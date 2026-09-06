'use strict';

const assert = require('node:assert/strict');
const { test, after } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createSessionRecovery } = require('../publish-recovery');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-recovery-test-'));
process.env.PUBLISHER_DB = path.join(scratch, 'publisher.sqlite');
process.env.PUBLISHER_DATA_DIR = scratch;
process.env.PUBLISHER_OPERATIONS_FILE = path.join(scratch, 'default-operations.json');
process.env.WEIBOT_COOKIE_FILE = path.join(scratch, 'unused-cookies.json');
const { db, createDashboardServer, createOperationJournal, importContent, updateContent,
  getDashboardData, buildPublishOperationSignature, DRAFTS_DIR } = require('../server');

after(() => { db.close(); fs.rmSync(scratch, { recursive: true, force: true }); });
let sequence = 0;
// General recovery must also work without the optional private Xiaohongshu adapter.
const RECOVERY_PLATFORM = 'toutiao';
const draftUrl = 'https://mp.toutiao.com/profile_v4/graphic/publish?article_id=original-42';
const ws = (id = 'original', port = 9444) => `ws://127.0.0.1:${port}/devtools/browser/${id}`;
const refused = () => Object.assign(new Error('refused'), { cause: { code: 'ECONNREFUSED' } });
const storedContent = id => getDashboardData().contents.find(item => item.id === id);

function fakeBrowser(overrides = {}) {
  const state = { session: { platform: RECOVERY_PLATFORM, port: 9444, browserPath: '/fake/browser',
    userDataDir: '/fake/original-profile', webSocketDebuggerUrl: ws() },
  reads: 0, commands: [], launches: [], writes: [], closed: false, exists: true,
  identity: ws(), targets: [{ type: 'page', targetId: 'draft-tab', url: draftUrl }], ...overrides };
  const dependencies = {
    readSession: () => state.session,
    profileExists: () => state.exists,
    requiresSession: platform => platform === RECOVERY_PLATFORM,
    readVersion: async () => {
      state.reads++;
      if (state.closed) throw refused();
      return { Browser: 'Chrome/140', webSocketDebuggerUrl: state.identity };
    },
    browserCommand: async (endpoint, method, params) => {
      state.commands.push({ endpoint, method, params });
      assert.equal(endpoint, state.identity);
      if (method === 'Target.getTargets') return { targetInfos: state.targets };
      if (method === 'Target.activateTarget') return {};
      assert.equal(method, 'Target.createTarget');
      return { targetId: 'created-tab' };
    },
    opener: async (session, url) => {
      state.launches.push({ session: { ...session }, url });
      state.closed = false;
      state.identity = ws('reopened', 9555);
      return { port: 9555, webSocketDebuggerUrl: state.identity };
    },
    writeSession: session => { state.writes.push({ ...session }); state.session = { ...session }; },
    probeTimeoutMs: 30,
    reopenTimeoutMs: 100,
  };
  return { state, dependencies, controller: createSessionRecovery(dependencies) };
}

async function fixture(t, overrides = {}) {
  const key = ++sequence;
  const content = importContent({ title: `恢复隔离稿 ${key}`, body: '原稿正文，不应在恢复中被改变。', format: 'markdown' });
  const journal = createOperationJournal({ filePath: path.join(scratch, `operations-${key}.json`) });
  const browser = fakeBrowser();
  let publisherCalls = 0;
  const server = createDashboardServer({ operationJournal: journal, recoveryDependencies: browser.dependencies,
    preflight: async () => null,
    platformPublisher: async () => { publisherCalls++; return { info: { status: 'uncertain', url: draftUrl, message: '没有明确回执' } }; },
    ...overrides });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const bootstrap = await (await fetch(`${origin}/api/bootstrap`)).json();
  const request = async (route, body, csrf = true) => {
    const response = await fetch(`${origin}${route}`, body === undefined ? {} : { method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin,
        ...(csrf ? { 'X-Workbench-CSRF': bootstrap.data.csrfToken } : {}) }, body: JSON.stringify(body) });
    return { status: response.status, ...await response.json() };
  };
  const publish = (operationId = `recovery-operation-${key}-0001`, platforms = [RECOVERY_PLATFORM]) => request(`/api/content/${content.id}/publish-platform`, {
    platform: platforms[0], publishMode: 'draft', operationId, expectedUpdatedAt: storedContent(content.id).updated_at,
  });
  const recovery = (platform = RECOVERY_PLATFORM) => request(`/api/content/${content.id}/recovery?platform=${platform}`);
  const confirm = (job, platform = RECOVERY_PLATFORM, extra = {}) => request(`/api/publish-jobs/${job.id}/recovery`, {
    platform, decision: 'confirmed_not_submitted', confirmation: true, expectedJobUpdatedAt: job.updated_at, ...extra,
  });
  return { content, journal, browser, request, publish, recovery, confirm, calls: () => publisherCalls, key };
}

