const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');
const nativeFetch = globalThis.fetch;

async function workbenchFetch(input, options = {}) {
  const target = new URL(input);
  const method = String(options.method || 'GET').toUpperCase();
  const headers = new Headers(options.headers || {});
  if (method === 'POST') {
    const bootstrap = await nativeFetch(`${target.origin}/api/bootstrap`, {
      headers: { Origin: target.origin },
    });
    const bootstrapBody = await bootstrap.json();
    headers.set('Origin', target.origin);
    headers.set('X-Workbench-CSRF', bootstrapBody.data.csrfToken);
  }
  return nativeFetch(input, { ...options, headers });
}

function rawHttpRequest(input, options = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(input, options, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    request.on('error', reject);
    request.end(options.body || '');
  });
}

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'publisher-dashboard-test-'));
process.env.PUBLISHER_DB = path.join(testDataDir, 'publisher.sqlite');
process.env.PUBLISHER_OPERATIONS_FILE = path.join(testDataDir, 'publish-operations.json');
const invalidPreviewCookieFile = path.join(testDataDir, 'invalid-preview-cookies.json');
fs.writeFileSync(invalidPreviewCookieFile, 'not valid cookie JSON', 'utf8');
process.env.WEIBOT_COOKIE_FILE = invalidPreviewCookieFile;

const {
  parsePlatformOutput,
  parseSyncResults,
  loginExported,
  generateCandidates,
  createPlansRange,
  updatePlan,
  contentToMarkdown,
  generateContent,
  updateContent,
  importContent,
  layoutContent,
  saveLocalDraft,
  previewContentForPlatform,
  publishSnapshotName,
  publishContent,
  createOperationJournal,
  createInstanceLock,
  createDashboardServer,
  getDashboardData,
  DRAFTS_DIR,
  CLI_PATH,
  server,
  db,
} = require('../server');

after(async () => {
  if (server.listening) {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
  db.close();
  fs.rmSync(testDataDir, { recursive: true, force: true });
});

function cleanupImportedContent(content) {
  if (!content?.id) return;
  db.prepare("DELETE FROM activity WHERE target_type = 'content' AND target_id = ?").run(content.id);
  db.prepare('DELETE FROM contents WHERE id = ?').run(content.id);
}

function canonicalRevisionPayload(content, overrides = {}) {
  return {
    title: content.title,
    summary: content.summary ?? '',
    body: content.body,
    type: content.type ?? '',
    expectedUpdatedAt: content.updated_at,
    ...overrides,
  };
}

function updateCurrentContent(contentId, payload = {}) {
  const current = db.prepare('SELECT updated_at FROM contents WHERE id = ?').get(contentId);
  assert.ok(current, `内容不存在: ${contentId}`);
  return updateContent(contentId, { ...payload, expectedUpdatedAt: current.updated_at });
}

async function withFixedClock(timestamp, callback) {
  const NativeDate = globalThis.Date;
  const fixedMs = NativeDate.parse(timestamp);
  class FixedDate extends NativeDate {
    constructor(...args) {
      super(...(args.length ? args : [fixedMs]));
    }

    static now() {
      return fixedMs;
    }
  }
  globalThis.Date = FixedDate;
  try {
    return await callback();
  } finally {
    globalThis.Date = NativeDate;
  }
}

function databaseSnapshot() {
  const tables = [
    'platforms',
    'weekly_plans',
    'candidates',
    'contents',
    'publish_jobs',
    'publish_results',
    'ai_commands',
    'activity',
  ];
  return Object.fromEntries(tables.map(table => [
    table,
    db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
  ]));
}

function createPreviewTempRoot(label) {
  return fs.mkdtempSync(path.join(testDataDir, `${label}-`));
}

function validPlatformPreview(overrides = {}) {
  const preview = {
    platform: 'xiaohongshu',
    title: '平台预览母稿',
    format: 'text',
    content: '当前正文',
    htmlPreview: '<p>当前正文</p>',
    imageCount: 0,
    warnings: [],
    limits: { maxImages: 9, maxTitleLength: 38 },
    article: {
      title: '平台预览母稿',
      markdown: '当前正文',
      html: '<p>当前正文</p>',
    },
  };
  return { ...preview, ...overrides };
}

async function listenOnRandomPort(testServer) {
  await new Promise((resolve, reject) => {
    const onError = error => reject(error);
    testServer.once('error', onError);
    testServer.listen(0, '127.0.0.1', () => {
      testServer.off('error', onError);
      resolve();
    });
  });
  return testServer.address().port;
}

async function closeServer(testServer) {
  if (!testServer?.listening) return;
  await new Promise((resolve, reject) => {
    testServer.close(error => error ? reject(error) : resolve());
  });
}

function createPublishStateFixture({ key, planDate, selectedPlatforms, contentStatus, planStatus }) {
  const content = importContent({
    filename: `${key}.md`,
    body: `# ${key}\n\n发布状态回归正文`,
  });
  const updatedAt = new Date().toISOString();
  db.prepare(`
    INSERT INTO weekly_plans
      (date, weekday, topic, type, audience, materials, status, content_id, updated_at)
    VALUES (?, '周一', ?, '方法论', '内容运营', '测试素材', ?, ?, ?)
  `).run(planDate, key, planStatus, content.id, updatedAt);
  db.prepare(`
    UPDATE contents
    SET plan_date = ?, status = ?, selected_platforms = ?, updated_at = ?
    WHERE id = ?
  `).run(planDate, contentStatus, JSON.stringify(selectedPlatforms), updatedAt, content.id);
  const platformStates = db.prepare(`
    SELECT id, auth_status, account, updated_at
    FROM platforms
    WHERE id IN ('zhihu', 'juejin', 'weixin', 'douyin')
  `).all();
  return {
    ...content,
    planDate,
    selectedPlatforms: [...selectedPlatforms],
    contentStatus,
    planStatus,
    platformStates,
  };
}

function readPublishState(fixture) {
  const content = db.prepare('SELECT status, selected_platforms FROM contents WHERE id = ?').get(fixture.id);
  const plan = db.prepare('SELECT status FROM weekly_plans WHERE date = ?').get(fixture.planDate);
  return {
    selectedPlatforms: JSON.parse(content.selected_platforms),
    contentStatus: content.status,
    planStatus: plan.status,
  };
}

function cleanupPublishStateFixture(fixture) {
  if (!fixture?.id) return;
  const jobs = db.prepare('SELECT id FROM publish_jobs WHERE content_id = ?').all(fixture.id);
  for (const job of jobs) {
    db.prepare("DELETE FROM activity WHERE target_type = 'publish_job' AND target_id = ?").run(job.id);
    db.prepare('DELETE FROM publish_results WHERE job_id = ?').run(job.id);
    db.prepare('DELETE FROM publish_jobs WHERE id = ?').run(job.id);
    fs.rmSync(path.join(DRAFTS_DIR, publishSnapshotName(job.id, fixture.id)), { force: true });
  }
  db.prepare("DELETE FROM activity WHERE target_type = 'content' AND target_id = ?").run(fixture.id);
  db.prepare('DELETE FROM contents WHERE id = ?').run(fixture.id);
  db.prepare('DELETE FROM weekly_plans WHERE date = ?').run(fixture.planDate);
  fs.rmSync(path.join(DRAFTS_DIR, `${fixture.id}.md`), { force: true });
  for (const platform of fixture.platformStates || []) {
    db.prepare('UPDATE platforms SET auth_status = ?, account = ?, updated_at = ? WHERE id = ?')
      .run(platform.auth_status, platform.account, platform.updated_at, platform.id);
  }
}

function successfulPlatformPublisher(calls = []) {
  return async (markdownFile, platform, title, publishMode) => {
    calls.push({ markdownFile, platform, title, publishMode });
    return {
      output: `stub output ${platform}`,
      info: {
        status: 'success',
        message: `stubbed ${platform} success`,
        url: `https://example.invalid/${platform}`,
        postId: `post-${platform}`,
      },
    };
  };
}

test('local API requires trusted origin and per-server CSRF for mutations', async () => {
  let imported;
  let firstServer;
  let secondServer;
  let publisherCalls = 0;
  try {
    firstServer = createDashboardServer({
      operationsFile: path.join(testDataDir, 'csrf-first-operations.json'),
      preflight: async () => null,
      platformPublisher: async () => {
        publisherCalls += 1;
        return { output: '', info: { status: 'success', message: 'csrf publish success' } };
      },
    });
    secondServer = createDashboardServer({
      operationsFile: path.join(testDataDir, 'csrf-second-operations.json'),
    });
    const firstPort = await listenOnRandomPort(firstServer);
    const secondPort = await listenOnRandomPort(secondServer);
    const firstOrigin = `http://127.0.0.1:${firstPort}`;
    const secondOrigin = `http://127.0.0.1:${secondPort}`;

    const firstBootstrap = await nativeFetch(`${firstOrigin}/api/bootstrap`, { headers: { Origin: firstOrigin } });
    const firstBootstrapBody = await firstBootstrap.json();
    const secondBootstrap = await nativeFetch(`${secondOrigin}/api/bootstrap`, { headers: { Origin: secondOrigin } });
    const secondBootstrapBody = await secondBootstrap.json();
    const firstToken = firstBootstrapBody.data.csrfToken;
    assert.equal(firstBootstrap.status, 200);
    assert.match(firstToken, /^[A-Za-z0-9_-]{32,}$/);
    assert.notEqual(firstToken, secondBootstrapBody.data.csrfToken);
    assert.notEqual(firstBootstrap.headers.get('access-control-allow-origin'), '*');

    let rawResponse = await rawHttpRequest(`${firstOrigin}/api/bootstrap`, {
      headers: { Host: `attacker.invalid:${firstPort}` },
    });
    assert.equal(rawResponse.status, 403);
    rawResponse = await rawHttpRequest(`${firstOrigin}/api/bootstrap`, {
      headers: {
        Host: `attacker.invalid:${firstPort}`,
        Origin: `http://attacker.invalid:${firstPort}`,
      },
    });
    assert.equal(rawResponse.status, 403);

    const importEndpoint = `${firstOrigin}/api/content/import`;
    const importBody = JSON.stringify({ filename: 'csrf.md', body: '# CSRF 文章\n\n正文' });
    let response = await nativeFetch(importEndpoint, {
      method: 'POST',
      headers: { Origin: firstOrigin, 'Content-Type': 'application/json' },
      body: importBody,
    });
    assert.equal(response.status, 403);

    response = await nativeFetch(importEndpoint, {
      method: 'POST',
      headers: {
        Origin: 'http://attacker.invalid',
        'Content-Type': 'text/plain',
        'X-Workbench-CSRF': firstToken,
      },
      body: importBody,
    });
    assert.equal(response.status, 403);
    assert.notEqual(response.headers.get('access-control-allow-origin'), '*');

    response = await nativeFetch(importEndpoint, {
      method: 'POST',
      headers: {
        Origin: `${firstOrigin}/not-an-origin`,
        'Content-Type': 'application/json',
        'X-Workbench-CSRF': firstToken,
      },
      body: importBody,
    });
    assert.equal(response.status, 403);

    response = await nativeFetch(importEndpoint, {
      method: 'POST',
      headers: {
        Origin: firstOrigin,
        'Content-Type': 'application/json',
        'X-Workbench-CSRF': 'wrong-token',
      },
      body: importBody,
    });
    assert.equal(response.status, 403);

    response = await nativeFetch(importEndpoint, {
      method: 'POST',
      headers: {
        Origin: firstOrigin,
        'Content-Type': 'application/json',
        'X-Workbench-CSRF': firstToken,
      },
      body: importBody,
    });
    const importResult = await response.json();
    imported = importResult.content;
    assert.equal(response.status, 200);

    const publishEndpoint = `${firstOrigin}/api/content/${imported.id}/publish-platform`;
    const publishBody = JSON.stringify({
      platform: 'zhihu',
      publishMode: 'direct',
      operationId: 'csrf-publish-operation-0001',
    });
    response = await nativeFetch(publishEndpoint, {
      method: 'POST',
      headers: { Origin: firstOrigin, 'Content-Type': 'application/json' },
      body: publishBody,
    });
    assert.equal(response.status, 403);
    assert.equal(publisherCalls, 0);

    response = await nativeFetch(publishEndpoint, {
      method: 'POST',
      headers: {
        Origin: 'http://attacker.invalid',
        'Content-Type': 'text/plain',
        'X-Workbench-CSRF': firstToken,
      },
      body: publishBody,
    });
    assert.equal(response.status, 403);
    assert.equal(publisherCalls, 0);

    response = await nativeFetch(publishEndpoint, {
      method: 'POST',
      headers: {
        Origin: firstOrigin,
        'Content-Type': 'application/json',
        'X-Workbench-CSRF': firstToken,
      },
      body: publishBody,
    });
    assert.equal(response.status, 200);
    assert.equal(publisherCalls, 1);

    response = await nativeFetch(firstOrigin, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://attacker.invalid',
        'Access-Control-Request-Method': 'POST',
      },
    });
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('access-control-allow-origin'), null);

    const localhostOrigin = `http://localhost:${firstPort}`;
    response = await nativeFetch(firstOrigin, {
      method: 'OPTIONS',
      headers: {
        Origin: localhostOrigin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type, X-Workbench-CSRF',
      },
    });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), localhostOrigin);
    assert.match(response.headers.get('access-control-allow-headers') || '', /X-Workbench-CSRF/i);
  } finally {
    await closeServer(firstServer);
    await closeServer(secondServer);
    cleanupImportedContent(imported);
  }
});

