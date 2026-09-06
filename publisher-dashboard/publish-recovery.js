'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { browserIdentity } = require('./topic-browser-source');

function recoveryError(message, code, statusCode = 409) {
  return Object.assign(new Error(message), { statusCode, apiCode: code });
}

function retryResolution(record, platform) {
  const resolution = record?.resolutions?.[platform];
  return resolution?.state === 'retry_allowed'
    && resolution.decision === 'confirmed_not_submitted'
    && resolution.confirmation === true ? resolution : null;
}

// The journal is the single commit point. SQLite keeps the original outcome;
// this read-only projection supplies the effective job version and resolution.
function projectRecoveryJob(job, record) {
  if (!job || !record || record.result?.jobId !== job.id
    || record.signature?.contentId !== job.content_id) return job;
  const resolutions = {};
  const results = [...job.results];
  for (const platform of job.platforms) {
    const resolution = retryResolution(record, platform);
    const result = results.find(item => item.platform === platform);
    if (!resolution || ['success', 'platform_draft'].includes(result?.status)) continue;
    resolutions[platform] = resolution;
    const projected = { ...result, platform, original_status: result?.status || 'uncertain',
      status: 'retry_allowed', resolution };
    if (result) results[results.indexOf(result)] = projected;
    else results.push(projected);
  }
  if (!Object.keys(resolutions).length) return job;
  const resolved = job.platforms.every(platform => results.some(result => result.platform === platform
    && ['success', 'platform_draft', 'retry_allowed'].includes(result.status)));
  return { ...job, results, resolutions, original_status: job.status,
    status: resolved ? 'retry_allowed' : job.status,
    updated_at: [job.updated_at, ...Object.values(resolutions).map(item => item.confirmedAt)].sort().at(-1) };
}

function canResolveJobPlatform(job, record, platform) {
  if (!job || !record || record.state !== 'uncertain' || record.result?.jobId !== job.id
    || record.signature?.contentId !== job.content_id || !job.platforms.includes(platform)
    || !record.signature.platforms.includes(platform) || retryResolution(record, platform)) return false;
  if ([job.status, record.result.jobStatus].some(status => ['published', 'draft_saved', 'success', 'platform_draft'].includes(status))) return false;
  const statuses = [...job.results, ...(record.result.platformResults || [])]
    .filter(item => item.platform === platform).map(item => item.status);
  if (statuses.some(status => ['success', 'platform_draft'].includes(status))) return false;
  return !statuses.length || statuses.every(status => ['failed', 'uncertain'].includes(status));
}

async function bounded(operation, timeoutMs) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(recoveryError('浏览器会话检查超时，请稍后重新核对', 'SESSION_PROBE_TIMEOUT'));
    }, timeoutMs);
  });
  try { return await Promise.race([Promise.resolve().then(() => operation(controller.signal)), timeout]); }
  finally { clearTimeout(timer); }
}

async function readVersion(port, { signal }) {
  const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal, redirect: 'error' });
  if (!response.ok) throw recoveryError('该端口未提供有效浏览器会话', 'SESSION_MISMATCH');
  return response.json();
}

// Commands are sent to the exact browser-instance socket, never /json/new on
// a reusable port. Activation is only used by an explicit open action;
// inspection never sends target commands. No navigation or page scripts.
function browserCommand(endpoint, method, params, { signal }) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(endpoint);
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      try { socket.close(); } catch { /* already closed */ }
      error ? reject(error) : resolve(value);
    };
    const abort = () => finish(recoveryError('浏览器连接超时', 'SESSION_PROBE_TIMEOUT'));
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    socket.addEventListener('open', () => socket.send(JSON.stringify({ id: 1, method, params })), { once: true });
    socket.addEventListener('error', () => finish(recoveryError('原浏览器实例已断开，请重新检查', 'SESSION_MISMATCH')), { once: true });
    socket.addEventListener('close', () => finish(recoveryError('原浏览器实例已断开，请重新检查', 'SESSION_MISMATCH')), { once: true });
    socket.addEventListener('message', event => {
      let reply;
      try { reply = JSON.parse(String(event.data)); } catch { finish(recoveryError('浏览器响应无效', 'SESSION_MISMATCH')); return; }
      if (reply.id === 1) finish(reply.error ? recoveryError('浏览器未完成恢复操作', 'SESSION_MISMATCH') : null, reply.result);
    });
  });
}

