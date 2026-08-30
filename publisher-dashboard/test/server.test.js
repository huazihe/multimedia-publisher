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