function insertJob(f, statuses, state = 'uncertain') {
  const id = `test-job-${++sequence}`;
  const platforms = Object.keys(statuses);
  const at = new Date(Date.now() + sequence).toISOString();
  db.prepare('INSERT INTO publish_jobs (id,content_id,title,status,platforms,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
    .run(id, f.content.id, f.content.title, state, JSON.stringify(platforms), at, at);
  for (const [platform, status] of Object.entries(statuses)) {
    if (status) db.prepare('INSERT INTO publish_results (id,job_id,platform,status,message,url,created_at) VALUES (?,?,?,?,?,?,?)')
      .run(`${id}-${platform}`, id, platform, status, '原始回执', platform === RECOVERY_PLATFORM ? draftUrl : null, at);
  }
  const operationId = `fixture-operation-${sequence}-0001`;
  const signature = buildPublishOperationSignature(storedContent(f.content.id), platforms, 'draft', f.content.updated_at);
  f.journal.begin(operationId, signature);
  f.journal.attachJob(operationId, id);
  if (state !== 'running') f.journal.markUncertain(operationId, { jobId: id, jobStatus: state,
    platformResults: Object.entries(statuses).filter(([, status]) => status).map(([platform, status]) => ({ platform, status })) });
  return { id, updated_at: at, operationId, signature };
}

test('GET recovery returns the stored article and latest job for this article/platform without any writes', async t => {
  const f = await fixture(t);
  const older = insertJob(f, { [RECOVERY_PLATFORM]: 'uncertain' });
  insertJob(f, { zhihu: 'failed' });
  const beforeContent = storedContent(f.content.id);
  const beforeChanges = db.prepare('SELECT total_changes() n').get().n;
  const beforeJournal = fs.readFileSync(f.journal.filePath, 'utf8');
  const beforeStat = fs.statSync(f.journal.filePath);
  const response = await f.recovery();
  assert.equal(response.status, 200);
  assert.deepEqual(response.recovery.content, beforeContent);
  assert.equal(response.recovery.latestJob.id, older.id);
  assert.equal(response.recovery.session.state, 'open');
  assert.equal(response.recovery.canConfirmNotSubmitted, true);
  assert.equal(fs.readFileSync(f.journal.filePath, 'utf8'), beforeJournal);
  assert.equal(fs.statSync(f.journal.filePath).mtimeMs, beforeStat.mtimeMs);
  assert.equal(db.prepare('SELECT total_changes() n').get().n, beforeChanges);
  assert.equal(f.calls(), 0);
  assert.deepEqual(f.browser.state.commands, []);
  assert.deepEqual(f.browser.state.launches, []);
  assert.deepEqual(f.browser.state.writes, []);
  const none = await f.recovery('juejin');
  assert.equal(none.recovery.latestJob, null);
  assert.equal(none.recovery.canConfirmNotSubmitted, false);
  assert.equal(none.recovery.session.state, 'not_required');
});

test('uncertain/no-op save stays locked; explicit confirmation is audited, idempotent and does not change canonical revision', async t => {
  const f = await fixture(t);
  assert.ok(DRAFTS_DIR.startsWith(scratch));
  const initial = await f.publish();
  assert.equal(initial.status, 200);
  assert.equal(initial.job.status, 'uncertain');
  const content = storedContent(f.content.id);
  const saved = updateContent(content.id, { ...content, expectedUpdatedAt: content.updated_at });
  assert.notEqual(saved.updated_at, content.updated_at);
  const blocked = await f.publish(`no-op-still-locked-${f.key}-0002`);
  assert.equal(blocked.status, 409);
  assert.equal(blocked.code, 'PUBLISH_UNCERTAIN');
  assert.equal(f.calls(), 1);
  const before = storedContent(content.id);
  const beforeChanges = db.prepare('SELECT total_changes() n').get().n;
  const confirmed = await f.confirm(initial.job);
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.job.results[0].status, 'retry_allowed');
  assert.equal(confirmed.job.status, 'retry_allowed');
  assert.equal(confirmed.resolution.actor, 'user');
  assert.match(confirmed.resolution.statement, /未经平台验证/);
  assert.notEqual(confirmed.job.updated_at, initial.job.updated_at);
  assert.deepEqual(storedContent(content.id), before);
  assert.equal(db.prepare('SELECT total_changes() n').get().n, beforeChanges);
  assert.equal(f.calls(), 1);
  const beforeReplay = fs.readFileSync(f.journal.filePath, 'utf8');
  const repeat = await f.confirm(initial.job);
  assert.equal(repeat.status, 200);
  assert.equal(repeat.cached, true);
  assert.deepEqual(repeat.resolution, confirmed.resolution);
  assert.equal(fs.readFileSync(f.journal.filePath, 'utf8'), beforeReplay);
  const latest = await f.recovery();
  assert.equal(latest.recovery.latestJob.updated_at, confirmed.job.updated_at);
  assert.equal(latest.recovery.canConfirmNotSubmitted, false);
  const history = await f.request('/api/history');
  assert.equal(history.jobs.find(job => job.id === initial.job.id).results[0].status, 'retry_allowed');
  assert.equal((await f.publish()).status, 409); // Old operationId remains unusable.
  const retried = await f.publish(`manual-new-operation-${f.key}-0003`);
  assert.equal(retried.status, 200);
  assert.equal(f.calls(), 2);
  assert.notEqual(retried.job.id, initial.job.id);
  // A delayed duplicate confirmation for the old attempt cannot release the new one.
  assert.equal((await f.confirm(initial.job)).cached, true);
  assert.equal((await f.publish(`new-attempt-stays-locked-${f.key}-0004`)).code, 'PUBLISH_UNCERTAIN');
  assert.equal(f.calls(), 2);
});

