'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const { test } = require('node:test');
const { transformTables, TABLE_IMAGE_LIMITS } = require('../table-images');
const { parseHTML } = createRequire(path.resolve(__dirname, '../../packages/core/package.json'))('linkedom');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN7kAAAAASUVORK5CYII=', 'base64');

async function setup(t) {
  const assetsRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'table-images-test-'));
  t.after(() => fs.rm(assetsRoot, { recursive: true, force: true }));
  const requests = [];
  const renderTable = async request => { requests.push(request); return PNG; };
  return { assetsRoot, renderTable, requests };
}
function table(rows = 3) {
  return `<table><thead><tr><th>编号</th><th>说明</th></tr></thead><tbody>${Array.from({ length: rows }, (_, i) => `<tr><td>行${i + 1}</td><td>内容${i + 1}</td></tr>`).join('')}</tbody></table>`;
}
function bodyValues(requests) {
  return requests.flatMap(request => Array.from(parseHTML(request.html).document.querySelectorAll('tbody tr')).map(row => row.firstElementChild.textContent));
}

test('no tables returns the original HTML exactly without creating assets', async () => {
  const html = '<p class="unchanged">正文 &amp; <img src="/uploads/original.png"></p>';
  assert.deepEqual(await transformTables(html), { html, assets: [], warnings: [] });
});

test('returns derived upload assets while preserving original HTML/file and non-table images', async t => {
  const config = await setup(t);
  const original = `<h1>原稿</h1>${table()}<p>后文</p><img src="/uploads/original.png">`;
  const sourceFile = path.join(config.assetsRoot, 'source.html');
  await fs.writeFile(sourceFile, original);
  const input = Object.freeze({ html: original });
  const output = await transformTables(input.html, config);
  assert.equal(input.html, original);
  assert.equal(await fs.readFile(sourceFile, 'utf8'), original);
  assert.ok(output.html.includes('<h1>原稿</h1>') && output.html.includes('<p>后文</p>'));
  assert.ok(output.html.includes('/uploads/original.png'));
  assert.ok(!output.html.includes('<table>'));
  assert.equal(output.assets.length, 1);
  const asset = output.assets[0];
  assert.match(asset.relativeUrl, /^\/uploads\/table-images\/[a-f0-9]{64}-\d+-\d+\.png$/);
  assert.equal(asset.absolutePath, path.join(await fs.realpath(config.assetsRoot), 'table-images', asset.filename));
  assert.equal(asset.mimeType, 'image/png');
  assert.deepEqual(await fs.readFile(asset.absolutePath), PNG);
});