test('upload serving rejects traversal, sibling-prefix, and symlink escapes without exposing paths', async () => {
  const uploadRoot = fs.mkdtempSync(path.join(testDataDir, 'uploads-contained-'));
  const siblingRoot = `${uploadRoot}-sibling`;
  const outsideDirectory = fs.mkdtempSync(path.join(testDataDir, 'uploads-outside-'));
  const outsideFile = path.join(testDataDir, 'outside-upload-secret.txt');
  let testServer;
  try {
    fs.mkdirSync(siblingRoot, { recursive: true });
    fs.writeFileSync(path.join(uploadRoot, 'safe.txt'), 'safe upload', 'utf8');
    fs.writeFileSync(path.join(siblingRoot, 'sibling-secret.txt'), 'sibling secret', 'utf8');
    fs.writeFileSync(outsideFile, 'outside secret', 'utf8');
    fs.writeFileSync(path.join(outsideDirectory, 'nested-secret.txt'), 'nested secret', 'utf8');
    fs.symlinkSync(outsideFile, path.join(uploadRoot, 'file-escape.txt'));
    fs.symlinkSync(outsideDirectory, path.join(uploadRoot, 'directory-escape'));

    testServer = createDashboardServer({ uploadsDir: uploadRoot });
    const port = await listenOnRandomPort(testServer);
    const origin = `http://127.0.0.1:${port}`;
    let response = await workbenchFetch(`${origin}/uploads/safe.txt`);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'safe upload');

    const attacks = [
      `/uploads/..%2F${encodeURIComponent(path.basename(outsideFile))}`,
      `/uploads/..%2F${encodeURIComponent(path.basename(siblingRoot))}%2Fsibling-secret.txt`,
      '/uploads/file-escape.txt',
      '/uploads/directory-escape/nested-secret.txt',
    ];
    for (const attack of attacks) {
      response = await workbenchFetch(`${origin}${attack}`);
      const responseText = await response.text();
      assert.equal(response.status, 404, attack);
      assert.match(responseText, /Not found/);
      assert.doesNotMatch(responseText, new RegExp(testDataDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      assert.doesNotMatch(responseText, /outside secret|sibling secret|nested secret/);
    }
  } finally {
    await closeServer(testServer);
    fs.rmSync(uploadRoot, { recursive: true, force: true });
    fs.rmSync(siblingRoot, { recursive: true, force: true });
    fs.rmSync(outsideDirectory, { recursive: true, force: true });
    fs.rmSync(outsideFile, { force: true });
  }
});

test('parsePlatformOutput reads CLI platform list', () => {
  const output = [
    '',
    'Supported platforms (2):',
    '',
    '  zhihu           Zhihu',
    '  zip-download    Markdown ZIP',
  ].join('\n');

  assert.deepEqual(parsePlatformOutput(output), [
    { id: 'zhihu', name: 'Zhihu' },
    { id: 'zip-download', name: 'Markdown ZIP' },
  ]);
});

test('parseSyncResults reads success and failed rows', () => {
  const output = [
    'Sync results:',
    '',
    '  ✓ zip-download',
    '    Downloaded Test.zip',
    '  ✗ juejin',
    '    Not logged in',
    '',
    'Sync completed: 1 success, 1 failed',
  ].join('\n');

  assert.deepEqual(parseSyncResults(output), {
    'zip-download': {
      status: 'success',
      url: null,
      message: 'Downloaded Test.zip',
    },
    juejin: {
      status: 'failed',
      error: 'Not logged in',
    },
  });
});

test('parseSyncResults reads current CLI OK and FAIL rows', () => {
  const output = [
    'Sync results:',
    '',
    '  [OK] zhihu (draft)',
    '    https://www.zhihu.com/draft/123',
    '    Draft saved',
    '  [FAIL] xiaohongshu',
    '    Run weibot login xiaohongshu first',
    '',
    'Sync completed: 1 success, 1 failed',
  ].join('\n');

  assert.deepEqual(parseSyncResults(output), {
    zhihu: {
      status: 'success',
      url: 'https://www.zhihu.com/draft/123',
      message: 'Draft saved',
    },
    xiaohongshu: {
      status: 'failed',
      error: 'Run weibot login xiaohongshu first',
    },
  });
});

test('loginExported detects cookie export output', () => {
  assert.equal(loginExported('Exported 3 cookies to cookies.json'), true);
  assert.equal(loginExported('Open browser and log in'), false);
});

test('generateCandidates creates five candidates', () => {
  const candidates = generateCandidates('2026-06-19');
  assert.equal(candidates.length, 5);
  assert.equal(candidates[0].priority, 'P0');
});

test('contentToMarkdown includes front matter and h1', () => {
  const markdown = contentToMarkdown({ title: 'Test Title', body: '# Test Title\n\nBody text' });
  assert.match(markdown, /title: Test Title/);
  assert.match(markdown, /# Test Title/);
  assert.match(markdown, /Body text/);
});

test('platform preview serializes canonical content and runs only the injected CLI preview command', async () => {
  let content;
  let previewFile;
  const tempRoot = createPreviewTempRoot('preview-success');
  const calls = [];
  try {
    content = importContent({
      filename: 'platform-preview.html',
      body: '<h1>平台预览母稿</h1><p>当前正文</p>',
    });
    const before = databaseSnapshot();
    const expected = validPlatformPreview();

    const preview = await previewContentForPlatform(content.id, 'xiaohongshu', {
      tempRoot,
      runner: async (args, timeout) => {
        calls.push({ args, timeout });
        previewFile = args[1];
        const source = fs.readFileSync(previewFile, 'utf8');
        assert.match(source, /title: 平台预览母稿/);
        assert.match(source, /# 平台预览母稿/);
        assert.match(source, /当前正文/);
        assert.doesNotMatch(source, /<h1>|<p>/);
        return {
          code: 0,
          stdout: `${JSON.stringify(expected)}\n`,
          stderr: '',
          output: `${JSON.stringify(expected)}\n`,
        };
      },
    });

    assert.deepEqual(preview, expected);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].args.slice(0, 1), ['preview']);
    assert.deepEqual(calls[0].args.slice(2), ['-p', 'xiaohongshu']);
    assert.equal(path.extname(calls[0].args[1]), '.md');
    assert.equal(path.dirname(path.dirname(calls[0].args[1])), tempRoot);
    assert.deepEqual(databaseSnapshot(), before);
    assert.equal(fs.existsSync(previewFile), false);
    assert.deepEqual(fs.readdirSync(tempRoot), []);
  } finally {
    cleanupImportedContent(content);
    if (previewFile && fs.existsSync(previewFile)) {
      fs.rmSync(path.dirname(previewFile), { recursive: true, force: true });
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('built CLI preview process reads the temp source and cleans it without runtime side effects', {
  skip: !fs.existsSync(CLI_PATH) ? 'built CLI unavailable; npm run dashboard:test builds it first' : false,
}, async () => {
  let content;
  const tempRoot = createPreviewTempRoot('preview-built-cli');
  try {
    content = importContent({
      filename: 'built-cli-preview.html',
      body: '<h1>真实 CLI 预览</h1><p>进程边界正文</p>',
    });
    const before = databaseSnapshot();

    const preview = await previewContentForPlatform(content.id, 'xiaohongshu', {
      tempRoot,
      timeout: 30000,
    });

    assert.equal(preview.platform, 'xiaohongshu');
    assert.equal(preview.title, '真实 CLI 预览');
    assert.equal(preview.format, 'text');
    assert.match(preview.content, /进程边界正文/);
    assert.equal(typeof preview.htmlPreview, 'string');
    assert.equal(Number.isInteger(preview.imageCount), true);
    assert.equal(preview.warnings.every(warning => typeof warning === 'string'), true);
    assert.deepEqual(databaseSnapshot(), before);
    assert.deepEqual(fs.readdirSync(tempRoot), []);
    assert.equal(fs.readFileSync(invalidPreviewCookieFile, 'utf8'), 'not valid cookie JSON');
  } finally {
    cleanupImportedContent(content);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('platform preview rejects missing and unknown platforms before invoking the CLI', async () => {
  let content;
  let runnerCalls = 0;
  const runner = async () => {
    runnerCalls++;
    return { code: 0, stdout: '{}\n', stderr: '', output: '{}\n' };
  };
  try {
    content = importContent({ filename: 'preview-validation.md', body: '# 预览校验\n\n正文' });

    await assert.rejects(
      () => previewContentForPlatform(content.id, '', { runner }),
      error => {
        assert.equal(error.statusCode, 400);
        assert.match(error.message, /缺少平台/);
        return true;
      }
    );
    await assert.rejects(
      () => previewContentForPlatform(content.id, 'unknown-platform', { runner }),
      error => {
        assert.equal(error.statusCode, 400);
        assert.match(error.message, /平台不存在: unknown-platform/);
        return true;
      }
    );
    assert.equal(runnerCalls, 0);
  } finally {
    cleanupImportedContent(content);
  }
});

test('platform preview returns 404 for unknown content before invoking the CLI', async () => {
  const tempRoot = createPreviewTempRoot('preview-missing-content');
  let runnerCalls = 0;
  try {
    await assert.rejects(
      () => previewContentForPlatform('../missing-content', 'xiaohongshu', {
        tempRoot,
        runner: async () => {
          runnerCalls++;
          return { code: 0, stdout: '{}\n', stderr: '', output: '{}\n' };
        },
      }),
      error => {
        assert.equal(error.statusCode, 404);
        assert.match(error.message, /内容不存在/);
        return true;
      }
    );
    assert.equal(runnerCalls, 0);
    assert.deepEqual(fs.readdirSync(tempRoot), []);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('platform preview rejects malformed or multiple CLI JSON results and cleans temporary files', async () => {
  let content;
  const tempRoot = createPreviewTempRoot('preview-malformed');
  const malformedOutputs = ['not-json\n', '{}\n{}\n'];
  try {
    content = importContent({ filename: 'preview-json.md', body: '# JSON 预览\n\n正文' });

    for (const stdout of malformedOutputs) {
      let previewFile;
      try {
        await assert.rejects(
          () => previewContentForPlatform(content.id, 'xiaohongshu', {
            tempRoot,
            runner: async args => {
              previewFile = args[1];
              return { code: 0, stdout, stderr: '', output: stdout };
            },
          }),
          error => {
            assert.equal(error.statusCode, 502);
            assert.equal(error.apiCode, 'PREVIEW_INVALID_RESPONSE');
            assert.equal(error.message, '平台预览结果无效，请重试');
            return true;
          }
        );
        assert.equal(fs.existsSync(previewFile), false);
        assert.deepEqual(fs.readdirSync(tempRoot), []);
      } finally {
        if (previewFile && fs.existsSync(previewFile)) {
          fs.rmSync(path.dirname(previewFile), { recursive: true, force: true });
        }
      }
    }
  } finally {
    cleanupImportedContent(content);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('platform preview rejects incomplete, mismatched, and mistyped CLI JSON schemas', async () => {
  let content;
  const tempRoot = createPreviewTempRoot('preview-schema');
  const invalidPreviews = [
    {},
    [],
    validPlatformPreview({ platform: 'zhihu' }),
    validPlatformPreview({ title: '   ' }),
    validPlatformPreview({ format: 'pdf' }),
    validPlatformPreview({ content: 42 }),
    validPlatformPreview({ htmlPreview: null }),
    validPlatformPreview({ imageCount: -1 }),
    validPlatformPreview({ imageCount: 1.5 }),
    validPlatformPreview({ warnings: ['有效警告', 2] }),
    validPlatformPreview({ limits: [] }),
  ];
  try {
    content = importContent({ filename: 'preview-schema.md', body: '# 预览 Schema\n\n正文' });

    for (const invalidPreview of invalidPreviews) {
      await assert.rejects(
        () => previewContentForPlatform(content.id, 'xiaohongshu', {
          tempRoot,
          runner: async () => {
            const stdout = `${JSON.stringify(invalidPreview)}\n`;
            return { code: 0, stdout, stderr: '', output: stdout };
          },
        }),
        error => {
          assert.equal(error.statusCode, 502);
          assert.equal(error.apiCode, 'PREVIEW_INVALID_RESPONSE');
          assert.equal(error.message, '平台预览结果无效，请重试');
          return true;
        }
      );
      assert.deepEqual(fs.readdirSync(tempRoot), []);
    }
  } finally {
    cleanupImportedContent(content);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('platform preview maps timeout, unavailable CLI, nonzero exit, and thrown runner failures', async () => {
  let content;
  const tempRoot = createPreviewTempRoot('preview-runner-errors');
  const consoleCalls = [];
  const originalConsole = {
    log: console.log,
    warn: console.warn,
    error: console.error,
  };
  console.log = (...args) => consoleCalls.push(['log', ...args]);
  console.warn = (...args) => consoleCalls.push(['warn', ...args]);
  console.error = (...args) => consoleCalls.push(['error', ...args]);
  try {
    content = importContent({ filename: 'preview-runner-errors.md', body: '# Runner 错误\n\n正文' });

    const timeoutError = Object.assign(new Error('process timed out after 25 ms'), {
      code: 'ETIMEDOUT',
      killed: true,
    });
    await assert.rejects(
      () => previewContentForPlatform(content.id, 'xiaohongshu', {
        tempRoot,
        runner: async () => ({
          code: 'ETIMEDOUT',
          error: timeoutError,
          stdout: '',
          stderr: `timeout while reading ${path.join(tempRoot, 'private.md')}`,
        }),
      }),
      error => {
        assert.equal(error.statusCode, 504);
        assert.equal(error.apiCode, 'PREVIEW_TIMEOUT');
        assert.match(error.message, /预览超时/);
        assert.doesNotMatch(error.message, new RegExp(tempRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
        return true;
      }
    );

    await assert.rejects(
      () => previewContentForPlatform(content.id, 'xiaohongshu', {
        tempRoot,
        runner: async () => {
          const error = new Error(`CLI 尚未构建: ${CLI_PATH}`);
          error.code = 'ENOENT';
          throw error;
        },
      }),
      error => {
        assert.equal(error.statusCode, 503);
        assert.equal(error.apiCode, 'PREVIEW_CLI_UNAVAILABLE');
        assert.match(error.message, /npm run build/);
        assert.doesNotMatch(error.message, /packages[\\/]cli|\/Users\//);
        return true;
      }
    );

    const sensitiveFailure = [
      'adapter rejected article',
      'Authorization: Bearer bearer-token-value',
      'Proxy-Authorization: Basic YmFzaWMtdG9rZW4=',
      'api_key=api-key-value',
      'api secret=api-secret-value',
      'Cookie: SID=cookie-value',
      'session=session-value',
      '/Users/Private User/preview article.md',
      'C:\\Users\\Private User\\preview article.md',
    ].join(' | ');
    await assert.rejects(
      () => previewContentForPlatform(content.id, 'xiaohongshu', {
        tempRoot,
        runner: async () => ({
          code: 1,
          error: null,
          stdout: '',
          stderr: sensitiveFailure,
        }),
      }),
      error => {
        assert.equal(error.statusCode, 502);
        assert.equal(error.apiCode, 'PREVIEW_CLI_FAILED');
        assert.equal(error.message, '平台预览失败，请重试');
        assert.doesNotMatch(error.message, /Bearer|Basic|api[_ ]?(?:key|secret)|Cookie|session|\/Users|C:\\/i);
        return true;
      }
    );

    await assert.rejects(
      () => previewContentForPlatform(content.id, 'xiaohongshu', {
        tempRoot,
        runner: async () => {
          throw new Error(sensitiveFailure);
        },
      }),
      error => {
        assert.equal(error.statusCode, 502);
        assert.equal(error.apiCode, 'PREVIEW_CLI_FAILED');
        assert.equal(error.message, '平台预览失败，请重试');
        assert.doesNotMatch(error.message, /Bearer|Basic|api[_ ]?(?:key|secret)|Cookie|session|\/Users|C:\\/i);
        return true;
      }
    );
    assert.deepEqual(fs.readdirSync(tempRoot), []);
  } finally {
    console.log = originalConsole.log;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
    cleanupImportedContent(content);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
  assert.deepEqual(consoleCalls, []);
});

test('GET platform-preview returns structured 504, 503, and 502 errors', async () => {
  let content;
  let testServer;
  const tempRoot = createPreviewTempRoot('preview-route-errors');
  const sensitiveFailure = [
    'Authorization: Bearer route-bearer-value',
    'Authorization: Basic cm91dGUtYmFzaWM=',
    'api_key=route-api-key',
    'secret=route-secret',
    'Cookie: SID=route-cookie',
    'session=route-session',
    '/Users/Private User/route preview.md',
    'C:\\Users\\Private User\\route preview.md',
  ].join(' | ');
  const outcomes = [
    () => Promise.reject(Object.assign(new Error('runner timeout'), { code: 'ETIMEDOUT' })),
    () => Promise.reject(new Error(`CLI 尚未构建: ${CLI_PATH}`)),
    () => Promise.resolve({ code: 1, stdout: '', stderr: sensitiveFailure }),
    () => Promise.reject(new Error(sensitiveFailure)),
    () => Promise.resolve({ code: 0, stdout: '{}\n', stderr: '' }),
  ];
  try {
    content = importContent({ filename: 'preview-route-errors.md', body: '# Route 错误\n\n正文' });
    testServer = createDashboardServer({
      previewTempRoot: tempRoot,
      previewRunner: async () => outcomes.shift()(),
    });
    const port = await listenOnRandomPort(testServer);
    const endpoint = `http://127.0.0.1:${port}/api/content/${encodeURIComponent(content.id)}/platform-preview?platform=xiaohongshu`;
    const expected = [
      [504, 'PREVIEW_TIMEOUT', '平台预览超时，请重试'],
      [503, 'PREVIEW_CLI_UNAVAILABLE', '平台预览服务尚未构建，请先运行 npm run build'],
      [502, 'PREVIEW_CLI_FAILED', '平台预览失败，请重试'],
      [502, 'PREVIEW_CLI_FAILED', '平台预览失败，请重试'],
      [502, 'PREVIEW_INVALID_RESPONSE', '平台预览结果无效，请重试'],
    ];

    for (const [status, code, message] of expected) {
      const response = await workbenchFetch(endpoint);
      const body = await response.json();
      assert.equal(response.status, status);
      assert.equal(body.ok, false);
      assert.equal(body.code, code);
      assert.equal(body.error, message);
      assert.doesNotMatch(JSON.stringify(body), /Bearer|Basic|api[_ ]?(?:key|secret)|Cookie|session|\/Users|C:\\/i);
    }
    assert.deepEqual(fs.readdirSync(tempRoot), []);
  } finally {
    await closeServer(testServer);
    cleanupImportedContent(content);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('GET platform-preview returns the injected CLI preview result', async () => {
  let content;
  let testServer;
  const tempRoot = createPreviewTempRoot('preview-route-success');
  const expected = validPlatformPreview({
    title: '预览端点母稿',
    content: '端点正文',
    htmlPreview: '<p>端点正文</p>',
  });
  const calls = [];
  try {
    content = importContent({ filename: 'preview-endpoint.md', body: '# 预览端点母稿\n\n端点正文' });
    testServer = createDashboardServer({
      previewTempRoot: tempRoot,
      previewRunner: async args => {
        calls.push(args);
        return {
          code: 0,
          stdout: `${JSON.stringify(expected)}\n`,
          stderr: '',
          output: `${JSON.stringify(expected)}\n`,
        };
      },
    });
    const port = await listenOnRandomPort(testServer);
    const response = await workbenchFetch(
      `http://127.0.0.1:${port}/api/content/${encodeURIComponent(content.id)}/platform-preview?platform=xiaohongshu`
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, preview: expected });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].slice(0, 1), ['preview']);
    assert.deepEqual(calls[0].slice(2), ['-p', 'xiaohongshu']);
    assert.equal(path.dirname(path.dirname(calls[0][1])), tempRoot);
    assert.deepEqual(fs.readdirSync(tempRoot), []);
  } finally {
    await closeServer(testServer);
    cleanupImportedContent(content);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('GET platform-preview maps platform validation to 400 and missing content to 404', async () => {
  let content;
  let testServer;
  let runnerCalls = 0;
  try {
    content = importContent({ filename: 'preview-endpoint-errors.md', body: '# 预览端点校验\n\n正文' });
    testServer = createDashboardServer({
      previewRunner: async () => {
        runnerCalls++;
        return { code: 0, stdout: '{}\n', stderr: '', output: '{}\n' };
      },
    });
    const port = await listenOnRandomPort(testServer);
    const base = `http://127.0.0.1:${port}/api/content`;

    let response = await workbenchFetch(`${base}/${encodeURIComponent(content.id)}/platform-preview`);
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /缺少平台/);

    response = await workbenchFetch(`${base}/${encodeURIComponent(content.id)}/platform-preview?platform=unknown-platform`);
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /平台不存在/);

    response = await workbenchFetch(`${base}/missing-content/platform-preview?platform=xiaohongshu`);
    assert.equal(response.status, 404);
    assert.match((await response.json()).error, /内容不存在/);
    assert.equal(runnerCalls, 0);
  } finally {
    await closeServer(testServer);
    cleanupImportedContent(content);
  }
});

test('publish snapshot names include safe job and content ids', () => {
  assert.equal(publishSnapshotName('job_1', 'content_1'), 'job_1-content_1.md');

  for (const ids of [
    ['', 'content_1'],
    ['job_1', ''],
    ['../job_1', 'content_1'],
    ['job_1', '../../content_1'],
    ['job/1', 'content_1'],
    ['job_1', 'content 1'],
  ]) {
    assert.throws(() => publishSnapshotName(...ids), /快照 ID 无效/);
  }
});

test('operation journal atomically persists running and reloads it as uncertain', () => {
  const operationsFile = path.join(testDataDir, 'operation-journal-uncertain.json');
  const signature = {
    contentId: 'content-journal-test',
    platforms: ['juejin', 'zhihu'],
    publishMode: 'direct',
    contentHash: 'a'.repeat(64),
  };
  let currentTime = 10_000;
  const firstJournal = createOperationJournal({
    filePath: operationsFile,
    nowMs: () => currentTime,
    ttlMs: 60_000,
    limit: 8,
  });
  const started = firstJournal.begin('journal-operation-0001', signature);
  assert.equal(started.kind, 'started');

  const runningDocument = JSON.parse(fs.readFileSync(operationsFile, 'utf8'));
  assert.equal(runningDocument.version, 1);
  assert.deepEqual(runningDocument.records[0].signature, signature);
  assert.equal(runningDocument.records[0].state, 'running');
  assert.equal(
    fs.readdirSync(path.dirname(operationsFile)).some(name => name.startsWith(`${path.basename(operationsFile)}.`) && name.endsWith('.tmp')),
    false,
  );

  currentTime += 1;
  const reloadedJournal = createOperationJournal({
    filePath: operationsFile,
    nowMs: () => currentTime,
    ttlMs: 60_000,
    limit: 8,
  });
  reloadedJournal.recoverRunning();
  assert.equal(reloadedJournal.get('journal-operation-0001').state, 'uncertain');
  assert.throws(
    () => reloadedJournal.begin('journal-operation-0001', signature),
    error => error?.statusCode === 409 && /不确定|重复/.test(error.message),
  );
  assert.doesNotMatch(fs.readFileSync(operationsFile, 'utf8'), /cookie|secret|正文内容/i);
});

test('two journal instances reload disk state and block a different operationId with the same running signature', () => {
  const operationsFile = path.join(testDataDir, 'operation-journal-two-instances-running.json');
  const signature = {
    contentId: 'content-shared-running',
    platforms: ['zhihu'],
    publishMode: 'direct',
    contentHash: 'b'.repeat(64),
  };
  const firstJournal = createOperationJournal({ filePath: operationsFile });
  const secondJournal = createOperationJournal({ filePath: operationsFile });
  firstJournal.begin('shared-running-operation-0001', signature);

  assert.throws(
    () => secondJournal.begin('shared-running-operation-0002', signature),
    error => error?.statusCode === 409 && /正在进行|不确定|重复/.test(error.message),
  );
  assert.equal(secondJournal.get('shared-running-operation-0001').state, 'running');
});

test('a second journal instance replays a completed signature across operationIds', () => {
  const operationsFile = path.join(testDataDir, 'operation-journal-two-instances-completed.json');
  const signature = {
    contentId: 'content-shared-completed',
    platforms: ['juejin', 'zhihu'],
    publishMode: 'draft',
    contentHash: 'c'.repeat(64),
  };
  const firstJournal = createOperationJournal({ filePath: operationsFile });
  const secondJournal = createOperationJournal({ filePath: operationsFile });
  firstJournal.begin('shared-completed-operation-0001', signature);
  firstJournal.complete('shared-completed-operation-0001', {
    jobId: 'job-shared-completed',
    jobStatus: 'draft_saved',
    platformResults: [
      { platform: 'zhihu', status: 'platform_draft' },
      { platform: 'juejin', status: 'platform_draft' },
    ],
  });

  const replay = secondJournal.begin('shared-completed-operation-0002', signature);
  assert.equal(replay.kind, 'replay');
  assert.equal(replay.record.operationId, 'shared-completed-operation-0002');
  assert.equal(replay.record.aliasOf, 'shared-completed-operation-0001');
  assert.equal(replay.record.result.jobId, 'job-shared-completed');
});

test('completed signature replay atomically persists an alias for the incoming operationId', () => {
  const operationsFile = path.join(testDataDir, 'operation-journal-completed-alias.json');
  const signature = {
    contentId: 'content-completed-alias',
    platforms: ['zhihu'],
    publishMode: 'direct',
    contentHash: 'e'.repeat(64),
  };
  const journal = createOperationJournal({ filePath: operationsFile, limit: 8 });
  journal.begin('completed-alias-operation-0001', signature);
  journal.complete('completed-alias-operation-0001', {
    jobId: 'job-completed-alias',
    jobStatus: 'published',
    platformResults: [{ platform: 'zhihu', status: 'success' }],
  });

  const replay = journal.begin('completed-alias-operation-0002', signature);
  assert.equal(replay.kind, 'replay');
  assert.equal(replay.record.operationId, 'completed-alias-operation-0002');
  assert.equal(replay.record.aliasOf, 'completed-alias-operation-0001');
  const document = JSON.parse(fs.readFileSync(operationsFile, 'utf8'));
  const alias = document.records.find(record => record.operationId === 'completed-alias-operation-0002');
  assert.equal(alias.state, 'completed');
  assert.deepEqual(alias.signature, signature);
  assert.equal(alias.result.jobId, 'job-completed-alias');
});

test('uncertain journal records survive short TTL pruning and block new IDs for the same signature', () => {
  const operationsFile = path.join(testDataDir, 'operation-journal-uncertain-retention.json');
  let currentTime = 50_000;
  const signature = {
    contentId: 'content-uncertain-retention',
    platforms: ['zhihu'],
    publishMode: 'direct',
    contentHash: 'd'.repeat(64),
  };
  const journal = createOperationJournal({
    filePath: operationsFile,
    nowMs: () => currentTime,
    ttlMs: 10,
    limit: 4,
  });
  journal.begin('uncertain-retention-operation-0001', signature);
  journal.markUncertain('uncertain-retention-operation-0001');
  currentTime += 10_000;

  assert.throws(
    () => journal.begin('uncertain-retention-operation-0002', signature),
    error => error?.statusCode === 409 && /不确定/.test(error.message),
  );
  assert.equal(journal.get('uncertain-retention-operation-0001').state, 'uncertain');
});

test('instance lock rejects a live PID and safely replaces a stale PID lock', () => {
  const liveLockFile = path.join(testDataDir, 'publisher-live.instance.lock');
  const staleLockFile = path.join(testDataDir, 'publisher-stale.instance.lock');
  fs.writeFileSync(liveLockFile, JSON.stringify({ pid: 4242, token: 'live-owner' }), 'utf8');
  const liveContender = createInstanceLock({
    filePath: liveLockFile,
    pid: 5252,
    isProcessAlive: pid => pid === 4242,
  });
  assert.throws(
    () => liveContender.acquire(),
    error => error?.code === 'PUBLISHER_INSTANCE_ACTIVE' && /4242/.test(error.message),
  );
  assert.equal(JSON.parse(fs.readFileSync(liveLockFile, 'utf8')).pid, 4242);

  fs.writeFileSync(staleLockFile, JSON.stringify({ pid: 6262, token: 'stale-owner' }), 'utf8');
  const replacement = createInstanceLock({
    filePath: staleLockFile,
    pid: 7272,
    isProcessAlive: () => false,
  });
  replacement.acquire();
  assert.equal(JSON.parse(fs.readFileSync(staleLockFile, 'utf8')).pid, 7272);
  replacement.release();
  assert.equal(fs.existsSync(staleLockFile), false);
});

test('dashboard server holds one instance lock and releases it on close', async () => {
  const operationsFile = path.join(testDataDir, 'server-instance-operations.json');
  const instanceLockFile = path.join(testDataDir, 'server-instance.lock');
  const firstServer = createDashboardServer({ operationsFile, instanceLockFile });
  const secondServer = createDashboardServer({ operationsFile, instanceLockFile });
  try {
    await listenOnRandomPort(firstServer);
    assert.equal(fs.existsSync(instanceLockFile), true);
    assert.throws(
      () => secondServer.listen(0, '127.0.0.1'),
      error => error?.code === 'PUBLISHER_INSTANCE_ACTIVE',
    );
    await closeServer(firstServer);
    assert.equal(fs.existsSync(instanceLockFile), false);
    await listenOnRandomPort(secondServer);
  } finally {
    await closeServer(firstServer);
    await closeServer(secondServer);
  }
  assert.equal(fs.existsSync(instanceLockFile), false);
});

test('publisher side-effect exception marks signature uncertain and blocks a new operationId', async () => {
  let fixture;
  let testServer;
  let publisherCalls = 0;
  const operationsFile = path.join(testDataDir, 'post-effect-uncertain-operations.json');
  try {
    fixture = createPublishStateFixture({
      key: 'post-effect-uncertain',
      planDate: '2099-06-08',
      selectedPlatforms: ['zhihu'],
      contentStatus: '已排版',
      planStatus: '已排版',
    });
    testServer = createDashboardServer({
      operationsFile,
      instanceLockFile: path.join(testDataDir, 'post-effect-uncertain.instance.lock'),
      preflight: async () => null,
      platformPublisher: async () => {
        publisherCalls += 1;
        throw new Error('publisher threw after external side effect');
      },
    });
    const port = await listenOnRandomPort(testServer);
    const endpoint = `http://127.0.0.1:${port}/api/content/${fixture.id}/publish-platform`;
    const publish = operationId => workbenchFetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform: 'zhihu', publishMode: 'direct', operationId }),
    });

    let response = await publish('post-effect-uncertain-operation-0001');
    assert.equal(response.status, 500);
    assert.equal(publisherCalls, 1);
    const journalAfterFailure = JSON.parse(fs.readFileSync(operationsFile, 'utf8'));
    assert.equal(journalAfterFailure.records[0].state, 'uncertain');

    response = await publish('post-effect-uncertain-operation-0002');
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /不确定|人工核对/);
    assert.equal(publisherCalls, 1);
  } finally {
    await closeServer(testServer);
    cleanupPublishStateFixture(fixture);
  }
});

test('all preflight failures record failed and allow a new operationId retry', async () => {
  let fixture;
  let testServer;
  let preflightCalls = 0;
  let publisherCalls = 0;
  const operationsFile = path.join(testDataDir, 'preflight-failed-operations.json');
  try {
    fixture = createPublishStateFixture({
      key: 'preflight-failed-retry',
      planDate: '2099-06-09',
      selectedPlatforms: ['zhihu'],
      contentStatus: '已排版',
      planStatus: '已排版',
    });
    testServer = createDashboardServer({
      operationsFile,
      preflight: async () => {
        preflightCalls += 1;
        return 'authentication unavailable before publisher start';
      },
      platformPublisher: async () => {
        publisherCalls += 1;
        return successfulPlatformPublisher()();
      },
    });
    const port = await listenOnRandomPort(testServer);
    const endpoint = `http://127.0.0.1:${port}/api/content/${fixture.id}/publish-platform`;
    const publish = operationId => workbenchFetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform: 'zhihu', publishMode: 'direct', operationId }),
    });

    let response = await publish('preflight-failed-operation-0001');
    assert.equal(response.status, 200);
    assert.equal((await response.json()).job.status, 'failed');
    response = await publish('preflight-failed-operation-0002');
    assert.equal(response.status, 200);
    assert.equal((await response.json()).cached, false);
    assert.equal(preflightCalls, 2);
    assert.equal(publisherCalls, 0);
    const document = JSON.parse(fs.readFileSync(operationsFile, 'utf8'));
    assert.deepEqual(document.records.map(record => record.state), ['failed', 'failed']);
  } finally {
    await closeServer(testServer);
    cleanupPublishStateFixture(fixture);
  }
});

test('publisher-started all-failed result records uncertain and blocks a new operationId', async () => {
  let fixture;
  let testServer;
  let publisherCalls = 0;
  const operationsFile = path.join(testDataDir, 'publisher-all-failed-operations.json');
  try {
    fixture = createPublishStateFixture({
      key: 'publisher-all-failed',
      planDate: '2099-06-10',
      selectedPlatforms: ['zhihu'],
      contentStatus: '已排版',
      planStatus: '已排版',
    });
    testServer = createDashboardServer({
      operationsFile,
      preflight: async () => null,
      platformPublisher: async () => {
        publisherCalls += 1;
        return { output: '', info: { status: 'failed', error: 'ambiguous adapter failure' } };
      },
    });
    const port = await listenOnRandomPort(testServer);
    const endpoint = `http://127.0.0.1:${port}/api/content/${fixture.id}/publish-platform`;
    const publish = operationId => workbenchFetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform: 'zhihu', publishMode: 'direct', operationId }),
    });

    let response = await publish('publisher-all-failed-operation-0001');
    assert.equal(response.status, 200);
    assert.equal((await response.json()).job.status, 'failed');
    assert.equal(JSON.parse(fs.readFileSync(operationsFile, 'utf8')).records[0].state, 'uncertain');
    response = await publish('publisher-all-failed-operation-0002');
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /不确定|人工核对/);
    assert.equal(publisherCalls, 1);
  } finally {
    await closeServer(testServer);
    cleanupPublishStateFixture(fixture);
  }
});

test('partial publisher success records completed and replays without another publisher call', async () => {
  let fixture;
  let testServer;
  let publisherCalls = 0;
  const operationsFile = path.join(testDataDir, 'publisher-partial-completed-operations.json');
  try {
    fixture = createPublishStateFixture({
      key: 'publisher-partial-completed',
      planDate: '2099-06-11',
      selectedPlatforms: ['zhihu', 'juejin'],
      contentStatus: '已排版',
      planStatus: '已排版',
    });
    testServer = createDashboardServer({
      operationsFile,
      preflight: async () => null,
      platformPublisher: async (markdownFile, platform) => {
        publisherCalls += 1;
        return platform === 'zhihu'
          ? { output: '', info: { status: 'success', message: 'published' } }
          : { output: '', info: { status: 'failed', error: 'known platform failure' } };
      },
    });
    const port = await listenOnRandomPort(testServer);
    const endpoint = `http://127.0.0.1:${port}/api/publish`;
    const publish = operationId => workbenchFetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contentId: fixture.id,
        platforms: ['zhihu', 'juejin'],
        publishMode: 'direct',
        operationId,
      }),
    });

    let response = await publish('publisher-partial-operation-0001');
    assert.equal(response.status, 200);
    assert.equal((await response.json()).job.status, 'partial_failed');
    assert.equal(JSON.parse(fs.readFileSync(operationsFile, 'utf8')).records[0].state, 'completed');
    response = await publish('publisher-partial-operation-0002');
    assert.equal(response.status, 200);
    assert.equal((await response.json()).cached, true);
    assert.equal(publisherCalls, 2);
  } finally {
    await closeServer(testServer);
    cleanupPublishStateFixture(fixture);
  }
});

test('lost completed response persists replay alias and changed alias signature never republishes', async () => {
  let fixture;
  let testServer;
  let publisherCalls = 0;
  const operationsFile = path.join(testDataDir, 'lost-response-alias-operations.json');
  try {
    fixture = createPublishStateFixture({
      key: 'lost-response-alias',
      planDate: '2099-06-12',
      selectedPlatforms: ['zhihu'],
      contentStatus: '已排版',
      planStatus: '已排版',
    });
    testServer = createDashboardServer({
      operationsFile,
      preflight: async () => null,
      platformPublisher: async () => {
        publisherCalls += 1;
        return { output: '', info: { status: 'success', message: 'published once' } };
      },
    });
    const port = await listenOnRandomPort(testServer);
    const endpoint = `http://127.0.0.1:${port}/api/content/${fixture.id}/publish-platform`;
    const publish = operationId => workbenchFetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform: 'zhihu', publishMode: 'direct', operationId }),
    });

    const lostResponse = await publish('lost-response-operation-0001');
    assert.equal(lostResponse.status, 200);
    await lostResponse.body?.cancel();
    let response = await publish('lost-response-operation-0002');
    assert.equal(response.status, 200);
    assert.equal((await response.json()).cached, true);
    let document = JSON.parse(fs.readFileSync(operationsFile, 'utf8'));
    assert.equal(document.records.find(record => record.operationId === 'lost-response-operation-0002').aliasOf, 'lost-response-operation-0001');

    updateCurrentContent(fixture.id, { body: '# Changed after lost response\n\nNew canonical signature.' });
    response = await publish('lost-response-operation-0002');
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /operationId|内容版本|发布参数/);
    assert.equal(publisherCalls, 1);
    document = JSON.parse(fs.readFileSync(operationsFile, 'utf8'));
    assert.equal(document.records.filter(record => record.operationId === 'lost-response-operation-0002').length, 1);
  } finally {
    await closeServer(testServer);
    cleanupPublishStateFixture(fixture);
  }
});