test('batch recovery only releases the selected failed platform and never success/platform_draft', async t => {
  const f = await fixture(t);
  const job = insertJob(f, { [RECOVERY_PLATFORM]: 'failed', douyin: 'uncertain', zhihu: 'success', weixin: 'platform_draft' });
  for (const platform of ['zhihu', 'weixin']) {
    const rejected = await f.confirm(job, platform);
    assert.equal(rejected.status, 409);
    assert.equal(rejected.code, 'RECOVERY_NOT_ALLOWED');
    assert.equal((await f.recovery(platform)).recovery.canConfirmNotSubmitted, false);
  }
  const confirmed = await f.confirm(job);
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.job.status, 'uncertain');
  assert.deepEqual(confirmed.job.results.map(item => item.status), ['retry_allowed', 'uncertain', 'success', 'platform_draft']);
  const record = f.journal.findForJob(job.id);
  assert.deepEqual(Object.keys(record.resolutions), [RECOVERY_PLATFORM]);
  assert.equal(record.state, 'uncertain');
  assert.equal(record.result.platformResults[0].status, 'failed');
  const reload = createOperationJournal({ filePath: f.journal.filePath });
  for (const platform of ['douyin', 'zhihu', 'weixin']) {
    assert.throws(() => reload.begin(`blocked-batch-${platform}-0001`, { ...job.signature, platforms: [platform] }), e => e.apiCode === 'PUBLISH_UNCERTAIN');
  }
  assert.equal(reload.begin('allowed-batch-toutiao-0001', { ...job.signature, platforms: [RECOVERY_PLATFORM] }).kind, 'started');
  assert.equal(f.calls(), 0);
  const staleOther = await f.confirm(job, 'douyin');
  assert.equal(staleOther.code, 'RECOVERY_VERSION_CONFLICT');
});