async function reopenBrowser(session, url, { signal, spawnBrowser = spawn }) {
  const activePortFile = path.join(session.userDataDir, 'DevToolsActivePort');
  const before = fs.existsSync(activePortFile) ? fs.readFileSync(activePortFile, 'utf8') : '';
  // A dynamically allocated port plus the newly written profile identity avoids
  // adopting another process that takes over the old debugging port during launch.
  const child = spawnBrowser(session.browserPath, ['--remote-debugging-port=0',
    `--user-data-dir=${session.userDataDir}`, '--no-first-run', '--no-default-browser-check', '--new-window', url],
  { detached: true, stdio: 'ignore' });
  let launchError;
  child.on('error', error => { launchError = error; });
  child.unref();
  while (!signal.aborted) {
    if (launchError || child.exitCode !== null || child.signalCode !== null) {
      throw recoveryError('平台浏览器未能重新打开，请重新登录', 'SESSION_REOPEN_FAILED');
    }
    let current = '';
    try { current = fs.readFileSync(activePortFile, 'utf8'); } catch { /* browser still starting */ }
    if (current && current !== before) {
      const [rawPort, browserPath] = current.trim().split(/\r?\n/);
      const port = Number(rawPort);
      const version = { Browser: 'Chrome/recovery', webSocketDebuggerUrl: `ws://127.0.0.1:${port}${browserPath}` };
      let identity;
      try { identity = browserIdentity(version, port); }
      catch { throw recoveryError('重开浏览器的实例记录无效，未更新登录会话', 'SESSION_MISMATCH'); }
      return { port, webSocketDebuggerUrl: identity };
    }
    await new Promise(resolve => {
      const abort = () => { clearTimeout(timer); resolve(); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 80);
      signal.addEventListener('abort', abort, { once: true });
    });
  }
  throw recoveryError('平台浏览器重开超时，请核对窗口后再继续', 'SESSION_REOPEN_FAILED');
}

