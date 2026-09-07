'use strict';

const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const { resolveLoginRoot } = require('../runtime/browser.cjs');
const { parseHTML } = (() => {
  try { return require('linkedom'); } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
    return createRequire(path.resolve(__dirname, '../packages/core/package.json'))('linkedom');
  }
})();

const BROWSER_PLATFORMS = Object.freeze(['douyin', 'xiaohongshu', 'zhihu']);
const CONFIG = Object.freeze({
  douyin: { url: 'https://www.douyin.com/hot', hosts: ['www.douyin.com', 'douyin.com'], kind: 'official_hot_list' },
  xiaohongshu: { url: 'https://www.xiaohongshu.com/explore', hosts: ['www.xiaohongshu.com', 'xiaohongshu.com'], kind: 'recommendation_feed' },
  zhihu: { url: 'https://www.zhihu.com/hot', hosts: ['www.zhihu.com', 'zhihu.com'], kind: 'official_hot_list' },
});
const LOGIN_ROOT = resolveLoginRoot({ cwd: path.resolve(__dirname, '..') });
const METHODS = new Set(['Target.createTarget', 'Target.attachToTarget', 'Target.closeTarget',
  'Page.enable', 'Page.getFrameTree', 'Page.navigate', 'Page.createIsolatedWorld',
  'Fetch.enable', 'Fetch.continueRequest', 'Fetch.failRequest', 'Runtime.evaluate']);
const MAX_MESSAGE = 256 * 1024;

class BrowserSourceError extends Error {
  constructor(code, reason, status = 'needs_browser') { super(reason); this.code = code; this.status = status; }
}
function fail(code, reason, status) { throw new BrowserSourceError(code, reason, status); }
function safePageUrl(raw, platform, base) {
  if (typeof raw !== 'string' || raw.length > 8192 || /[\u0000-\u0020\u007f\\]/u.test(raw)) fail('unsafe_page', '页面地址不安全', 'source_unavailable');
  let url;
  try { url = new URL(raw, base); } catch { fail('unsafe_page', '页面地址无效', 'source_unavailable'); }
  if (url.protocol !== 'https:' || url.port || url.username || url.password || !CONFIG[platform].hosts.includes(url.hostname)) {
    fail('unsafe_page', '已阻止跨平台或非官方页面跳转', 'source_unavailable');
  }
  return url;
}
function safeSocket(raw, port) {
  if (typeof raw !== 'string' || raw.length > 1024 || !/^ws:\/\/127\.0\.0\.1:[1-9]\d{0,4}\/devtools\/browser\/[a-zA-Z0-9-]{1,128}$/.test(raw)) fail('invalid_session', '项目浏览器会话地址无效');
  let url;
  try { url = new URL(raw); } catch { fail('invalid_session', '项目浏览器会话地址无效'); }
  if (url.protocol !== 'ws:' || url.hostname !== '127.0.0.1' || Number(url.port) !== port ||
    url.username || url.password || url.search || url.hash || !/^\/devtools\/browser\/[a-zA-Z0-9-]{1,128}$/.test(url.pathname)) {
    fail('invalid_session', 'CDP 地址必须是与会话端口一致的 127.0.0.1 浏览器端点');
  }
  return url.href;
}
function validateSession(session, platform) {
  if (!session || typeof session !== 'object' || Array.isArray(session) ||
      !Number.isInteger(session.port) || session.port < 1 || session.port > 65535 ||
      (session.platform !== undefined && session.platform !== platform)) fail('invalid_session', '项目登录会话记录无效，请在工作台重新进行平台登录');
  if (session.webSocketDebuggerUrl === undefined) fail('stale_session', '旧登录记录缺少浏览器实例身份，请在工作台重新登录连接', 'needs_login');
  safeSocket(session.webSocketDebuggerUrl, session.port);
  // browserPath, userDataDir, loginUrl and any other session fields are never
  // executed, followed or used to select files. There is no browser launch.
  return { port: session.port, webSocketDebuggerUrl: session.webSocketDebuggerUrl };
}
function browserIdentity(version, port) {
  if (!version || !/^(?:Chrome|Chromium|HeadlessChrome|Edg)\//.test(version.Browser || '')) fail('invalid_session', '该端口不是有效的项目浏览器 CDP 会话');
  return safeSocket(version.webSocketDebuggerUrl, port);
}
async function readSession(platform) {
  try {
    for (const directory of [LOGIN_ROOT, path.join(LOGIN_ROOT, platform)]) {
      const stat = await fs.lstat(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) fail('invalid_session', '登录会话目录不能是符号链接');
    }
    const file = await fs.open(path.join(LOGIN_ROOT, platform, 'session.json'), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > 16384) fail('invalid_session', '登录会话文件类型或大小无效');
      const buffer = Buffer.alloc(16385);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      if (bytesRead > 16384) fail('invalid_session', '登录会话文件超过大小上限');
      return JSON.parse(buffer.subarray(0, bytesRead).toString('utf8').replace(/^\uFEFF/, ''));
    } finally { await file.close(); }
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    if (error instanceof BrowserSourceError) throw error;
    fail('invalid_session', '项目登录会话文件无法安全读取，请在工作台重新进行平台登录');
  }
}
function readVersion(port, { signal }) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: '127.0.0.1', port, path: '/json/version', agent: false, signal,
      headers: { Accept: 'application/json' } }, res => {
      if (res.statusCode !== 200 || Number(res.headers['content-length']) > 16384) {
        res.destroy(); reject(new BrowserSourceError('not_connected', '项目登录浏览器未提供有效 CDP 会话，请先在工作台平台登录')); return;
      }
      let size = 0; const chunks = [];
      res.on('data', data => {
        size += data.length;
        if (size > 16384) { res.destroy(); reject(new BrowserSourceError('invalid_session', 'CDP 响应超过大小上限')); }
        else chunks.push(data);
      });
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new BrowserSourceError('invalid_session', 'CDP 会话响应无效')); } });
      res.on('error', reject);
    });
    req.on('error', reject);
  });
}
function bounded(operation, signal, timeout = 3000) {
  return new Promise((resolve, reject) => {
    let timer; let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', expire); callback(value);
    };
    const expire = () => finish(reject, new BrowserSourceError('browser_timeout', '项目浏览器连接或加载超时，请确认工作台登录浏览器仍在运行'));
    if (signal?.aborted) return expire();
    timer = setTimeout(expire, timeout);
    signal?.addEventListener('abort', expire, { once: true });
    Promise.resolve().then(operation).then(value => finish(resolve, value), error => finish(reject, error));
  });
}

