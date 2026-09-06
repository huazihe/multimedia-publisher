// node this-file.cjs /absolute/path/to/playwright /absolute/evidence-directory
// Read-only production-data check. Blocks publishing, saving and credential checks.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.argv[2]);const out=path.resolve(process.argv[3]);fs.mkdirSync(out,{recursive:true});
const origin='http://127.0.0.1:18810';const report={screens:[],errors:[]};let browser;
(async()=>{
  const before=(await(await fetch(origin+'/api/bootstrap')).json()).data;
  browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  await page.route('**/*',route=>{const r=route.request(),url=new URL(r.url());return url.origin===origin&&(r.method()==='GET'||url.pathname.endsWith('/draft-preview'))?route.continue():route.abort()});
  page.on('pageerror',e=>report.errors.push(e.message));await page.goto(origin,{waitUntil:'networkidle'});
  await page.locator('[data-action="select-content"][data-id="content_mtodu8cs_5wr16x"]').click();
  await page.getByRole('tab',{name:'平台预览',exact:true}).click();await page.locator('[data-platform-preview-select]').selectOption('woshipm');
  await page.locator('.platform-preview-iframe').waitFor({timeout:30000});
  const frame=page.frameLocator('.platform-preview-iframe');
  await frame.locator('img').first().waitFor();await frame.locator('img').evaluateAll(imgs=>Promise.all(imgs.map(i=>i.decode())));
  for(const [width,device] of [[1440,'desktop'],[1440,'mobile'],[390,'mobile'],[320,'mobile']]){
    await page.setViewportSize({width,height:1000});await page.locator(`[data-preview-device="${device}"]`).click();
    await frame.locator('img').first().waitFor();await frame.locator('img').evaluateAll(imgs=>Promise.all(imgs.map(i=>i.decode())));
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    const metrics=await frame.locator('body').evaluate(body=>{
      const main=body.querySelector('.workbench-reading-column'),r=main.getBoundingClientRect(),s=getComputedStyle(main);
      const left=r.left+parseFloat(s.paddingLeft),right=r.right-parseFloat(s.paddingRight);
      return {width:innerWidth,scroll:document.documentElement.scrollWidth,column:{left,right,width:right-left},images:[...body.querySelectorAll('img')].map(i=>{const b=i.getBoundingClientRect();return{width:b.width,height:b.height,left:b.left,right:b.right,naturalWidth:i.naturalWidth,naturalHeight:i.naturalHeight}})};
    });
    assert.equal(metrics.images.length,3);assert.ok(metrics.scroll<=metrics.width);
    for(const img of metrics.images){assert.equal(img.naturalWidth,1672);assert.equal(img.naturalHeight,941);assert.ok(img.left>=metrics.column.left-1&&img.right<=metrics.column.right+1);assert.ok(Math.abs(img.width/img.height-1672/941)<.01)}
    await page.evaluate(()=>scrollTo(0,0));const buttons=await page.locator('.platform-publish-actions').boundingBox(),preview=await page.locator('.platform-preview-live').boundingBox();
    assert.ok(buttons.y<preview.y);if(width===1440)assert.ok(buttons.y+buttons.height<1000);
    assert.equal(await page.locator('[data-action="open-platform-direct"]').isDisabled(),true);
    report.screens.push({viewportWidth:width,device,...metrics,buttonsY:buttons.y});
    await frame.locator('img').first().evaluate(img=>img.scrollIntoView({block:'center',behavior:'instant'}));
    await page.locator('.platform-preview-frame').evaluate(el=>el.scrollIntoView({block:'center',behavior:'instant'}));
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    await page.locator('.platform-preview-frame').screenshot({path:path.join(out,`image-${width}-${device}.png`)});
  }
  const after=(await(await fetch(origin+'/api/bootstrap')).json()).data;
  assert.deepEqual(after.contents,before.contents);assert.deepEqual(after.jobs,before.jobs);assert.deepEqual(report.errors,[]);
  report.canonicalAndJobsUnchanged=true;report.ok=true;
})().catch(e=>{report.error=e.stack;process.exitCode=1}).finally(async()=>{if(browser)await browser.close();fs.writeFileSync(path.join(out,'woshipm-preview-fit.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))});
