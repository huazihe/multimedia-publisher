const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'publisher-dashboard-test-'));
process.env.PUBLISHER_DB = path.join(testDataDir, 'publisher.sqlite');
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
  previewContentForPlatform,
  publishSnapshotName,
  publishContent,
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
      const response = await fetch(endpoint);
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
    const response = await fetch(
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

    let response = await fetch(`${base}/${encodeURIComponent(content.id)}/platform-preview`);
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /缺少平台/);

    response = await fetch(`${base}/${encodeURIComponent(content.id)}/platform-preview?platform=unknown-platform`);
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /平台不存在/);

    response = await fetch(`${base}/missing-content/platform-preview?platform=xiaohongshu`);
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

test('publishContent batch still updates selection and aggregate status for two platforms', async () => {
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
    const result = await publishContent(fixture.id, ['zhihu', 'juejin'], {
      publishMode: 'draft',
      preflight: async () => null,
      platformPublisher: successfulPlatformPublisher(calls),
    });

    assert.equal(result.job.status, 'published');
    assert.deepEqual(result.job.platforms, ['zhihu', 'juejin']);
    assert.deepEqual(result.job.results.map(item => [item.platform, item.status]), [
      ['zhihu', 'success'],
      ['juejin', 'success'],
    ]);
    assert.deepEqual(readPublishState(fixture), {
      selectedPlatforms: ['zhihu', 'juejin'],
      contentStatus: '已发布',
      planStatus: '已发布',
    });
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

    let response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform: ' ZHIHU ', publishMode: 'draft' }),
    });
    assert.equal(response.status, 200);
    let result = await response.json();
    assert.equal(result.ok, true);
    assert.deepEqual(result.job.platforms, ['zhihu']);
    assert.deepEqual(result.job.results.map(item => [item.platform, item.status]), [['zhihu', 'success']]);
    const firstJobId = result.job.id;
    assert.deepEqual(readPublishState(fixture), {
      selectedPlatforms: ['weixin', 'douyin'],
      contentStatus: '已排版',
      planStatus: '选题已确认',
    });

    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform: 'juejin', publishMode: 'direct' }),
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
    const request = (platform, publishMode) => fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform, publishMode }),
    });

    const responses = await Promise.all([
      request('zhihu', 'draft'),
      request('juejin', 'direct'),
    ]);
    const payloads = await Promise.all(responses.map(response => response.json()));

    assert.deepEqual(responses.map(response => response.status), [200, 200]);
    assert.equal(new Set(payloads.map(payload => payload.job.id)).size, 2);
    assert.deepEqual(payloads.map(payload => payload.job.platforms[0]).sort(), ['juejin', 'zhihu']);
    for (const payload of payloads) {
      assert.equal(payload.ok, true);
      assert.equal(payload.job.results.length, 1);
      assert.equal(payload.job.results[0].platform, payload.job.platforms[0]);
      assert.equal(payload.job.results[0].status, 'success');
    }
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
    const publish = () => fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform: 'zhihu', publishMode: 'direct' }),
    });

    const firstRequest = publish();
    await firstEntered;
    const duplicateResponse = await publish();
    assert.equal(duplicateResponse.status, 409);
    assert.match((await duplicateResponse.json()).error, /正在进行|重复发布/);
    assert.equal(calls, 1);

    releaseFirst();
    const firstResponse = await firstRequest;
    assert.equal(firstResponse.status, 200);

    const retryResponse = await publish();
    assert.equal(retryResponse.status, 200);
    assert.equal(calls, 2);
  } finally {
    releaseFirst?.();
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
    const invalidCases = [
      [{ publishMode: 'draft' }, /必须且只能指定一个平台/],
      [{ platform: ['zhihu'], publishMode: 'draft' }, /必须且只能指定一个平台/],
      [{ platform: 'zhihu,juejin', publishMode: 'draft' }, /必须且只能指定一个平台/],
      [{ platform: 'unknown-platform', publishMode: 'draft' }, /平台不存在/],
      [{ platform: 'zhihu' }, /publishMode.*draft.*direct/],
      [{ platform: 'zhihu', publishMode: 'scheduled' }, /publishMode.*draft.*direct/],
      [[], /JSON 对象/],
    ];

    for (const [body, messagePattern] of invalidCases) {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      assert.equal(response.status, 400);
      assert.match((await response.json()).error, messagePattern);
    }

    const malformedResponse = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"platform":',
    });
    assert.equal(malformedResponse.status, 400);
    assert.match((await malformedResponse.json()).error, /JSON 格式无效/);

    const missingResponse = await fetch(
      `http://127.0.0.1:${port}/api/content/missing-content/publish-platform`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: 'zhihu', publishMode: 'direct' }),
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
    let response = await fetch(`http://127.0.0.1:${port}/api/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contentId: fixture.id,
        platforms: ['zhihu', 'juejin'],
        publishMode: 'draft',
      }),
    });
    let result = await response.json();

    assert.equal(response.status, 200);
    assert.equal(result.ok, true);
    assert.equal(result.job.content_id, fixture.id);
    assert.equal(result.job.status, 'published');
    assert.deepEqual(result.job.platforms, ['zhihu', 'juejin']);
    assert.deepEqual(result.job.results.map(item => [item.platform, item.status]), [
      ['zhihu', 'success'],
      ['juejin', 'success'],
    ]);
    assert.equal(result.rawOutput, 'stub output zhihu\n\nstub output juejin');
    assert.deepEqual(readPublishState(fixture), {
      selectedPlatforms: ['zhihu', 'juejin'],
      contentStatus: '已发布',
      planStatus: '已发布',
    });

    response = await fetch(`http://127.0.0.1:${port}/api/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contentId: fixture.id,
        platforms: ['weixin'],
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

test('root dashboard scripts build core and CLI without recursive test scripts', () => {
  const rootPackagePath = path.resolve(__dirname, '..', '..', 'package.json');
  const rootPackage = JSON.parse(fs.readFileSync(rootPackagePath, 'utf8'));

  assert.equal(rootPackage.scripts.build, 'npm run build:core && npm run build:cli');
  assert.equal(rootPackage.scripts.dashboard, 'npm run build && npm --prefix publisher-dashboard start');
  assert.equal(rootPackage.scripts['dashboard:test'], 'npm run build && npm --prefix publisher-dashboard test');
  assert.equal(rootPackage.scripts.test, 'npm run dashboard:test');
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
    const updated = updateContent(content.id, {
      body: '# User Edited Title\n\nUser edited body.',
    });

    assert.equal(updated.title, 'User Edited Title');
    assert.match(updated.body, /User edited body/);
  } finally {
    if (content?.id) db.prepare('DELETE FROM contents WHERE id = ?').run(content.id);
    db.prepare("DELETE FROM weekly_plans WHERE date = '2099-02-02'").run();
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
    const updated = updateContent(content.id, { body: unsafeBody });
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
    const markdownUpdated = updateContent(content.id, { body: markdownCode });
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
    const updateResponse = await fetch(`http://127.0.0.1:${port}/api/content/${content.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: unsafeBody }),
    });
    const updateResult = await updateResponse.json();
    assert.equal(updateResponse.status, 200);
    assert.equal(updateResult.ok, true);
    assert.equal(updateResult.content.body, '<p>可见正文</p>');

    db.prepare('UPDATE contents SET body = ? WHERE id = ?').run(unsafeBody, content.id);
    const bootstrapResponse = await fetch(`http://127.0.0.1:${port}/api/bootstrap`);
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
    assert.match(content.body, /<pre><code class="language-html">&lt;article data-action=&quot;publish&quot;&gt;&lt;script&gt;alert\(&quot;示例&quot;\)&lt;\/script&gt;&lt;\/article&gt;<\/code><\/pre>/);
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
    assert.match(content.body, /<pre><code class="language-html">&lt;script&gt;alert\(&quot;示例&quot;\)&lt;\/script&gt;<\/code><\/pre>/);
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
    assert.match(content.body, /<pre><code>&lt;script&gt;alert\(&quot;缩进代码&quot;\)&lt;\/script&gt;<\/code><\/pre>/);
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
    const response = await fetch(`http://127.0.0.1:${port}/api/content/import`, {
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
    const post = (url, body) => fetch(url, {
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
