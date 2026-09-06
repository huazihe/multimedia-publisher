'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');
const { parseHTML } = createRequire(path.resolve(__dirname, '../../packages/core/package.json'))('linkedom');
const { collectBrowserTopicSignals, BROWSER_PLATFORMS } = require('../topic-browser-source');
const { collectTopicSignals } = require('../topic-sources');

// Fully synthetic CDP and DOM fixtures. No browser or session files are opened.
const NOW = '2026-09-05T13:00:00.000Z';
const ENDPOINT = 'ws://127.0.0.1:9333/devtools/browser/browser-123';
const URLS = { douyin: 'https://www.douyin.com/hot', xiaohongshu: 'https://www.xiaohongshu.com/explore', zhihu: 'https://www.zhihu.com/hot' };
const ITEM_URLS = { douyin: 'https://www.douyin.com/hot/123', xiaohongshu: 'https://www.xiaohongshu.com/explore/abc123', zhihu: 'https://www.zhihu.com/question/123' };
function fixture(platform = 'xiaohongshu', overrides = {}) {
  const calls = []; const connections = []; let callback; let navigated = false; let closed = false;
  const emit = (method, params, sessionId = 'own-session') => callback?.({ method, params, sessionId });
  const client = {
    onEvent(listener) { callback = listener; return () => { callback = null; }; },
    close() { closed = true; },
    async send(method, params = {}, sessionId) {
      calls.push({ method, params, sessionId });
      if (overrides.send) {
        const custom = await overrides.send(method, params, sessionId, emit);
        if (custom !== undefined) return custom;
      }
      if (method === 'Target.createTarget') return { targetId: 'own-tab' };
      if (method === 'Target.attachToTarget') return { sessionId: 'own-session' };
      if (method === 'Page.navigate') { navigated = true; return {}; }
      if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'own-frame', url: navigated ? URLS[platform] : 'about:blank' } } };
      if (method === 'Page.createIsolatedWorld') return { executionContextId: 7 };
      if (method === 'Runtime.evaluate') return { result: { value: {
        url: URLS[platform], ready: 'complete', login: false, challenge: false,
        items: [{ title: '真实 DOM 测试标题', url: ITEM_URLS[platform], metrics: { likeCount: '1.2万' } }],
        ...overrides.snapshot,
      } } };
      if (method === 'Target.closeTarget') return { success: true };
      return {};
    },
  };
  return { calls, connections, get closed() { return closed; }, emit,
    deps: { now: () => Date.parse(NOW), sleep: async () => {},
      readSession: async () => ({ platform, port: 9333, webSocketDebuggerUrl: ENDPOINT, browserPath: '/must/not/execute', userDataDir: '/must/not/read' }),
      readVersion: async port => { assert.equal(port, 9333); return { Browser: 'Chrome/140.0', webSocketDebuggerUrl: ENDPOINT }; },
      connect: async endpoint => { connections.push(endpoint); return client; },
      ...overrides.deps,
    },
  };
}
async function collect(platform = 'xiaohongshu', overrides = {}) {
  const f = fixture(platform, overrides);
  return { f, result: await collectBrowserTopicSignals({ platform }, f.deps) };
}
function domSnapshot(expression, html, url) {
  const { document } = parseHTML(html);
  for (const node of document.querySelectorAll('*')) {
    node.getClientRects = () => [{ width: 120, height: 20 }];
    if (node.tagName === 'A') Object.defineProperty(node, 'href', { value: new URL(node.getAttribute('href'), url).href });
  }
  return vm.runInNewContext(expression, {
    document, location: new URL(url), URL,
    getComputedStyle: node => ({
      display: /display\s*:\s*none/i.test(node.getAttribute('style') || '') ? 'none' : 'block',
      visibility: /visibility\s*:\s*hidden/i.test(node.getAttribute('style') || '') ? 'hidden' : 'visible', opacity: '1',
    }),
  }, { timeout: 1000 });
}