test('recovery validates CSRF, target, state, decision and job version; other 409s are not content conflicts', async t => {
  const f = await fixture(t);
  const job = insertJob(f, { [RECOVERY_PLATFORM]: 'uncertain' });
  const body = { platform: RECOVERY_PLATFORM, decision: 'confirmed_not_submitted', confirmation: true, expectedJobUpdatedAt: job.updated_at };
  const route = `/api/publish-jobs/${job.id}/recovery`;
  assert.equal((await f.request(route, body, false)).status, 403);
  for (const extra of [{ confirmation: false }, { confirmation: 'true' }, { decision: 'retry' }, { expectedJobUpdatedAt: '' }, { platform: '../../x' }]) {
    assert.equal((await f.request(route, { ...body, ...extra })).status, 400);
  }
  assert.equal((await f.confirm(job, 'juejin')).code, 'RECOVERY_TARGET_INVALID');
  assert.equal((await f.confirm(job, RECOVERY_PLATFORM, { expectedJobUpdatedAt: 'stale' })).code, 'RECOVERY_VERSION_CONFLICT');
  assert.equal((await f.request('/api/publish-jobs/not-found/recovery', body)).status, 404);
  const running = insertJob(f, { douyin: null }, 'running');
  assert.equal((await f.confirm(running, 'douyin')).code, 'PUBLISH_IN_PROGRESS');
  assert.throws(() => f.journal.begin('running-lock-0001', { ...running.signature, contentHash: 'a'.repeat(64) }), e => e.apiCode === 'PUBLISH_IN_PROGRESS');
  assert.throws(() => f.journal.begin(job.operationId, { ...job.signature, platforms: ['juejin'] }), e => e.statusCode === 409 && e.apiCode !== 'CONTENT_REVISION_CONFLICT');
  assert.equal(f.journal.findForJob(job.id).resolutions, undefined);
  assert.equal(f.calls(), 0);
});

test('actual article revision conflicts carry CONTENT_REVISION_CONFLICT on save/layout/draft/publish', async t => {
  const f = await fixture(t);
  const original = storedContent(f.content.id);
  updateContent(original.id, { ...original, body: '已经更新的正文', expectedUpdatedAt: original.updated_at });
  for (const [suffix, body] of [
    ['', { title: original.title, body: original.body, expectedUpdatedAt: original.updated_at }],
    ['layout', { expectedUpdatedAt: original.updated_at }],
    ['save-draft', { expectedUpdatedAt: original.updated_at, platforms: [RECOVERY_PLATFORM] }],
    ['publish-platform', { expectedUpdatedAt: original.updated_at, platform: RECOVERY_PLATFORM, publishMode: 'draft', operationId: 'stale-body-publish-0001' }],
  ]) {
    const response = await f.request(`/api/content/${original.id}${suffix ? `/${suffix}` : ''}`, body);
    assert.equal(response.status, 409, suffix);
    assert.equal(response.code, 'CONTENT_REVISION_CONFLICT', suffix);
  }
  assert.equal(f.calls(), 0);
});

test('platform-open activates the precise original draft tab without navigating, clearing or publishing', async t => {
  const f = await fixture(t);
  const job = insertJob(f, { [RECOVERY_PLATFORM]: 'platform_draft' });
  const before = storedContent(f.content.id);
  const response = await f.request('/api/platform-open', { platform: RECOVERY_PLATFORM, url: draftUrl });
  assert.equal(response.status, 200);
  assert.equal(response.opened.recoveryType, 'reused');
  assert.equal(response.opened.tabId, 'draft-tab');
  assert.deepEqual(f.browser.state.commands, [
    { endpoint: ws(), method: 'Target.getTargets', params: {} },
    { endpoint: ws(), method: 'Target.activateTarget', params: { targetId: 'draft-tab' } },
  ]);
  assert.deepEqual(f.browser.state.writes, []);
  assert.deepEqual(f.browser.state.launches, []);
  assert.equal(f.calls(), 0);
  assert.equal((await f.recovery()).recovery.canConfirmNotSubmitted, false);
  assert.equal((await f.confirm(job)).code, 'RECOVERY_NOT_ALLOWED');
  assert.deepEqual(storedContent(f.content.id), before);
});

