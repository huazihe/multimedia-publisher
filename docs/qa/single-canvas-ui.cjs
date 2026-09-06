// Read-only live UI audit. Only local preview POSTs are allowed; no saves or deliveries.
// node this-file.cjs /path/to/playwright /path/to/output [origin]
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.argv[2]);
const output = path.resolve(process.argv[3]);
const origin = process.argv[4] || 'http://127.0.0.1:18810';
fs.mkdirSync(output, { recursive: true });
const report = { checks: [], sizes: [], pageErrors: [], blocked: [] };
let browser;
(async () => {
  const before = (await (await fetch(origin + '/api/bootstrap')).json()).data;
  const catalog = await (await fetch(origin + '/api/layout-templates')).json();
  assert.equal(catalog.catalogVersion, 1);
  browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  await context.route('**/*', route => {
    const r = route.request(), u = new URL(r.url());
    if (u.origin !== origin || (!['GET','HEAD'].includes(r.method()) && !/\/draft-preview$/.test(u.pathname))) {
      report.blocked.push(r.method() + ' ' + u.pathname); return route.abort();
    }
    return route.continue();
  });
  const page = await context.newPage();
  page.on('pageerror', e => report.pageErrors.push(e.message));
  await page.goto(origin, { waitUntil: 'networkidle' });
  await page.locator('#content-editor-panel').waitFor();
  const article = page.locator('[data-action="select-content"][data-id="content_mtodu8cs_5wr16x"]');
  if (await article.count()) await article.click();
  const body = page.locator('.content-editor');
  const original = await body.innerHTML();
  await body.fill('仅在浏览器中测试的未保存正文');
  await page.getByRole('tab', { name: '平台预览', exact: true }).click();
  assert.equal(await body.isVisible(), false);
  await page.getByRole('tab', { name: '编辑正文', exact: true }).click();
  assert.equal(await body.innerText(), '仅在浏览器中测试的未保存正文');
  await body.evaluate((el, html) => { el.innerHTML = html; el.dispatchEvent(new Event('input', { bubbles: true })); }, original);
  report.checks.push('Tab switches preserve unsaved text without saving');
  await page.reload({ waitUntil: 'networkidle' });
  if (await article.count()) await article.click();
  await page.getByRole('tab', { name: '平台预览', exact: true }).click();
  await page.locator('#wechat-template-select option').first().waitFor({ state: 'attached' });
  const labels = await page.locator('#wechat-template-select option').allTextContents();
  assert.equal(labels.length, 26);
  assert.equal(new Set(labels.map(x=>x.trim())).size, 26);
  assert.ok(labels.every(x => !/样式\s*\d|模板\s*\d|style_\d/.test(x)));
  const featured = ['weixin','woshipm','sspai','xiaohongshu','uisdc','douyin'];
  assert.deepEqual(await page.locator('.platform-preview-tabs [role="tab"]').evaluateAll(els=>els.map(e=>e.dataset.platform)), featured);
  assert.deepEqual((await page.locator('[data-platform-preview-select] option').evaluateAll(els=>els.map(e=>e.value))).slice(0,featured.length), featured);
  report.checks.push('26 named styles; six featured platforms in confirmed order');
  await page.locator('.platform-preview-iframe').waitFor({ timeout: 30000 });
  await page.locator('[data-action="toggle-content-library"]').click();
  assert.equal(await page.locator('#content-library').isVisible(), false);
  await page.locator('[data-action="toggle-sidebar"]').click();
  assert.equal(await page.locator('body').evaluate(e=>e.classList.contains('sidebar-collapsed')), true);
  for (const mode of ['preview','edit']) {
    await page.getByRole('tab',{name:mode==='preview'?'平台预览':'编辑正文',exact:true}).click();
    for (const width of [1440,1024,768,390,320]) {
      await page.setViewportSize({width,height:1000});
      await page.waitForFunction(w=>innerWidth===w,width);
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      if(mode==='preview') {
        await page.locator('.platform-preview-frame').scrollIntoViewIfNeeded();
        const text=await page.frameLocator('.platform-preview-iframe').locator('body').innerText();
        assert.ok(text.length>500,'actual iframe text must be rendered');
      }
      const metrics = await page.evaluate(mode=>({mode,width:innerWidth,scroll:document.documentElement.scrollWidth,
        canvas:document.querySelector(mode==='preview'?'.platform-preview-frame':'.content-editor').getBoundingClientRect().width,
        panel:document.querySelector('.content-detail-panel').getBoundingClientRect().width}),mode);
      report.sizes.push(metrics);
      assert.ok(metrics.scroll<=width,JSON.stringify(metrics));
      if (width===1440) assert.ok(metrics.canvas>850,JSON.stringify(metrics));
      if (width<=390) assert.ok(metrics.canvas>width*.75,JSON.stringify(metrics));
      if ([1440,390].includes(width)) { await page.evaluate(()=>scrollTo(0,0)); await page.screenshot({path:path.join(output,`${mode}-${width}.png`),fullPage:true}); if(mode==='preview')await page.locator('.platform-preview-frame').screenshot({path:path.join(output,`canvas-${width}.png`)}); }
    }
  }
  await page.locator('[data-action="toggle-sidebar"]').click();
  assert.equal(await page.locator('#workspace-navigation').isVisible(),true);
  await page.locator('[data-action="toggle-content-library"]').click();
  assert.equal(await page.locator('#content-library').isVisible(),true);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  report.checks.push('Both modes at five widths without page overflow; navigation and article list reopen at 320px');
  await page.setViewportSize({width:1440,height:1000});
  await page.locator('[data-view="platforms"]').click();
  const loginOrder=await page.locator('[data-auth-grid] [data-platform]').evaluateAll(els=>els.map(e=>e.dataset.platform));
  report.loginOrder=loginOrder.slice(0,10);
  await page.locator('[data-view="plans"]').click();
  assert.deepEqual(await page.locator('[data-topic-platform]').evaluateAll(els=>els.map(e=>e.dataset.topicPlatform)),[...featured,'zhihu','toutiao']);
  report.checks.push('Topic radar includes sspai in shared priority order');
  const after = (await (await fetch(origin + '/api/bootstrap')).json()).data;
  for(const key of ['contents','jobs']) assert.deepEqual(after[key],before[key]);
  assert.deepEqual(report.pageErrors,[]);
  assert.ok(Array.isArray(before.contents) && Array.isArray(before.jobs));
  assert.ok(report.blocked.every(item=>item==='POST /api/platform-auth'));
  report.checks.push('Automatic credential checks blocked during read-only audit; original contents and jobs unchanged');
  report.ok=true;
})().catch(e=>{report.error=e.stack;process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();fs.writeFileSync(path.join(output,'single-canvas-ui.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));});