test('listenWithFallback does not retry another port for the same data store', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '..', 'server.js'), 'utf8');
  const start = source.indexOf('function listenWithFallback');
  const end = source.indexOf('\ninitDb();', start);
  const listenSource = source.slice(start, end);
  assert.doesNotMatch(listenSource, /listenWithFallback\(next/);
  assert.doesNotMatch(listenSource, /trying \$\{next\}/);
});

test('repeated publish jobs keep different job-specific snapshots', async () => {
  let content;
  const jobIds = [];
  const snapshotFiles = [];
  const publisherCalls = [];
  try {
    content = importContent({ filename: 'repeat-publish.md', body: '# 重复发布母稿\n\n不能被覆盖的正文' });
    const platformPublisher = async (markdownFile, platform, title, publishMode) => {
      snapshotFiles.push(markdownFile);
      publisherCalls.push({ platform, title, publishMode });
      assert.match(fs.readFileSync(markdownFile, 'utf8'), /不能被覆盖的正文/);
      return {
        output: '',
        info: { status: 'success', message: '本地 stub 发布成功' },
      };
    };
    const options = {
      publishMode: 'draft',
      preflight: async () => null,
      platformPublisher,
    };

    const first = await publishContent(content.id, ['zhihu'], options);
    const second = await publishContent(content.id, ['zhihu'], options);
    jobIds.push(first.job.id, second.job.id);

    assert.notEqual(first.job.id, second.job.id);
    assert.deepEqual(snapshotFiles.map(file => path.basename(file)), [
      publishSnapshotName(first.job.id, content.id),
      publishSnapshotName(second.job.id, content.id),
    ]);
    assert.notEqual(snapshotFiles[0], snapshotFiles[1]);
    assert.equal(snapshotFiles.every(file => fs.existsSync(file)), true);
    assert.equal(fs.existsSync(path.join(DRAFTS_DIR, `${content.id}.md`)), false);
    assert.deepEqual(publisherCalls, [
      { platform: 'zhihu', title: '重复发布母稿', publishMode: 'draft' },
      { platform: 'zhihu', title: '重复发布母稿', publishMode: 'draft' },
    ]);
  } finally {
    for (const jobId of jobIds) {
      db.prepare("DELETE FROM activity WHERE target_type = 'publish_job' AND target_id = ?").run(jobId);
      db.prepare('DELETE FROM publish_results WHERE job_id = ?').run(jobId);
      db.prepare('DELETE FROM publish_jobs WHERE id = ?').run(jobId);
    }
    cleanupImportedContent(content);
    for (const snapshotFile of snapshotFiles) {
      fs.rmSync(snapshotFile, { force: true });
    }
  }
});

