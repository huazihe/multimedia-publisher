'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { browserIdentity } = require('../topic-browser-source');
function extract(filename, start, end) {
  const source=fs.readFileSync(path.join(__dirname,'..',filename),'utf8');
  return source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start))).trim();
}
test('browser identity mismatch invalidates cached login and never reads cookies',async()=>{
  const session={id:'old',platform:'zhihu',port:9333,webSocketDebuggerUrl:'ws://127.0.0.1:9333/devtools/browser/original',done:false};
  const loginSessions=new Map([['old',session]]);let reads=0;
  const fn=vm.runInNewContext(`(${extract('server.js','async function finishLoginSession(','function exportedLoginResult(')})`,{
    loginSessions,browserIdentity,waitForJson:async()=>({Browser:'Chrome/140',webSocketDebuggerUrl:'ws://127.0.0.1:9333/devtools/browser/replacement'}),
    statusError:(m,s)=>Object.assign(new Error(m),{statusCode:s}),collectBrowserCookies:async()=>{reads++;return [];},
    setPlatformAuthStatus:()=>{},
  });
  await assert.rejects(()=>fn(session),e=>e.apiCode==='LOGIN_SESSION_INVALID'&&e.statusCode===409);
  assert.equal(session.done,true);assert.equal(session.exporting,false);assert.equal(loginSessions.has('old'),false);assert.equal(reads,0);
});
test('frontend clears pending login after an explicit invalid-session response',async()=>{
  const state={loginSessions:{zhihu:'old'},loginFinishing:new Set(),data:{platforms:[{id:'zhihu',auth_status:'logged_in'}]}};
  const fn=vm.runInNewContext(`(${extract('public/app.js','async function finishLogin(','async function refreshPlatforms(')})`,{
    state,renderAuthPanels:()=>{},toast:()=>{},request:async()=>{throw Object.assign(new Error('状态无效'),{apiCode:'LOGIN_SESSION_INVALID'});},
  });
  await fn('zhihu');assert.equal(state.loginSessions.zhihu,undefined);assert.equal(state.loginFinishing.size,0);
  assert.equal(state.data.platforms[0].auth_status,'unknown');
});
