'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'weibot-workbench-test-'));
process.env.PUBLISHER_DB = path.join(scratch, 'db.sqlite');
process.env.PUBLISHER_OPERATIONS_FILE = path.join(scratch, 'operations.json');
const dashboard = require('../server');
const assets = require('../content-assets');
const topics = require('../topic-research');
function pngChunk(type, data) {
  const bytes=Buffer.concat([Buffer.from(type),data]);let crc=0xffffffff;
  for(const byte of bytes){crc^=byte;for(let k=0;k<8;k++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  const len=Buffer.alloc(4);len.writeUInt32BE(data.length);const end=Buffer.alloc(4);end.writeUInt32BE((~crc)>>>0);
  return Buffer.concat([len,bytes,end]);
}
const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(1,0);ihdr.writeUInt32BE(1,4);ihdr[8]=8;ihdr[9]=6;
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),pngChunk('IHDR',ihdr),pngChunk('IDAT',require('node:zlib').deflateSync(Buffer.from([0,102,153,204,255]))),pngChunk('IEND',Buffer.alloc(0))]).toString('base64');
const uploads = path.join(scratch, 'uploads');
const servers = [];
after(async () => { for (const server of servers) if (server.listening) await new Promise(r=>server.close(r)); dashboard.db.close(); fs.rmSync(scratch,{recursive:true,force:true}); });
async function startServer(options={}) {
  const server=dashboard.createDashboardServer({uploadsDir:uploads,operationsFile:path.join(scratch,Math.random()+'.json'),...options});servers.push(server);
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
  const bootstrap=await(await fetch(origin+'/api/bootstrap')).json();
  return {origin,post:(url,body)=>fetch(origin+url,{method:'POST',headers:{'Content-Type':'application/json','Origin':origin,'X-Workbench-CSRF':bootstrap.data.csrfToken},body:JSON.stringify(body)})};
}
test('MD bundle imports original images at their existing positions and embeds only img resources for CLI',async()=>{
  const result=await dashboard.importContentBundle({filename:'稿件.md',body:'# 标题\n\n前文\n\n![图](配图/%E6%B5%8B%E8%AF%95.png)\n\n后文',assets:[{name:'测试.png',dataBase64:png}]},{uploadsDir:uploads});
  assert.equal(result.assetCount,1);assert.equal(result.content.images.length,1);assert.equal(result.content.summary,'');
  assert.ok(result.content.body.indexOf('前文')<result.content.body.indexOf('<img'));assert.ok(result.content.body.indexOf('<img')<result.content.body.indexOf('后文'));
  const prepared=dashboard.selectPlatformSourcePayload(result.content,'zhihu');assert.match(prepared.content,/data:image\/png;base64/);
  const code='<pre>&lt;img src="/uploads/not-a-file.png"&gt;</pre>';assert.equal(assets.inlineUploadedAssets(code,uploads),code);
});
test('missing or ambiguous local images reject bundle without creating content',async()=>{
  const before=dashboard.db.prepare('SELECT COUNT(*) n FROM contents').get().n;
  await assert.rejects(()=>dashboard.importContentBundle({filename:'x.md',body:'![图](a.png)',assets:[]},{uploadsDir:uploads}),/配图未找到/);
  const records=assets.storeAssets([{relativePath:'a/same.png',dataBase64:png},{relativePath:'b/same.png',dataBase64:png}],uploads);
  assert.throws(()=>assets.replaceBundleImages('<img src="same.png">',records),/重名/);
  assert.equal(dashboard.db.prepare('SELECT COUNT(*) n FROM contents').get().n,before);
});
test('asset validation rejects traversal, fake images and linked files outside the upload root',()=>{
  for(const name of ['../x.png','/tmp/x.png','a/../../x.png','%2e%2e/x.png','C:\\x.png'])assert.throws(()=>assets.storeAssets([{name,dataBase64:png}],uploads));
  assert.throws(()=>assets.storeAssets([{name:'bad.png',dataBase64:Buffer.from('<svg onload="alert(1)">').toString('base64')}],uploads),/仅支持/);
  const outside=path.join(scratch,'outside.png');fs.writeFileSync(outside,Buffer.from(png,'base64'));fs.symlinkSync(outside,path.join(uploads,'linked.png'));
  assert.throws(()=>assets.inlineUploadedAssets('<img src="/uploads/linked.png">',uploads),/越界/);
});
test('unsaved preview uses draft text without changing canonical article or publication records',async()=>{
  const content=dashboard.importContent({filename:'draft.md',body:'# 原稿\n\n旧正文'});
  let source;
  const app=await startServer({previewRunner:async args=>{source=fs.readFileSync(args[1],'utf8');return JSON.stringify({platform:'zhihu',title:'预览标题',format:'html',content:'<p>新正文</p>',htmlPreview:'<p>新正文</p>',imageCount:0,warnings:[],limits:{},article:{title:'预览标题',html:'<p>新正文</p>'}});}});
  const before=dashboard.db.prepare('SELECT * FROM contents WHERE id=?').get(content.id);
  const response=await app.post(`/api/content/${content.id}/draft-preview`,{title:'预览标题',summary:'',body:'<p>新正文</p>',platform:'zhihu'});
  assert.equal(response.status,200);const json=await response.json();assert.equal(json.preview.sourceState,'unsaved');assert.match(source,/新正文/);
  assert.deepEqual(dashboard.db.prepare('SELECT * FROM contents WHERE id=?').get(content.id),before);
  assert.equal(dashboard.db.prepare('SELECT COUNT(*) n FROM publish_jobs').get().n,0);
});
test('Feishu export integrates Markdown and media, and missing CSRF never invokes exporter',async()=>{
  const exportRoot=path.join(scratch,'feishu');fs.mkdirSync(exportRoot);let calls=0;
  const exporter=async()=>{calls++;const file=path.join(exportRoot,'picture.png');fs.writeFileSync(file,Buffer.from(png,'base64'));return {title:'飞书文章',markdown:'# 飞书文章\n\n前文\n\n![图](assets/picture.png)',markdownPath:path.join(exportRoot,'original.md'),assets:[{relativePath:'assets/picture.png',absolutePath:file,filename:'picture.png'}],warnings:[]};};
  const app=await startServer({feishuExporter:exporter,feishuExportRoot:exportRoot});
  let response=await fetch(app.origin+'/api/content/import-feishu',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:'https://my.feishu.cn/docx/TestDoc'})});
  assert.equal(response.status,403);assert.equal(calls,0);
  response=await app.post('/api/content/import-feishu',{url:'https://my.feishu.cn/docx/TestDoc'});assert.equal(response.status,200);
  const result=await response.json();assert.equal(result.assetCount,1);assert.equal(result.content.title,'飞书文章');assert.match(result.content.body,/\/uploads\//);
  const img=await fetch(app.origin+result.content.images[0].url);assert.equal(img.status,200);assert.match(img.headers.get('content-type'),/image\/png/);
});
test('shared topic analysis must cite captured sources; collected evidence survives model failure',async()=>{
  const collection={collectedAt:new Date().toISOString(),platforms:[{id:'zhihu',status:'ok',items:[{title:'具体产品更新',url:'https://www.zhihu.com/question/123',capturedAt:new Date().toISOString(),sourceKind:'hot_list'}]}]};
  const service=topics.createTopicResearchService({root:path.join(scratch,'topics-ok'),collector:async()=>collection,analyzer:async input=>({status:'ready',summary:'基于来源提出待验证方向',cards:[{id:'one',topic:'用真实任务检验这次产品更新',platforms:['zhihu'],reader_problem:'新功能能否解决日常任务？',angle:'用同一任务比较更新前后',why_now:'观察到产品更新线索，日期尚需补证',reader_payoff:'得到适用条件',evidence_ids:[input.signals[0].id],missing_evidence:['官方更新说明','作者实测'],risk:'medium'}]})});
  const started=service.start({platforms:['zhihu']});assert.throws(()=>service.start({platforms:['zhihu']}),/已有/);await started.done;
  assert.equal(service.get(started.id).status,'ready');
  const bad=topics.createTopicResearchService({root:path.join(scratch,'topics-bad'),collector:async()=>collection,analyzer:async()=>{throw new Error('模拟模型不可用');}});
  const other=bad.start({platforms:['zhihu']});await other.done;assert.equal(bad.get(other.id).status,'analysis_failed');assert.equal(bad.get(other.id).signals.length,1);assert.equal(bad.get(other.id).analysis,undefined);
});
test('all sources blocked never call the analyzer and unsupported platform input is rejected',async()=>{
  let calls=0;const service=topics.createTopicResearchService({root:path.join(scratch,'topics-empty'),collector:async()=>({platforms:[{id:'weixin',status:'source_unavailable',items:[]}]}),analyzer:async()=>{calls++;}});
  const run=service.start({platforms:['weixin']});await run.done;assert.equal(service.get(run.id).status,'blocked');assert.equal(calls,0);
  assert.throws(()=>topics.validateRequest({platforms:['unknown-platform']}),/支持的 8 个/);assert.throws(()=>service.get('../outside'),/ID无效/);
  assert.throws(()=>topics.validateAnalysis({status:'ready',summary:'x',cards:[{id:'a',topic:'x',reader_problem:'x',angle:'x',why_now:'x',reader_payoff:'x',platforms:['zhihu'],evidence_ids:['invented'],missing_evidence:[],risk:'low'}]},[],['zhihu']),/不存在的证据/);
});