test('sanitizes to rebuilt table/plain text and never exposes CSS, scripts, paths or network resources to renderer', async t => {
  const config = await setup(t);
  const html = `<table style="background:url(https://evil.invalid/css)" onclick="steal()"><caption>标题&lt;x&gt;</caption><thead><tr><th>安全表头</th></tr></thead><tbody><tr><td><script>secretScript()</script><style>@import 'https://evil.invalid/style';</style><iframe src="file:///etc/passwd">iframe text</iframe><svg onload="steal()"><image href="https://evil.invalid/svg"/></svg><a href="javascript:secret()">纯文本链接</a><img src="../../secrets" srcset="https://evil.invalid/image" onerror="steal()" alt="配图说明"><p>一行</p><p>另一行 &lt;script&gt;文字&lt;/script&gt;</p><br>结尾</td></tr></tbody></table>`;
  const result = await transformTables(html, config);
  const rendered = config.requests[0].html;
  assert.doesNotMatch(rendered, /evil\.invalid|file:|secretScript|steal\(|onerror|onclick|<script|<iframe|<svg|<img|srcset|href=/i);
  assert.match(rendered, /纯文本链接/);
  assert.match(rendered, /配图说明/);
  assert.match(rendered, /&lt;script&gt;文字&lt;\/script&gt;/);
  assert.match(rendered, /overflow-wrap:anywhere/);
  assert.match(rendered, /default-src 'none'/);
  assert.match(rendered, /script-src 'none'/);
  assert.ok(result.warnings.some(w => w.includes('替代文字')));
  assert.ok(result.warnings.some(w => w.includes('脚本')));
});

test('splits all rows once, repeats all header rows and preserves captions', async t => {
  const config = await setup(t);
  const html = table(17).replace('<table>', '<table><caption>对比说明</caption>');
  const result = await transformTables(html, { ...config, maxRowsPerImage: 4 });
  assert.equal(result.assets.length, 5);
  assert.deepEqual(bodyValues(config.requests), Array.from({ length: 17 }, (_, i) => `行${i + 1}`));
  for (const request of config.requests) {
    const doc = parseHTML(request.html).document;
    assert.equal(doc.querySelector('thead').textContent, '编号说明');
    assert.equal(doc.querySelector('caption').textContent, '对比说明');
    assert.ok(request.rowCount <= 4);
  }
  assert.ok(result.warnings.some(w => w.includes('重复表头')));
});

test('splits again on measured height without losing rows', async t => {
  const config = await setup(t);
  const successful = [];
  const result = await transformTables(table(9), { ...config, maxRowsPerImage: 9,
    renderTable: async request => {
      if (request.rowCount > 2) throw Object.assign(new Error('too tall'), { code: 'TABLE_IMAGE_TOO_TALL' });
      successful.push(request);
      return PNG;
    },
  });
  assert.equal(result.assets.length, 5);
  assert.deepEqual(bodyValues(successful), Array.from({ length: 9 }, (_, i) => `行${i + 1}`));
});

test('rowspan/colspan and multirow headers stay intact across segments', async t => {
  const config = await setup(t);
  const html = '<table><thead><tr><th rowspan="2">分类</th><th colspan="2">描述</th></tr><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td rowspan="2">合并</td><td>一</td><td>二</td></tr><tr><td>三</td><td>四</td></tr><tr><td>五</td><td>六</td><td>七</td></tr></tbody></table>';
  const result = await transformTables(html, { ...config, maxRowsPerImage: 2 });
  assert.equal(result.assets.length, 2);
  assert.deepEqual(config.requests.map(r => r.rowCount), [2, 1]);
  assert.ok(config.requests.every(r => parseHTML(r.html).document.querySelectorAll('thead tr').length === 2));
  assert.match(config.requests[0].html, /<td colspan="1" rowspan="2">合并/);
  assert.equal(config.requests.reduce((sum, r) => sum + r.rowCount, 0), 3);
});

test('no table header is invented and all data remains present', async t => {
  const config = await setup(t);
  const html = '<table><tr><td>甲</td></tr><tr><td>乙</td></tr></table>';
  const result = await transformTables(html, { ...config, maxRowsPerImage: 1 });
  assert.deepEqual(bodyValues(config.requests), ['甲', '乙']);
  assert.ok(config.requests.every(r => !r.html.includes('<thead>')));
  assert.ok(result.warnings.some(w => w.includes('没有可识别表头')));
});

test('cache uses content, width and style and serves repeated tables from one PNG', async t => {
  const config = await setup(t);
  const first = await transformTables(table(), config);
  const same = await transformTables(table(), config);
  assert.deepEqual(first.assets, same.assets);
  assert.equal(config.requests.length, 1);
  const repeated = await transformTables(table() + table(), config);
  assert.equal(repeated.assets.length, 1);
  assert.equal(config.requests.length, 1);
  const changed = await transformTables(table().replace('内容1', '修改内容'), config);
  const width = await transformTables(table(), { ...config, width: 800 });
  const style = await transformTables(table(), { ...config, fontSize: 20 });
  const renderer = await transformTables(table(), { ...config, rendererCacheKey: 'v2' });
  assert.equal(new Set([first, changed, width, style, renderer].map(r => r.assets[0].filename)).size, 5);
});

test('input count, row, character, option and structure limits fail explicitly before rendering', async t => {
  const config = await setup(t);
  const cases = [
    ['x'.repeat(TABLE_IMAGE_LIMITS.inputBytes + 1), /4 MiB/],
    [table().repeat(21), /表格数/],
    [table(1001), /行数/],
    [`<table><tr><td>${'长'.repeat(10001)}</td></tr></table>`, /单元格/],
    [`<table>${'<tr><td>'.concat('x'.repeat(9000), '</td></tr>').repeat(12)}</table>`, /字数/],
    ['<table><tr><td><table><tr><td>嵌套</td></tr></table></td></tr></table>', /嵌套/],
    ['<table><tr><td rowspan="0">内容</td></tr></table>', /rowspan/],
    ['<table><tr><td colspan="25">内容</td></tr></table>', /范围/],
    ['<table></table>', /没有数据行/],
    ['<table><tr><td>数据</td></tr><p>不能丢失的文本</p></table>', /单元格外/],
    ['<table><tr><td>数据</td>不能丢失的文本</tr></table>', /单元格外/],
    [`<table><tr><td>${'<div>'.repeat(70)}字${'</div>'.repeat(70)}</td></tr></table>`, /过深/],
  ];
  for (const [html, message] of cases) await assert.rejects(transformTables(html, config), message);
  await assert.rejects(transformTables(table(), { ...config, width: '1000;url(evil)' }), /width/);
  await assert.rejects(transformTables(table(), { ...config, maxRowsPerImage: 0 }), /maxRowsPerImage/);
  assert.equal(config.requests.length, 0);
});

test('cannot clip a single oversized row/header or split a merged cell', async t => {
  const config = await setup(t);
  await assert.rejects(transformTables(table(1), { ...config,
    renderTable: async () => { throw Object.assign(new Error('height'), { code: 'TABLE_IMAGE_TOO_TALL' }); },
  }), /无法无损分段/);
  const merged = '<table><tr><td rowspan="2">合并</td><td>一</td></tr><tr><td>二</td></tr></table>';
  await assert.rejects(transformTables(merged, { ...config, maxRowsPerImage: 1 }), /合并单元格跨越/);
});

test('rejects path traversal, symlink directories and symlinked cached images', async t => {
  const config = await setup(t);
  for (const assetsRoot of ['relative', '/tmp/test/../outside', '/', '/tmp/evil\0dir']) {
    await assert.rejects(transformTables(table(), { ...config, assetsRoot }), /目录|路径/);
  }
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'table-images-outside-'));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  await fs.symlink(outside, path.join(config.assetsRoot, 'table-images'));
  await assert.rejects(transformTables(table(), config), /符号链接/);
  assert.deepEqual(await fs.readdir(outside), []);
  await fs.unlink(path.join(config.assetsRoot, 'table-images'));
  const valid = await transformTables(table(), config);
  const target = valid.assets[0].absolutePath;
  await fs.unlink(target);
  const outsideFile = path.join(outside, 'original.png');
  await fs.writeFile(outsideFile, PNG);
  await fs.symlink(outsideFile, target);
  await assert.rejects(transformTables(table(), config), /符号链接/);
  assert.deepEqual(await fs.readFile(outsideFile), PNG);
});