test('closed window reopens the same profile and exact draft URL, updates identity, leaves uncertainty locked and article unchanged', async t => {
  const f = await fixture(t);
  const job = insertJob(f, { [RECOVERY_PLATFORM]: 'uncertain' });
  f.browser.state.closed = true;
  const before = storedContent(f.content.id);
  assert.equal((await f.recovery()).recovery.session.state, 'closed');
  const response = await f.request('/api/platform-open', { platform: RECOVERY_PLATFORM, url: draftUrl });
  assert.equal(response.status, 200);
  assert.equal(response.opened.recoveryType, 'reopened');
  assert.equal(f.browser.state.launches[0].session.userDataDir, '/fake/original-profile');
  assert.equal(f.browser.state.launches[0].url, draftUrl);
  assert.equal(f.browser.state.writes[0].webSocketDebuggerUrl, ws('reopened', 9555));
  assert.equal(f.browser.state.writes[0].port, 9555);
  assert.equal(f.calls(), 0);
  assert.equal(f.journal.findForJob(job.id).resolutions, undefined);
  assert.deepEqual(storedContent(f.content.id), before);
  assert.equal((await f.publish(`still-uncertain-${f.key}-0002`)).code, 'PUBLISH_UNCERTAIN');
});

test('alive session with only another draft opens a visible tab for the exact target', async () => {
  const f = fakeBrowser({ targets: [{ type: 'page', targetId: 'other', url: `${draftUrl}-different` }] });
  const opened = await f.controller.open(RECOVERY_PLATFORM, draftUrl);
  assert.equal(opened.recoveryType, 'new_tab');
  assert.deepEqual(f.state.commands.map(item => item.method), ['Target.getTargets', 'Target.createTarget']);
  assert.deepEqual(f.state.commands[1].params, { url: draftUrl, background: false });
  assert.deepEqual(f.state.launches, []);
});

test('missing profile/session and occupied/mismatched ports never connect tabs, spawn or update identity', async () => {
  for (const [overrides, expected] of [
    [{ session: null }, 'missing'], [{ exists: false }, 'missing'],
    [{ identity: ws('other-browser') }, 'mismatch'],
    [{ session: { platform: 'douyin', port: 9444, browserPath: '/fake/browser', userDataDir: '/fake/profile', webSocketDebuggerUrl: ws() } }, 'mismatch'],
    [{ identity: 'ws://localhost:9444/devtools/browser/other' }, 'mismatch'],
  ]) {
    const f = fakeBrowser(overrides);
    assert.equal((await f.controller.inspect(RECOVERY_PLATFORM)).state, expected);
    await assert.rejects(() => f.controller.open(RECOVERY_PLATFORM, draftUrl), e => e.apiCode === `SESSION_${expected.toUpperCase()}`);
    assert.deepEqual(f.state.commands, []);
    assert.deepEqual(f.state.launches, []);
    assert.deepEqual(f.state.writes, []);
  }
});

test('GET probe timeout is bounded and must not be treated as a closed browser', async t => {
  const browser = fakeBrowser();
  const f = await fixture(t, { recoveryDependencies: { ...browser.dependencies,
    readVersion: () => new Promise(() => {}), probeTimeoutMs: 20 } });
  const started = Date.now();
  const response = await f.recovery();
  assert.equal(response.recovery.session.state, 'mismatch');
  assert.ok(Date.now() - started < 1000);
  const opened = await f.request('/api/platform-open', { platform: RECOVERY_PLATFORM, url: draftUrl });
  assert.equal(opened.code, 'SESSION_MISMATCH');
  assert.deepEqual(browser.state.launches, []);
  assert.deepEqual(browser.state.commands, []);
});