test('only the three browser platforms and a numeric item limit are public inputs', async () => {
  assert.deepEqual(BROWSER_PLATFORMS, ['douyin', 'xiaohongshu', 'zhihu']);
  const f = fixture();
  for (const options of [null, { platform: '../douyin' }, { platform: 'weixin' }, { platform: 'zhihu', limit: 0 },
    { platform: 'zhihu', method: 'Browser.close' }, { platform: 'zhihu', expression: 'document.cookie' },
    { platform: 'zhihu', port: 1234 }, { platform: 'zhihu', sourceUrl: 'https://evil.test/' }]) {
    await assert.rejects(collectBrowserTopicSignals(options, f.deps), TypeError);
  }
  assert.equal(f.calls.length, 0);
  assert.equal(f.connections.length, 0);
});

test('absent session returns needs_login without HTTP/CDP, launch, or user-tab lookup', async () => {
  for (const platform of BROWSER_PLATFORMS) {
    const { result, f } = await collect(platform, { deps: {
      readSession: async () => null, readVersion: async () => { throw Error('must not probe'); },
    } });
    assert.equal(result.status, 'needs_login');
    assert.equal(result.code, 'no_session');
    assert.match(result.reason, /工作台.*平台登录/);
    assert.equal(f.calls.length, 0);
    assert.equal(f.connections.length, 0);
  }
});

test('stale/offline project session returns needs_browser without creating a tab', async () => {
  const { result, f } = await collect('zhihu', { deps: { readVersion: async () => { throw Error('ECONNREFUSED'); } } });
  assert.equal(result.status, 'needs_browser');
  assert.equal(result.code, 'not_connected');
  assert.equal(f.calls.length, 0);
  assert.equal(f.connections.length, 0);
});

test('malicious session ports, platform mismatches and WebSocket URLs fail before connection', async t => {
  for (const session of [
    { port: '9333' }, { port: 0 }, { port: 65536 }, { port: 9333.5 }, { port: 9333, platform: 'douyin' },
    ...['ws://evil.test:9333/devtools/browser/a', 'ws://127.0.0.1.evil.test:9333/devtools/browser/a',
      'ws://127.0.0.1:9999/devtools/browser/a', 'ws://user:secret@127.0.0.1:9333/devtools/browser/a',
      'ws://localhost:9333/devtools/browser/a', 'ws://2130706433:9333/devtools/browser/a', 'ws://2130706433:9333/devtools/browser/a?token=secret',
      'ws://127.0.0.1:9333/devtools/page/user-tab', 'ws://127.0.0.1:9333/devtools/browser/a#fragment',
      'wss://127.0.0.1:9333/devtools/browser/a'].map(webSocketDebuggerUrl => ({ port: 9333, webSocketDebuggerUrl })),
  ]) await t.test(JSON.stringify(session), async () => {
    let probed = false;
    const { result, f } = await collect('zhihu', { deps: {
      readSession: async () => session, readVersion: async () => { probed = true; return {}; },
    } });
    assert.equal(result.code, 'invalid_session');
    assert.equal(probed, false);
    assert.equal(f.connections.length, 0);
  });
});

test('version discovery cannot redirect CDP to a foreign host/port or a different saved browser', async () => {
  for (const endpoint of ['ws://10.0.0.1:9333/devtools/browser/a', 'ws://127.0.0.1:9999/devtools/browser/a']) {
    const { result, f } = await collect('zhihu', { deps: { readVersion: async () => ({ Browser: 'Chrome/140', webSocketDebuggerUrl: endpoint }) } });
    assert.equal(result.code, 'invalid_session'); assert.equal(f.connections.length, 0);
  }
  const stale = await collect('zhihu', { deps: { readSession: async () => ({ port: 9333, webSocketDebuggerUrl: ENDPOINT.replace('browser-123', 'older-browser') }) } });
  assert.equal(stale.result.code, 'stale_session'); assert.equal(stale.f.connections.length, 0);
});

