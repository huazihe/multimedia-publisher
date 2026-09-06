'use strict';
const assert=require('node:assert/strict');const {test,after}=require('node:test');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const xhsSource=path.resolve(__dirname,'../../packages/core/src/adapters/platforms/xiaohongshu.ts');
function mockXhsSource(t,read){
  const original=fs.readFileSync;
  t.mock.method(fs,'readFileSync',(file,...args)=>file===xhsSource?read():original(file,...args));
}
const {ACTIVE_PLATFORM_IDS,INDUSTRY_PLATFORM_IDS,catalogPlatforms}=require('../platform-catalog');
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'platform-catalog-'));
process.env.PUBLISHER_DB=path.join(scratch,'db.sqlite');process.env.PUBLISHER_DATA_DIR=scratch;
process.env.PUBLISHER_OPERATIONS_FILE=path.join(scratch,'ops.json');
const app=require('../server');after(()=>{app.db.close();fs.rmSync(scratch,{recursive:true,force:true});});

test('catalog keeps general writing platforms and removes industry from active lists without mutating records',()=>{
  const rows=[...ACTIVE_PLATFORM_IDS,...INDUSTRY_PLATFORM_IDS,'xueqiu','eastmoney','51cto','imooc','oschina','segmentfault'].reverse().map(id=>({id,name:id,auth_status:'logged_in'}));
  const original=JSON.stringify(rows);const result=catalogPlatforms(rows);
  assert.equal(result.length,21);assert.deepEqual(result.map(p=>p.id),ACTIVE_PLATFORM_IDS);
  assert.deepEqual(['general','technical','tool'].map(g=>result.filter(p=>p.catalog_group===g).length),[16,4,1]);
  assert.ok(INDUSTRY_PLATFORM_IDS.every(id=>!result.some(p=>p.id===id)));assert.equal(JSON.stringify(rows),original);
  for(const id of ['jianshu','netease']){const item=result.find(p=>p.id===id);assert.equal(item.delivery_mode,'manual');assert.equal(item.auto_check_auth,false);assert.match(item.manual_url,/^https:/)}
});

test('catalog describes preparation capabilities consistently without changing legacy delivery modes',t=>{
  mockXhsSource(t,()=>'// local adapter fixture');
  const result=catalogPlatforms(ACTIVE_PLATFORM_IDS.map(id=>({id})));
  for(const item of result){
    const expected=['uisdc','jianshu','netease'].includes(item.id)?'manual'
      :['xiaohongshu','toutiao','douban'].includes(item.id)?'editor'
      :['douyin','qiehao'].includes(item.id)?'draft-text'
      :item.id==='zip-download'?'export':'draft';
    assert.equal(item.preparation_mode,expected,item.id);
    assert.equal(item.supports_direct,false,item.id);
    assert.ok(item.preparation_label?.length,item.id);
    assert.equal(item.delivery_mode,expected==='manual'?'manual'
      :['weixin','woshipm','sspai'].includes(item.id)?'draft':'adapter',item.id);
  }
  for(const mode of ['manual','editor','draft-text','draft','export']){
    assert.equal(new Set(result.filter(item=>item.preparation_mode===mode).map(item=>item.preparation_label)).size,1);
  }
});

for(const state of ['missing','fallback','local']){
  test(`xiaohongshu ${state} source selects the matching preparation capability without changing its record`,t=>{
    mockXhsSource(t,()=>{
      if(state==='missing') throw Object.assign(new Error('missing optional adapter'),{code:'ENOENT'});
      return state==='fallback'?'// PUBLIC_MANUAL_FALLBACK\nthrow new Error("must not execute source");':'// local adapter fixture';
    });
    const row={id:'xiaohongshu',auth_status:'logged_in',account:'keep-local-account'};
    const result=catalogPlatforms([row])[0];
    assert.equal(result.delivery_mode,state==='local'?'adapter':'manual');
    assert.equal(result.preparation_mode,state==='local'?'editor':'manual');
    assert.equal(result.auto_check_auth,state==='local');
    assert.equal(result.supports_direct,false);
    if(state!=='local'){
      assert.equal(result.preparation_label,'公开版：手工操作');
      assert.equal(result.manual_url,'https://creator.xiaohongshu.com/publish/publish?source=official');
    }
    assert.deepEqual(row,{id:'xiaohongshu',auth_status:'logged_in',account:'keep-local-account'});
  });
}

test('active APIs retain legacy history and login metadata but reject new legacy/manual publishing',async t=>{
  const content=app.importContent({title:'旧平台兼容验证',body:'原稿不可改写',format:'markdown'});
  app.db.prepare('UPDATE contents SET selected_platforms=? WHERE id=?').run(JSON.stringify(['china-vision','weixin']),content.id);
  app.db.prepare('UPDATE platforms SET auth_status=?,account=? WHERE id=?').run('logged_in','kept-account','china-vision');
  const before=app.db.prepare('SELECT * FROM contents WHERE id=?').get(content.id);
  const at=new Date().toISOString();
  app.db.prepare('INSERT INTO publish_jobs(id,content_id,title,status,platforms,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('legacy-job',content.id,content.title,'published','["china-vision"]',at,at);
  app.db.prepare('INSERT INTO publish_results(id,job_id,platform,status,message,created_at) VALUES(?,?,?,?,?,?)').run('legacy-result','legacy-job','china-vision','success','历史结果',at);
  let calls=0;const server=app.createDashboardServer({operationsFile:path.join(scratch,'api-ops.json'),preflight:async()=>null,platformPublisher:async()=>{calls++;throw new Error('must not publish')}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const origin='http://127.0.0.1:'+server.address().port;
  const {data}=await(await fetch(origin+'/api/bootstrap')).json();
  assert.equal(data.platforms.length,21);assert.equal(data.platformLabels['china-vision'],'中国机器视觉网');
  assert.ok(!data.platforms.some(p=>INDUSTRY_PLATFORM_IDS.includes(p.id)));
  const platforms=await(await fetch(origin+'/api/platforms')).json();assert.equal(platforms.platforms.length,21);
  const history=await(await fetch(origin+'/api/history')).json();assert.ok(history.jobs.some(j=>j.id==='legacy-job'&&j.results[0].platform==='china-vision'));
  const post=(route,body)=>fetch(origin+route,{method:'POST',headers:{'Content-Type':'application/json','X-Workbench-CSRF':data.csrfToken},body:JSON.stringify(body)});
  const auth=await(await post('/api/platform-auth',{platform:'china-vision'})).json();assert.equal(auth.skippedInactive,true);assert.equal(auth.platform.auth_status,'logged_in');
  for(const platform of ['china-vision','jianshu','netease']){
    const response=await post('/api/publish',{contentId:content.id,platforms:[platform],publishMode:'draft',operationId:`catalog-${platform}-operation-0001`,expectedUpdatedAt:before.updated_at});
    assert.equal(response.status,400);assert.match((await response.json()).error,/退出常用|手工/);
  }
  assert.equal(calls,0);assert.deepEqual(app.db.prepare('SELECT * FROM contents WHERE id=?').get(content.id),before);
  assert.equal(app.db.prepare('SELECT account FROM platforms WHERE id=?').get('china-vision').account,'kept-account');
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM publish_jobs').get().n,1);
});
