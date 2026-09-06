'use strict';
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const assert=require('node:assert/strict');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'workbench-flow-'));
process.env.PUBLISHER_DB=path.join(temp,'db.sqlite');process.env.PUBLISHER_OPERATIONS_FILE=path.join(temp,'operations.json');
const repo=path.resolve(__dirname,'../..');const app=require(path.join(repo,'publisher-dashboard/server.js'));
const {chromium}=require(process.argv[2]);const out=path.resolve(process.argv[3]||temp);fs.mkdirSync(out,{recursive:true});
const report={checks:[],pageErrors:[]};let browser,server;
(async()=>{
 const content=app.importContent({title:'隔离交互验证',filename:'test.md',body:'# 隔离交互验证\n\n初始正文',summary:''});
 const original=app.db.prepare('SELECT body,updated_at FROM contents WHERE id=?').get(content.id);
 server=app.createDashboardServer({operationsFile:path.join(temp,'flow-ops.json'),uploadsDir:path.join(temp,'uploads'),topicRoot:path.join(temp,'topics'),
  previewRunner:async args=>{const source=fs.readFileSync(args[1],'utf8');const text=source.includes('未保存B')?'未保存B':source.includes('未保存A')?'未保存A':'初始正文';if(text==='未保存A')await new Promise(r=>setTimeout(r,1600));return JSON.stringify({platform:args[3],title:'隔离交互验证',format:'html',content:'<p>'+text+'</p>',htmlPreview:'<p>'+text+'</p>',imageCount:0,warnings:[],limits:{},article:{title:'隔离交互验证',html:'<p>'+text+'</p>'}});},
  topicCollector:async()=>({collectedAt:new Date().toISOString(),platforms:[{id:'zhihu',status:'ok',items:[{title:'界面验证资料（合成，不是真实热点）',url:'https://www.zhihu.com/question/123'}]},{id:'xiaohongshu',status:'needs_login',reason:'隔离测试的登录限制',items:[]}]}),
  topicAnalyzer:async input=>({status:'ready',summary:'合成数据，仅验证交互',cards:[{id:'card1',topic:'候选选题交互验证',platforms:['zhihu'],reader_problem:'读者要做什么选择？',angle:'一个具体任务的比较',why_now:'仅为验收样本',reader_payoff:'可以核对的清单',evidence_ids:[input.signals[0].id],missing_evidence:['真实来源待补'],risk:'high'}]})});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
 await context.route('**/*',route=>new URL(route.request().url()).origin!==origin?route.abort():route.continue());
 const page=await context.newPage();page.on('pageerror',e=>report.pageErrors.push(e.message));await page.goto(origin,{waitUntil:'networkidle'});
 await page.locator('[data-action="select-content"][data-id="'+content.id+'"]').click();
 await page.getByRole('tab',{name:'平台预览',exact:true}).click();
 await page.locator('[data-platform-preview-select]').selectOption('zhihu');
 await page.getByRole('tab',{name:'编辑正文',exact:true}).click();
 const editor=page.locator('[data-content-body="'+content.id+'"]');
 await editor.fill('未保存A');await page.waitForRequest(r=>r.url().endsWith('/draft-preview'),{timeout:10000});
 await editor.fill('未保存B');await page.waitForFunction(()=>document.querySelector('.platform-preview-iframe')?.srcdoc.includes('未保存B'));
 await page.waitForTimeout(1800);assert.match(await page.locator('.platform-preview-iframe').getAttribute('srcdoc'),/未保存B/);
 assert.deepEqual(app.db.prepare('SELECT body,updated_at FROM contents WHERE id=?').get(content.id),original);
 report.checks.push('未保存预览显示最新B，延迟A响应不覆盖，数据库正文与版本不变');
 await page.getByRole('tab',{name:'平台预览',exact:true}).click();
 assert.equal(await editor.isVisible(),false);
 await page.getByRole('tab',{name:'编辑正文',exact:true}).click();
 assert.equal(await editor.innerText(),'未保存B');
 assert.deepEqual(app.db.prepare('SELECT body,updated_at FROM contents WHERE id=?').get(content.id),original);
 report.checks.push('编辑/预览Tab保留未保存正文，不触发保存');
 await page.getByRole('tab',{name:'平台预览',exact:true}).click();
 await page.screenshot({path:path.join(out,'unsaved-preview.png')});
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 report.checks.push('390px编辑预览无页面横向溢出');await page.setViewportSize({width:1440,height:1000});
 await page.locator('[data-view="plans"]').click();await page.locator('#topic-keyword').waitFor();
  await page.locator('[data-action="start-topic-research"]').click();await page.locator('[data-action="adopt-topic"]').waitFor({timeout:15000});
  await page.locator('[data-topic-adopt-date="card1"]').fill('2031-01-02');
 await page.locator('[data-action="adopt-topic"]').click();await page.waitForFunction(()=>[...document.querySelectorAll('[data-plan-field="topic"]')].some(el=>el.value==='候选选题交互验证'));
 assert.equal(app.db.prepare('SELECT COUNT(*) n FROM publish_jobs').get().n,0);
 report.checks.push('共用选题采集、受限状态、分析卡和采用到计划可操作；未生成发布任务');
 await page.screenshot({path:path.join(out,'topic-flow-isolated.png')});
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  report.checks.push('390px选题页无横向溢出');
  if(process.argv[4]){
    const bundle=path.resolve(process.argv[4]);await page.setViewportSize({width:1440,height:1000});
    await page.locator('[data-view="content"]').click();await page.locator('#view-content [data-action="open-import-dialog"]').click();
    await page.getByRole('tab',{name:'读取文件',exact:true}).click();
    await page.locator('#import-file-input').setInputFiles(path.join(bundle,'original.md'));
    await page.waitForFunction(()=>document.querySelector('#import-content-input').value.length>100);
    const images=fs.readdirSync(path.join(bundle,'assets')).filter(f=>/\.png$/.test(f)).map(f=>path.join(bundle,'assets',f));
    await page.locator('#import-images-input').setInputFiles(images);
    const wait=page.waitForResponse(r=>r.url().endsWith('/api/content/import-bundle'));
    await page.locator('[data-action="submit-import"]').click();const response=await wait;const data=await response.json();
    assert.equal(response.status(),200,JSON.stringify(data));assert.equal(data.assetCount,3);
    await page.waitForFunction(()=>[...document.querySelectorAll('.content-editor img')].length===3&&[...document.querySelectorAll('.content-editor img')].every(i=>i.complete&&i.naturalWidth>0));
    await page.screenshot({path:path.join(out,'md-and-images-import.png')});
    report.checks.push('真实飞书导出的MD通过文件选择器带入，三张原图全部匹配并可见（隔离数据库）');
  }
  assert.deepEqual(report.pageErrors,[]);report.ok=true;
})().catch(e=>{report.error=e.stack;process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();if(server?.listening)await new Promise(r=>server.close(r));app.db.close();fs.writeFileSync(path.join(out,'workbench-flow.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));});
