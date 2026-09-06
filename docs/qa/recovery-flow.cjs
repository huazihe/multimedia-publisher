// node recovery-flow.cjs /path/to/playwright /path/to/evidence
// All database, journal, browser recovery and publishing side effects are isolated.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'creator-recovery-ui-'));
process.env.PUBLISHER_DB=path.join(scratch,'db.sqlite');process.env.PUBLISHER_DATA_DIR=scratch;
process.env.PUBLISHER_OPERATIONS_FILE=path.join(scratch,'default-journal.json');process.env.WEIBOT_COOKIE_FILE=path.join(scratch,'no-cookies.json');
const app=require('../../publisher-dashboard/server');const {chromium}=require(process.argv[2]);
const out=path.resolve(process.argv[3]);fs.mkdirSync(out,{recursive:true});
const report={checks:[],errors:[],publisherModes:[],browserActions:[]};let browser,server;
const xhs='xiaohongshu',url='https://creator.xiaohongshu.com/publish/publish?source=official';
const ws=(id,p)=>`ws://127.0.0.1:${p}/devtools/browser/${id}`;
let session={platform:xhs,port:9444,browserPath:'/fake/chrome',userDataDir:'/fake/profile',webSocketDebuggerUrl:ws('original',9444)},closed=false,activePort=9444,identity=session.webSocketDebuggerUrl;
(async()=>{
  const content=app.importContent({title:'恢复流程验收稿',body:'<p>原始正文</p>',filename:'recovery-test.html',format:'html'});
  server=app.createDashboardServer({operationsFile:path.join(scratch,'ops.json'),preflight:async()=>null,
    previewRunner:async args=>JSON.stringify({platform:args[3],title:content.title,format:'html',content:'<p>本地模拟预览</p>',htmlPreview:'<p>本地模拟预览</p>',imageCount:0,warnings:[],limits:{}}),
    platformPublisher:async(_file,platform,_title,mode)=>{report.publisherModes.push(mode);closed=true;return{output:'',info:{status:'uncertain',url,message:'隔离模拟：没有最终发布回执'}}},
    recoveryDependencies:{readSession:()=>session,profileExists:()=>true,requiresSession:p=>p===xhs,
      readVersion:async port=>{if(closed||port!==activePort)throw Object.assign(new Error('closed'),{cause:{code:'ECONNREFUSED'}});return{Browser:'Chrome/test',webSocketDebuggerUrl:identity}},
      opener:async(s,target)=>{report.browserActions.push('reopen');assert.equal(s.userDataDir,'/fake/profile');assert.equal(target,url);closed=false;activePort=9555;identity=ws('reopened',9555);return{port:activePort,webSocketDebuggerUrl:identity}},
      writeSession:s=>{session=s},browserCommand:async(_ws,method)=>{report.browserActions.push(method);return method==='Target.getTargets'?{targetInfos:[{type:'page',targetId:'original-tab',url}]}:{targetId:'new-tab'}},probeTimeoutMs:100,reopenTimeoutMs:200}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  page.on('dialog',dialog=>dialog.accept()); // Confirm isolated draft preparation only.
  await page.route('**/*',route=>{const u=new URL(route.request().url());return u.origin===origin&&!/platform-auth|platform-login/.test(u.pathname)?route.continue():route.abort()});
  page.on('pageerror',e=>report.errors.push(e.message));await page.goto(origin,{waitUntil:'networkidle'});
  await page.locator(`[data-action="select-content"][data-id="${content.id}"]`).click();
  await page.locator('[data-view="publish"]').click();await page.locator('[data-platform-choice="xiaohongshu"]').check();
  await page.locator('[data-action="publish-selected"]').click();
  await page.waitForFunction(()=>[...document.querySelectorAll('#publish-progress .result-status-label')].some(n=>n.textContent==='结果待核对'));
  assert.equal(report.publisherModes.length,1);
  const retry=page.waitForResponse(r=>r.url().endsWith('/api/publish')&&r.status()===409);
  await page.locator('[data-action="publish-selected"]').click();const response=await retry;assert.equal((await response.json()).code,'PUBLISH_UNCERTAIN');
  assert.equal(await page.evaluate(()=>state.contentCanonicalConflicts.size),0);assert.equal(report.publisherModes.length,1);
  report.checks.push('Repeat publish is blocked as uncertain, not a document-version conflict; only one mock publish occurred');
  await page.locator('#view-publish .recovery-banner [data-action="open-publish-recovery"]').click();
  await page.getByRole('button',{name:'重新打开平台窗口',exact:true}).waitFor();
  await page.getByRole('button',{name:'重新打开平台窗口',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#publish-recovery-body')?.textContent.includes('已沿原登录目录重开浏览器'));
  assert.equal(report.publisherModes.length,1);assert.deepEqual(report.browserActions,['reopen']);
  report.checks.push('Reopening the closed window preserves the original profile and does not resubmit');
  await page.locator('[data-confirm-not-submitted]').check();await page.locator('[data-action="confirm-recovery-not-submitted"]').click();
  await page.locator('[data-action="prepare-after-recovery"]').waitFor();assert.equal(report.publisherModes.length,1);
  await page.locator('[data-action="prepare-after-recovery"]').click();await page.locator('#platform-publish-dialog[open]').waitFor();
  assert.match(await page.locator('#single-publish-mode').innerText(),/填入平台编辑器/);assert.equal(report.publisherModes.length,1);
  await page.locator('#platform-publish-dialog [data-action="cancel-single-publish"]').last().click();
  report.checks.push('Human declaration unlocks only preparation, opening a draft confirmation; it never auto-publishes');
  await page.locator('[data-view="content"]').click();const editor=page.locator(`[data-content-body="${content.id}"]`);await editor.fill('本页未保存的版本');
  const current=app.getDashboardData().contents.find(c=>c.id===content.id);
  app.updateContent(content.id,{title:current.title,summary:current.summary,body:'<p>另一个标签页保存的版本</p>',expectedUpdatedAt:current.updated_at});
  await page.locator('[data-view="publish"]').click();await page.waitForFunction(()=>state.contentCanonicalConflicts.size===1);
  assert.equal(await editor.innerText(),'本页未保存的版本');
  await page.locator('#view-content .recovery-banner [data-action="open-publish-recovery"]').click();
  await page.locator('[data-action="restore-working-copy"]').waitFor();await page.locator('[data-action="restore-working-copy"]').click();
  await page.waitForFunction(()=>document.querySelector('#publish-recovery-body')?.textContent.includes('已保留恢复副本并载入最新稿'));
  const copies=app.getDashboardData().contents.filter(c=>c.id!==content.id&&c.title.includes('恢复副本'));
  assert.equal(copies.length,1);assert.match(copies[0].body,/本页未保存的版本/);
  assert.match(app.getDashboardData().contents.find(c=>c.id===content.id).body,/另一个标签页保存的版本/);
  assert.equal(await editor.innerText(),'另一个标签页保存的版本');assert.equal(await page.evaluate(()=>state.contentCanonicalConflicts.size),0);
  await page.locator('[data-action="restore-working-copy"]').click();await page.waitForFunction(()=>document.querySelector('#publish-recovery-body')?.textContent.includes('本页内容与保存稿一致'));
  assert.equal(app.getDashboardData().contents.filter(c=>c.id!==content.id&&c.title.includes('恢复副本')).length,1);
  report.checks.push('Real version conflict preserves local edits as a durable copy; original uses the newer version; repeat recovery creates no extra copy');
  await page.locator('[data-action="close-publish-recovery"]').click();
  assert.equal(await page.locator('[data-employee-picker]').count(),0);
  const toggle=page.locator('[data-action="toggle-sidebar"]');assert.equal((await toggle.innerText()).trim(),'');assert.equal(await toggle.evaluate(e=>!!e.closest('#workspace-navigation')),true);
  await toggle.click();assert.equal(await page.locator('.brand-copy').isVisible(),false);assert.equal(await toggle.isVisible(),true);await toggle.click();
  await page.screenshot({path:path.join(out,'recovery-desktop.png')});
  for(const width of [390,320]){await page.setViewportSize({width,height:900});await toggle.click();assert.equal(await toggle.isVisible(),true);assert.equal(await page.locator('.topnav').isVisible(),false);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await toggle.click();assert.equal(await page.locator('.topnav').isVisible(),true)}
  await page.screenshot({path:path.join(out,'recovery-mobile.png')});
  report.checks.push('No virtual employees; icon-only sidebar control works expanded/collapsed at desktop and 390/320px');
  assert.deepEqual(report.errors,[]);report.ok=true;
})().catch(e=>{report.error=e.stack;process.exitCode=1}).finally(async()=>{if(browser)await browser.close();if(server?.listening)await new Promise(r=>server.close(r));app.db.close();fs.writeFileSync(path.join(out,'recovery-flow.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))});