function createSessionRecovery(options) {
  const read = options.readSession;
  const exists = options.profileExists || (directory => fs.existsSync(directory) && fs.statSync(directory).isDirectory());
  const version = options.readVersion || readVersion;
  const command = options.browserCommand || browserCommand;
  const opener = options.opener || ((session, url, context) => reopenBrowser(session, url,
    { ...context, spawnBrowser: options.spawnBrowser }));
  const probeTimeoutMs = Math.min(5000, Math.max(10, options.probeTimeoutMs || 1500));
  const reopenTimeoutMs = Math.min(20000, Math.max(10, options.reopenTimeoutMs || 12000));
  const openings = new Map();
  const probe = session => bounded(signal => version(session.port, { signal }), probeTimeoutMs);
  const sameSession = (left, right) => left && right && ['platform', 'browserPath', 'userDataDir', 'port', 'webSocketDebuggerUrl']
    .every(key => left[key] === right[key]);

  async function inspect(platform, force = false) {
    if (!force && !options.requiresSession(platform)) {
      return { state: 'not_required', message: '该平台的发布流程无需保留浏览器窗口' };
    }
    const session = read(platform);
    if (!session || !session.browserPath || !session.userDataDir || !Number.isInteger(session.port)
      || session.port < 1 || session.port > 65535 || !exists(session.userDataDir)) {
      return { state: 'missing', message: '平台登录会话或原登录目录不存在，请重新登录' };
    }
    if ((session.platform && session.platform !== platform) || !session.webSocketDebuggerUrl) {
      return { state: 'mismatch', message: '登录记录缺少有效的原浏览器实例身份，请重新登录' };
    }
    try {
      browserIdentity({ Browser: 'Chrome/record', webSocketDebuggerUrl: session.webSocketDebuggerUrl }, session.port);
      const identity = browserIdentity(await probe(session), session.port);
      if (identity !== session.webSocketDebuggerUrl) throw new Error('identity mismatch');
      return { state: 'open', message: '原平台浏览器仍在运行，可继续核对原稿' };
    } catch (error) {
      // Only a refused local TCP connection proves the saved listener is closed.
      // Timeout, invalid JSON, HTTP errors or an occupied port must never launch.
      const closed = error.code === 'ECONNREFUSED' || error.cause?.code === 'ECONNREFUSED';
      return { state: closed ? 'closed' : 'mismatch', message: closed
        ? '原平台浏览器已关闭，可沿原登录目录重新打开；发布结果仍需人工核对'
        : '无法确认原浏览器实例身份（端口不匹配或检查超时），已停止连接，请重新核对登录会话' };
    }
  }

  async function open(platform, url) {
    const session = { ...read(platform) };
    const state = await inspect(platform, true);
    if (!['open', 'closed'].includes(state.state)) throw recoveryError(state.message, `SESSION_${state.state.toUpperCase()}`);
    const assertUnchanged = () => {
      if (!sameSession(session, read(platform))) throw recoveryError('登录会话记录已变化，请重新检查', 'SESSION_MISMATCH');
    };
    assertUnchanged();
    let recoveryType;
    let tabId;
    if (state.state === 'closed') {
      const recheck = await inspect(platform, true);
      if (recheck.state !== 'closed') throw recoveryError('浏览器状态已变化，请重新检查', 'SESSION_MISMATCH');
      assertUnchanged();
      const launched = await bounded(signal => opener(session, url, { signal }), reopenTimeoutMs);
      const identity = browserIdentity(await probe(launched), launched.port);
      if (identity !== launched.webSocketDebuggerUrl) throw recoveryError('重开浏览器身份不匹配，未连接其他实例', 'SESSION_MISMATCH');
      assertUnchanged();
      Object.assign(session, { port: launched.port, webSocketDebuggerUrl: identity, platform });
      options.writeSession(session);
      recoveryType = 'reopened';
    } else {
      const identity = browserIdentity(await probe(session), session.port);
      if (identity !== session.webSocketDebuggerUrl) throw recoveryError('登录浏览器身份不匹配，未打开其他浏览器', 'SESSION_MISMATCH');
      assertUnchanged();
      const targets = await bounded(signal => command(identity, 'Target.getTargets', {}, { signal }), probeTimeoutMs);
      if (!Array.isArray(targets?.targetInfos)) throw recoveryError('无法读取原会话标签页', 'SESSION_MISMATCH');
      const target = targets.targetInfos.find(item => item.type === 'page' && item.url === url);
      if (target) {
        if (!target.targetId) throw recoveryError('原稿标签页缺少有效标识', 'SESSION_MISMATCH');
        assertUnchanged();
        await bounded(signal => command(identity, 'Target.activateTarget', { targetId: target.targetId }, { signal }), probeTimeoutMs);
        recoveryType = 'reused'; tabId = target.targetId;
      }
      else {
        assertUnchanged();
        const params = { url, background: false,
          ...(!targets.targetInfos.some(item => item.type === 'page') ? { newWindow: true } : {}) };
        const created = await bounded(signal => command(identity, 'Target.createTarget', params, { signal }), probeTimeoutMs);
        if (!created?.targetId) throw recoveryError('无法在原会话打开链接', 'SESSION_MISMATCH');
        recoveryType = 'new_tab'; tabId = created.targetId;
      }
    }
    return { platform, url, port: session.port, userDataDir: session.userDataDir, recoveryType, ...(tabId ? { tabId } : {}) };
  }

  return { inspect, open(platform, url) {
    if (openings.has(platform)) throw recoveryError('该平台窗口正在恢复，请等待完成', 'SESSION_OPEN_IN_PROGRESS');
    const task = open(platform, url);
    openings.set(platform, task);
    return task.finally(() => openings.delete(platform));
  } };
}

module.exports = { recoveryError, retryResolution, projectRecoveryJob, canResolveJobPlatform, createSessionRecovery };