async function connectSocket(endpoint, { signal }) {
  const socket = new WebSocket(endpoint);
  try {
    await bounded(() => new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', () => reject(new BrowserSourceError('not_connected', '无法连接项目登录浏览器，请先在工作台平台登录')), { once: true });
    }), signal);
  } catch (error) { socket.close(); throw error; }
  const pending = new Map(); const listeners = new Set(); let sequence = 0;
  function disconnect() {
    for (const { reject, timer } of pending.values()) { clearTimeout(timer); reject(new BrowserSourceError('not_connected', '项目浏览器会话已断开')); }
    pending.clear();
  }
  socket.addEventListener('close', disconnect);
  socket.addEventListener('error', disconnect);
  socket.addEventListener('message', event => {
    if (typeof event.data !== 'string' || Buffer.byteLength(event.data) > MAX_MESSAGE) { disconnect(); socket.close(); return; }
    let message;
    try { message = JSON.parse(event.data); } catch { disconnect(); socket.close(); return; }
    const request = pending.get(message.id);
    if (request) {
      pending.delete(message.id); clearTimeout(request.timer);
      if (message.error) request.reject(new BrowserSourceError('cdp_error', '浏览器不支持或未完成本次只读采集操作'));
      else request.resolve(message.result);
    } else if (message.method) for (const listener of listeners) listener(message);
  });
  return {
    send(method, params = {}, sessionId) {
      if (!METHODS.has(method)) return Promise.reject(new BrowserSourceError('unsafe_method', 'CDP 方法不在只读采集白名单中'));
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new BrowserSourceError('cdp_timeout', '浏览器采集指令超时')); }, 3000);
        pending.set(id, { resolve, reject, timer });
        try { socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); }
        catch { clearTimeout(timer); pending.delete(id); reject(new BrowserSourceError('not_connected', '项目浏览器会话已断开')); }
      });
    },
    onEvent(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    close() { disconnect(); listeners.clear(); socket.close(); },
  };
}

