const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'publisher-dashboard-test-'));
process.env.PUBLISHER_DB = path.join(testDataDir, 'publisher.sqlite');

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
  getDashboardData,
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

test('imports Markdown title and body with imported status', () => {
  let content;
  try {
    const body = '# 导入标题\n\n正文内容';
    content = importContent({ filename: 'article.md', body });

    assert.equal(content.title, '导入标题');
    assert.equal(content.body, body);
    assert.equal(content.status, '已导入');
  } finally {
    cleanupImportedContent(content);
  }
});

test('preserves a Markdown autolink verbatim', () => {
  let content;
  try {
    const body = '\n# 链接文章\n\n访问 <https://safe.example/path>\n';
    content = importContent({ filename: 'autolink.md', body });

    assert.equal(content.body, body.trim());
    assert.match(content.body, /<https:\/\/safe\.example\/path>/);
  } finally {
    cleanupImportedContent(content);
  }
});

test('preserves a script element inside a Markdown code fence as text', () => {
  let content;
  try {
    const body = [
      '',
      '# 代码示例',
      '',
      '```html',
      '<script>alert("示例")</script>',
      '```',
      '',
    ].join('\n');
    content = importContent({ filename: 'code-example.markdown', body });

    assert.equal(content.body, body.trim());
    assert.match(content.body, /<script>alert\("示例"\)<\/script>/);
  } finally {
    cleanupImportedContent(content);
  }
});

test('sanitizes mixed HTML while restoring protected Markdown literals byte-for-byte', () => {
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
    assert.ok(content.body.includes(autolink));
    assert.equal(content.body.slice(content.body.indexOf('```html')), fencedBlock);
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
    for (const autolink of autolinks) assert.ok(content.body.includes(autolink));
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
    assert.ok(content.body.includes(autolink));
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

    assert.doesNotMatch(content.body, /\sstyle\s*=|url\s*\(/i);
    assert.match(content.body, /<article id="root" class="story" data-kind="article">/);
    assert.match(content.body, /<p class="lead" title="安全提示">安全正文<\/p>/);
    assert.match(content.body, /<img src="https:\/\/safe\.example\/image\.png" alt="安全图片" width="640">/);
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