test('legacy port-only sessions are rejected before discovery or creating a tab', async () => {
  let discoveries=0;
  const {result,f}=await collect('zhihu',{deps:{readSession:async()=>({platform:'zhihu',port:9333}),
    readVersion:async()=>{discoveries++;return {Browser:'Chrome/140',webSocketDebuggerUrl:ENDPOINT};}}});
  assert.equal(result.code,'stale_session');assert.equal(result.status,'needs_login');assert.equal(discoveries,0);
  assert.equal(f.connections.length,0);assert.equal(f.calls.length,0);
});

test('success creates only a background blank tab, attaches to it, and closes only its own target', async () => {
  const { result, f } = await collect();
  assert.equal(result.status, 'ok');
  assert.equal(result.items[0].sourceKind, 'recommendation_feed');
  assert.equal(result.items[0].evidenceLevel, 'title_only');
  assert.equal(result.items[0].metrics.likeCount, 12000);
  assert.equal(result.items[0].capturedAt, NOW);
  assert.ok(result.items[0].limitations.includes('personalized_recommendation_not_global_hot_list'));
  assert.deepEqual(f.calls.find(call => call.method === 'Target.createTarget').params, { url: 'about:blank', background: true });
  assert.deepEqual(f.calls.find(call => call.method === 'Target.attachToTarget').params, { targetId: 'own-tab', flatten: true });
  assert.deepEqual(f.calls.filter(call => call.method === 'Target.closeTarget').map(call => call.params), [{ targetId: 'own-tab' }]);
  assert.ok(f.calls.filter(call => /^(Page|Fetch|Runtime)\./.test(call.method)).every(call => call.sessionId === 'own-session'));
  assert.equal(f.closed, true);
  assert.doesNotMatch(JSON.stringify(f.calls), /Browser\.close|activateTarget|bringToFront|getTargets|getCookies|localStorage|sessionStorage|document\.cookie|Input\./);
  const evaluation = f.calls.find(call => call.method === 'Runtime.evaluate').params;
  assert.equal(evaluation.contextId, 7); assert.equal(evaluation.userGesture, false);
});

test('external document redirect is blocked before continuing and never read', async () => {
  const { result, f } = await collect('zhihu', { send: (method, _params, _session, emit) => {
    if (method === 'Page.navigate') emit('Fetch.requestPaused', { frameId: 'own-frame', requestId: 'bad-redirect', request: { url: 'https://www.zhihu.com.evil.test/', method: 'GET' } });
  } });
  assert.equal(result.code, 'unsafe_page');
  assert.deepEqual(f.calls.find(call => call.method === 'Fetch.failRequest').params, { requestId: 'bad-redirect', errorReason: 'BlockedByClient' });
  assert.equal(f.calls.some(call => call.method === 'Runtime.evaluate'), false);
  assert.equal(f.calls.filter(call => call.method === 'Target.closeTarget').length, 1);
});

test('allowed document GET is continued, POST and external iframes are blocked; other user targets are ignored', async () => {
  const { result, f } = await collect('zhihu', { send: (method, _params, _session, emit) => {
    if (method === 'Page.navigate') {
      emit('Fetch.requestPaused', { frameId: 'own-frame', requestId: 'safe', request: { url: URLS.zhihu, method: 'GET' } });
      emit('Fetch.requestPaused', { frameId: 'ad-frame', requestId: 'ad', request: { url: 'https://advert.test/', method: 'GET' } });
      emit('Fetch.requestPaused', { frameId: 'other-frame', requestId: 'post', request: { url: URLS.zhihu, method: 'POST' } });
      emit('Fetch.requestPaused', { frameId: 'user-frame', requestId: 'user', request: { url: 'https://user.test/', method: 'GET' } }, 'user-session');
    }
  } });
  assert.equal(result.status, 'ok');
  assert.deepEqual(f.calls.filter(c => c.method === 'Fetch.continueRequest').map(c => c.params.requestId), ['safe']);
  assert.deepEqual(f.calls.filter(c => c.method === 'Fetch.failRequest').map(c => c.params.requestId), ['ad', 'post']);
});

