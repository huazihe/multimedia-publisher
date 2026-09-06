'use strict';

// Local template verification only; never calls login or publishing endpoints.
// Usage: node this-file.cjs /absolute/playwright/module /absolute/output-directory /absolute/article.md CONTENT_ID
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const repo = path.resolve(__dirname, '../..');
const layout = require(path.join(repo, 'publisher-dashboard/layout-templates.js'));
const { parseHTML } = createRequire(path.join(repo, 'packages/core/package.json'))('linkedom');
const { chromium } = require(process.argv[2]);
const output = path.resolve(process.argv[3]);
if (!process.argv[4]) throw new Error('请传入自己有权使用的 Markdown 验收稿路径');
const sourcePath = path.resolve(process.argv[4]);
const articleDir = path.dirname(sourcePath);
const origin = 'http://127.0.0.1:18810';
const digest = value => createHash('sha256').update(value).digest('hex');
const normalize = value => value.replace(/\s+/g, '');
const report = { generatedAt: new Date().toISOString(), templates: [], externalRequestsBlocked: [], pageErrors: [] };
let browser, server;

function fragment(html) {
  return parseHTML('<!doctype html><html><head></head><body>' + html + '</body></html>').document;
}
function bodySignature(document, title, outputDocument = false) {
  const body = document.body.cloneNode(true);
  if (outputDocument) {
    for (const el of body.querySelectorAll('[data-wechat-slot],style,script')) el.remove();
  } else {
    const first = body.firstElementChild;
    if (first?.tagName === 'H1' && normalize(first.textContent) === normalize(title)) first.remove();
  }
  const imagePositions = [];
  let textOffset = 0;
  function visit(node) {
    if (node.nodeType === 3) textOffset += normalize(node.textContent).length;
    if (node.nodeType === 1 && node.tagName === 'IMG') {
      imagePositions.push({ alt: node.getAttribute('alt'), textOffset });
    }
    for (const child of node.childNodes || []) visit(child);
  }
  visit(body);
  return {
    text: normalize(body.textContent),
    headings: [...body.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(el => [el.tagName, normalize(el.textContent)]),
    imagePositions,
  };
}

(async () => {
  const positionCheck = bodySignature(fragment('<p>前文</p><img alt="图"><p>后文</p>'), 'T').imagePositions;
  assert.deepEqual(positionCheck, bodySignature(fragment('<p></p><div><p>前文</p><img alt="图"><p>后文</p></div>'), 'T').imagePositions);
  assert.notDeepEqual(positionCheck, bodySignature(fragment('<p>前文</p><p>后文</p><img alt="图">'), 'T').imagePositions);
  fs.mkdirSync(output, { recursive: true });
  const before = (await (await fetch(origin + '/api/bootstrap')).json()).data;
  const content = before.contents.find(c => c.id === process.argv[5]);
  assert.ok(content, '请传入工作台中待验收文章的 CONTENT_ID');
  const initialHash = digest(fs.readFileSync(sourcePath));
  const sourceMd = fs.readFileSync(sourcePath, 'utf8');
  const allowedImages = new Set([...sourceMd.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)]
    .map(match => path.resolve(articleDir, decodeURIComponent(match[1]))));
  const input = fragment(content.body);
  report.input = { title: content.title, contentId: content.id, canonicalHash: layout.canonicalContentHash(content),
    sourceFileHash: initialHash, images: [] };
  for (const img of input.querySelectorAll('img')) {
    const originalRef = img.getAttribute('src');
    const resolved = path.resolve(articleDir, decodeURIComponent(originalRef));
    assert.ok(allowedImages.has(resolved), 'Image is not in the original manuscript');
    assert.equal(path.extname(resolved).toLowerCase(), '.png');
    const bytes = fs.readFileSync(resolved);
    img.setAttribute('src', 'data:image/png;base64,' + bytes.toString('base64'));
    report.input.images.push({ name: path.basename(resolved), bytes: bytes.length, sha256: digest(bytes) });
  }
  const expected = bodySignature(fragment(content.body), content.title);
  const hydratedBody = input.body.innerHTML;
  assert.deepEqual(bodySignature(fragment(hydratedBody), content.title), expected);
  report.input.imagePreparation = 'Test copy embeds the three original local PNGs. Live article and importer are unchanged.';
  const picked = spawnSync('python3', [path.join(repo, 'skills/weixin-layout/scripts/pick_layout.py'), '--json', '--seed', '20260905'], { encoding: 'utf8' });
  assert.equal(picked.status, 0, picked.stderr);
  const selected = JSON.parse(picked.stdout);
  fs.readFileSync(selected.path, 'utf8');
  report.selectedTemplate = selected.filename;
  const documents = new Map();
  for (const template of layout.listLayoutTemplates()) {
    const html = layout.renderLayoutTemplate(template.filename, { title: content.title, summary: content.summary,
      body: hydratedBody, accountName: '', accountDescription: '', generatedAt: report.generatedAt });
    const doc = parseHTML(html).document;
    const actual = bodySignature(doc, content.title, true);
    const entry = { filename: template.filename, label: template.label,
      textPreserved: actual.text === expected.text,
      headingsPreserved: JSON.stringify(actual.headings) === JSON.stringify(expected.headings),
      imagePositionsPreserved: JSON.stringify(actual.imagePositions) === JSON.stringify(expected.imagePositions),
      titleSlots: doc.querySelectorAll('[data-wechat-slot="title"]').length,
      images: doc.querySelectorAll('img').length,
      sampleCopyFound: /此处为|替换为|公众号通用排版样式合集|TC4钛合金|BUSINESS INSIGHT/.test(doc.body.textContent),
      views: [] };
    if (!entry.textPreserved) entry.textLengths = { expected: expected.text.length, actual: actual.text.length };
    documents.set(template.filename, html);
    report.templates.push(entry);
  }
  assert.equal(documents.size, 40);
  const finalFile = path.join(output, 'FDE-通用排版·基础样式.html');
  fs.writeFileSync(finalFile, documents.get(selected.filename));
  const staticCheck = spawnSync('python3', [path.join(repo, 'skills/weixin-layout/scripts/check_layout.py'), finalFile], { encoding: 'utf8' });
  report.staticCheck = { exitCode: staticCheck.status, output: staticCheck.stdout.trim(), error: staticCheck.stderr.trim() };
  if (staticCheck.status !== 0 && !/此处为|此处放|文章主标题|副标题或|正文区域|正文内容|配图位|替换为实际|示例正文/.test(parseHTML(documents.get(selected.filename)).document.body.textContent)) {
    report.staticCheck.note = 'The scanner matched 正文区域 in a CSS comment; no matching placeholder exists in the visible body.';
  }
  report.exampleFile = path.basename(finalFile);
  const stagedFile = path.join(output, 'platform-preview-input.html');
  const preparedDocuments = new Map();
  for (const entry of report.templates) {
    fs.writeFileSync(stagedFile, documents.get(entry.filename));
    const converted = spawnSync(process.execPath, [path.join(repo, 'packages/cli/dist/index.js'), 'preview', stagedFile,
      '-p', 'weixin', '-t', content.title], { cwd: repo, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    assert.equal(converted.status, 0, converted.stderr);
    const preview = JSON.parse(converted.stdout.trim());
    entry.platformPreview = { format: preview.format, images: preview.imageCount, warnings: preview.warnings };
    preparedDocuments.set(entry.filename, preview.htmlPreview);
  }
  fs.unlinkSync(stagedFile);
  server = http.createServer((req, res) => {
    const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname.slice(1));
    const html = name.startsWith('prepared/') ? preparedDocuments.get(name.slice(9)) : documents.get(name);
    if (!html) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const testOrigin = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== testOrigin) { report.externalRequestsBlocked.push(url.origin); return route.abort(); }
    return route.continue();
  });
  const page = await context.newPage();
  page.on('pageerror', err => report.pageErrors.push(err.message));
  for (const [index, entry] of report.templates.entries()) {
    await page.goto(testOrigin + '/' + encodeURIComponent(entry.filename), { waitUntil: 'load' });
    await page.evaluate(() => Promise.all([...document.images].map(img => img.decode().catch(() => null))));
    for (const width of [390, 800]) {
      await page.setViewportSize({ width, height: 844 });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const metrics = await page.evaluate(() => {
        const title = document.querySelector('[data-wechat-slot="title"]');
        const titleStyle = getComputedStyle(title);
        const titleBox = title.getBoundingClientRect();
        let background = 'rgb(255, 255, 255)', backgroundImage = 'none';
        for (let el = title; el; el = el.parentElement) {
          const s = getComputedStyle(el);
          if (s.backgroundImage !== 'none') { backgroundImage = s.backgroundImage; break; }
          if (s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backgroundColor !== 'transparent') { background = s.backgroundColor; break; }
        }
        const titleMetrics = { color: titleStyle.color, textFill: titleStyle.webkitTextFillColor,
          background, backgroundImage, fontSize: parseFloat(titleStyle.fontSize),
          width: titleBox.width, height: titleBox.height,
          visibility: titleStyle.visibility, opacity: titleStyle.opacity, textLength: title.textContent.length };
        const images = [...document.images].map(img => { const box = img.getBoundingClientRect(); return {
          decoded: img.complete && img.naturalWidth > 0, visibleWidth: box.width, visibleHeight: box.height,
          left: box.left, right: box.right,
        }; });
        const paragraphs = [...document.querySelectorAll('p')].filter(p => p.innerText.trim().length > 30);
        const overflow = [...document.body.querySelectorAll('*')].filter(el => {
          const b = el.getBoundingClientRect(); return b.width > 0 && (b.right > innerWidth + 1 || b.left < -1);
        }).slice(0, 6).map(el => ({ tag: el.tagName, class: el.className, width: el.getBoundingClientRect().width }));
        return { width: innerWidth, documentWidth: document.documentElement.scrollWidth, images, title: titleMetrics,
          minimumParagraphSize: Math.min(...paragraphs.map(p => parseFloat(getComputedStyle(p).fontSize))), overflow };
      });
      entry.views.push(metrics);
      if (width === 390) {
        entry.thumbnail = String(index + 1).padStart(2, '0') + '-mobile.png';
        await page.screenshot({ path: path.join(output, entry.thumbnail) });
      }
      if (entry.filename === selected.filename) {
        await page.screenshot({ path: path.join(output, `selected-${width}.png`) });
        if (width === 390) {
          await page.locator('img').first().scrollIntoViewIfNeeded();
          await page.screenshot({ path: path.join(output, 'selected-image-mobile.png') });
          await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
          await page.screenshot({ path: path.join(output, 'selected-ending-mobile.png') });
          await page.evaluate(() => scrollTo(0, 0));
        }
      }
    }
    const mobileTitle = entry.views[0].title;
    entry.visualWarnings = [];
    if (Number(mobileTitle.opacity) === 0 || mobileTitle.visibility !== 'visible') entry.visualWarnings.push('标题文字层被隐藏');
    if (mobileTitle.backgroundImage === 'none' && /^rgb\(255, 255, 255\)$/.test(mobileTitle.textFill)
      && mobileTitle.background === 'rgb(255, 255, 255)') entry.visualWarnings.push('白色标题落在白色背景上');
    if (mobileTitle.width < 100 && mobileTitle.height > 200) entry.visualWarnings.push('长标题被挤成窄竖列');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(testOrigin + '/prepared/' + encodeURIComponent(entry.filename), { waitUntil: 'load' });
    await page.evaluate(() => Promise.all([...document.images].map(img => img.decode().catch(() => null))));
    entry.platformPreview.view = await page.evaluate(titleText => {
      const compact = text => text.replace(/\s+/g, '');
      const titles = [...document.body.querySelectorAll('*')].filter(el => compact(el.textContent) === compact(titleText));
      const title = titles.at(-1);
      const style = title && getComputedStyle(title);
      const firstBodyParagraph = [...document.querySelectorAll('p')].find(p => p.textContent.startsWith('我之前写过一篇文章'));
      return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
        text: compact(document.body.textContent),
        imagesLoaded: [...document.images].filter(i => i.complete && i.naturalWidth > 0).length,
        title: title ? { opacity: style.opacity, color: style.color, width: title.getBoundingClientRect().width,
          height: title.getBoundingClientRect().height, size: style.fontSize } : null,
        bodySize: firstBodyParagraph ? getComputedStyle(firstBodyParagraph).fontSize : null };
    }, content.title);
    entry.platformPreview.textPreserved = entry.platformPreview.view.text === normalize(content.title + content.summary) + expected.text;
    delete entry.platformPreview.view.text;
    entry.platformPreview.titleFontChanged = Boolean(entry.platformPreview.view.title)
      && parseFloat(entry.platformPreview.view.title.size) !== mobileTitle.fontSize;
    if (entry.filename === selected.filename) await page.screenshot({ path: path.join(output, 'selected-platform-preview-mobile.png') });
    entry.pass = entry.textPreserved && entry.headingsPreserved && entry.imagePositionsPreserved
      && entry.titleSlots === 1 && entry.images === 3 && !entry.sampleCopyFound
      && entry.views.every(v => v.documentWidth <= v.width && v.images.every(i => i.decoded && i.visibleWidth > 0 && i.visibleHeight > 0))
      && entry.visualWarnings.length === 0 && entry.platformPreview.textPreserved
      && entry.platformPreview.view.imagesLoaded === 3 && entry.platformPreview.view.scrollWidth <= 390;
  }
  const cards = report.templates.map((entry, i) => `<article><header>${i + 1}. ${entry.label} · ${entry.visualWarnings.length ? '标题待修' : entry.platformPreview.titleFontChanged ? '预览字号变化' : '基础检查通过'}</header><img src="data:image/png;base64,${fs.readFileSync(path.join(output, entry.thumbnail)).toString('base64')}"></article>`).join('');
  await page.setViewportSize({ width: 1680, height: 1000 });
  await page.setContent('<!doctype html><html><head><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;padding:24px;font:16px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;background:#ececec}.grid{display:grid;grid-template-columns:repeat(5,1fr);gap:20px}article{background:white;border:1px solid #ddd;overflow:hidden}header{height:52px;padding:12px;font-weight:600}img{display:block;width:100%;height:auto}</style></head><body><h1>FDE 原稿 · 40 套公众号模板实际首屏</h1><div class="grid">' + cards + '</div></body></html>');
  await page.evaluate(() => Promise.all([...document.images].map(img => img.decode())));
  await page.screenshot({ path: path.join(output, '40-template-overview.png'), fullPage: true });
  const after = (await (await fetch(origin + '/api/bootstrap')).json()).data;
  report.liveArticleUnchanged = layout.canonicalContentHash(after.contents.find(c => c.id === content.id)) === report.input.canonicalHash;
  report.originalFileUnchanged = digest(fs.readFileSync(sourcePath)) === initialHash;
  report.publishJobs = { before: before.jobs.length, after: after.jobs.length };
  report.summary = { generated: report.templates.length,
    basicRenderChecksPassed: report.templates.filter(t => t.pass).length,
    templateTitleIssues: report.templates.filter(t => t.visualWarnings.length).map(t => t.filename),
    platformPreviewTitleFontChanges: report.templates.filter(t => t.platformPreview.titleFontChanged).length,
    scope: 'Local template and prepared-HTML rendering with original embedded images; not WeChat server/client acceptance.' };
})().catch(err => { report.error = err.stack; process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  report.externalRequestsBlocked = [...new Set(report.externalRequestsBlocked)];
  fs.writeFileSync(path.join(output, 'template-audit.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report.summary, selectedTemplate: report.selectedTemplate,
    staticCheck: report.staticCheck, liveArticleUnchanged: report.liveArticleUnchanged,
    originalFileUnchanged: report.originalFileUnchanged, publishJobs: report.publishJobs,
    pageErrors: report.pageErrors, error: report.error, output }, null, 2));
});
