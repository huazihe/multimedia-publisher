// node docs/qa/batch-draft-flow.cjs /path/to/playwright /path/to/evidence
// Real dashboard/browser; isolated DB and fake publishers. No external platform writes.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'creator-batch-draft-'));
process.env.PUBLISHER_DB = path.join(scratch, 'db.sqlite');
process.env.PUBLISHER_DATA_DIR = scratch;
process.env.PUBLISHER_OPERATIONS_FILE = path.join(scratch, 'ops.json');
process.env.WEIBOT_COOKIE_FILE = path.join(scratch, 'no-cookies.json');
const app = require('../../publisher-dashboard/server');
const { chromium } = require(process.argv[2]);
const out = path.resolve(process.argv[3]);
fs.mkdirSync(out, { recursive: true });
const report = { checks: [], errors: [], calls: [] };
let browser, server;
(async () => {
  const content = app.importContent({ title: '多平台草稿验收稿', body: '只在隔离数据库验证，不会发布到真实平台。', format: 'markdown' });
  server = app.createDashboardServer({ operationsFile: path.join(scratch, 'journal.json'), preflight: async () => null,
    platformPublisher: async (_file, platform, _title, mode) => {
      report.calls.push({ platform, mode });
      return { output: '', info: { status: 'success', postId: `fake-${platform}`, url: `https://example.invalid/${platform}`, message: '隔离测试回执' } };
    },
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.origin === origin && !/platform-auth|platform-login/.test(url.pathname) ? route.continue() : route.abort();
  });
  page.on('pageerror', error => report.errors.push(error.message));
  await page.goto(origin, { waitUntil: 'networkidle' });
  await page.locator(`[data-action="select-content"][data-id="${content.id}"]`).click();
  await page.locator('[data-view="publish"]').click();
  for (const box of await page.locator('[data-platform-choice]:checked').all()) await box.uncheck();
  for (const id of ['weixin', 'woshipm', 'sspai']) await page.locator(`[data-platform-choice="${id}"]`).check();
  const draft = page.locator('[data-action="publish-selected"]');
  const direct = page.locator('[data-action="publish-selected-direct"]');
  assert.equal(await page.locator('[data-selected-platform-count]').innerText(), '已选择 3 项');
  assert.equal(await draft.isEnabled(), true); assert.equal(await direct.count(), 0);
  assert.equal(await page.locator('[data-platform-choice="uisdc"]').isDisabled(), true);
  report.checks.push('Three draft platforms selectable; automatic direct action absent, manual entries disabled');
  page.once('dialog', dialog => dialog.dismiss());
  await draft.click(); assert.equal(report.calls.length, 0);
  report.checks.push('Cancel causes no platform calls');
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await draft.scrollIntoViewIfNeeded();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow at ${width}`);
    assert.equal(await draft.isVisible(), true); assert.equal(await direct.count(), 0);
    await page.screenshot({ path: path.join(out, `batch-drafts-${width}.png`) });
  }
  report.checks.push('Draft action visible without horizontal overflow at 1440/768/390/320px');
  await page.setViewportSize({ width: 1440, height: 1000 });
  page.once('dialog', dialog => { assert.match(dialog.message(), /不会公开发布/); return dialog.accept(); });
  const draftResponse = page.waitForResponse(response => response.url().endsWith('/api/publish'));
  await draft.click(); const saved = await (await draftResponse).json();
  assert.equal(saved.job.status, 'draft_saved');
  assert.deepEqual(saved.job.results.map(result => [result.platform, result.status]), [
    ['weixin', 'platform_draft'], ['woshipm', 'platform_draft'], ['sspai', 'platform_draft'],
  ]);
  assert.deepEqual(report.calls, ['weixin', 'woshipm', 'sspai'].map(platform => ({ platform, mode: 'draft' })));
  await page.waitForFunction(() => !state.batchPublishSubmitting);
  assert.equal(await direct.count(), 0);
  assert.equal(await page.locator('#publish-progress').getByRole('button', {name:'检查草稿并发表',exact:true}).count(), 3);
  for (const id of ['weixin', 'woshipm', 'sspai']) await page.locator(`[data-platform-choice="${id}"]`).uncheck();
  await page.locator('[data-platform-choice="zhihu"]').check();
  await page.evaluate(() => publishContent(undefined, 'direct'));
  assert.equal(report.calls.length, 3);
  await page.locator('[data-view="content"]').click();
  await page.locator('[data-content-mode="preview"]').click();
  assert.equal(await page.locator('[data-action="open-platform-direct"]').count(), 0);
  report.checks.push('Three draft calls only; draft handoff links shown; stale direct action cannot submit; preview has no automatic publication');
  assert.deepEqual(report.errors, []);
  report.ok = true;
})().catch(error => { report.error = error.stack; process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  app.db.close();
  fs.rmSync(scratch, { recursive: true, force: true }); // This run's isolated fixtures only.
  fs.writeFileSync(path.join(out, 'batch-draft-flow.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
});
