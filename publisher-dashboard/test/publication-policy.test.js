'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, after } = require('node:test');
const { ACTIVE_PLATFORM_IDS } = require('../platform-catalog');
const xhsSource = path.resolve(__dirname, '../../packages/core/src/adapters/platforms/xiaohongshu.ts');
function mockXhsSource(t, read) {
  const original = fs.readFileSync;
  t.mock.method(fs, 'readFileSync', (file, ...args) => file === xhsSource ? read() : original(file, ...args));
}

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-publication-policy-'));
process.env.PUBLISHER_DATA_DIR = scratch;
process.env.PUBLISHER_DB = path.join(scratch, 'db.sqlite');
process.env.PUBLISHER_OPERATIONS_FILE = path.join(scratch, 'operations.json');
const app = require('../server');
after(() => { app.db.close(); fs.rmSync(scratch, { recursive: true, force: true }); });
let sequence = 0;

async function fixture(t, overrides = {}) {
  const key = ++sequence;
  const content = app.importContent({ title: `准备策略 ${key}`, format: 'html',
    body: '<p>保留原稿</p><table><tr><td>图片准备探针</td></tr></table>' });
  const journal = app.createOperationJournal({ filePath: path.join(scratch, `journal-${key}.json`) });
  const calls = { journal: [], images: 0, auth: 0, publisher: [] };
  const operationJournal = new Proxy(journal, { get(target, property) {
    if (typeof target[property] !== 'function') return target[property];
    return (...args) => { calls.journal.push(property); return target[property](...args); };
  } });
  const server = app.createDashboardServer({ operationJournal,
    transformTables: async () => { calls.images++; throw new Error('unexpected image preparation'); },
    preflight: async () => { calls.auth++; return null; },
    platformPublisher: async (file, platform, title, mode) => {
      calls.publisher.push({ platform, mode });
      return { info: { status: 'success', url: `https://example.com/${platform}/editor`, message: 'legacy success' } };
    }, ...overrides });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const bootstrap = await (await fetch(`${origin}/api/bootstrap`)).json();
  const request = async (route, body) => {
    const response = await fetch(origin + route, body === undefined ? {} : { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Workbench-CSRF': bootstrap.data.csrfToken },
      body: JSON.stringify(body) });
    return { status: response.status, ...await response.json() };
  };
  const post = (kind, extra = {}) => request(kind === 'single'
    ? `/api/content/${content.id}/publish-platform` : '/api/publish', {
    contentId: content.id, platform: 'zhihu', platforms: ['zhihu'],
    operationId: `policy-operation-${key}-${++sequence}`,
    expectedUpdatedAt: app.db.prepare('SELECT updated_at FROM contents WHERE id=?').get(content.id).updated_at,
    ...extra,
  });
  return { content, journal, calls, post, request };
}

