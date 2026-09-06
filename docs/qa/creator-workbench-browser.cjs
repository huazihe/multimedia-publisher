// Run with: node this-file.cjs /absolute/path/to/playwright /absolute/evidence-directory
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const repo = path.resolve(__dirname, '../..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'creator-workbench-qa-'));
const output = process.argv[3] || temp;
fs.mkdirSync(output, { recursive: true });
process.env.PUBLISHER_DB = path.join(temp, 'isolated.sqlite');
process.env.PUBLISHER_OPERATIONS_FILE = path.join(temp, 'operations.json');
process.env.WEIBOT_COOKIE_FILE = path.join(temp, 'no-credentials.json');
const app = require(path.join(repo, 'publisher-dashboard/server.js'));
const { chromium } = require(process.argv[2]);
const report = { checks: [], screenshots: [], page_errors: [] };
let browser;
(async () => {
  const content = app.importContent({ filename: 'check.md', body: '# 创作工作台检查用稿\n\n需要保留的原稿正文。\n\n| 标题 | 值 |\n|---|---|\n| 示例 | 1 |\n\n![测试图片](assets/missing.png)' });
  await new Promise((resolve, reject) => { app.server.once('error', reject); app.server.listen(0, '127.0.0.1', resolve); });
  const origin = 'http://127.0.0.1:' + app.server.address().port;
  browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  await context.route('**/*', route => {
    const u = new URL(route.request().url());
    if (u.origin !== origin || /publish-platform|\/api\/publish|platform-login|platform-open/.test(u.pathname)) return route.abort();
    return route.continue();
  });
  const page = await context.newPage();
  page.on('pageerror', err => report.page_errors.push(err.message));
  await page.goto(origin, { waitUntil: 'networkidle' });
  await page.locator('#view-content.active .content-detail-panel').waitFor();
  assert.equal(await page.title(), '创作者工作台');
  report.checks.push('Content-first entry visible');
  await page.locator('.article-metadata summary').click();
  const titleField = page.locator('#canonical-title-editor');
  await titleField.fill('工作台保存与预览验证');
  await page.locator(`[data-save-content-button="${content.id}"]`).click();
  await page.waitForFunction(() => document.querySelector('.content-title-block h2')?.textContent === '工作台保存与预览验证');
  await page.locator('.platform-preview-summary').waitFor();
  assert.match(app.db.prepare('SELECT title FROM contents WHERE id=?').get(content.id).title, /保存与预览/);
  report.checks.push('Metadata edit saves and preserves article');
  await page.locator('[data-platform-preview-select]').selectOption('woshipm');
  await page.getByText('当前适配器尚未将表格转成图片，投递前需要处理。', { exact: true }).waitFor();
  assert.match(await page.locator('.preview-warning-box').innerText(), /本地或相对图片引用/);
  report.checks.push('Missing asset and table conversion states visible');
  await page.locator('[data-action="open-platform-direct"]').click();
  await page.locator('#platform-publish-dialog[open]').waitFor();
  await page.locator('#platform-publish-dialog [data-action="cancel-single-publish"]').last().click();
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM publish_jobs').get().n, 0);
  report.checks.push('Publish confirmation cancels without delivery');
  report.sizes = [];
  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.waitForFunction(w => innerWidth === w, width);
    const metrics = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth,
      bg: getComputedStyle(document.body).backgroundColor,
      panelShadow: getComputedStyle(document.querySelector('.content-detail-panel')).boxShadow }));
    assert.ok(metrics.scroll <= metrics.width, JSON.stringify(metrics));
    assert.equal(metrics.bg, 'rgb(255, 255, 255)');
    assert.equal(metrics.panelShadow, 'none');
    report.sizes.push(metrics);
    if ([1440, 390].includes(width)) {
      const name = `isolated-${width}.png`;
      await page.screenshot({ path: path.join(output, name), fullPage: true });
      report.screenshots.push(name);
    }
  }
  assert.deepEqual(report.page_errors, []);
  report.checks.push('Five viewport widths without page overflow; white surfaces and flat panels');
  report.publish_jobs = app.db.prepare('SELECT COUNT(*) AS n FROM publish_jobs').get().n;
  report.ok = true;
})().catch(err => { report.error = err.message; process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  if (app.server.listening) await new Promise(resolve => app.server.close(resolve));
  app.db.close();
  fs.writeFileSync(path.join(output, 'browser-check.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
});