test('draft preview rejects outside image paths before invoking the CLI',async()=>{
  const content=dashboard.importContent({filename:'safe.md',body:'安全正文'});let calls=0;
  const app=await startServer({previewRunner:async()=>{calls++;throw new Error('must not run');}});
  const outside=path.join(scratch,'private.png');fs.writeFileSync(outside,Buffer.from(png,'base64'));
  for(const source of [outside,`file://${outside}`,outside.replaceAll('/','&#47;')]){
    const response=await app.post(`/api/content/${content.id}/draft-preview`,{title:content.title,summary:'',platform:'zhihu',body:`<img src="${source}">`});
    assert.ok(response.status>=400);assert.equal(calls,0);
  }
});
test('saving the selected template keeps the publish source aligned with the draft preview',()=>{
  const original=dashboard.importContent({title:'原稿',filename:'same.md',body:'# 原稿\n\n旧内容'});
  const saved=dashboard.updateContent(original.id,{title:'新稿',summary:'',body:'<p>新内容</p>',expectedUpdatedAt:original.updated_at,template:'通用排版·基础样式.html'});
  const metadata=dashboard.inspectLayoutMetadata(saved.layout_html);assert.equal(metadata.canonicalHash,dashboard.canonicalContentHash(saved));
  const payload=dashboard.selectPlatformSourcePayload(saved,'weixin');assert.equal(payload.templated,true);assert.equal(payload.format,'html');assert.match(payload.content,/新内容/);
});
test('distinct native trend IDs sharing a list URL remain separate evidence',()=>{
  const items=['a','b','c'].map((id,i)=>({id,title:'不同热点'+i,url:'https://www.douyin.com/hot'}));
  const signals=topics.normalizedSignals({platforms:[{id:'douyin',items}]});assert.equal(signals.length,3);assert.equal(new Set(signals.map(s=>s.id)).size,3);
});
test('model citations omit browser access and tracking parameters',()=>{
  const url=topics.analysisCitationUrl('https://www.xiaohongshu.com/explore/123?xsec_token=fixture-private&source=web#account');
  assert.equal(url,'https://www.xiaohongshu.com/explore/123');
  assert.equal(topics.analysisCitationUrl('https://mp.weixin.qq.com/s?__biz=public&mid=123&idx=1&access_token=fixture'),
    'https://mp.weixin.qq.com/s?__biz=public&mid=123&idx=1');
});
test('adoption refuses an occupied plan and preserves its linked article and materials',async()=>{
  const card={id:'card',topic:'新选题',platforms:['zhihu'],reader_problem:'问题',angle:'角度',why_now:'近期线索',reader_payoff:'收益',evidence_ids:['s'],missing_evidence:[],risk:'medium'};
  const app=await startServer({topicService:{get:()=>({status:'ready',analysis:{cards:[card]},signals:[{id:'s',url:'https://www.zhihu.com/question/1'}]}),latest:()=>null}});
  dashboard.updatePlan('2032-01-02',{topic:'原计划',materials:'原资料'});
  const before=dashboard.db.prepare('SELECT * FROM weekly_plans WHERE date=?').get('2032-01-02');
  const response=await app.post('/api/topics/adopt',{runId:'unused-in-stub',cardId:'card',date:'2032-01-02'});
  assert.equal(response.status,409);assert.deepEqual(dashboard.db.prepare('SELECT * FROM weekly_plans WHERE date=?').get('2032-01-02'),before);
});