function stagedFiles() {
  return fs.readdirSync(scratch, { recursive: true }).filter(name => /^(drafts|uploads)\//.test(name)).sort();
}

test('HTTP direct is rejected for every platform before journal access, images, auth, snapshots or database writes', async t => {
  const f = await fixture(t);
  const signature = app.buildPublishOperationSignature(f.content, ['zhihu'], 'direct', f.content.updated_at);
  f.journal.begin('legacy-direct-operation-0001', signature);
  const at = new Date().toISOString();
  app.db.prepare('INSERT INTO publish_jobs(id,content_id,title,status,platforms,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
    .run('policy-legacy-direct-job', f.content.id, f.content.title, 'published', '["zhihu"]', at, at);
  app.db.prepare('INSERT INTO publish_results(id,job_id,platform,status,message,url,created_at) VALUES(?,?,?,?,?,?,?)')
    .run('policy-legacy-direct-result', 'policy-legacy-direct-job', 'zhihu', 'success', '历史公开发表', 'https://example.com/published', at);
  f.journal.complete('legacy-direct-operation-0001', { jobId: 'policy-legacy-direct-job', jobStatus: 'published' });
  const beforeJournal = fs.readFileSync(f.journal.filePath, 'utf8');
  const beforeStat = fs.statSync(f.journal.filePath).mtimeMs;
  const beforeChanges = app.db.prepare('SELECT total_changes() n').get().n;
  const beforeFiles = stagedFiles();
  f.calls.journal.length = 0;
  for (const kind of ['single', 'batch']) {
    for (const platform of ACTIVE_PLATFORM_IDS) {
      const result = await f.post(kind, { platform, platforms: ['woshipm', platform], publishMode: 'direct' });
      assert.equal(result.status, 400, `${kind}: ${platform}`);
      assert.equal(result.code, 'MANUAL_PUBLICATION_REQUIRED', `${kind}: ${platform}`);
      assert.match(result.error, /人工|手动/);
      assert.match(result.error, /群发|通知/);
    }
    for (const extra of [{ operationId: 'legacy-direct-operation-0001' }, { operationId: 'bad id', expectedUpdatedAt: '' }]) {
      const result = await f.post(kind, { ...extra, publishMode: 'direct' });
      assert.equal(result.code, 'MANUAL_PUBLICATION_REQUIRED');
    }
  }
  assert.deepEqual(f.calls, { journal: [], images: 0, auth: 0, publisher: [] });
  assert.equal(app.db.prepare('SELECT total_changes() n').get().n, beforeChanges);
  assert.deepEqual(stagedFiles(), beforeFiles);
  assert.equal(fs.readFileSync(f.journal.filePath, 'utf8'), beforeJournal);
  assert.equal(fs.statSync(f.journal.filePath).mtimeMs, beforeStat);
  const history = await f.request('/api/history');
  const legacy = history.jobs.find(job => job.id === 'policy-legacy-direct-job');
  assert.equal(legacy.status, 'published');
  assert.equal(legacy.results[0].status, 'success');
  assert.equal(legacy.results[0].url, 'https://example.com/published');
});

test('both HTTP endpoints default to draft when publishMode is omitted', async t => {
  for (const kind of ['single', 'batch']) {
    const f = await fixture(t);
    const result = await f.post(kind);
    assert.equal(result.status, 200);
    assert.equal(result.job.status, 'draft_saved');
    assert.equal(result.job.results[0].status, 'platform_draft');
    assert.deepEqual(f.calls.publisher, [{ platform: 'zhihu', mode: 'draft' }]);
    assert.equal(f.journal.findForJob(result.job.id).signature.publishMode, 'draft');
  }
});

test('all three draft platforms can still be submitted together in one HTTP operation', async t => {
  const f = await fixture(t);
  // No table conversion is needed for this text-only fixture.
  app.db.prepare('UPDATE contents SET body=? WHERE id=?').run('三平台同稿', f.content.id);
  const result = await f.post('batch', { platforms: ['weixin', 'woshipm', 'sspai'] });
  assert.equal(result.status, 200);
  assert.equal(result.job.status, 'draft_saved');
  assert.deepEqual(result.job.results.map(row => row.status), ['platform_draft', 'platform_draft', 'platform_draft']);
  assert.deepEqual(f.calls.publisher, ['weixin', 'woshipm', 'sspai'].map(platform => ({ platform, mode: 'draft' })));
});

test('fill-only legacy successes keep their URL, become uncertain and block repeat submissions after a no-op save', async t => {
  mockXhsSource(t, () => '// local adapter fixture');
  for (const platform of ['xiaohongshu', 'toutiao', 'douban']) {
    for (const legacyStatus of ['success', 'platform_draft']) {
      let calls = 0;
      const url = `https://example.com/${platform}/original-editor?draft=123`;
      const f = await fixture(t, { platformPublisher: async () => {
        calls++;
        return { info: { status: legacyStatus, url, postId: '123', message: 'legacy saved successfully' } };
      } });
      const result = await f.post('single', { platform, publishMode: 'draft' });
      assert.equal(result.status, 200);
      assert.equal(result.job.status, 'uncertain');
      assert.equal(result.job.results[0].status, 'uncertain');
      assert.equal(result.job.results[0].url, url);
      assert.match(result.job.results[0].message, /人工核对/);
      assert.match(result.job.results[0].message, /草稿/);
      assert.equal(f.journal.findForJob(result.job.id).state, 'uncertain');
      app.updateContent(f.content.id, { title: f.content.title, body: f.content.body,
        expectedUpdatedAt: f.content.updated_at });
      const retry = await f.post('batch', { platforms: [platform], publishMode: 'draft' });
      assert.equal(retry.status, 409);
      assert.equal(retry.code, 'PUBLISH_UNCERTAIN');
      assert.equal(calls, 1);
    }
  }
});

for (const state of ['missing', 'fallback']) {
  test(`public xiaohongshu ${state} rejects single, batch and default selection before preparing assets or publishing`, async t => {
    mockXhsSource(t, () => {
      if (state === 'missing') throw Object.assign(new Error('optional source absent'), { code: 'ENOENT' });
      return '// PUBLIC_MANUAL_FALLBACK';
    });
    const f = await fixture(t);
    app.db.prepare('UPDATE contents SET selected_platforms=? WHERE id=?')
      .run(JSON.stringify(['woshipm', 'xiaohongshu']), f.content.id);
    const beforeChanges = app.db.prepare('SELECT total_changes() n').get().n;
    const beforeFiles = stagedFiles();
    for (const [kind, extra] of [
      ['single', { platform: 'xiaohongshu' }],
      ['batch', { platforms: ['woshipm', 'xiaohongshu'] }],
      ['batch', { platforms: [] }],
    ]) {
      const result = await f.post(kind, extra);
      assert.equal(result.status, 400);
      assert.equal(result.code, 'MANUAL_PLATFORM_ONLY');
      assert.match(result.error, /手工/);
    }
    assert.equal(f.calls.images, 0);
    assert.equal(f.calls.auth, 0);
    assert.deepEqual(f.calls.publisher, []);
    assert.equal(app.db.prepare('SELECT total_changes() n').get().n, beforeChanges);
    assert.deepEqual(stagedFiles(), beforeFiles);
    assert.equal(fs.existsSync(f.journal.filePath), false);
    const platforms = await f.request('/api/platforms');
    assert.equal(platforms.platforms.find(p => p.id === 'xiaohongshu').delivery_mode, 'manual');
  });
}

test('ZIP success is a local export, excluded from published and platform draft results and auth updates', async t => {
  const f = await fixture(t, { platformPublisher: async (_file, platform) => ({ info: {
    status: 'success', message: platform === 'zip-download' ? '已下载 report.zip（2 张图片）' : '草稿已回读',
  } }) });
  const before = app.getDashboardData();
  const authBefore = app.db.prepare('SELECT * FROM platforms WHERE id=?').get('zip-download');
  const result = await f.post('batch', { platforms: ['zip-download'] });
  assert.equal(result.status, 200);
  assert.equal(result.job.status, 'exported');
  assert.equal(result.job.results[0].status, 'exported');
  assert.match(result.job.results[0].message, /本地导出/);
  assert.match(result.job.results[0].message, /report\.zip/);
  assert.equal(f.calls.auth, 0);
  assert.equal(result.content.status, '已导出');
  assert.equal(f.journal.findForJob(result.job.id).state, 'completed');
  assert.equal(app.getDashboardData().stats.thisWeekPublished, before.stats.thisWeekPublished);
  assert.deepEqual(app.db.prepare('SELECT * FROM platforms WHERE id=?').get('zip-download'), authBefore);
  const mixed = await f.post('batch', { platforms: ['zip-download', 'zhihu'] });
  assert.equal(mixed.job.status, 'draft_saved');
  assert.deepEqual(mixed.job.results.map(row => row.status), ['exported', 'platform_draft']);
});

test('dashboard execution helper also rejects direct before side effects and defaults to draft', async () => {
  const content = app.importContent({ title: '内部入口', body: '正文', format: 'markdown' });
  let calls = 0;
  const options = { preflight: async () => { calls++; return null; },
    platformPublisher: async (_file, _platform, _title, mode) => {
      calls++; assert.equal(mode, 'draft'); return { info: { status: 'success' } };
    } };
  const beforeChanges = app.db.prepare('SELECT total_changes() n').get().n;
  const beforeFiles = stagedFiles();
  await assert.rejects(app.publishContent(content.id, ['zhihu'], { ...options, publishMode: 'direct' }),
    error => error.apiCode === 'MANUAL_PUBLICATION_REQUIRED');
  assert.equal(calls, 0);
  assert.equal(app.db.prepare('SELECT total_changes() n').get().n, beforeChanges);
  assert.deepEqual(stagedFiles(), beforeFiles);
  const result = await app.publishContent(content.id, ['zhihu'], options);
  assert.equal(result.job.status, 'draft_saved');
  assert.equal(calls, 2);
});