// This fixed expression is the ONLY Runtime.evaluate program. It runs in an
// isolated world, reads rendered DOM, and returns a bounded typed projection.
// No input scripts/selectors/CDP methods, cookies, storage, HTML or page globals.
function visibleSnapshot(platform, maxItems) {
  const visible = node => {
    if (!node || !node.getClientRects().length) return false;
    for (let element = node; element; element = element.parentElement) {
      const style = getComputedStyle(element);
      if (element.hidden || element.getAttribute('aria-hidden') === 'true' || style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    }
    return true;
  };
  const text = (node, max = 240) => visible(node) ? (node.innerText || node.textContent || '').trim().slice(0, max) : '';
  const hasVisible = selector => [...document.querySelectorAll(selector)].some(visible);
  const title = (document.title || '').slice(0, 240);
  const dialogs = [...document.querySelectorAll('[role="dialog"],.login-container,.login-modal,.SignFlow,.Modal-content')].filter(visible);
  const challenge = /验证码|安全验证|captcha|access denied/i.test(title) || hasVisible('[id*="captcha"], [class*="captcha"], [id*="verify-bar"]');
  const login = /^(?:登录|登陆)|sign\s?in/i.test(title) || /\/(?:signin|login)(?:\/|$)/.test(location.pathname) ||
    dialogs.some(node => {
      const words = text(node, 1200);
      if (/扫码登录|请先登录|登录后|手机号登录|验证码登录/.test(words)) return true;
      const loginWords = /登录|登陆|注册|sign\s*in|log\s*in|register/i.test(words);
      const loginForm = node.querySelector('input[type="password"],input[type="tel"],input[autocomplete="username"],input[placeholder*="手机"],input[placeholder*="邮箱"]');
      const loginContainer = node.matches('.login-container,.login-modal,.SignFlow');
      const loginButton = [...node.querySelectorAll('button,[role="button"]')].some(button => /登录|登陆|注册|sign\s*in|log\s*in/i.test(text(button,80)));
      return loginWords && Boolean(loginForm || loginContainer || loginButton);
    });
  const result = { url: location.href.slice(0, 8192), ready: document.readyState, login, challenge, items: [] };
  if (challenge || login) return result;
  const add = (card, anchor, titleNode, metrics = {}, nativeId) => {
    if (!visible(card) || !visible(anchor)) return;
    const itemTitle = text(titleNode) || (anchor.getAttribute('title') || '').slice(0, 240);
    if (!itemTitle) return;
    const date = card.querySelector('time[datetime]');
    result.items.push({ title: itemTitle, url: anchor.href, metrics, ...(nativeId ? { nativeId } : {}),
      ...(visible(date) ? { publishedAt: date.getAttribute('datetime') } : {}) });
  };
  if (platform === 'xiaohongshu') {
    for (const card of [...document.querySelectorAll('section.note-item')].slice(0, 150)) {
      const anchor = card.querySelector('a.title[href]');
      add(card, anchor, anchor, { likeCount: text(card.querySelector('.like-wrapper .count'), 40) });
      if (result.items.length >= maxItems) break;
    }
  } else if (platform === 'zhihu') {
    for (const card of [...document.querySelectorAll('.HotItem')].slice(0, 150)) {
      add(card, card.querySelector('a.HotItem-content[href],a[href*="/question/"]'), card.querySelector('.HotItem-title'), {
        rank: text(card.querySelector('.HotItem-rank'), 8), heatText: text(card.querySelector('.HotItem-metrics'), 60),
      });
      if (result.items.length >= maxItems) break;
    }
  } else {
    for (const anchor of [...document.querySelectorAll('a[href*="/hot/"],a[href*="hot_id="]')].slice(0, 150)) {
      const card = anchor.closest('[data-e2e="hot-list-item"],li') || anchor;
      const nativeId = anchor.href.match(/\/hot\/(\d+)/)?.[1] || new URL(anchor.href).searchParams.get('hot_id');
      add(card, anchor, anchor.querySelector('[data-e2e*="title"],[class*="title"]') || anchor, {
        rank: text(card.querySelector('[data-e2e*="rank"],[class*="rank"]'), 8),
        heatText: text(card.querySelector('[data-e2e*="hot-value"],[class*="hotValue"]'), 60),
      }, nativeId);
      if (result.items.length >= maxItems) break;
    }
  }
  if (!result.items.length && /请先登录|扫码登录|登录后查看|登录探索更多/.test((document.body?.innerText || '').slice(0, 2000))) result.login = true;
  return result;
}

function clean(value, length = 240) {
  if (typeof value !== 'string') return '';
  let text = value.slice(0, 12000);
  for (let i = 0; i < 2; i++) {
    const { document } = parseHTML(`<html><body>${text}</body></html>`);
    document.querySelectorAll('script,style,iframe,svg,object,template').forEach(node => node.remove());
    text = document.body.textContent;
  }
  return [...text.replace(/[<>\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim()].slice(0, length).join('');
}
function numeric(value) {
  if (!['string', 'number'].includes(typeof value)) return undefined;
  const match = String(value).trim().replace(/,/g, '').match(/^(\d+(?:\.\d+)?)\s*(万|亿|k|m)?$/i);
  if (!match) return undefined;
  const number = Number(match[1]) * ({ 万: 1e4, 亿: 1e8, k: 1e3, m: 1e6 }[match[2]?.toLowerCase()] || 1);
  return Number.isFinite(number) && number <= Number.MAX_SAFE_INTEGER ? number : undefined;
}
function normalizeRows(rows, platform, sourceUrl, capturedAt, limit) {
  const items = new Map(); let dropped = 0;
  for (const row of rows.slice(0, 150)) {
    const title = clean(row?.title); let url;
    try { url = safePageUrl(row?.url, platform, sourceUrl); } catch { dropped++; continue; }
    if (!title) { dropped++; continue; }
    const metrics = {};
    for (const field of ['rank', 'likeCount']) {
      const number = numeric(row.metrics?.[field]);
      if (number !== undefined && (field !== 'rank' || (Number.isInteger(number) && number > 0))) metrics[field] = number;
    }
    const heat = clean(row.metrics?.heatText, 60);
    if (heat) metrics.heatText = heat;
    const limitations = ['article_body_not_read'];
    let publishedAt;
    if (typeof row.publishedAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(row.publishedAt)) {
      const time = Date.parse(row.publishedAt);
      const day = new Date(`${row.publishedAt.slice(0, 10)}T00:00:00Z`);
      if (Number.isFinite(time) && Number.isFinite(day.getTime()) && day.toISOString().slice(0, 10) === row.publishedAt.slice(0, 10) && time <= Date.parse(capturedAt)) publishedAt = new Date(time).toISOString();
      else limitations.push('invalid_or_future_publication_date_omitted');
    }
    if (!publishedAt) limitations.push('publication_date_unknown');
    if (!Object.keys(metrics).length) limitations.push('popularity_unknown');
    if (platform === 'xiaohongshu') limitations.push('personalized_recommendation_not_global_hot_list');
    const nativeId = clean(row.nativeId, 160);
    const key = nativeId ? `native:${nativeId}` : `${url.origin}${url.pathname}`.replace(/\/$/, '');
    const id = `${platform}:${createHash('sha256').update(key).digest('hex').slice(0, 24)}`;
    if (!items.has(id)) items.set(id, { id, platform, title, url: url.href, sourceUrl, capturedAt,
      sourceKind: CONFIG[platform].kind, evidenceLevel: 'title_only', metrics, limitations,
      ...(publishedAt ? { publishedAt } : {}) });
  }
  return { items: [...items.values()].slice(0, limit), dropped };
}

/**
 * Reuse ONLY this worktree's active .creator-login/<platform>/session.json.
 * Public input: {platform: douyin|xiaohongshu|zhihu, limit?:1..50}. All other
 * fields are rejected. No launching, focus, cookies, saved user-tab selection,
 * input scripts, browser settings, or account/session writes.
 * Returns the same platform/item shape as collectTopicSignals, plus code.
 * Trusted test deps only: readSession(platform), readVersion(port,{signal}),
 * connect(endpoint,{signal})->{send,onEvent,close}, now(), sleep(ms), timeoutMs.
 */
async function collectBrowserTopicSignals(options, injected = {}) {
  if (!options || Object.keys(options).some(key => !['platform', 'limit'].includes(key))) throw new TypeError('Only platform and limit are accepted');
  const { platform, limit = 10 } = options;
  if (!BROWSER_PLATFORMS.includes(platform) || !Number.isInteger(limit) || limit < 1 || limit > 50) throw new TypeError('Invalid browser topic platform or limit');
  const deps = { readSession, readVersion, connect: connectSocket, now: Date.now,
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)), timeoutMs: 18000, ...injected };
  const config = CONFIG[platform];
  const result = { id: platform, status: 'needs_browser', sourceUrl: config.url, reason: '', items: [], capturedAt: new Date(deps.now()).toISOString() };
  const controller = new AbortController(); const signal = controller.signal;
  const deadline = setTimeout(() => controller.abort(), Math.max(1, Math.min(18000, Number(deps.timeoutMs) || 18000)));
  let client; let targetId; let sessionId; let mainFrame; let removeEvents; let blockedNavigation = false; let creationRequested = false;
  const send = (method, params = {}, page = true) => bounded(() => client.send(method, params, page ? sessionId : undefined), signal);
  try {
    const rawSession = await bounded(() => deps.readSession(platform), signal);
    if (!rawSession) fail('no_session', '未找到项目活跃登录会话，请先在工作台“平台登录”中登录该平台，并保持登录浏览器运行', 'needs_login');
    const session = validateSession(rawSession, platform);
    let version;
    try { version = await bounded(() => deps.readVersion(session.port, { signal }), signal, 2000); }
    catch (error) { if (error instanceof BrowserSourceError) throw error; fail('not_connected', '项目登录浏览器未连接，请先在工作台平台登录并保持浏览器运行'); }
    const endpoint = browserIdentity(version, session.port);
    if (endpoint !== session.webSocketDebuggerUrl) fail('stale_session', '项目会话与当前浏览器不一致，请在工作台重新进行平台登录', 'needs_login');
    client = await bounded(() => deps.connect(endpoint, { signal }), signal);
    creationRequested = true;
    const created = await send('Target.createTarget', { url: 'about:blank', background: true }, false);
    const candidate = created?.targetId;
    if (typeof candidate !== 'string' || !/^[a-zA-Z0-9-]{1,128}$/.test(candidate)) fail('cdp_error', '无法创建自己的后台采集标签页');
    targetId = candidate;
    const attached = await send('Target.attachToTarget', { targetId, flatten: true }, false);
    sessionId = attached?.sessionId;
    if (typeof sessionId !== 'string' || !/^[a-zA-Z0-9-]{1,128}$/.test(sessionId)) fail('cdp_error', '无法连接自己的后台采集标签页');
    await send('Page.enable');
    mainFrame = (await send('Page.getFrameTree'))?.frameTree?.frame?.id;
    if (!mainFrame) fail('cdp_error', '无法确认采集标签页主框架');
    removeEvents = client.onEvent(message => {
      if (message.sessionId !== sessionId) return;
      if (message.method === 'Fetch.requestPaused') {
        const params = message.params || {};
        let allowed = false;
        try { safePageUrl(params.request?.url, platform); allowed = ['GET', 'HEAD'].includes(params.request?.method); } catch { /* blocked before navigation */ }
        if (!allowed && params.frameId === mainFrame) blockedNavigation = true;
        client.send(allowed ? 'Fetch.continueRequest' : 'Fetch.failRequest', allowed
          ? { requestId: params.requestId } : { requestId: params.requestId, errorReason: 'BlockedByClient' }, sessionId)
          .catch(() => { blockedNavigation = true; });
      }
      if (message.method === 'Page.frameNavigated' && !message.params?.frame?.parentId) {
        try { safePageUrl(message.params.frame.url, platform); } catch { blockedNavigation = true; }
      }
    });
    // Only this newly attached target is affected. Document interception blocks
    // off-platform top-level/iframe redirects before loading those documents;
    // the site's normal CDN subresources are left to the logged-in browser.
    await send('Fetch.enable', { patterns: [{ urlPattern: '*', resourceType: 'Document', requestStage: 'Request' }] });
    const navigation = await send('Page.navigate', { url: config.url });
    if (navigation?.errorText && !blockedNavigation) fail('navigation_failed', '官方页面加载失败，未继续尝试', 'source_unavailable');
    for (let attempt = 0; attempt < 12; attempt++) {
      if (blockedNavigation) fail('unsafe_page', '已阻止跨平台或非官方页面跳转', 'source_unavailable');
      const frame = (await send('Page.getFrameTree'))?.frameTree?.frame;
      if (frame?.url === 'about:blank') { await bounded(() => deps.sleep(500), signal); continue; }
      safePageUrl(frame?.url, platform);
      const world = await send('Page.createIsolatedWorld', { frameId: frame.id, worldName: 'creator-topic-reader', grantUniveralAccess: false });
      if (!Number.isInteger(world?.executionContextId)) fail('cdp_error', '无法创建只读采集上下文');
      const evaluated = await send('Runtime.evaluate', { contextId: world.executionContextId,
        expression: `(${visibleSnapshot.toString()})(${JSON.stringify(platform)},${Math.min(150, limit * 3)})`,
        returnByValue: true, awaitPromise: false, userGesture: false, timeout: 1500 });
      if (evaluated?.exceptionDetails) fail('dom_unavailable', '当前页面无法完成只读 DOM 采集', 'source_unavailable');
      const snapshot = evaluated?.result?.value;
      if (!snapshot || !Array.isArray(snapshot.items) || snapshot.items.length > 150) fail('invalid_dom', '页面返回的选题结构无效', 'source_unavailable');
      const currentUrl = safePageUrl(snapshot.url, platform).href;
      if (blockedNavigation) fail('unsafe_page', '已阻止跨平台或非官方页面跳转', 'source_unavailable');
      if (snapshot.challenge) fail('access_challenge', '官方页面要求验证码或安全验证，请在工作台登录浏览器中自行完成；采集已停止', 'needs_login');
      if (snapshot.login) fail('login_required', '当前平台仍要求登录，请先在工作台平台登录；采集已停止', 'needs_login');
      result.capturedAt = new Date(deps.now()).toISOString();
      const normalized = normalizeRows(snapshot.items, platform, currentUrl, result.capturedAt, limit);
      if (normalized.items.length) {
        result.items = normalized.items; result.status = normalized.dropped ? 'partial' : 'ok';
        result.sourceUrl = currentUrl;
        result.reason = platform === 'xiaohongshu' ? '已读取登录浏览器的可见推荐流；不是全站热榜' : '已读取官方页面当前 DOM 可见榜单条目';
        if (normalized.dropped) result.reason += `；已丢弃 ${normalized.dropped} 条无效或跨平台条目`;
        return result;
      }
      if (snapshot.items.length) fail('invalid_dom', '可见条目没有有效的标题和官方链接', 'source_unavailable');
      await bounded(() => deps.sleep(500), signal);
    }
    fail('empty_dom', '已连接项目浏览器，但有界等待后仍没有可见选题；请在工作台确认登录或页面可用性', 'needs_browser');
  } catch (error) {
    result.status = error instanceof BrowserSourceError ? error.status : 'needs_browser';
    result.code = error instanceof BrowserSourceError ? error.code : 'browser_unavailable';
    result.reason = error instanceof BrowserSourceError ? error.message : '项目浏览器会话不可用，请先在工作台平台登录并保持浏览器运行';
    return result;
  } finally {
    controller.abort();
    clearTimeout(deadline);
    // Never Browser.close or any existing target. Cleanup gets its own short
    // budget even after the collection timed out.
    if (client && targetId) {
      try {
        const closed = await bounded(() => client.send('Target.closeTarget', { targetId }), null, 2500);
        if (closed?.success === false) throw new Error('close failed');
      } catch {
        result.status = result.items.length ? 'partial' : 'needs_browser';
        result.code = 'cleanup_failed'; result.reason += '；自己的采集标签页未确认关闭，请在工作台检查';
      }
    }
    if (creationRequested && !targetId) {
      result.status = 'needs_browser'; result.code = 'creation_unconfirmed';
      result.reason += '；后台标签页创建结果未确认，未操作任何已有标签页，请在工作台检查';
    }
    removeEvents?.();
    try { client?.close(); } catch { /* no browser-wide cleanup or retry */ }
  }
}

module.exports = { BROWSER_PLATFORMS, collectBrowserTopicSignals, browserIdentity };