test('bad PNG, untrusted exception detail and renderer timeout never produce successful assets', async t => {
  const config = await setup(t);
  await assert.rejects(transformTables(table(), { ...config, renderTable: async () => Buffer.from('<svg/>') }), /完整 PNG/);
  await assert.rejects(transformTables(table(), { ...config, renderTable: async () => { throw new Error('token=secret'); } }), error => {
    assert.match(error.message, /渲染或缓存失败/);
    assert.ok(!error.message.includes('secret'));
    return true;
  });
  await assert.rejects(transformTables(table(), { ...config, timeoutMs: 100, renderTable: () => new Promise(() => {}) }), /超时/);
  assert.deepEqual(await fs.readdir(path.join(config.assetsRoot, 'table-images')), []);
});

test('built-in browser renderer disables JavaScript, network, service workers and downloads', async t => {
  const config = await setup(t);
  let launchOptions, contextOptions, routePattern, closed = false, abortCode;
  const page = {
    setDefaultTimeout() {},
    async setContent(html) { assert.doesNotMatch(html, /evil\.invalid/); },
    locator() { return { boundingBox: async () => ({ width: 1000, height: 200 }), evaluate: async () => false, screenshot: async () => PNG }; },
  };
  const chromium = { launch: async opts => {
    launchOptions = opts;
    return { close: async () => { closed = true; }, newContext: async opts2 => {
      contextOptions = opts2;
      return { route: async (pattern, handler) => {
        routePattern = pattern;
        await handler({ abort: code => { abortCode = code; } });
      }, newPage: async () => page };
    } };
  } };
  const { renderTable, ...rest } = config;
  await transformTables(table(), { ...rest, chromium });
  assert.equal(launchOptions.headless, true);
  assert.equal(contextOptions.javaScriptEnabled, false);
  assert.equal(contextOptions.offline, true);
  assert.equal(contextOptions.serviceWorkers, 'block');
  assert.equal(contextOptions.acceptDownloads, false);
  assert.equal(routePattern, '**/*');
  assert.equal(abortCode, 'blockedbyclient');
  assert.equal(closed, true);
  page.locator = () => ({ boundingBox: async () => ({ width: 1000, height: 200 }), evaluate: async () => true,
    screenshot: async () => { assert.fail('must not screenshot overflow'); } });
  await assert.rejects(transformTables(table(4), { ...rest, chromium }), /横向溢出/);
});

// Opt in once: RUN_TABLE_IMAGE_CHROME=1 node --test publisher-dashboard/test/table-images.test.js
// TABLE_IMAGES_SMOKE_DIR can preserve only the generated PNGs for visual review.
test('real Chrome screenshot smoke: Chinese text, repeated headers and wrapped long cells', {
  skip: process.env.RUN_TABLE_IMAGE_CHROME !== '1', timeout: 60000,
}, async t => {
  const config = await setup(t);
  const assetsRoot = process.env.TABLE_IMAGES_SMOKE_DIR || config.assetsRoot;
  const html = `<h1>不变的原稿</h1><table><caption>方案对比：原文保真核验</caption><thead><tr><th>条目编号</th><th>完整说明</th></tr></thead><tbody>${Array.from({ length: 13 }, (_, i) => `<tr><td>第 ${i + 1} 条</td><td>${i === 4 ? '长单元格中文必须完整换行。'.repeat(28) : `这是第 ${i + 1} 行的内容，包括标点 &amp; 特殊字符。`}${i === 12 ? ' 末行核验-END-13' : ''}</td></tr>`).join('')}</tbody></table><p>结尾保留</p>`;
  const output = await transformTables(html, { assetsRoot, width: 1000, maxHeight: 1400, maxRowsPerImage: 5 });
  assert.ok(output.assets.length >= 3);
  assert.ok(output.html.includes('结尾保留'));
  for (const asset of output.assets) {
    const data = await fs.readFile(asset.absolutePath);
    assert.equal(data.readUInt32BE(16), 1000);
    assert.ok(data.readUInt32BE(20) <= 1400);
    assert.ok(data.length > 5000);
  }
  t.diagnostic(`真实 Chrome 已生成 ${output.assets.length} 张 PNG：${output.assets.map(a => a.absolutePath).join(', ')}`);
});
