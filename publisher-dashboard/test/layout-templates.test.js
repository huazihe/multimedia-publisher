'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');

const {
  listLayoutTemplates,
  renderLayoutTemplate,
} = require('../layout-templates');

const TEMPLATE_DIR = path.resolve(__dirname, '../../skills/weixin-layout/templates');
const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'publisher-layout-templates-test-'));
process.env.PUBLISHER_DB = path.join(testDataDir, 'publisher.sqlite');
const PLACEHOLDER_MARKERS = /此处为|替换为|文章主标题|公众号名称|公众号简介/;
const KNOWN_SAMPLE_COPY = /TC4钛合金|手艺人的最后一代|公众号通用排版样式合集|关于早晨的那杯茶|正文段落首行缩进两格|上一篇文章的标题|作者名字|慢生活笔记|BUSINESS INSIGHT|\[\s*配图位置\s*\]/i;

let dashboardServer;

function dashboard() {
  dashboardServer ||= require('../server');
  return dashboardServer;
}

function cleanupContent(content) {
  if (!content?.id || !dashboardServer) return;
  dashboardServer.db.prepare("DELETE FROM activity WHERE target_type = 'content' AND target_id = ?").run(content.id);
  dashboardServer.db.prepare('DELETE FROM contents WHERE id = ?').run(content.id);
}

async function listenOnRandomPort() {
  const { server } = dashboard();
  if (server.listening) return server.address().port;
  await new Promise((resolve, reject) => {
    const onError = error => reject(error);
    server.once('error', onError);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', onError);
      resolve();
    });
  });
  return server.address().port;
}

after(async () => {
  if (dashboardServer?.server.listening) {
    await new Promise((resolve, reject) => dashboardServer.server.close(error => error ? reject(error) : resolve()));
  }
  dashboardServer?.db.close();
  fs.rmSync(testDataDir, { recursive: true, force: true });
});