test('external frame or snapshot URLs are rejected before returning DOM data', async () => {
  for (const mode of ['frame', 'snapshot']) {
    let frames = 0;
    const { result } = await collect('zhihu', {
      snapshot: mode === 'snapshot' ? { url: 'https://evil.test/' } : {},
      send: method => method === 'Page.getFrameTree' && ++frames > 1 && mode === 'frame'
        ? { frameTree: { frame: { id: 'own-frame', url: 'https://127.0.0.1/' } } } : undefined,
    });
    assert.equal(result.code, 'unsafe_page'); assert.deepEqual(result.items, []);
  }
});

test('login and captcha stop after one read and cleanup the owned tab', async () => {
  for (const marker of ['login', 'challenge']) {
    const { result, f } = await collect('zhihu', { snapshot: { [marker]: true } });
    assert.equal(result.status, 'needs_login');
    assert.deepEqual(result.items, []);
    assert.equal(f.calls.filter(call => call.method === 'Runtime.evaluate').length, 1);
    assert.equal(f.calls.filter(call => call.method === 'Target.closeTarget').length, 1);
  }
});

test('malicious titles and links are sanitized/dropped; secret fields are not projected and partial is explicit', async () => {
  const { result } = await collect('zhihu', { snapshot: {
    cookies: 'do-not-return-cookie', html: '<body>private</body>', localStorage: { token: 'secret' },
    items: [
      { title: '<img onerror=evil()>正常<script>steal()</script>', url: ITEM_URLS.zhihu, metrics: { heatText: '<b>20万热度</b>', cookies: 'secret' }, cookie: 'secret', excerpt: 'must-not-return' },
      { title: '外域', url: 'https://evil.test/question/1' },
      { title: '&lt;script&gt;bad()&lt;/script&gt;', url: 'https://www.zhihu.com/question/2' },
    ],
  } });
  assert.equal(result.status, 'partial');
  assert.equal(result.items.length, 1); assert.equal(result.items[0].title, '正常');
  assert.deepEqual(result.items[0].metrics, { heatText: '20万热度' });
  assert.doesNotMatch(JSON.stringify(result), /steal|evil\(|onerror|must-not-return|do-not-return|localStorage|cookies|<|>/);
});

test('bounded empty DOM, evaluation errors and cleanup failures never claim full success', async () => {
  const empty = await collect('douyin', { snapshot: { items: [] } });
  assert.equal(empty.result.code, 'empty_dom');
  assert.equal(empty.f.calls.filter(c => c.method === 'Runtime.evaluate').length, 12);
  const failed = await collect('zhihu', { send: method => method === 'Runtime.evaluate' ? { exceptionDetails: { text: 'error' } } : undefined });
  assert.equal(failed.result.code, 'dom_unavailable');
  assert.equal(failed.f.calls.filter(c => c.method === 'Target.closeTarget').length, 1);
  const cleanup = await collect('zhihu', { send: method => method === 'Target.closeTarget' ? { success: false } : undefined });
  assert.equal(cleanup.result.status, 'partial'); assert.equal(cleanup.result.code, 'cleanup_failed');
  assert.match(cleanup.result.reason, /未确认关闭/);
});

test('a total deadline aborts stuck reads and still closes only the owned tab', async () => {
  const { result, f } = await collect('zhihu', { deps: { timeoutMs: 10 }, send: method => method === 'Runtime.evaluate' ? new Promise(() => {}) : undefined });
  assert.equal(result.code, 'browser_timeout');
  assert.equal(f.calls.filter(c => c.method === 'Target.closeTarget').length, 1);
  assert.equal(f.closed, true);
});

test('different native IDs survive same-URL duplication and future dates/negative metrics are omitted', async () => {
  const { result } = await collect('douyin', { snapshot: { items: [
    { nativeId: '1001', title: '条目一', url: URLS.douyin, publishedAt: '2099-01-01T00:00:00Z', metrics: { rank: '-1' } },
    { nativeId: '1002', title: '条目二', url: URLS.douyin, publishedAt: '2026-09-04T10:00:00+08:00' },
    { nativeId: '1001', title: '条目一重复', url: URLS.douyin },
  ] } });
  assert.equal(result.items.length, 2); assert.notEqual(result.items[0].id, result.items[1].id);
  assert.equal(Object.hasOwn(result.items[0], 'publishedAt'), false);
  assert.deepEqual(result.items[0].metrics, {});
  assert.equal(result.items[1].publishedAt, '2026-09-04T02:00:00.000Z');
});

test('the actual fixed DOM expression reads visible XHS cards, ignores hidden rows and recognizes overlays', async () => {
  let expression;
  const { result } = await collect('xiaohongshu', { send: (method, params) => {
    if (method !== 'Runtime.evaluate') return undefined;
    expression = params.expression;
    return { result: { value: domSnapshot(expression, '<html><head><title>小红书</title></head><body><nav>登录</nav><section class="note-item"><a class="title" href="/explore/abc123">公开标题</a><span class="like-wrapper"><span class="count">2万</span></span></section><div style="visibility:hidden"><section class="note-item"><a class="title" href="/explore/abc456">隐藏标题</a></section></div></body></html>', URLS.xiaohongshu) } };
  } });
  assert.equal(result.status, 'ok'); assert.equal(result.items.length, 1);
  assert.equal(result.items[0].metrics.likeCount, 20000);
  const login = domSnapshot(expression, '<html><body><div role="dialog">扫码登录</div></body></html>', URLS.xiaohongshu);
  assert.equal(login.login, true); assert.equal(login.items.length, 0);
  const modal = domSnapshot(expression, '<html><body><div class="login-modal" role="dialog" aria-modal="true"><h2>登录 / 注册</h2><input type="tel" placeholder="请输入手机号"><button>登录</button></div><section class="note-item"><a class="title" href="/explore/abc123">弹窗背后的条目</a></section></body></html>', URLS.xiaohongshu);
  assert.equal(modal.login,true);assert.equal(modal.items.length,0);
});

test('fixed DOM expression extracts Zhihu and Douyin visible titles and labeled ranks', async () => {
  const pages = {
    zhihu: '<html><body><section class="HotItem"><span class="HotItem-rank">3</span><a class="HotItem-content" href="/question/123"><h2 class="HotItem-title">知乎问题</h2></a><div class="HotItem-metrics">18万热度</div></section></body></html>',
    douyin: '<html><body><li><span data-e2e="hot-rank">2</span><a href="/hot/123"><span data-e2e="hot-title">抖音热点</span></a><span data-e2e="hot-value">20万热度</span></li></body></html>',
  };
  for (const platform of ['zhihu', 'douyin']) {
    const { result } = await collect(platform, { send: (method, params) => method === 'Runtime.evaluate'
      ? { result: { value: domSnapshot(params.expression, pages[platform], URLS[platform]) } } : undefined });
    assert.equal(result.status, 'ok'); assert.equal(result.items.length, 1);
    assert.equal(result.items[0].sourceKind, 'official_hot_list');
    assert.equal(result.items[0].metrics.rank, platform === 'zhihu' ? 3 : 2);
  }
});

test('collector invokes browser fallback once for HTTP empty/401, retains HTTP evidence, and preserves normalized IDs', async () => {
  for (const platform of BROWSER_PLATFORMS) {
    let attempts = 0;
    const f = fixture(platform);
    const r = await collectTopicSignals({ platforms: [platform] }, {
      now: () => Date.parse(NOW), sleep: async () => {}, lookup: async () => [{ address: '93.184.215.14', family: 4 }],
      request: async () => ({ status: platform === 'zhihu' ? 401 : 200, headers: {}, body: '' }),
      browserSource: async options => { attempts++; return collectBrowserTopicSignals(options, f.deps); },
    });
    assert.equal(attempts, 1); assert.equal(r.platforms[0].status, 'ok');
    assert.equal(r.platforms[0].sources.length, 2);
    assert.equal(r.platforms[0].sources[1].transport, 'project_browser_dom');
    assert.equal(r.platforms[0].items.length, 1);
    assert.match(r.platforms[0].items[0].id, new RegExp(`^${platform}:`));
  }
});

test('successful HTTP, 403, captcha, rate limits and unsafe sources never trigger browser fallback', async () => {
  for (const entry of [
    { status: 403, body: '' }, { status: 429, body: '' },
    { status: 200, body: '<html><head><title>安全验证</title></head></html>' },
    { status: 200, body: JSON.stringify({ data: { word_list: [{ word: '已有热点', sentence_id: '123' }] } }) },
  ]) {
    let attempts = 0;
    await collectTopicSignals({ platforms: ['douyin'] }, {
      sleep: async () => {}, lookup: async () => [{ address: '93.184.215.14', family: 4 }],
      request: async () => ({ ...entry, headers: {} }), browserSource: async () => { attempts++; throw Error('must not run'); },
    });
    assert.equal(attempts, 0);
  }
  let called = false;
  await collectTopicSignals({ platforms: ['douyin'], sourceUrlsByPlatform: { douyin: ['https://127.0.0.1/'] } }, {
    browserSource: async () => { called = true; },
  });
  assert.equal(called, false);
});

test('several eligible HTTP sources still cause only one fallback and no session propagates needs_login', async () => {
  let attempts = 0;
  const f = fixture('zhihu', { deps: { readSession: async () => null } });
  const r = await collectTopicSignals({ platforms: ['zhihu'], sourceUrlsByPlatform: { zhihu: [URLS.zhihu, 'https://www.zhihu.com/'] } }, {
    sleep: async () => {}, lookup: async () => [{ address: '93.184.215.14', family: 4 }], request: async () => ({ status: 401, headers: {}, body: '' }),
    browserSource: async options => { attempts++; return collectBrowserTopicSignals(options, f.deps); },
  });
  assert.equal(attempts, 1); assert.equal(r.platforms[0].status, 'needs_login');
  assert.equal(r.platforms[0].browserFallback.code, 'no_session');
  assert.equal(f.calls.length, 0);
});

test('a newly established project login is picked up on the next call without a code/config change', async () => {
  let loggedIn = false;
  const f = fixture('zhihu', { deps: { readSession: async () => loggedIn ? { port: 9333, platform: 'zhihu', webSocketDebuggerUrl: ENDPOINT } : null } });
  const before = await collectBrowserTopicSignals({ platform: 'zhihu' }, f.deps);
  assert.equal(before.status, 'needs_login'); assert.equal(f.calls.length, 0);
  loggedIn = true;
  const after = await collectBrowserTopicSignals({ platform: 'zhihu' }, f.deps);
  assert.equal(after.status, 'ok'); assert.equal(after.items.length, 1);
  assert.equal(f.calls.filter(call => call.method === 'Target.createTarget').length, 1);
});

test('an invalid create-target response never permits closing a supplied arbitrary target object', async () => {
  const { result, f } = await collect('zhihu', { send: method => method === 'Target.createTarget' ? { targetId: { targetId: 'user-tab' } } : undefined });
  assert.equal(result.code, 'creation_unconfirmed');
  assert.equal(f.calls.some(call => call.method === 'Target.closeTarget'), false);
});