test('publishContent batch draft uses distinct statuses without increasing published metrics', async () => {
  let fixture;
  const calls = [];
  try {
    fixture = createPublishStateFixture({
      key: 'batch-state-regression',
      planDate: '2099-06-01',
      selectedPlatforms: ['weixin'],
      contentStatus: '已排版',
      planStatus: '正文已生成',
    });
    const dashboardBefore = getDashboardData();
    const publishedBefore = dashboardBefore.stats.thisWeekPublished;
    const monthPublishedBefore = dashboardBefore.stats.monthPublished;
    const distributionBefore = Object.fromEntries(dashboardBefore.platformDistribution.map(item => [item.id, item.count]));
    const result = await publishContent(fixture.id, ['zhihu', 'juejin'], {
      publishMode: 'draft',
      preflight: async () => null,
      platformPublisher: successfulPlatformPublisher(calls),
    });

    assert.equal(result.job.status, 'draft_saved');
    assert.deepEqual(result.job.platforms, ['zhihu', 'juejin']);
    assert.deepEqual(result.job.results.map(item => [item.platform, item.status]), [
      ['zhihu', 'platform_draft'],
      ['juejin', 'platform_draft'],
    ]);
    assert.deepEqual(readPublishState(fixture), {
      selectedPlatforms: ['zhihu', 'juejin'],
      contentStatus: '草稿已保存',
      planStatus: '草稿已保存',
    });
    const dashboardAfter = getDashboardData();
    assert.equal(dashboardAfter.stats.thisWeekPublished, publishedBefore);
    assert.equal(dashboardAfter.stats.monthPublished, monthPublishedBefore);
    assert.deepEqual(
      Object.fromEntries(dashboardAfter.platformDistribution.map(item => [item.id, item.count])),
      distributionBefore,
    );
    assert.deepEqual(calls.map(call => call.platform), ['zhihu', 'juejin']);
  } finally {
    cleanupPublishStateFixture(fixture);
  }
});

test('publishContent can record one platform without mutating selection or aggregate status', async () => {
  let fixture;
  try {
    fixture = createPublishStateFixture({
      key: 'single-state-preserved',
      planDate: '2099-06-02',
      selectedPlatforms: ['weixin', 'douyin'],
      contentStatus: '已排版',
      planStatus: '选题已确认',
    });
    const result = await publishContent(fixture.id, ['zhihu'], {
      publishMode: 'direct',
      persistSelection: false,
      updateAggregateStatus: false,
      preflight: async () => null,
      platformPublisher: successfulPlatformPublisher(),
    });

    assert.equal(result.job.status, 'published');
    assert.deepEqual(result.job.platforms, ['zhihu']);
    assert.deepEqual(result.job.results.map(item => [item.platform, item.status]), [['zhihu', 'success']]);
    assert.deepEqual(readPublishState(fixture), {
      selectedPlatforms: ['weixin', 'douyin'],
      contentStatus: '已排版',
      planStatus: '选题已确认',
    });
  } finally {
    cleanupPublishStateFixture(fixture);
  }
});

test('POST publish-platform records sequential jobs without changing aggregate content state', async () => {
  let fixture;
  let testServer;
  const platformCalls = [];
  let highLevelPublisherCalls = 0;
  try {
    fixture = createPublishStateFixture({
      key: 'single-platform-sequential',
      planDate: '2099-06-03',
      selectedPlatforms: ['weixin', 'douyin'],
      contentStatus: '已排版',
      planStatus: '选题已确认',
    });
    testServer = createDashboardServer({
      publisher: async () => {
        highLevelPublisherCalls++;
        throw new Error('whole publisher replacement must not be used');
      },
      preflight: async () => null,
      platformPublisher: successfulPlatformPublisher(platformCalls),
    });
    const port = await listenOnRandomPort(testServer);
    const endpoint = `http://127.0.0.1:${port}/api/content/${encodeURIComponent(fixture.id)}/publish-platform`;

    let response = await workbenchFetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform: ' ZHIHU ', publishMode: 'draft', operationId: 'sequential-operation-0001' }),
    });
    assert.equal(response.status, 200);
    let result = await response.json();
    assert.equal(result.ok, true);
    assert.equal(result.job.status, 'draft_saved');
    assert.deepEqual(result.job.platforms, ['zhihu']);
    assert.deepEqual(result.job.results.map(item => [item.platform, item.status]), [['zhihu', 'platform_draft']]);
    const firstJobId = result.job.id;
    assert.deepEqual(readPublishState(fixture), {
      selectedPlatforms: ['weixin', 'douyin'],
      contentStatus: '已排版',
      planStatus: '选题已确认',
    });

    response = await workbenchFetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform: 'juejin', publishMode: 'direct', operationId: 'sequential-operation-0002' }),
    });
    assert.equal(response.status, 200);
    result = await response.json();
    assert.deepEqual(result.job.platforms, ['juejin']);
    assert.deepEqual(result.job.results.map(item => [item.platform, item.status]), [['juejin', 'success']]);
    assert.notEqual(result.job.id, firstJobId);
    assert.deepEqual(readPublishState(fixture), {
      selectedPlatforms: ['weixin', 'douyin'],
      contentStatus: '已排版',
      planStatus: '选题已确认',
    });
    assert.equal(highLevelPublisherCalls, 0);
    assert.deepEqual(platformCalls.map(call => [call.platform, call.publishMode]), [
      ['zhihu', 'draft'],
      ['juejin', 'direct'],
    ]);
  } finally {
    await closeServer(testServer);
    cleanupPublishStateFixture(fixture);
  }
});

test('POST publish-platform keeps state stable across concurrent single-platform jobs', async () => {
  let fixture;
  let testServer;
  const platformCalls = [];
  let entered = 0;
  let releasePublishers;
  const bothEntered = new Promise(resolve => {
    releasePublishers = resolve;
  });
  try {
    fixture = createPublishStateFixture({
      key: 'single-platform-concurrent',
      planDate: '2099-06-04',
      selectedPlatforms: ['weixin', 'douyin'],
      contentStatus: '草稿已保存',
      planStatus: '已排版',
    });
    testServer = createDashboardServer({
      publisher: async () => {
        throw new Error('whole publisher replacement must not be used');
      },
      preflight: async () => null,
      platformPublisher: async (markdownFile, platform, title, publishMode) => {
        platformCalls.push({ markdownFile, platform, title, publishMode });
        entered++;
        if (entered === 2) releasePublishers();
        await bothEntered;
        return {
          output: '',
          info: {
            status: 'success',
            message: `concurrent ${platform} success`,
            url: `https://example.invalid/${platform}`,
            postId: `concurrent-${platform}`,
          },
        };
      },
    });
    const port = await listenOnRandomPort(testServer);
    const endpoint = `http://127.0.0.1:${port}/api/content/${encodeURIComponent(fixture.id)}/publish-platform`;
    const request = (platform, publishMode, operationId) => workbenchFetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform, publishMode, operationId }),
    });

    const responses = await Promise.all([
      request('zhihu', 'draft', 'concurrent-operation-0001'),
      request('juejin', 'direct', 'concurrent-operation-0002'),
    ]);
    const payloads = await Promise.all(responses.map(response => response.json()));

    assert.deepEqual(responses.map(response => response.status), [200, 200]);
    assert.equal(new Set(payloads.map(payload => payload.job.id)).size, 2);
    assert.deepEqual(payloads.map(payload => payload.job.platforms[0]).sort(), ['juejin', 'zhihu']);
    for (const payload of payloads) {
      assert.equal(payload.ok, true);
      assert.equal(payload.job.results.length, 1);
      assert.equal(payload.job.results[0].platform, payload.job.platforms[0]);
    }
    assert.deepEqual(Object.fromEntries(payloads.map(payload => [
      payload.job.platforms[0],
      [payload.job.status, payload.job.results[0].status],
    ])), {
      juejin: ['published', 'success'],
      zhihu: ['draft_saved', 'platform_draft'],
    });
    assert.deepEqual(readPublishState(fixture), {
      selectedPlatforms: ['weixin', 'douyin'],
      contentStatus: '草稿已保存',
      planStatus: '已排版',
    });
    assert.deepEqual(platformCalls.map(call => [call.platform, call.publishMode]).sort(), [
      ['juejin', 'direct'],
      ['zhihu', 'draft'],
    ]);
  } finally {
    releasePublishers?.();
    await closeServer(testServer);
    cleanupPublishStateFixture(fixture);
  }
});

test('POST publish-platform rejects an in-flight duplicate and releases the guard afterward', async () => {
  let fixture;
  let testServer;
  let releaseFirst;
  let signalEntered;
  const firstEntered = new Promise(resolve => { signalEntered = resolve; });
  const firstGate = new Promise(resolve => { releaseFirst = resolve; });
  let calls = 0;
  try {
    fixture = createPublishStateFixture({
      key: 'single-platform-in-flight-guard',
      planDate: '2099-06-05',
      selectedPlatforms: ['weixin'],
      contentStatus: '已排版',
      planStatus: '已排版',
    });
    testServer = createDashboardServer({
      preflight: async () => null,
      platformPublisher: async (markdownFile, platform) => {
        calls += 1;
        if (calls === 1) {
          signalEntered();
          await firstGate;
        }
        return {
          output: '',
          info: { status: 'success', message: `${platform} guarded success` },
        };
      },
    });
    const port = await listenOnRandomPort(testServer);
    const endpoint = `http://127.0.0.1:${port}/api/content/${fixture.id}/publish-platform`;
    const publish = operationId => workbenchFetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform: 'zhihu', publishMode: 'direct', operationId }),
    });

    const operationId = 'in-flight-operation-0001';
    const firstRequest = publish(operationId);
    await firstEntered;
    const duplicateResponse = await publish(operationId);
    assert.equal(duplicateResponse.status, 409);
    assert.match((await duplicateResponse.json()).error, /正在进行|重复发布/);
    assert.equal(calls, 1);

    releaseFirst();
    const firstResponse = await firstRequest;
    const firstResult = await firstResponse.json();
    assert.equal(firstResponse.status, 200);

    const retryResponse = await publish(operationId);
    const retryResult = await retryResponse.json();
    assert.equal(retryResponse.status, 200);
    assert.equal(retryResult.cached, true);
    assert.equal(retryResult.job.id, firstResult.job.id);
    assert.equal(calls, 1);

    const conflictingResponse = await workbenchFetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platform: 'juejin',
        publishMode: 'direct',
        operationId,
      }),
    });
    assert.equal(conflictingResponse.status, 409);

    const newOperationResponse = await publish('in-flight-operation-0002');
    assert.equal(newOperationResponse.status, 200);
    assert.equal((await newOperationResponse.json()).cached, true);
    assert.equal(calls, 1);
  } finally {
    releaseFirst?.();
    await closeServer(testServer);
    cleanupPublishStateFixture(fixture);
  }
});

test('single publish completed cache expires by TTL and evicts oldest entries when bounded', async () => {
  let fixture;
  let testServer;
  let currentTime = 1_000;
  let calls = 0;
  try {
    fixture = createPublishStateFixture({
      key: 'single-platform-cache-policy',
      planDate: '2099-06-06',
      selectedPlatforms: ['weixin'],
      contentStatus: '已排版',
      planStatus: '已排版',
    });
    testServer = createDashboardServer({
      operationsFile: path.join(testDataDir, 'single-cache-policy-operations.json'),
      preflight: async () => null,
      singlePublishCacheTtlMs: 50,
      singlePublishCacheLimit: 1,
      nowMs: () => currentTime,
      platformPublisher: async () => {
        calls += 1;
        return { output: '', info: { status: 'success', message: `cache call ${calls}` } };
      },
    });
    const port = await listenOnRandomPort(testServer);
    const endpoint = `http://127.0.0.1:${port}/api/content/${fixture.id}/publish-platform`;
    const publish = operationId => workbenchFetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform: 'zhihu', publishMode: 'direct', operationId }),
    });

    let response = await publish('cache-policy-operation-0001');
    assert.equal(response.status, 200);
    response = await publish('cache-policy-operation-0001');
    assert.equal((await response.json()).cached, true);
    assert.equal(calls, 1);

    currentTime += 51;
    response = await publish('cache-policy-operation-0001');
    assert.equal(response.status, 200);
    assert.equal(calls, 2);

    updateCurrentContent(fixture.id, { body: '# Cache version two\n\nChanged canonical body.' });
    response = await publish('cache-policy-operation-0002');
    assert.equal(response.status, 200);
    assert.equal(calls, 3);
    updateCurrentContent(fixture.id, { body: '# Cache version three\n\nChanged canonical body again.' });
    response = await publish('cache-policy-operation-0001');
    assert.equal(response.status, 200);
    assert.equal(calls, 4);
  } finally {
    await closeServer(testServer);
    cleanupPublishStateFixture(fixture);
  }
});