test('identity changing between probe and action stops before any tab operation', async () => {
  const f = fakeBrowser();
  let probes = 0;
  const controller = createSessionRecovery({ ...f.dependencies, readVersion: async () => ({
    Browser: 'Chrome/140', webSocketDebuggerUrl: ++probes === 1 ? ws() : ws('replacement'),
  }) });
  await assert.rejects(() => controller.open(RECOVERY_PLATFORM, draftUrl), e => e.apiCode === 'SESSION_MISMATCH');
  assert.deepEqual(f.state.commands, []);
  assert.deepEqual(f.state.launches, []);
});

test('restart preserves the job association and allows an interrupted job to be explicitly reconciled', async t => {
  const f = await fixture(t);
  const job = insertJob(f, { [RECOVERY_PLATFORM]: null }, 'running');
  const restarted = createOperationJournal({ filePath: f.journal.filePath });
  restarted.recoverRunning();
  const response = await f.recovery();
  assert.equal(response.recovery.canConfirmNotSubmitted, true);
  assert.equal(response.recovery.latestJob.id, job.id);
  assert.equal((await f.confirm(response.recovery.latestJob)).job.results[0].status, 'retry_allowed');
  assert.equal(f.calls(), 0);
});

test('changing article text cannot bypass unresolved platform locks or enable an old operationId', async t => {
  const f = await fixture(t);
  const job = insertJob(f, { [RECOVERY_PLATFORM]: 'uncertain' });
  const content = storedContent(f.content.id);
  updateContent(content.id, { ...content, body: '<p>实质修改后的新正文</p>', expectedUpdatedAt: content.updated_at });
  assert.equal((await f.publish('edited-text-locked-operation-0001')).code, 'PUBLISH_UNCERTAIN');
  const before = storedContent(content.id);
  assert.equal((await f.confirm(job)).status, 200);
  assert.deepEqual(storedContent(content.id), before);
  assert.throws(() => f.journal.begin(job.operationId, job.signature), e => e.apiCode === 'PUBLISH_UNCERTAIN');
  assert.equal(f.calls(), 0);
});

test('a failed audit commit leaves the original lock intact and SQLite unchanged', async t => {
  const f = await fixture(t);
  const job = insertJob(f, { [RECOVERY_PLATFORM]: 'uncertain' });
  const before = fs.readFileSync(f.journal.filePath, 'utf8');
  const changes = db.prepare('SELECT total_changes() n').get().n;
  const rename = fs.renameSync;
  fs.renameSync = (source, target) => {
    if (target === f.journal.filePath) throw new Error('injected audit commit failure');
    return rename(source, target);
  };
  try {
    const response = await f.confirm(job);
    assert.equal(response.status, 500);
    assert.match(response.error, /injected audit commit failure/);
  } finally { fs.renameSync = rename; }
  assert.equal(fs.readFileSync(f.journal.filePath, 'utf8'), before);
  assert.equal(db.prepare('SELECT total_changes() n').get().n, changes);
  assert.equal(f.journal.findForJob(job.id).resolutions, undefined);
  assert.equal((await f.publish('audit-failed-still-locked-0001')).code, 'PUBLISH_UNCERTAIN');
  assert.equal(f.calls(), 0);
});

test('concurrent duplicate confirmations commit one audit record; another batch platform needs the new version', async t => {
  const f = await fixture(t);
  const job = insertJob(f, { [RECOVERY_PLATFORM]: 'uncertain', douyin: 'failed' });
  const [first, second] = await Promise.all([f.confirm(job), f.confirm(job)]);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.notEqual(first.cached, second.cached);
  assert.deepEqual(first.resolution, second.resolution);
  assert.equal((await f.confirm(job, 'douyin')).code, 'RECOVERY_VERSION_CONFLICT');
  const next = await f.confirm(first.job, 'douyin');
  assert.equal(next.status, 200);
  assert.equal(next.job.status, 'retry_allowed');
  assert.deepEqual(Object.keys(f.journal.findForJob(job.id).resolutions).sort(), ['douyin', RECOVERY_PLATFORM]);
});