function normalizedStyleBlocks(html) {
  return [...String(html).matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)]
    .map(match => match[1].replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function visualStyleSignature(html) {
  const styleBlocks = normalizedStyleBlocks(html).join('|');
  const inlineStyles = [...String(html).matchAll(/\sstyle=(?:"([^"]*)"|'([^']*)')/gi)]
    .slice(0, 16)
    .map(match => (match[1] || match[2] || '').replace(/\s+/g, ' ').trim())
    .join('|');
  return `${styleBlocks}::${inlineStyles}`;
}

test('discovers exactly 40 templates with stable safe metadata', () => {
  const first = listLayoutTemplates();
  const second = listLayoutTemplates();

  assert.equal(first.length, 40);
  assert.deepEqual(second, first);
  assert.deepEqual(first.map(template => template.filename), first.map(template => template.filename).sort());
  assert.equal(new Set(first.map(template => template.filename)).size, 40);

  for (const template of first) {
    assert.deepEqual(Object.keys(template).sort(), ['filename', 'label']);
    assert.equal(path.basename(template.filename), template.filename);
    assert.match(template.filename, /\.html$/);
    assert.ok(template.label.trim());
    assert.doesNotMatch(template.label, /\.html$/i);
    assert.equal(fs.lstatSync(path.join(TEMPLATE_DIR, template.filename)).isFile(), true);
  }

  assert.equal(first.find(template => template.filename === 'style_10.html').label, '样式 10');
  assert.equal(first.find(template => template.filename === 'template_style11_杂志分栏风.html').label, '杂志分栏风');
  assert.equal(first.find(template => template.filename === '专业案例·清爽蓝白.html').label, '专业案例·清爽蓝白');
});

test('rejects traversal, missing files, and non-template names', () => {
  const input = {
    title: '真实标题',
    summary: '真实导语',
    body: '<p>真实正文</p>',
  };

  for (const filename of [
    '../style_10.html',
    'nested/style_10.html',
    '/tmp/style_10.html',
    'style_10.HTML',
    'style_10.txt',
    'package.json',
    '',
  ]) {
    assert.throws(() => renderLayoutTemplate(filename, input), /模板名称无效/);
  }
  assert.throws(() => renderLayoutTemplate('missing-template.html', input), /模板不存在/);
});

test('renders all 40 templates with only the requested article and account copy', () => {
  const rendered = [];
  for (const template of listLayoutTemplates()) {
    const source = fs.readFileSync(path.join(TEMPLATE_DIR, template.filename), 'utf8');
    const html = renderLayoutTemplate(template.filename, {
      title: '真实标题',
      summary: '真实导语',
      body: '<h2>第一节</h2><p>真实正文内容</p><ul><li>真实清单项</li></ul>',
      accountName: '真实公众号',
      accountDescription: '专注真实行业洞察',
    });
    rendered.push(html);

    assert.match(html, /^<!doctype html>/i, template.filename);
    assert.match(html, new RegExp(`data-wechat-template="${template.filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`), template.filename);
    for (const realCopy of ['真实标题', '真实导语', '第一节', '真实正文内容', '真实清单项', '真实公众号', '专注真实行业洞察']) {
      assert.ok(html.includes(realCopy), `${template.filename} 缺少 ${realCopy}`);
    }
    assert.doesNotMatch(html, PLACEHOLDER_MARKERS, template.filename);
    assert.doesNotMatch(html, KNOWN_SAMPLE_COPY, template.filename);
    assert.doesNotMatch(html, /color\s*:\s*url\(/i, `${template.filename} 生成了无效的文本颜色`);
    const accountTag = html.match(/<[^>]+data-wechat-account="true"[^>]*>/i)?.[0];
    assert.ok(accountTag, `${template.filename} 缺少账号区`);
    assert.doesNotMatch(accountTag, /display\s*:\s*flex/i, `${template.filename} 账号区误用了装饰横线布局`);

    const originalStyles = normalizedStyleBlocks(source);
    const renderedStyles = normalizedStyleBlocks(html);
    for (const style of originalStyles) {
      assert.ok(renderedStyles.includes(style), `${template.filename} 未保留原始 style 块`);
    }
  }

  const signatures = new Set(rendered.map(visualStyleSignature));
  assert.ok(signatures.size >= 12, `40 套模板只保留了 ${signatures.size} 种视觉样式`);
});

test('renders generated Markdown as article HTML', () => {
  const html = renderLayoutTemplate('style_10.html', {
    title: 'Markdown 标题',
    summary: 'Markdown 导语',
    body: [
      '# Markdown 标题',
      '',
      '## Markdown 小节',
      '',
      '第一段正文。',
      '',
      '- 清单甲',
      '- 清单乙',
    ].join('\n'),
  });

  assert.match(html, /<h2\b[^>]*>Markdown 小节<\/h2>/);
  assert.match(html, /<p\b[^>]*>第一段正文。<\/p>/);
  assert.match(html, /<li\b[^>]*>清单甲<\/li>/);
  assert.equal((html.match(/Markdown 标题/g) || []).length, 2, '标题应只出现在文档 title 和文章主标题');
});

test('removes unsafe resources and actions from article content and the final document', () => {
  const html = renderLayoutTemplate('style_10.html', {
    title: '安全标题',
    summary: '安全导语',
    body: [
      '<h2 onclick="alert(1)">安全小节</h2>',
      '<p onmouseover="alert(2)">安全正文</p>',
      '<script>alert(3)</script>',
      '<iframe src="https://evil.example"></iframe>',
      '<object data="https://evil.example"></object>',
      '<embed src="https://evil.example">',
      '<meta http-equiv="refresh" content="0;url=https://evil.example">',
      '<link rel="stylesheet" href="https://evil.example/style.css">',
      '<form action="/publish"><button formaction="/delete">危险操作</button></form>',
      '<a href="javascript:alert(4)" data-action="publish">保留链接文字</a>',
      '<img src="javascript:alert(5)" srcset="javascript:alert(6) 2x" onerror="alert(7)" alt="危险图片">',
    ].join(''),
  });

  assert.match(html, /安全小节/);
  assert.match(html, /安全正文/);
  assert.doesNotMatch(html, /<(?:script|iframe|object|embed|form|button|input|select|textarea|meta\b[^>]*http-equiv=["']?refresh|link)\b/i);
  assert.doesNotMatch(html, /\son[a-z0-9_-]+\s*=|\s(?:action|formaction|srcdoc|contenteditable|data-action)\s*=/i);
  assert.doesNotMatch(html, /\ssrcset\s*=/i);
  assert.doesNotMatch(html, /javascript\s*:/i);
});

test('layoutContent renders a selected template and keeps the generic fallback', () => {
  const { importContent, layoutContent, db } = dashboard();
  let content;
  try {
    content = importContent({
      filename: 'layout-integration.md',
      title: '布局集成标题',
      summary: '布局集成导语',
      body: '# 布局集成标题\n\n## 集成小节\n\n布局集成正文',
    });

    const generic = layoutContent(content.id);
    assert.equal(generic.status, '已排版');
    assert.match(generic.layout_html, /class="wechat-preview"/);
    assert.doesNotMatch(generic.layout_html, /data-wechat-template=/);
    assert.throws(() => layoutContent(content.id, false), /模板名称无效/);

    const templated = layoutContent(content.id, 'style_10.html');
    assert.equal(templated.status, '已排版');
    assert.match(templated.layout_html, /^<!doctype html>/i);
    assert.match(templated.layout_html, /data-wechat-template="style_10\.html"/);
    assert.match(templated.layout_html, /布局集成标题/);
    assert.match(templated.layout_html, /布局集成正文/);
    assert.equal(db.prepare('SELECT layout_html FROM contents WHERE id = ?').get(content.id).layout_html, templated.layout_html);
  } finally {
    cleanupContent(content);
  }
});

test('GET template list and POST selected layout return preview-compatible full HTML', async () => {
  const { importContent, db } = dashboard();
  let content;
  const port = await listenOnRandomPort();
  try {
    const listResponse = await fetch(`http://127.0.0.1:${port}/api/layout-templates`);
    const listResult = await listResponse.json();
    assert.equal(listResponse.status, 200);
    assert.equal(listResult.ok, true);
    assert.deepEqual(listResult.templates, listLayoutTemplates());

    content = importContent({
      filename: 'layout-route.md',
      title: '路由排版标题',
      summary: '路由排版导语',
      body: '# 路由排版标题\n\n路由排版正文',
    });
    const layoutResponse = await fetch(`http://127.0.0.1:${port}/api/content/${content.id}/layout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template: 'style_11.html' }),
    });
    const layoutResult = await layoutResponse.json();
    assert.equal(layoutResponse.status, 200);
    assert.equal(layoutResult.ok, true);
    assert.equal(layoutResult.content.status, '已排版');
    assert.match(layoutResult.content.layout_html, /data-wechat-template="style_11\.html"/);
    assert.equal(db.prepare('SELECT layout_html FROM contents WHERE id = ?').get(content.id).layout_html, layoutResult.content.layout_html);

    const previewResponse = await fetch(`http://127.0.0.1:${port}/content/${content.id}/preview.html`);
    const previewHtml = await previewResponse.text();
    assert.equal(previewResponse.status, 200);
    assert.match(previewHtml, /^<!doctype html>/i);
    assert.match(previewHtml, /data-wechat-template="style_11\.html"/);
    assert.match(previewHtml, /路由排版正文/);
  } finally {
    cleanupContent(content);
  }
});