test('batch publish journal survives server restart, replays completion, and rejects mismatch', async () => {
  let fixture;
  let testServer;
  let calls = 0;
  const operationsFile = path.join(testDataDir, 'batch-restart-operations.json');
  const operationId = 'batch-restart-operation-0001';
  const requestBody = {
    contentId: '',
    platforms: ['juejin', 'zhihu'],
    publishMode: 'direct',
    operationId,
  };
  const platformPublisher = async (markdownFile, platform) => {
    calls += 1;
    return {
      output: `private raw output ${platform}`,
      info: { status: 'success', message: `${platform} published` },
    };
  };
  try {
    fixture = createPublishStateFixture({
      key: 'batch-journal-restart-secret-title',
      planDate: '2099-06-07',
      selectedPlatforms: ['weixin'],
      contentStatus: '已排版',
      planStatus: '已排版',
    });
    requestBody.contentId = fixture.id;
    const startServer = async () => {
      const instance = createDashboardServer({
        operationsFile,
        preflight: async () => null,
        platformPublisher,
      });
      const port = await listenOnRandomPort(instance);
      return { instance, endpoint: `http://127.0.0.1:${port}/api/publish` };
    };
    const post = (endpoint, body) => workbenchFetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    let running = await startServer();
    testServer = running.instance;
    let response = await post(running.endpoint, {
      contentId: fixture.id,
      platforms: ['zhihu'],
      publishMode: 'direct',
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /operationId/);
    assert.equal(calls, 0);

    response = await post(running.endpoint, requestBody);
    const firstResult = await response.json();
    assert.equal(response.status, 200);
    assert.equal(firstResult.cached, false);
    assert.equal(calls, 2);
    const firstJobId = firstResult.job.id;
    await closeServer(testServer);
    testServer = null;

    running = await startServer();
    testServer = running.instance;
    response = await post(running.endpoint, requestBody);
    const replayResult = await response.json();
    assert.equal(response.status, 200);
    assert.equal(replayResult.cached, true);
    assert.equal(replayResult.job.id, firstJobId);
    assert.equal(calls, 2);

    response = await post(running.endpoint, {
      ...requestBody,
      platforms: ['weixin'],
    });
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /operationId|发布参数|内容版本/);
    assert.equal(calls, 2);

    const journalText = fs.readFileSync(operationsFile, 'utf8');
    assert.doesNotMatch(journalText, /batch-journal-restart-secret-title|发布状态回归正文|private raw output/i);
  } finally {
    await closeServer(testServer);
    cleanupPublishStateFixture(fixture);
  }
});

test('POST publish-platform validates one known platform, mode, body, and content', async () => {
  let content;
  let testServer;
  let platformPublisherCalls = 0;
  try {
    content = importContent({ filename: 'single-platform-validation.md', body: '# 单平台校验\n\n正文' });
    testServer = createDashboardServer({
      preflight: async () => null,
      platformPublisher: async () => {
        platformPublisherCalls++;
        return successfulPlatformPublisher()();
      },
    });
    const port = await listenOnRandomPort(testServer);
    const endpoint = `http://127.0.0.1:${port}/api/content/${encodeURIComponent(content.id)}/publish-platform`;
    const operationId = 'validation-operation-0001';
    const invalidCases = [
      [{ publishMode: 'draft', operationId }, /必须且只能指定一个平台/],
      [{ platform: ['zhihu'], publishMode: 'draft', operationId }, /必须且只能指定一个平台/],
      [{ platform: 'zhihu,juejin', publishMode: 'draft', operationId }, /必须且只能指定一个平台/],
      [{ platform: 'unknown-platform', publishMode: 'draft', operationId }, /平台不存在/],
      [{ platform: 'zhihu', operationId }, /publishMode.*draft.*direct/],
      [{ platform: 'zhihu', publishMode: 'scheduled', operationId }, /publishMode.*draft.*direct/],
      [{ platform: 'zhihu', publishMode: 'draft' }, /operationId/],
      [{ platform: 'zhihu', publishMode: 'draft', operationId: 'bad operation id' }, /operationId/],
      [[], /JSON 对象/],
    ];

    for (const [body, messagePattern] of invalidCases) {
      const response = await workbenchFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      assert.equal(response.status, 400);
      assert.match((await response.json()).error, messagePattern);
    }

    const malformedResponse = await workbenchFetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"platform":',
    });
    assert.equal(malformedResponse.status, 400);
    assert.match((await malformedResponse.json()).error, /JSON 格式无效/);

    const missingResponse = await workbenchFetch(
      `http://127.0.0.1:${port}/api/content/missing-content/publish-platform`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: 'zhihu', publishMode: 'direct', operationId }),
      }
    );
    assert.equal(missingResponse.status, 404);
    assert.match((await missingResponse.json()).error, /内容不存在/);
    assert.equal(platformPublisherCalls, 0);
  } finally {
    await closeServer(testServer);
    cleanupImportedContent(content);
  }
});

test('POST /api/publish keeps the existing batch publisher contract', async () => {
  let fixture;
  let testServer;
  const platformCalls = [];
  let highLevelPublisherCalls = 0;
  try {
    fixture = createPublishStateFixture({
      key: 'batch-endpoint-contract',
      planDate: '2099-06-05',
      selectedPlatforms: ['weixin'],
      contentStatus: '已排版',
      planStatus: '正文已生成',
    });
    testServer = createDashboardServer({
      publisher: async () => {
        highLevelPublisherCalls++;
        throw new Error('whole publisher replacement must not be used');
      },
      preflight: async () => null,
      platformPublisher: successfulPlatformPublisher(platformCalls),
    });
    const port = await listenOnRandomPort(testServer);
    let response = await workbenchFetch(`http://127.0.0.1:${port}/api/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contentId: fixture.id,
        platforms: ['zhihu', 'juejin'],
        publishMode: 'draft',
        operationId: 'batch-contract-operation-0001',
      }),
    });
    let result = await response.json();

    assert.equal(response.status, 200);
    assert.equal(result.ok, true);
    assert.equal(result.job.content_id, fixture.id);
    assert.equal(result.job.status, 'draft_saved');
    assert.deepEqual(result.job.platforms, ['zhihu', 'juejin']);
    assert.deepEqual(result.job.results.map(item => [item.platform, item.status]), [
      ['zhihu', 'platform_draft'],
      ['juejin', 'platform_draft'],
    ]);
    assert.equal(result.rawOutput, 'stub output zhihu\n\nstub output juejin');
    assert.deepEqual(readPublishState(fixture), {
      selectedPlatforms: ['zhihu', 'juejin'],
      contentStatus: '草稿已保存',
      planStatus: '草稿已保存',
    });

    response = await workbenchFetch(`http://127.0.0.1:${port}/api/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contentId: fixture.id,
        platforms: ['weixin'],
        operationId: 'batch-contract-operation-0002',
      }),
    });
    result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.ok, true);
    assert.equal(highLevelPublisherCalls, 0);
    assert.deepEqual(platformCalls.map(call => [call.platform, call.publishMode]), [
      ['zhihu', 'draft'],
      ['juejin', 'draft'],
      ['weixin', 'direct'],
    ]);
  } finally {
    await closeServer(testServer);
    cleanupPublishStateFixture(fixture);
  }
});

test('root npm test runs focused core, CLI, and dashboard suites without recursion', () => {
  const rootPackagePath = path.resolve(__dirname, '..', '..', 'package.json');
  const rootPackage = JSON.parse(fs.readFileSync(rootPackagePath, 'utf8'));

  assert.equal(rootPackage.scripts.build, 'npm run build:core && npm run build:cli');
  assert.equal(rootPackage.scripts.dashboard, 'npm run build && npm --prefix publisher-dashboard start');
  assert.equal(rootPackage.scripts['core:test'], 'npx -y pnpm@9.15.9 --filter @weibot/core test -- --run');
  assert.equal(rootPackage.scripts['cli:test'], 'npx -y pnpm@9.15.9 --filter @weibot/cli test -- --run');
  assert.equal(rootPackage.scripts['dashboard:test'], 'npm run build && npm --prefix publisher-dashboard test');
  assert.equal(rootPackage.scripts.test, 'npm run core:test && npm run cli:test && npm run dashboard:test');
  assert.doesNotMatch(rootPackage.scripts['core:test'], /npm (?:run )?test(?:\s|$)/);
  assert.doesNotMatch(rootPackage.scripts['cli:test'], /npm (?:run )?test(?:\s|$)/);
  assert.doesNotMatch(rootPackage.scripts['dashboard:test'], /npm (?:run )?test(?:\s|$)/);
  assert.doesNotMatch(rootPackage.scripts['dashboard:test'], /dashboard:test/);
});

test('plans can be created in range and edited', () => {
  db.prepare("DELETE FROM contents WHERE plan_date BETWEEN '2099-01-01' AND '2099-01-03'").run();
  db.prepare("DELETE FROM weekly_plans WHERE date BETWEEN '2099-01-01' AND '2099-01-03'").run();
  try {
    const result = createPlansRange('2099-01-01', '2099-01-03', { status: 'todo' });
    assert.equal(result.plans.length, 3);

    const plan = updatePlan('2099-01-02', {
      topic: 'Editable topic',
      type: 'Case review',
      audience: 'Content ops',
      materials: 'Customer cases',
      status: 'confirmed',
    });
    assert.equal(plan.topic, 'Editable topic');
    assert.equal(plan.status, 'confirmed');
  } finally {
    db.prepare("DELETE FROM weekly_plans WHERE date BETWEEN '2099-01-01' AND '2099-01-03'").run();
  }
});

test('content body can be updated', () => {
  let content;
  try {
    content = generateContent('2099-02-02');
    const updated = updateCurrentContent(content.id, {
      body: '# User Edited Title\n\nUser edited body.',
    });

    assert.equal(updated.title, 'User Edited Title');
    assert.match(updated.body, /User edited body/);
  } finally {
    if (content?.id) db.prepare('DELETE FROM contents WHERE id = ?').run(content.id);
    db.prepare("DELETE FROM weekly_plans WHERE date = '2099-02-02'").run();
  }
});

test('updateContent rejects a stale revision with status 409 and preserves the newer update', () => {
  let content;
  try {
    content = importContent({ filename: 'optimistic-lock.md', body: '# Original title\n\nOriginal body.' });
    const originalToken = '2099-01-01T00:00:00.999Z';
    db.prepare('UPDATE contents SET updated_at = ? WHERE id = ?').run(originalToken, content.id);
    content = { ...content, updated_at: originalToken };

    const newer = updateContent(content.id, canonicalRevisionPayload(content, {
      title: 'Newer title',
      body: '<p>Newer body.</p>',
    }));
    assert.ok(Date.parse(newer.updated_at) > Date.parse(originalToken));

    assert.throws(
      () => updateContent(content.id, canonicalRevisionPayload(content, {
        title: 'Stale title',
        body: '<p>Stale body.</p>',
      })),
      error => {
        assert.equal(error.statusCode, 409);
        assert.match(error.message, /更新|版本|冲突/);
        return true;
      }
    );

    const stored = db.prepare('SELECT title, body, updated_at FROM contents WHERE id = ?').get(content.id);
    assert.equal(stored.title, 'Newer title');
    assert.equal(stored.body, '<p>Newer body.</p>');
    assert.equal(stored.updated_at, newer.updated_at);
  } finally {
    cleanupImportedContent(content);
  }
});

test('fixed-clock save then layout keeps the revision monotonic and rejects the original token', async () => {
  let content;
  await withFixedClock('2026-09-02T08:00:00.000Z', async () => {
    try {
      content = importContent({ filename: 'layout-aba.md', body: '# Layout ABA\n\nOriginal body.' });
      const original = { ...content };
      const saved = updateContent(content.id, canonicalRevisionPayload(original, { summary: 'Saved summary' }));
      const laidOut = layoutContent(content.id);

      assert.throws(
        () => updateContent(content.id, canonicalRevisionPayload(original, { title: 'Stale layout writer' })),
        error => error.statusCode === 409
      );
      assert.ok(Date.parse(laidOut.updated_at) > Date.parse(saved.updated_at));
      assert.equal(db.prepare('SELECT updated_at FROM contents WHERE id = ?').get(content.id).updated_at, laidOut.updated_at);
    } finally {
      cleanupImportedContent(content);
    }
  });
});

test('fixed-clock save then local draft keeps the revision monotonic and rejects the original token', async () => {
  let fixture;
  await withFixedClock('2026-09-02T08:10:00.000Z', async () => {
    try {
      fixture = createPublishStateFixture({
        key: 'draft-aba',
        planDate: '2099-06-01',
        selectedPlatforms: [],
        contentStatus: '已排版',
        planStatus: '已排版',
      });
      const original = { ...fixture };
      const saved = updateContent(fixture.id, canonicalRevisionPayload(original, { summary: 'Saved summary' }));
      saveLocalDraft(fixture.id, ['zhihu']);
      const drafted = db.prepare('SELECT updated_at FROM contents WHERE id = ?').get(fixture.id);

      assert.throws(
        () => updateContent(fixture.id, canonicalRevisionPayload(original, { title: 'Stale draft writer' })),
        error => error.statusCode === 409
      );
      assert.ok(Date.parse(drafted.updated_at) > Date.parse(saved.updated_at));
    } finally {
      cleanupPublishStateFixture(fixture);
    }
  });
});

test('fixed-clock save then publish status keeps the revision monotonic and rejects the original token', async () => {
  let fixture;
  await withFixedClock('2026-09-02T08:20:00.000Z', async () => {
    try {
      fixture = createPublishStateFixture({
        key: 'publish-aba',
        planDate: '2099-06-02',
        selectedPlatforms: ['zhihu'],
        contentStatus: '已排版',
        planStatus: '已排版',
      });
      const original = { ...fixture };
      const saved = updateContent(fixture.id, canonicalRevisionPayload(original, { summary: 'Saved summary' }));
      await publishContent(fixture.id, ['zhihu'], {
        preflight: async () => null,
        platformPublisher: successfulPlatformPublisher(),
      });
      const published = db.prepare('SELECT updated_at FROM contents WHERE id = ?').get(fixture.id);

      assert.throws(
        () => updateContent(fixture.id, canonicalRevisionPayload(original, { title: 'Stale publish writer' })),
        error => error.statusCode === 409
      );
      assert.ok(Date.parse(published.updated_at) > Date.parse(saved.updated_at));
    } finally {
      cleanupPublishStateFixture(fixture);
    }
  });
});

test('updateContent rolls back content, plan, and revision when activity insertion fails', () => {
  let fixture;
  const triggerName = 'fail_content_update_activity';
  db.exec(`DROP TRIGGER IF EXISTS ${triggerName}`);
  try {
    fixture = createPublishStateFixture({
      key: 'atomic-content-update',
      planDate: '2099-06-03',
      selectedPlatforms: [],
      contentStatus: '已排版',
      planStatus: '已排版',
    });
    const originalContent = db.prepare(`
      SELECT title, summary, body, type, status, layout_html, updated_at
      FROM contents WHERE id = ?
    `).get(fixture.id);
    const originalPlan = db.prepare(`
      SELECT topic, type, status, updated_at
      FROM weekly_plans WHERE date = ?
    `).get(fixture.planDate);
    const payload = canonicalRevisionPayload(originalContent, {
      title: 'Atomic updated title',
      type: 'Atomic updated type',
    });
    db.exec(`
      CREATE TRIGGER ${triggerName}
      BEFORE INSERT ON activity
      WHEN NEW.target_type = 'content' AND NEW.action LIKE '更新正文%'
      BEGIN
        SELECT RAISE(ABORT, 'forced content update activity failure');
      END
    `);

    assert.throws(
      () => updateContent(fixture.id, payload),
      /forced content update activity failure/
    );
    assert.deepEqual(db.prepare(`
      SELECT title, summary, body, type, status, layout_html, updated_at
      FROM contents WHERE id = ?
    `).get(fixture.id), originalContent);
    assert.deepEqual(db.prepare(`
      SELECT topic, type, status, updated_at
      FROM weekly_plans WHERE date = ?
    `).get(fixture.planDate), originalPlan);

    db.exec(`DROP TRIGGER ${triggerName}`);
    const retried = updateContent(fixture.id, payload);
    assert.equal(retried.title, 'Atomic updated title');
    assert.notEqual(retried.updated_at, originalContent.updated_at);
    const updatedPlan = db.prepare('SELECT topic, type, status FROM weekly_plans WHERE date = ?').get(fixture.planDate);
    assert.equal(updatedPlan.topic, 'Atomic updated title');
    assert.equal(updatedPlan.type, 'Atomic updated type');
    assert.equal(updatedPlan.status, '正文已生成');
  } finally {
    db.exec(`DROP TRIGGER IF EXISTS ${triggerName}`);
    cleanupPublishStateFixture(fixture);
  }
});