test('aggregate success without per-platform rows is not eligible for not-submitted confirmation', async t => {
  const f = await fixture(t);
  const job = insertJob(f, { [RECOVERY_PLATFORM]: null });
  db.prepare("UPDATE publish_jobs SET status = 'draft_saved' WHERE id = ?").run(job.id);
  assert.equal((await f.recovery()).recovery.canConfirmNotSubmitted, false);
  assert.equal((await f.confirm(job)).code, 'RECOVERY_NOT_ALLOWED');
  assert.equal(f.journal.findForJob(job.id).resolutions, undefined);
});

test('profile changes and a replacement instance during reopen cannot overwrite the saved session', async () => {
  for (const change of ['profile', 'instance']) {
    const f = fakeBrowser({ closed: true });
    const controller = createSessionRecovery({ ...f.dependencies, opener: async (...args) => {
      const launched = await f.dependencies.opener(...args);
      if (change === 'profile') f.state.session = { ...f.state.session, userDataDir: '/fake/other-profile' };
      else f.state.identity = ws('unexpected', 9555);
      return launched;
    } });
    await assert.rejects(() => controller.open(RECOVERY_PLATFORM, draftUrl), e => e.apiCode === 'SESSION_MISMATCH');
    assert.deepEqual(f.state.writes, []);
    assert.deepEqual(f.state.commands, []);
  }
});

test('concurrent window-open requests do not spawn two instances', async () => {
  const f = fakeBrowser({ closed: true });
  const first = f.controller.open(RECOVERY_PLATFORM, draftUrl);
  assert.throws(() => f.controller.open(RECOVERY_PLATFORM, draftUrl), e => e.apiCode === 'SESSION_OPEN_IN_PROGRESS');
  assert.equal((await first).recoveryType, 'reopened');
  assert.equal(f.state.launches.length, 1);
});

test('active browser without page windows creates a visible new window only on explicit open', async () => {
  const f = fakeBrowser({ targets: [{ type: 'service_worker', targetId: 'worker', url: draftUrl }] });
  assert.equal((await f.controller.inspect(RECOVERY_PLATFORM)).state, 'open');
  assert.deepEqual(f.state.commands, []);
  const opened = await f.controller.open(RECOVERY_PLATFORM, draftUrl);
  assert.equal(opened.recoveryType, 'new_tab');
  assert.deepEqual(f.state.commands[1], { endpoint: ws(), method: 'Target.createTarget',
    params: { url: draftUrl, background: false, newWindow: true } });
  assert.deepEqual(f.state.launches, []);
});

test('failed activation never navigates or creates a replacement draft and does not report success', async t => {
  const browser = fakeBrowser();
  const f = await fixture(t, { recoveryDependencies: { ...browser.dependencies, browserCommand: async (...args) => {
    if (args[1] === 'Target.activateTarget') {
      browser.state.commands.push({ endpoint: args[0], method: args[1], params: args[2] });
      throw Object.assign(new Error('原稿标签页已关闭'), { apiCode: 'SESSION_MISMATCH', statusCode: 409 });
    }
    return browser.dependencies.browserCommand(...args);
  } } });
  const response = await f.request('/api/platform-open', { platform: RECOVERY_PLATFORM, url: draftUrl });
  assert.equal(response.status, 409);
  assert.equal(response.code, 'SESSION_MISMATCH');
  assert.equal(response.opened, undefined);
  assert.deepEqual(browser.state.commands.map(command => command.method), ['Target.getTargets', 'Target.activateTarget']);
  assert.deepEqual(browser.state.launches, []);
  assert.equal(f.calls(), 0);
});

test('login record replaced while listing tabs stops before activation', async () => {
  const f = fakeBrowser();
  const controller = createSessionRecovery({ ...f.dependencies, browserCommand: async (...args) => {
    const result = await f.dependencies.browserCommand(...args);
    f.state.session = { ...f.state.session, webSocketDebuggerUrl: ws('new-login') };
    return result;
  } });
  await assert.rejects(() => controller.open(RECOVERY_PLATFORM, draftUrl), error => error.apiCode === 'SESSION_MISMATCH');
  assert.deepEqual(f.state.commands.map(command => command.method), ['Target.getTargets']);
});