test('canonical field changes invalidate plan-linked layout and reset generated status', () => {
  let content;
  try {
    content = generateContent('2099-02-03');
    const baseline = {
      title: 'Baseline title',
      summary: 'Baseline summary',
      body: '<p>Baseline body.</p>',
      type: 'Baseline type',
    };
    const changes = [
      ['title', 'Changed title'],
      ['summary', 'Changed summary'],
      ['body', '<p>Changed body.</p>'],
      ['type', 'Changed type'],
    ];

    for (const [index, [field, value]] of changes.entries()) {
      const token = new Date(Date.UTC(2099, 1, 3, 0, 0, 0, index)).toISOString();
      db.prepare(`
        UPDATE contents
        SET title = ?, summary = ?, body = ?, type = ?, status = '已排版', layout_html = ?, updated_at = ?
        WHERE id = ?
      `).run(
        baseline.title,
        baseline.summary,
        baseline.body,
        baseline.type,
        '<article>derived layout</article>',
        token,
        content.id
      );

      const updated = updateContent(content.id, {
        ...baseline,
        [field]: value,
        expectedUpdatedAt: token,
      });
      assert.equal(updated[field], value, `${field} should be updated`);
      assert.equal(updated.layout_html, '', `${field} should invalidate layout`);
      assert.equal(updated.status, '正文已生成', `${field} should reset plan-linked status`);
    }
  } finally {
    if (content?.id) cleanupImportedContent(content);
    db.prepare("DELETE FROM weekly_plans WHERE date = '2099-02-03'").run();
  }
});

test('imported canonical changes reset imported status while an exact no-op preserves layout', () => {
  let content;
  try {
    content = importContent({ filename: 'layout-invalidation.md', body: '# Imported title\n\nImported body.' });
    let token = '2099-03-01T00:00:00.000Z';
    db.prepare("UPDATE contents SET status = '已排版', layout_html = ?, updated_at = ? WHERE id = ?")
      .run('<article>imported layout</article>', token, content.id);
    content = {
      ...content,
      status: '已排版',
      layout_html: '<article>imported layout</article>',
      updated_at: token,
    };

    const changed = updateContent(content.id, canonicalRevisionPayload(content, { summary: 'Changed summary' }));
    assert.equal(changed.status, '已导入');
    assert.equal(changed.layout_html, '');

    token = '2099-03-01T00:00:01.000Z';
    db.prepare("UPDATE contents SET status = '已排版', layout_html = ?, updated_at = ? WHERE id = ?")
      .run('<article>preserved layout</article>', token, content.id);
    const noOpBase = { ...changed, status: '已排版', layout_html: '<article>preserved layout</article>', updated_at: token };
    const noOp = updateContent(content.id, canonicalRevisionPayload(noOpBase));

    assert.equal(noOp.status, '已排版');
    assert.equal(noOp.layout_html, '<article>preserved layout</article>');
  } finally {
    cleanupImportedContent(content);
  }
});

test('updateContent validates payload string fields and requires an optimistic-lock token', () => {
  let content;
  try {
    content = importContent({ filename: 'field-types.md', body: '# Field types\n\nBody.' });
    const valid = canonicalRevisionPayload(content);
    const invalidPayloads = [
      null,
      [],
      { ...valid, title: 123 },
      { ...valid, summary: {} },
      { ...valid, body: Buffer.from('body') },
      { ...valid, type: false },
      { title: valid.title, summary: valid.summary, body: valid.body, type: valid.type },
      { ...valid, expectedUpdatedAt: 123 },
    ];

    for (const payload of invalidPayloads) {
      assert.throws(
        () => updateContent(content.id, payload),
        error => {
          assert.equal(error.statusCode, 400);
          assert.match(error.message, /JSON 对象|字符串|expectedUpdatedAt/);
          return true;
        }
      );
    }
  } finally {
    cleanupImportedContent(content);
  }
});

test('updateContent enforces Unicode field limits and a 5 MiB UTF-8 body limit', () => {
  let content;
  try {
    content = importContent({ filename: 'field-limits.md', body: '# Field limits\n\nBody.' });
    const invalidFields = [
      ['title', '😀'.repeat(201), /标题.*200/, 400],
      ['summary', '摘'.repeat(1001), /摘要.*1000/, 400],
      ['type', '类'.repeat(101), /类型.*100/, 400],
      ['body', 'a'.repeat(5 * 1024 * 1024 + 1), /正文.*5 MiB/, 413],
    ];
    for (const [field, value, message, statusCode] of invalidFields) {
      assert.throws(
        () => updateContent(content.id, canonicalRevisionPayload(content, { [field]: value })),
        error => {
          assert.equal(error.statusCode, statusCode);
          assert.match(error.message, message);
          return true;
        }
      );
    }

    content = updateContent(content.id, canonicalRevisionPayload(content, { title: '😀'.repeat(200) }));
    content = updateContent(content.id, canonicalRevisionPayload(content, { summary: '摘'.repeat(1000) }));
    content = updateContent(content.id, canonicalRevisionPayload(content, { type: '类'.repeat(100) }));
    const exactLimitBody = `<p>${'a'.repeat(5 * 1024 * 1024 - 7)}</p>`;
    content = updateContent(content.id, canonicalRevisionPayload(content, { body: exactLimitBody }));
    assert.equal(Buffer.byteLength(content.body, 'utf8'), 5 * 1024 * 1024);
  } finally {
    cleanupImportedContent(content);
  }
});

test('updateContent rejects an oversized title derived from the final body', () => {
  let content;
  try {
    const oversizedHeading = '😀'.repeat(201);
    for (const titleMode of ['empty', 'omitted']) {
      content = importContent({ filename: `derived-title-${titleMode}.md`, body: '# Original title\n\nOriginal body.' });
      const payload = canonicalRevisionPayload(content, {
        body: `# ${oversizedHeading}\n\nUpdated body.`,
      });
      if (titleMode === 'empty') payload.title = '';
      else delete payload.title;

      assert.throws(
        () => updateContent(content.id, payload),
        error => {
          assert.equal(error.statusCode, 400);
          assert.match(error.message, /标题.*200/);
          return true;
        }
      );
      const stored = db.prepare('SELECT title, updated_at FROM contents WHERE id = ?').get(content.id);
      assert.equal(stored.title, content.title);
      assert.equal(stored.updated_at, content.updated_at);
      cleanupImportedContent(content);
      content = null;
    }
  } finally {
    cleanupImportedContent(content);
  }
});

test('updateContent validates every final resolved field after fallback and normalization', () => {
  let content;
  const cases = [
    {
      field: 'summary',
      storedValue: '摘'.repeat(1001),
      message: /摘要.*1000/,
    },
    {
      field: 'type',
      storedValue: '类'.repeat(101),
      message: /类型.*100/,
    },
    {
      field: 'body',
      submittedValue: 'a'.repeat(5 * 1024 * 1024 - 1),
      message: /正文.*5 MiB/,
      statusCode: 413,
    },
  ];

  try {
    for (const [index, testCase] of cases.entries()) {
      content = importContent({ filename: `resolved-${testCase.field}.md`, body: '# Final fields\n\nOriginal body.' });
      let token = content.updated_at;
      if (testCase.storedValue !== undefined) {
        token = new Date(Date.UTC(2099, 4, 1, 0, 0, 0, index)).toISOString();
        db.prepare(`UPDATE contents SET ${testCase.field} = ?, updated_at = ? WHERE id = ?`)
          .run(testCase.storedValue, token, content.id);
        content = { ...content, [testCase.field]: testCase.storedValue, updated_at: token };
      }
      const payload = canonicalRevisionPayload(content);
      if (testCase.submittedValue !== undefined) payload[testCase.field] = testCase.submittedValue;
      else delete payload[testCase.field];

      assert.throws(
        () => updateContent(content.id, payload),
        error => {
          assert.equal(error.statusCode, testCase.statusCode || 400);
          assert.match(error.message, testCase.message);
          return true;
        }
      );
      assert.equal(db.prepare('SELECT updated_at FROM contents WHERE id = ?').get(content.id).updated_at, token);
      cleanupImportedContent(content);
      content = null;
    }
  } finally {
    cleanupImportedContent(content);
  }
});

test('updateContent sanitizes canonical HTML and preserves code round trip', () => {
  let content;
  try {
    content = importContent({ filename: 'canonical-update.md', body: '# 安全母稿\n\n初始正文' });
    const unsafeBody = [
      '<h2 id="unsafe-title" style="color:red" onclick="alert(1)">安全标题</h2>',
      '<p data-action="publish" controls>安全正文 <a href="javascript:alert(1)" onmouseover="alert(1)">危险链接</a></p>',
      '<img src="javascript:alert(1)" onerror="alert(1)" alt="危险图片">',
      '<script>alert("stored-xss")</script>',
      '<pre><code class="language-html">&lt;button data-action="code"&gt;代码示例&lt;/button&gt;</code></pre>',
    ].join('');
    const updated = updateCurrentContent(content.id, { body: unsafeBody });
    const stored = db.prepare('SELECT body FROM contents WHERE id = ?').get(content.id).body;

    for (const body of [updated.body, stored]) {
      assert.match(body, /<h2>安全标题<\/h2>/);
      assert.match(body, /<p>安全正文 <a>危险链接<\/a><\/p>/);
      assert.doesNotMatch(body, /<script|<[^>]+\s(?:on\w+|style|data-action|id)\s*=|<[^>]+\scontrols(?:\s|>|=)|(?:href|src)="javascript:/i);
    }
    const markdown = contentToMarkdown(updated);
    assert.match(markdown, /```html/);
    assert.match(markdown, /<button data-action="code">代码示例<\/button>/);

    const markdownCode = '```html\n<script data-action="code">alert("literal")</script>\n```';
    const markdownUpdated = updateCurrentContent(content.id, { body: markdownCode });
    assert.doesNotMatch(markdownUpdated.body, /<script\b/i);
    assert.match(markdownUpdated.body, /&lt;script data-action=&quot;code&quot;&gt;/);
    assert.match(contentToMarkdown(markdownUpdated), /<script data-action="code">alert\("literal"\)<\/script>/);
  } finally {
    cleanupImportedContent(content);
  }
});

test('content update endpoint and bootstrap normalize unsafe canonical bodies', async () => {
  let content;
  let testServer;
  try {
    content = importContent({ filename: 'canonical-endpoint.md', body: '# Endpoint 母稿\n\n正文' });
    testServer = createDashboardServer();
    const port = await listenOnRandomPort(testServer);
    const unsafeBody = '<p id="legacy" style="color:red" onclick="alert(1)" data-action="publish">可见正文</p><script>alert(1)</script>';
    const updateResponse = await workbenchFetch(`http://127.0.0.1:${port}/api/content/${content.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: unsafeBody, expectedUpdatedAt: content.updated_at }),
    });
    const updateResult = await updateResponse.json();
    assert.equal(updateResponse.status, 200);
    assert.equal(updateResult.ok, true);
    assert.equal(updateResult.content.body, '<p>可见正文</p>');

    db.prepare('UPDATE contents SET body = ? WHERE id = ?').run(unsafeBody, content.id);
    const bootstrapResponse = await workbenchFetch(`http://127.0.0.1:${port}/api/bootstrap`);
    const bootstrapResult = await bootstrapResponse.json();
    const legacyContent = bootstrapResult.data.contents.find(item => item.id === content.id);
    assert.equal(bootstrapResponse.status, 200);
    assert.equal(legacyContent.body, '<p>可见正文</p>');
    assert.equal(db.prepare('SELECT body FROM contents WHERE id = ?').get(content.id).body, unsafeBody);
  } finally {
    await closeServer(testServer);
    cleanupImportedContent(content);
  }
});

test('content update endpoint returns 409 for a stale revision without overwriting newer content', async () => {
  let content;
  let testServer;
  try {
    content = importContent({ filename: 'endpoint-lock.md', body: '# Endpoint original\n\nOriginal body.' });
    testServer = createDashboardServer();
    const port = await listenOnRandomPort(testServer);
    const endpoint = `http://127.0.0.1:${port}/api/content/${content.id}`;
    const originalPayload = canonicalRevisionPayload(content);

    const firstResponse = await workbenchFetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...originalPayload, title: 'Endpoint newer title' }),
    });
    const firstResult = await firstResponse.json();
    assert.equal(firstResponse.status, 200);

    const staleResponse = await workbenchFetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...originalPayload, title: 'Endpoint stale title' }),
    });
    const staleResult = await staleResponse.json();
    assert.equal(staleResponse.status, 409);
    assert.equal(staleResult.ok, false);
    assert.match(staleResult.error, /更新|版本|冲突/);

    const stored = db.prepare('SELECT title, updated_at FROM contents WHERE id = ?').get(content.id);
    assert.equal(stored.title, 'Endpoint newer title');
    assert.equal(stored.updated_at, firstResult.content.updated_at);
  } finally {
    await closeServer(testServer);
    cleanupImportedContent(content);
  }
});

test('content update endpoint returns 413 for a body over 5 MiB', async () => {
  let content;
  let testServer;
  try {
    content = importContent({ filename: 'endpoint-body-limit.md', body: '# Body limit\n\nOriginal body.' });
    testServer = createDashboardServer();
    const port = await listenOnRandomPort(testServer);
    const response = await workbenchFetch(`http://127.0.0.1:${port}/api/content/${content.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(canonicalRevisionPayload(content, {
        body: 'a'.repeat(5 * 1024 * 1024 + 1),
      })),
    });
    const result = await response.json();

    assert.equal(response.status, 413);
    assert.equal(result.ok, false);
    assert.match(result.error, /正文.*5 MiB/);
    const stored = db.prepare('SELECT body, updated_at FROM contents WHERE id = ?').get(content.id);
    assert.equal(stored.body, content.body);
    assert.equal(stored.updated_at, content.updated_at);
  } finally {
    await closeServer(testServer);
    cleanupImportedContent(content);
  }
});

test('content update endpoint returns 400 for malformed JSON', async () => {
  let content;
  let testServer;
  try {
    content = importContent({ filename: 'endpoint-malformed-json.md', body: '# JSON syntax\n\nOriginal body.' });
    testServer = createDashboardServer();
    const port = await listenOnRandomPort(testServer);
    const response = await workbenchFetch(`http://127.0.0.1:${port}/api/content/${content.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"title":',
    });
    const result = await response.json();

    assert.equal(response.status, 400);
    assert.equal(result.ok, false);
    assert.match(result.error, /JSON 格式无效/);
    assert.equal(db.prepare('SELECT updated_at FROM contents WHERE id = ?').get(content.id).updated_at, content.updated_at);
  } finally {
    await closeServer(testServer);
    cleanupImportedContent(content);
  }
});

test('default JSON request bodies are limited to 8 MiB', async () => {
  let testServer;
  try {
    testServer = createDashboardServer();
    const port = await listenOnRandomPort(testServer);
    const response = await workbenchFetch(`http://127.0.0.1:${port}/api/topics/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: '2099-01-01', padding: 'a'.repeat(8 * 1024 * 1024) }),
    });

    assert.equal(response.status, 413);
    assert.match((await response.json()).error, /请求内容过大/);
  } finally {
    await closeServer(testServer);
  }
});

test('imports Markdown title and body with imported status', () => {
  let content;
  try {
    const body = '# 导入标题\n\n正文内容';
    content = importContent({ filename: 'article.md', body });

    assert.equal(content.title, '导入标题');
    assert.match(content.body, /<h1>导入标题<\/h1>/);
    assert.match(content.body, /<p>正文内容<\/p>/);
    assert.equal(content.status, '已导入');
  } finally {
    cleanupImportedContent(content);
  }
});

test('renders a Markdown autolink as a safe anchor', () => {
  let content;
  try {
    const body = '\n# 链接文章\n\n访问 <https://safe.example/path>\n';
    content = importContent({ filename: 'autolink.md', body });

    assert.match(content.body, /<a href="https:\/\/safe\.example\/path">https:\/\/safe\.example\/path<\/a>/);
  } finally {
    cleanupImportedContent(content);
  }
});

test('renders fenced Markdown markup as escaped code nodes', () => {
  let content;
  try {
    const body = [
      '',
      '# 代码示例',
      '',
      '```html',
      '<article data-action="publish"><script>alert("示例")</script></article>',
      '```',
      '',
    ].join('\n');
    content = importContent({ filename: 'code-example.markdown', body });

    assert.match(content.body, /<h1>代码示例<\/h1>/);
    assert.match(content.body, /<pre><code class="language-html">&lt;article data-action=&quot;publish&quot;&gt;&lt;script&gt;alert\(&quot;示例&quot;\)&lt;\/script&gt;&lt;\/article&gt;\n?<\/code><\/pre>/);
    assert.doesNotMatch(content.body, /<script\b|<[^>]+\sdata-action\s*=/i);
  } finally {
    cleanupImportedContent(content);
  }
});