function diskSessionRecovery(scenario) {
  const directory = fs.mkdtempSync(path.join(scratch, 'session-roundtrip-'));
  const profile = path.join(directory, 'original-profile');
  fs.mkdirSync(profile);
  const sessionFile = path.join(directory, 'session.json');
  const activePortFile = path.join(profile, 'DevToolsActivePort');
  const session = { platform: RECOVERY_PLATFORM, browserPath: '/fake/Google Chrome.app/Contents/MacOS/Google Chrome',
    userDataDir: profile, port: 9444, webSocketDebuggerUrl: ws() };
  fs.writeFileSync(sessionFile, JSON.stringify(session));
  fs.writeFileSync(activePortFile, '9444\n/devtools/browser/original\n');
  const launches = []; const probes = []; const writes = []; const commands = [];
  const dependencies = {
    readSession: () => JSON.parse(fs.readFileSync(sessionFile, 'utf8')),
    writeSession: updated => { writes.push(updated); fs.writeFileSync(sessionFile, JSON.stringify(updated)); },
    requiresSession: () => true,
    readVersion: async port => {
      probes.push(port);
      if (port === 9444) throw refused();
      assert.equal(port, 9555);
      return { Browser: 'Chrome/140', webSocketDebuggerUrl: ws(scenario === 'wrong-instance' ? 'replacement' : 'fresh', port) };
    },
    spawnBrowser: (binary, args, options) => {
      launches.push({ binary, args, options });
      const child = new EventEmitter();
      child.exitCode = null; child.signalCode = null; child.unref = () => {};
      if (scenario === 'exited') child.exitCode = 1;
      if (!['stale-file', 'exited'].includes(scenario)) {
        fs.writeFileSync(activePortFile, scenario === 'invalid-file'
          ? '9555\nhttps://other-machine/devtools/browser/fresh\n' : '9555\n/devtools/browser/fresh\n');
      }
      return child;
    },
    browserCommand: async (endpoint, method) => { commands.push({ endpoint, method }); throw new Error('unexpected target command during reopen'); },
    probeTimeoutMs: 30, reopenTimeoutMs: 40,
  };
  return { controller: createSessionRecovery(dependencies), session, sessionFile, launches, probes, writes, commands, profile };
}

test('default Chrome reopener round-trips session.json through the original profile and a fresh verified instance', async () => {
  const f = diskSessionRecovery('fresh');
  const opened = await f.controller.open(RECOVERY_PLATFORM, draftUrl);
  assert.equal(opened.recoveryType, 'reopened');
  assert.equal(opened.port, 9555);
  assert.deepEqual(f.launches, [{ binary: f.session.browserPath,
    args: ['--remote-debugging-port=0', `--user-data-dir=${f.profile}`, '--no-first-run',
      '--no-default-browser-check', '--new-window', draftUrl], options: { detached: true, stdio: 'ignore' } }]);
  const persisted = JSON.parse(fs.readFileSync(f.sessionFile, 'utf8'));
  assert.deepEqual(persisted, { ...f.session, port: 9555, webSocketDebuggerUrl: ws('fresh', 9555) });
  assert.equal(f.writes.length, 1);
  assert.deepEqual(f.probes, [9444, 9444, 9555]);
  assert.equal((await f.controller.inspect(RECOVERY_PLATFORM)).state, 'open');
  assert.deepEqual(f.commands, []);
});

test('default Chrome reopener rejects stale/invalid identity files, exited processes and unexpected instances', async () => {
  for (const scenario of ['stale-file', 'invalid-file', 'exited', 'wrong-instance']) {
    const f = diskSessionRecovery(scenario);
    const before = fs.readFileSync(f.sessionFile, 'utf8');
    await assert.rejects(() => f.controller.open(RECOVERY_PLATFORM, draftUrl), error => error.apiCode === ({
      'stale-file': 'SESSION_PROBE_TIMEOUT', 'invalid-file': 'SESSION_MISMATCH',
      exited: 'SESSION_REOPEN_FAILED', 'wrong-instance': 'SESSION_MISMATCH',
    })[scenario]);
    assert.equal(f.launches.length, 1);
    assert.deepEqual(f.writes, []);
    assert.deepEqual(f.commands, []);
    assert.equal(fs.readFileSync(f.sessionFile, 'utf8'), before);
  }
});