test('sanitizes mixed HTML while rendering protected Markdown literals safely', () => {
  let content;
  try {
    const autolink = '<https://safe.example/path>';
    const fencedBlock = [
      '```html',
      '<script>alert("示例")</script>',
      '```',
    ].join('\n');
    const forgedToken = '__WEIBOT_IMPORT_PROTECTED_deadbeef_0__';
    const body = [
      '# 混合文章',
      '',
      '<article onclick="alert(1)">',
      '<script>alert("危险")</script>',
      '<p><a href="javascript:alert(1)">保留正文</a></p>',
      `<p>${forgedToken}</p>`,
      '</article>',
      '',
      `访问 ${autolink}`,
      '',
      fencedBlock,
    ].join('\n');
    content = importContent({ filename: 'mixed.md', body });

    assert.doesNotMatch(content.body, /onclick\s*=|href="javascript:|alert\("危险"\)/i);
    assert.match(content.body, /<article>\s*<p><a>保留正文<\/a><\/p>/);
    assert.match(content.body, /<a href="https:\/\/safe\.example\/path">https:\/\/safe\.example\/path<\/a>/);
    assert.match(content.body, /<pre><code class="language-html">&lt;script&gt;alert\(&quot;示例&quot;\)&lt;\/script&gt;\n?<\/code><\/pre>/);
    assert.ok(content.body.includes(forgedToken));
  } finally {
    cleanupImportedContent(content);
  }
});

test('preserves safe URI-scheme Markdown autolinks in mixed content', () => {
  let content;
  try {
    const autolinks = [
      '<ftp://files.example.com/pub/article.txt>',
      '<http://safe.example/path?q=1>',
      '<https://safe.example/path#section>',
      '<mailto:editor.name+tag@example.co.uk>',
    ];
    content = importContent({
      filename: 'mixed-generic.md',
      body: `<article onclick="alert(1)"><p>安全链接</p></article>\n\n${autolinks.join('\n')}`,
    });

    assert.doesNotMatch(content.body, /onclick\s*=/i);
    const ftpUrl = autolinks[0].slice(1, -1);
    assert.ok(content.body.includes(`<a>${ftpUrl}</a>`));
    assert.ok(!content.body.includes(`href="${ftpUrl}"`));
    for (const autolink of autolinks.slice(1)) {
      const url = autolink.slice(1, -1);
      assert.ok(content.body.includes(`href="${url}"`));
      assert.ok(content.body.includes(`>${url}</a>`));
    }
  } finally {
    cleanupImportedContent(content);
  }
});

test('preserves an email Markdown autolink in mixed content', () => {
  let content;
  try {
    const autolink = '<editor.name+tag@example.co.uk>';
    content = importContent({
      filename: 'mixed-email.md',
      body: `<section onload="alert(1)"><p>联系方式</p></section>\n\n${autolink}`,
    });

    assert.doesNotMatch(content.body, /onload\s*=/i);
    assert.ok(content.body.includes('href="mailto:editor.name+tag@example.co.uk"'));
    assert.ok(content.body.includes('>editor.name+tag@example.co.uk</a>'));
  } finally {
    cleanupImportedContent(content);
  }
});

test('removes dangerous-scheme Markdown autolinks from mixed content', () => {
  let content;
  try {
    const dangerousAutolinks = [
      '<javascript:alert(2)>',
      '<data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==>',
      '<vbscript:msgbox(1)>',
    ];
    content = importContent({
      filename: 'mixed-dangerous.md',
      body: `<article><p>保留正文</p></article>\n\n${dangerousAutolinks.join('\n')}`,
    });

    for (const autolink of dangerousAutolinks) assert.ok(!content.body.includes(autolink));
    assert.doesNotMatch(content.body, /javascript\s*:|data\s*:\s*text\/html|vbscript\s*:/i);
    assert.match(content.body, /<article><p>保留正文<\/p><\/article>/);
  } finally {
    cleanupImportedContent(content);
  }
});

test('explicit imported title wins over the Markdown heading', () => {
  let content;
  try {
    content = importContent({
      filename: 'article.md',
      title: '显式标题',
      body: '# Markdown 标题\n\n正文内容',
    });

    assert.equal(content.title, '显式标题');
  } finally {
    cleanupImportedContent(content);
  }
});

test('uses the HTML title when no imported title is provided', () => {
  let content;
  try {
    content = importContent({
      filename: 'article.html',
      body: '<html><head><title>HTML 标题</title></head><body><p>正文内容</p></body></html>',
    });

    assert.equal(content.title, 'HTML 标题');
  } finally {
    cleanupImportedContent(content);
  }
});

test('sanitizes scripts inside backtick fences for explicit HTML files', () => {
  let content;
  try {
    content = importContent({
      filename: 'backtick-script.html',
      body: [
        '<article>',
        '```html',
        '<script>alert("危险 HTML")</script>',
        '```',
        '<p>保留正文</p>',
        '</article>',
      ].join('\n'),
    });

    assert.doesNotMatch(content.body, /<script\b|alert\("危险 HTML"\)/i);
    assert.match(content.body, /<p>保留正文<\/p>/);
  } finally {
    cleanupImportedContent(content);
  }
});

test('falls back to the first HTML h1 when the title element is absent', () => {
  let content;
  try {
    content = importContent({
      filename: 'article.htm',
      body: '<article><h1 class="headline">HTML 一级标题</h1><p>正文内容</p></article>',
    });

    assert.equal(content.title, 'HTML 一级标题');
  } finally {
    cleanupImportedContent(content);
  }
});

test('uses the first non-empty plain-text line as the imported title', () => {
  let content;
  try {
    content = importContent({
      filename: 'article.txt',
      body: '\n  \n纯文本第一行\n第二行正文',
    });

    assert.equal(content.title, '纯文本第一行');
  } finally {
    cleanupImportedContent(content);
  }
});

test('keeps .txt imports as verbatim text with a plain-text title', () => {
  let content;
  try {
    const body = '# 纯文本标题\n<article data-action="publish">按文本保留</article>';
    content = importContent({ filename: 'literal.txt', body });

    assert.equal(content.title, '# 纯文本标题');
    assert.match(content.body, /<p># 纯文本标题<br>&lt;article data-action=&quot;publish&quot;&gt;按文本保留&lt;\/article&gt;<\/p>/);
    assert.doesNotMatch(content.body, /<article\b|<[^>]+\sdata-action\s*=/i);
  } finally {
    cleanupImportedContent(content);
  }
});

test('.txt extension overrides a conflicting requested format', () => {
  let content;
  try {
    content = importContent({
      filename: 'authoritative.txt',
      format: 'html',
      body: '<strong data-action="publish">literal text</strong>',
    });

    assert.match(content.body, /&lt;strong data-action=&quot;publish&quot;&gt;literal text&lt;\/strong&gt;/);
    assert.doesNotMatch(content.body, /<strong\b|<[^>]+\sdata-action\s*=/i);
  } finally {
    cleanupImportedContent(content);
  }
});

test('renders inline and indented Markdown code safely during unnamed mixed inference', () => {
  let content;
  try {
    const inlineCode = '`<button data-action="inline">行内按钮</button>`';
    const indentedCode = '    <script>alert("缩进代码")</script>';
    const autolink = '<https://safe.example/path>';
    const body = [
      '普通标题',
      '',
      inlineCode,
      indentedCode,
      autolink,
      '<article data-action="publish"><button>外部按钮</button><p>外部正文</p></article>',
    ].join('\n');
    content = importContent({ body });

    assert.equal(content.title, '普通标题');
    assert.match(content.body, /<code>&lt;button data-action=&quot;inline&quot;&gt;行内按钮&lt;\/button&gt;<\/code>/);
    assert.match(content.body, /<pre><code>&lt;script&gt;alert\(&quot;缩进代码&quot;\)&lt;\/script&gt;\n?<\/code><\/pre>/);
    assert.match(content.body, /<a href="https:\/\/safe\.example\/path">https:\/\/safe\.example\/path<\/a>/);
    assert.match(content.body, /<article>外部按钮<p>外部正文<\/p><\/article>/);
  } finally {
    cleanupImportedContent(content);
  }
});

test('uses the HTML title before Markdown-looking lines in HTML content', () => {
  let content;
  try {
    content = importContent({
      filename: 'html-title.html',
      body: [
        '<!doctype html><html><head><title>真实 HTML 标题</title></head><body>',
        '# 伪 Markdown 标题',
        '<h1>HTML 一级标题</h1><p>正文</p>',
        '</body></html>',
      ].join('\n'),
    });

    assert.equal(content.title, '真实 HTML 标题');
    assert.doesNotMatch(content.body, /<title\b/i);
    assert.match(content.body, /<h1>HTML 一级标题<\/h1>/);
  } finally {
    cleanupImportedContent(content);
  }
});

test('payload format html forces HTML title precedence and sanitization', () => {
  let content;
  try {
    content = importContent({
      format: 'html',
      body: '# 伪 Markdown 标题\n<title>格式指定标题</title><article data-action="publish"><p>正文</p></article>',
    });

    assert.equal(content.title, '格式指定标题');
    assert.doesNotMatch(content.body, /<title\b|data-action/i);
    assert.match(content.body, /<article><p>正文<\/p><\/article>/);
  } finally {
    cleanupImportedContent(content);
  }
});

test('ignores Markdown headings inside fenced, indented, and inline code', () => {
  let content;
  try {
    content = importContent({
      filename: 'metadata.md',
      body: [
        '<!--',
        '# 评论伪标题',
        '-->',
        '<script>\n# 脚本伪标题\n</script>',
        '<iframe>\n# iframe 伪标题\n</iframe>',
        '<object>\n# object 伪标题\n</object>',
        '<embed>\n# embed 伪标题\n</embed>',
        '<style>\n# style 伪标题\n</style>',
        '<svg>\n# svg 伪标题\n</svg>',
        '<meta>\n# meta 伪标题\n</meta>',
        '<link>\n# link 伪标题\n</link>',
        '```markdown',
        '# 围栏伪标题',
        '```',
        '    # 缩进伪标题',
        '`# 行内伪标题`',
        '# 真实 Markdown 标题',
        '正文',
      ].join('\n'),
    });

    assert.equal(content.title, '真实 Markdown 标题');
    assert.match(content.body, /<h1>真实 Markdown 标题<\/h1>/);
  } finally {
    cleanupImportedContent(content);
  }
});

test('ignores Markdown headings inside raw HTML pre and code blocks', () => {
  let content;
  try {
    content = importContent({
      filename: 'raw-code-metadata.md',
      body: '<pre><code>\n# Raw code fake\n</code></pre>\n# Real title\n正文',
    });

    assert.equal(content.title, 'Real title');
    assert.match(content.body, /<h1>Real title<\/h1>/);
  } finally {
    cleanupImportedContent(content);
  }
});

test('preserves inline and fenced code through import and contentToMarkdown', () => {
  let content;
  try {
    content = importContent({
      filename: 'roundtrip-code.md',
      body: [
        '# 代码往返',
        '',
        'Inline ``value with `tick` inside`` end.',
        '',
        '```js',
        'const html = "<article data-action=\\"publish\\">";',
        'console.log(`tick`);',
        '```',
      ].join('\n'),
    });
    const markdown = contentToMarkdown(content);

    assert.match(content.body, /<code>value with `tick` inside<\/code>/);
    assert.match(content.body, /<pre><code class="language-js">/);
    assert.match(markdown, /Inline ``value with `tick` inside`` end\./);
    assert.match(markdown, /```js\nconst html = "<article data-action=\\"publish\\">";\nconsole\.log\(`tick`\);\n```/);
  } finally {
    cleanupImportedContent(content);
  }
});

test('mature GFM conversion preserves structure exactly through import edit and publish serialization', () => {
  let content;
  try {
    const source = [
      '# Format parity',
      '',
      'Paragraph with [docs](https://example.com/a?x=1&y=2#frag), **bold**, *emphasis*, and `inline <tag>`.',
      '',
      '- outer',
      '  - inner [nested](https://nested.example/path?q=one&lang=zh)',
      '  - inner `code`',
      '',
      '| Name | Value |',
      '| :--- | ---: |',
      '| **A** | `1 < 2` |',
      '',
      '```js',
      'const url = "https://example.com?q=1&x=2";',
      'console.log(`tick`);',
      '```',
    ].join('\n');
    const expectedHtml = [
      '<h1>Format parity</h1>',
      '<p>Paragraph with <a href="https://example.com/a?x=1&y=2#frag">docs</a>, <strong>bold</strong>, <em>emphasis</em>, and <code>inline &lt;tag&gt;</code>.</p>',
      '<ul>',
      '<li>outer<ul>',
      '<li>inner <a href="https://nested.example/path?q=one&lang=zh">nested</a></li>',
      '<li>inner <code>code</code></li>',
      '</ul>',
      '</li>',
      '</ul>',
      '<table>',
      '<thead>',
      '<tr>',
      '<th align="left">Name</th>',
      '<th align="right">Value</th>',
      '</tr>',
      '</thead>',
      '<tbody><tr>',
      '<td align="left"><strong>A</strong></td>',
      '<td align="right"><code>1 &lt; 2</code></td>',
      '</tr>',
      '</tbody></table>',
      '<pre><code class="language-js">const url = &quot;https://example.com?q=1&amp;x=2&quot;;',
      'console.log(`tick`);',
      '</code></pre>',
    ].join('\n');
    const expectedMarkdown = [
      '---',
      'title: Format parity',
      '---',
      '',
      '# Format parity',
      '',
      'Paragraph with [docs](https://example.com/a?x=1&y=2#frag), **bold**, *emphasis*, and `inline <tag>`.',
      '',
      '-   outer',
      '    -   inner [nested](https://nested.example/path?q=one&lang=zh)',
      '    -   inner `code`',
      '',
      '| Name | Value |',
      '| :-- | --: |',
      '| **A** | `1 < 2` |',
      '',
      '```js',
      'const url = "https://example.com?q=1&x=2";',
      'console.log(`tick`);',
      '```',
      '',
    ].join('\n');

    content = importContent({ filename: 'format-parity.md', body: source });
    assert.equal(content.body, expectedHtml);
    const edited = updateCurrentContent(content.id, {
      title: content.title,
      summary: content.summary,
      body: content.body,
    });
    assert.equal(edited.body, expectedHtml);
    assert.equal(contentToMarkdown(edited), expectedMarkdown);
  } finally {
    cleanupImportedContent(content);
  }
});

test('converts a code-only imported body back to fenced Markdown', () => {
  let content;
  try {
    content = importContent({
      filename: 'code-only.md',
      body: '```python\nprint("<safe>")\n```',
    });
    const markdown = contentToMarkdown(content);

    assert.match(markdown, /```python\nprint\("<safe>"\)\n```/);
    assert.doesNotMatch(markdown, /<pre>|<code/);
  } finally {
    cleanupImportedContent(content);
  }
});

test('ignores HTML titles and headings inside comments and blocked elements', () => {
  let content;
  try {
    content = importContent({
      filename: 'metadata.html',
      body: [
        '<!-- <title>评论伪标题</title><h1>评论伪标题</h1> -->',
        '<script><title>脚本伪标题</title><h1>脚本伪标题</h1></script>',
        '<template><title>模板伪标题</title></template>',
        '<article><h1>真实 HTML 标题</h1><p>正文</p></article>',
      ].join(''),
    });

    assert.equal(content.title, '真实 HTML 标题');
    assert.doesNotMatch(content.body, /评论伪标题|脚本伪标题|模板伪标题/);
  } finally {
    cleanupImportedContent(content);
  }
});

test('falls back to the filename without its supported extension', () => {
  let content;
  try {
    content = importContent({
      filename: '文件名标题.markdown',
      body: '<img src="https://example.com/article.png" alt="">',
    });

    assert.equal(content.title, '文件名标题');
  } finally {
    cleanupImportedContent(content);
  }
});

test('uses the final unnamed title fallback when no title source is available', () => {
  let content;
  try {
    content = importContent({ body: '![](https://safe.example/image.png)' });

    assert.equal(content.title, '未命名文章');
  } finally {
    cleanupImportedContent(content);
  }
});

test('rejects a non-empty filename with an unsupported extension', () => {
  let insertedContent;
  try {
    assert.throws(() => {
      insertedContent = importContent({ filename: 'article.docx', body: '有效正文' });
    }, /文件格式不支持，仅支持 \.md、\.markdown、\.html、\.htm、\.txt/);
  } finally {
    cleanupImportedContent(insertedContent);
  }
});

test('rejects empty or whitespace-only imported content', () => {
  let insertedContent;
  try {
    assert.throws(() => {
      insertedContent = importContent({ filename: 'empty.txt', body: ' \n\t ' });
    }, /导入正文不能为空/);
  } finally {
    cleanupImportedContent(insertedContent);
  }
});

test('rejects non-object import payloads and non-string schema fields', () => {
  for (const payload of [null, [], '正文', 42, true]) {
    assert.throws(() => importContent(payload), error => {
      assert.equal(error.statusCode, 400);
      assert.match(error.message, /JSON 对象/);
      return true;
    });
  }

  for (const field of ['title', 'body', 'summary', 'type', 'filename', 'format']) {
    const payload = { body: '有效正文', [field]: 42 };
    assert.throws(() => importContent(payload), error => {
      assert.equal(error.statusCode, 400);
      assert.match(error.message, new RegExp(`${field}.*字符串`));
      return true;
    });
  }
});

test('rejects imported content over 5 MiB by UTF-8 byte size', () => {
  let insertedContent;
  const oversizedBody = `标题\n${'你'.repeat(Math.floor((5 * 1024 * 1024) / 3) + 1)}`;
  try {
    assert.throws(() => {
      insertedContent = importContent({ filename: 'oversized.txt', body: oversizedBody });
    }, /导入正文不能超过 5 MiB/);
  } finally {
    cleanupImportedContent(insertedContent);
  }
});

test('removes dangerous imported HTML while preserving safe article markup', () => {
  let content;
  try {
    content = importContent({
      filename: 'safe-article.html',
      body: [
        '<!doctype html><html><head><title>安全文章</title>',
        '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">',
        '<link rel="stylesheet" href="javascript:alert(1)"></head>',
        '<body onload="alert(1)"><script>alert(1)</script>',
        '<iframe src="https://evil.example">危险框架</iframe>',
        '<object data="https://evil.example"><p>危险对象</p></object>',
        '<embed src="data:text/html,&lt;script&gt;alert(1)&lt;/script&gt;">',
        '<h1 onclick="alert(1)">安全标题</h1>',
        '<p onmouseover="alert(1)">安全正文 ',
        '<a href=" javascript:alert(1)">危险链接</a> ',
        '<a href="data:text/html;base64,PHNjcmlwdD4=">危险数据</a> ',
        '<a href="https://safe.example/article">安全链接</a></p>',
        '<img src="https://safe.example/image.png" alt="安全图片" onerror="alert(1)">',
        '<table><tr><td>安全表格</td></tr></table>',
        '<pre><code>const ok = true;</code></pre></body></html>',
      ].join('\n'),
    });

    assert.doesNotMatch(content.body, /<(?:script|iframe|object|embed|meta|link)\b/i);
    assert.doesNotMatch(content.body, /\son[a-z0-9_-]+\s*=/i);
    assert.doesNotMatch(content.body, /javascript\s*:|data\s*:\s*text\/html/i);
    assert.match(content.body, /<h1[^>]*>安全标题<\/h1>/);
    assert.match(content.body, /<p[^>]*>安全正文/);
    assert.match(content.body, /href="https:\/\/safe\.example\/article"/);
    assert.match(content.body, /<img[^>]*src="https:\/\/safe\.example\/image\.png"[^>]*alt="安全图片"[^>]*>/);
    assert.match(content.body, /<table><tr><td>安全表格<\/td><\/tr><\/table>/);
    assert.match(content.body, /<pre><code>const ok = true;<\/code><\/pre>/);
  } finally {
    cleanupImportedContent(content);
  }
});

test('removes paired and self-closing style elements while preserving article structure', () => {
  let content;
  try {
    content = importContent({
      filename: 'style-attack.html',
      body: [
        '<article>',
        '<style>',
        String.raw`.encoded { background-image: url(\6a avascript:alert(1)); }`,
        '.spaced { background-image: url(',
        '  javascript:alert(2)',
        '); }',
        '.data { background-image: url("data:text/html,%3Cscript%3Ealert(3)%3C/script%3E"); }',
        '</style>',
        '<style data-source="remove-me" />',
        '<h2>安全标题</h2><p>安全正文</p>',
        '<table><tr><td>安全表格</td></tr></table>',
        '</article>',
      ].join('\n'),
    });

    assert.doesNotMatch(content.body, /<style\b|background-image|javascript\s*:|data\s*:\s*text\/html/i);
    assert.match(content.body, /<h2>安全标题<\/h2><p>安全正文<\/p>/);
    assert.match(content.body, /<table><tr><td>安全表格<\/td><\/tr><\/table>/);
  } finally {
    cleanupImportedContent(content);
  }
});

test('removes every inline style attribute while preserving safe attributes', () => {
  let content;
  try {
    content = importContent({
      filename: 'inline-style-attack.html',
      body: [
        String.raw`<article id="root" class="story" data-kind="article" style="background:url(\6a avascript:alert(1))">`,
        String.raw`<p class="lead" title="安全提示" style="background:url(d\61 ta:text/html;%3Cscript%3E)">安全正文</p>`,
        '<img src="https://safe.example/image.png" alt="安全图片" width="640" style="color:red">',
        '</article>',
      ].join(''),
    });

    assert.doesNotMatch(content.body, /\s(?:style|id|class|data-kind)\s*=|url\s*\(/i);
    assert.match(content.body, /<article>/);
    assert.match(content.body, /<p title="安全提示">安全正文<\/p>/);
    assert.match(content.body, /<img src="https:\/\/safe\.example\/image\.png" alt="安全图片" width="640">/);
  } finally {
    cleanupImportedContent(content);
  }
});

test('removes command attributes and interactive controls from imported HTML', () => {
  let content;
  try {
    content = importContent({
      filename: 'command-injection.html',
      body: [
        '<article id="content-editor" class="action-zone" data-action="publish" data-command="delete" contenteditable="true">',
        '<h2 data-action="publish-now">安全标题</h2>',
        '<button data-action="publish" formaction="/publish">发布按钮文本</button>',
        '<form action="/publish"><input name="command" value="publish">',
        '<select name="target"><option value="all">选项文本</option></select>',
        '<textarea name="payload">文本域内容</textarea></form>',
        '<dialog open data-command="confirm">对话文本</dialog>',
        '<p><strong>安全正文</strong><custom-widget data-action="run">自定义文本</custom-widget></p>',
        '</article>',
      ].join(''),
    });

    assert.doesNotMatch(content.body, /<(?:button|input|select|option|textarea|form|dialog|custom-widget)\b/i);
    assert.doesNotMatch(content.body, /\s(?:id|class|data-[\w-]+|contenteditable|formaction|action|name|value|open)\s*=/i);
    assert.match(content.body, /<article><h2>安全标题<\/h2>/);
    assert.match(content.body, /发布按钮文本/);
    assert.match(content.body, /选项文本/);
    assert.match(content.body, /文本域内容/);
    assert.match(content.body, /对话文本/);
    assert.match(content.body, /<p><strong>安全正文<\/strong>自定义文本<\/p>/);
  } finally {
    cleanupImportedContent(content);
  }
});

test('allows only approved href and src URL protocols in imported HTML', () => {
  let content;
  try {
    content = importContent({
      filename: 'url-policy.html',
      body: [
        '<article>',
        '<a href="#section">hash</a>',
        '<a href="/relative/path">relative</a>',
        '<a href="https://safe.example/path">https</a>',
        '<a href="http://safe.example/path">http</a>',
        '<a href="mailto:editor@example.com">mail</a>',
        '<a href="tel:+8613800000000">tel</a>',
        '<a href="ftp://files.example.com/file">blocked ftp</a>',
        '<a href="vbscript:msgbox(1)">blocked vbscript</a>',
        '<a href="&#x6a;avascript:alert(1)">blocked javascript</a>',
        '<a href="data:text/html;base64,PHNjcmlwdD4=">blocked data</a>',
        '<img src="/images/local.png" alt="local">',
        '<img src="https://safe.example/image.jpg" alt="remote">',
        '<img src="data:image/png;base64,iVBORw0KGgo=" alt="png">',
        '<img src="data:image/jpeg;base64,/9j/4AAQ=" alt="jpeg">',
        '<img src="data:image/gif;base64,R0lGODlhAQ==" alt="gif">',
        '<img src="data:image/webp;base64,UklGRg==" alt="webp">',
        '<img src="data:image/svg+xml;base64,PHN2Zz4=" alt="blocked svg">',
        '<img src="data:text/html;base64,PGh0bWw+" alt="blocked html">',
        '<img src="data:application/xhtml+xml;base64,PGh0bWw+" alt="blocked xhtml">',
        '<img src="ftp://files.example.com/image.png" alt="blocked ftp image">',
        '</article>',
      ].join(''),
    });

    for (const url of [
      '#section', '/relative/path', 'https://safe.example/path', 'http://safe.example/path',
      'mailto:editor@example.com', 'tel:+8613800000000', '/images/local.png',
      'https://safe.example/image.jpg', 'data:image/png;base64,iVBORw0KGgo=',
      'data:image/jpeg;base64,/9j/4AAQ=', 'data:image/gif;base64,R0lGODlhAQ==',
      'data:image/webp;base64,UklGRg==',
    ]) assert.ok(content.body.includes(url));
    assert.doesNotMatch(content.body, /href="(?:ftp|vbscript|javascript|data):/i);
    assert.doesNotMatch(content.body, /src="(?:ftp:|data:(?:image\/svg\+xml|text\/html|application\/xhtml\+xml))/i);
    assert.match(content.body, /<a>blocked ftp<\/a>/);
    assert.match(content.body, /<img alt="blocked svg">/);
  } finally {
    cleanupImportedContent(content);
  }
});

test('sanitizes a pasted HTML fragment without a filename', () => {
  let content;
  try {
    content = importContent({
      body: [
        '<article onclick="alert(1)"><script>alert(1)</script>',
        '<h2>片段标题</h2>',
        '<p><a href="javascript:alert(1)">保留正文</a></p>',
        '<svg><animate attributeName="href" values="javascript:alert(1)"></animate></svg>',
        '</article>',
      ].join(''),
    });

    assert.doesNotMatch(content.body, /<(?:script|svg|animate)\b/i);
    assert.doesNotMatch(content.body, /\sonclick\s*=|javascript\s*:/i);
    assert.match(content.body, /<article><h2>片段标题<\/h2>/);
    assert.match(content.body, /<p><a>保留正文<\/a><\/p>/);
  } finally {
    cleanupImportedContent(content);
  }
});

test('removes SVG animation and resource elements from imported HTML', () => {
  let content;
  try {
    content = importContent({
      filename: 'svg-attack.html',
      body: [
        '<article><p>保留正文</p>',
        '<svg xmlns="http://www.w3.org/2000/svg">',
        '<animate attributeName="href" values="https://safe.example; javascript:alert(1)"></animate>',
        '<use href="https://safe.example/icon.svg#icon"></use>',
        '</svg><p>保留结尾</p></article>',
      ].join(''),
    });

    assert.doesNotMatch(content.body, /<(?:svg|animate|use)\b/i);
    assert.doesNotMatch(content.body, /javascript\s*:/i);
    assert.match(content.body, /<p>保留正文<\/p>/);
    assert.match(content.body, /<p>保留结尾<\/p>/);
  } finally {
    cleanupImportedContent(content);
  }
});

test('stores imported defaults and derives a 120-character readable summary', () => {
  let content;
  try {
    const readableBody = '正文内容'.repeat(50);
    content = importContent({ filename: 'summary.md', body: `# 摘要标题\n\n${readableBody}` });

    assert.match(content.id, /^content_/);
    assert.equal(content.summary, `摘要标题 ${readableBody}`.slice(0, 120));
    assert.equal(content.type, '导入文章');
    assert.equal(content.plan_date, null);
    assert.equal(content.layout_html, '');
    assert.deepEqual(content.images, []);
    assert.deepEqual(content.selected_platforms, []);
    assert.equal(content.created_at, content.updated_at);
    assert.match(content.created_at, /^\d{4}-\d{2}-\d{2}T/);
  } finally {
    cleanupImportedContent(content);
  }
});

test('keeps a provided summary and trims a provided content type', () => {
  let content;
  try {
    content = importContent({
      filename: 'custom.txt',
      body: '自定义字段文章\n正文',
      summary: '  自定义摘要  ',
      type: '  外部资料  ',
    });

    assert.equal(content.summary, '自定义摘要');
    assert.equal(content.type, '外部资料');
  } finally {
    cleanupImportedContent(content);
  }
});

test('records an activity for the imported article', () => {
  let content;
  try {
    content = importContent({ filename: 'activity.txt', body: '活动记录文章\n正文' });
    const activity = db.prepare("SELECT * FROM activity WHERE target_type = 'content' AND target_id = ?").get(content.id);

    assert.ok(activity);
    assert.equal(activity.actor, '用户');
    assert.equal(activity.action, '导入文章《活动记录文章》');
  } finally {
    cleanupImportedContent(content);
  }
});

test('rolls back imported content when its activity insert fails', () => {
  const title = `事务回滚文章-${Date.now()}`;
  db.exec('DROP TRIGGER IF EXISTS fail_import_activity');
  db.exec(`
    CREATE TRIGGER fail_import_activity
    BEFORE INSERT ON activity
    WHEN NEW.target_type = 'content' AND NEW.action LIKE '导入文章%'
    BEGIN
      SELECT RAISE(ABORT, 'forced import activity failure');
    END
  `);

  try {
    assert.throws(() => importContent({
      filename: 'rollback.txt',
      title,
      body: '事务回滚正文',
    }), /forced import activity failure/);
    assert.equal(db.prepare('SELECT id FROM contents WHERE title = ?').get(title), undefined);
    assert.equal(db.prepare("SELECT id FROM activity WHERE action LIKE '导入文章%' AND target_id IN (SELECT id FROM contents WHERE title = ?)").get(title), undefined);
  } finally {
    db.exec('DROP TRIGGER IF EXISTS fail_import_activity');
    db.prepare("DELETE FROM activity WHERE target_type = 'content' AND target_id IN (SELECT id FROM contents WHERE title = ?)").run(title);
    db.prepare('DELETE FROM contents WHERE title = ?').run(title);
  }
});

test('returns imported content in dashboard content data', () => {
  let content;
  try {
    content = importContent({ filename: 'dashboard.txt', body: '内容列表文章\n正文' });
    const listed = getDashboardData().contents.find(item => item.id === content.id);

    assert.ok(listed);
    assert.equal(listed.title, '内容列表文章');
    assert.equal(listed.status, '已导入');
  } finally {
    cleanupImportedContent(content);
  }
});

test('POST /api/content/import imports and returns content', async () => {
  const title = `端点导入文章-${Date.now()}`;
  let content;
  await new Promise((resolve, reject) => {
    const onError = error => reject(error);
    server.once('error', onError);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', onError);
      resolve();
    });
  });

  try {
    const { port } = server.address();
    const response = await workbenchFetch(`http://127.0.0.1:${port}/api/content/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: 'endpoint.md', title, body: '# 被覆盖标题\n\n端点正文' }),
    });
    const result = await response.json();
    content = result.content;

    assert.equal(response.status, 200);
    assert.equal(result.ok, true);
    assert.equal(content.title, title);
    assert.equal(content.status, '已导入');
  } finally {
    content ||= db.prepare('SELECT id FROM contents WHERE title = ?').get(title);
    cleanupImportedContent(content);
    if (server.listening) {
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  }
});

test('POST /api/content/import returns validation and request-size status codes', async () => {
  const titles = [
    `无效扩展-${Date.now()}`,
    `超大正文-${Date.now()}`,
    `高转义正文-${Date.now()}`,
    `超大请求-${Date.now()}`,
  ];
  await new Promise((resolve, reject) => {
    const onError = error => reject(error);
    server.once('error', onError);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', onError);
      resolve();
    });
  });

  try {
    const { port } = server.address();
    const endpoint = `http://127.0.0.1:${port}/api/content/import`;
    const post = (url, body) => workbenchFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    let response = await post(endpoint, JSON.stringify({ filename: 'article.docx', title: titles[0], body: '正文' }));
    assert.equal(response.status, 415);
    assert.match((await response.json()).error, /文件格式不支持/);

    response = await post(endpoint, JSON.stringify({ filename: 'empty.txt', body: '   ' }));
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /正文不能为空/);

    response = await post(endpoint, JSON.stringify({ filename: 'large.txt', title: titles[1], body: 'a'.repeat(5 * 1024 * 1024 + 1) }));
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /不能超过 5 MiB/);

    response = await post(endpoint, '{"filename":');
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /JSON 格式无效/);

    for (const invalidPayload of ['null', '[]', JSON.stringify({ body: 123 })]) {
      response = await post(endpoint, invalidPayload);
      assert.equal(response.status, 400);
      assert.match((await response.json()).error, /JSON 对象|字符串/);
    }

    const highlyEscapedBody = '\u0001'.repeat(1024 * 1024 + 64);
    response = await post(endpoint, JSON.stringify({ filename: 'escaped.txt', title: titles[2], body: highlyEscapedBody }));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).content.title, titles[2]);

    const oversizedEnvelope = `${JSON.stringify({ filename: 'envelope.txt', title: titles[3], body: '正文' })}${' '.repeat(32 * 1024 * 1024 + 1)}`;
    response = await post(endpoint, oversizedEnvelope);
    assert.equal(response.status, 413);
    assert.match((await response.json()).error, /请求内容过大/);

    response = await post(`http://127.0.0.1:${port}/api/topics/generate`, '{"date":');
    assert.equal(response.status, 500);
  } finally {
    for (const title of titles) {
      const rows = db.prepare('SELECT id FROM contents WHERE title = ?').all(title);
      for (const row of rows) cleanupImportedContent(row);
    }
    if (server.listening) {
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  }
});
