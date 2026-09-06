'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { SUPPORTED_TOPIC_PLATFORMS, SIX_PLATFORMS, collectTopicSignals } = require('../topic-sources');

// Synthetic protocol/layout fixtures, never production fallback data. All
// tests inject the transport and resolver and make NO real network requests.
const NOW = '2026-09-05T12:00:00.000Z';
const TT = 'https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc';
const WX = 'https://mp.weixin.qq.com/s/example-article';
const SSPAI = 'https://sspai.com/';
const json = data => ({ status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
const html = body => ({ status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body });
const ttRows = (rows = [{ Title: 'AI 产品测试话题', Url: 'https://www.toutiao.com/trending/123/', HotValue: '23456' }]) => json({ data: rows });
const wxArticle = (title = '公众号测试文章', extra = '') => html(`<html><head><title>${title}</title>${extra}</head><body><h1 id="activity-name">${title}</h1><div id="js_content"><p>这是一段用于验证提取边界的文章正文。</p></div></body></html>`);
const sspaiCard = (url = '/post/123', title = '少数派公开内容测试') => `<article class="comp__ArticleCard"><a class="article__card__link" href="${url}"><p class="article__card__title">${title}</p></a></article>`;
function fixtures(handler = () => ttRows(), overrides = {}) {
  const calls = [];
  return {
    calls,
    deps: {
      now: () => Date.parse(NOW), sleep: async () => {},
      browserSource: async () => null,
      lookup: async () => [{ address: '93.184.215.14', family: 4 }],
      request: async (url, options) => { calls.push({ url: url.href, options }); return handler(url, options); },
      ...overrides,
    },
  };
}
async function single(options = {}, handler, overrides) {
  const fixture = fixtures(handler, overrides);
  const result = await collectTopicSignals({ platforms: ['toutiao'], ...options }, fixture.deps);
  return { ...fixture, result, platform: result.platforms[0] };
}

test('exports the eight supported platforms in priority order with an immutable compatibility alias', () => {
  assert.deepEqual(SUPPORTED_TOPIC_PLATFORMS, ['weixin', 'woshipm', 'sspai', 'xiaohongshu', 'uisdc', 'douyin', 'zhihu', 'toutiao']);
  assert.equal(Object.isFrozen(SUPPORTED_TOPIC_PLATFORMS), true);
  assert.equal(SIX_PLATFORMS, SUPPORTED_TOPIC_PLATFORMS);
});

test('uisdc reads only article cards and preserves relative time without inventing ranking or dates', async () => {
  const card=(href,title='优设 AI 工作流测试文章')=>`<article class="list-item item-article"><h2 class="item-title"><a href="${href}">${title}</a></h2><div class="item-desc"><div class="desc-wrap">列表摘要，不是全文</div></div><span class="meta-time">24小时前</span></article>`;
  const {platform,calls}=await single({platforms:['uisdc']},()=>html(`<nav><a href="/contribution">投稿</a></nav>${card('/test-workflow')}${card('/test-workflow')}${card('https://evil.example.com/test')}${card('/archives')}<div hidden>${card('/hidden')}</div>`));
  assert.equal(calls[0].url,'https://www.uisdc.com/archives');assert.equal(platform.items.length,1);
  const item=platform.items[0];assert.equal(item.url,'https://www.uisdc.com/test-workflow');assert.equal(item.displayedTime,'24小时前');
  assert.equal(item.publishedAt,undefined);assert.deepEqual(item.metrics,{});assert.equal(item.evidenceLevel,'title_and_excerpt');
  assert.ok(item.limitations.includes('not_sitewide_ranking'));assert.ok(item.limitations.includes('article_body_not_read'));
});

test('uisdc archives use the observed archive card hierarchy, not homepage-only selectors',async()=>{
  const {platform}=await single({platforms:['uisdc']},()=>html('<body class="archive-allposts"><div class="f-box c-box"><div class="item-wrap"><div class="item-main"><h2 class="item-title"><a href="/archive-example">优设文章测试标题</a></h2><span class="meta-time">昨天</span></div></div></div><aside><a href="/unrelated">导航不能冒充文章</a></aside></body>'));
  assert.equal(platform.items.length,1);assert.equal(platform.items[0].url,'https://www.uisdc.com/archive-example');assert.equal(platform.items[0].displayedTime,'昨天');
});

test('normalized hot-list schema keeps exact URLs, capture time, native heat and original rank', async () => {
  const { result, platform, calls } = await single();
  assert.equal(result.collectedAt, NOW);
  assert.equal(platform.id, 'toutiao');
  assert.equal(platform.status, 'ok');
  assert.equal(platform.sourceUrl, TT);
  assert.equal(platform.sources[0].capturedAt, NOW);
  assert.equal(platform.sources[0].finalUrl, TT);
  const item = platform.items[0];
  assert.match(item.id, /^toutiao:[a-f0-9]{24}$/);
  assert.equal(item.title, 'AI 产品测试话题');
  assert.equal(item.platform, 'toutiao');
  assert.equal(item.url, 'https://www.toutiao.com/trending/123/');
  assert.equal(item.sourceUrl, TT);
  assert.equal(item.capturedAt, NOW);
  assert.equal(item.sourceKind, 'official_hot_list');
  assert.equal(item.evidenceLevel, 'title_only');
  assert.deepEqual(item.metrics, { rank: 1, hotValue: 23456 });
  assert.equal(Object.hasOwn(item, 'publishedAt'), false);
  assert.ok(item.limitations.includes('article_body_not_read'));
  assert.ok(item.limitations.includes('publication_date_unknown'));
  assert.equal(calls[0].options.address, '93.184.215.14');
  assert.equal(calls[0].options.headers['Accept-Encoding'], 'identity');
});

test('empty Weixin source arrays use the authorized default radar instead of requesting a user list', async () => {
  const { platform, calls } = await single({ platforms: ['weixin'], sourceUrlsByPlatform: { weixin: [] } });
  assert.equal(platform.status, 'source_unavailable');
  assert.equal(platform.sourceUrl, 'https://www.aibase.com/zh/news');
  assert.match(platform.reason, /公众号选题雷达/);
  assert.deepEqual(platform.items, []);
  assert.equal(calls.length, 6);
});

test('one failure does not erase successful platforms and duplicate requested platforms are deduplicated', async () => {
  const f = fixtures(url => {
    if (url.hostname === 'www.toutiao.com') return ttRows();
    if (url.hostname === 'www.zhihu.com') return { status: 401, body: '', headers: {} };
    throw new Error('offline');
  });
  const result = await collectTopicSignals({ platforms: ['douyin', 'toutiao', 'zhihu', 'weixin', 'toutiao'], sourceUrlsByPlatform: { weixin: [] } }, f.deps);
  assert.deepEqual(result.platforms.map(p => p.status), ['source_unavailable', 'ok', 'needs_login', 'source_unavailable']);
  assert.deepEqual(result.platforms.map(p => p.id), ['douyin', 'toutiao', 'zhihu', 'weixin']);
});

test('HTML login wall, authentication JSON, captcha, 401, 403 and 429 remain explicit', async t => {
  for (const [name, response, status, code] of [
    ['login HTML', html('<html><head><title>登录 - 知乎</title></head><body>扫码登录</body></html>'), 'needs_login', 'login_required'],
    ['login body', html('<html><head><title>社区</title></head><body>请先登录后查看内容</body></html>'), 'needs_login', 'login_required'],
    ['login JSON', json({ error: { name: 'AuthenticationError', message: '身份未经过验证' } }), 'needs_login', 'login_required'],
    ['captcha', html('<html><head><title>安全验证</title></head><body>验证码</body></html>'), 'source_unavailable', 'access_challenge'],
    ['401', { status: 401, headers: {}, body: '' }, 'needs_login', 'login_required'],
    ['403', { status: 403, headers: {}, body: 'Forbidden' }, 'source_unavailable', 'http_403'],
    ['429', { status: 429, headers: {}, body: '' }, 'source_unavailable', 'rate_limited'],
  ]) await t.test(name, async () => {
    const { platform, calls } = await single({}, () => response);
    assert.equal(platform.status, status);
    assert.equal(platform.sources[0].code, code);
    assert.deepEqual(platform.items, []);
    assert.equal(calls.length, 1, 'blocked sources must not be retried');
  });
});

test('empty body, empty JSON arrays, invalid JSON and script-only pages do not yield placeholder topics', async t => {
  for (const response of [html(''), html('<html><body><script>window.data={title:"fake hot item"}</script></body></html>'), json({ data: [] }), json({}), json(null), { status: 200, headers: {}, body: '{broken' }]) {
    await t.test(String(response.body).slice(0, 35), async () => {
      const { platform } = await single({}, () => response);
      assert.equal(platform.status, 'source_unavailable');
      assert.deepEqual(platform.items, []);
    });
  }
});

test('keyword is an analysis hint and never an exact-substring collection filter', async () => {
  const data = ttRows([
    { Title: '其他新闻', Url: 'https://www.toutiao.com/trending/1/' },
    { Title: 'AI 新产品', Url: 'https://www.toutiao.com/trending/2/' },
  ]);
  const { platform, result } = await single({ keyword: 'AI工具、产品、效率工作流和职业实践', limit: 10 }, () => data);
  assert.equal(platform.items.length, 2);
  assert.equal(platform.items[0].metrics.rank, 1);
  assert.equal(platform.items[1].metrics.rank, 2);
  assert.equal(platform.fetchedCount, 2);
  assert.equal(result.keywordHint, 'AI工具、产品、效率工作流和职业实践');
  const empty = await single({ keyword: '', sourceUrlsByPlatform: { toutiao: [] } }, () => data);
  assert.equal(empty.platform.status, 'ok');
  assert.equal(empty.platform.items.length, 2);
  assert.equal(empty.result.keywordHint, '');
  assert.equal(empty.calls.length, 1);
});

test('public XHS cards are a recommendation feed, not a hot list or a read article', async () => {
  const page = html(`<html><head><title>小红书</title></head><body><nav>登录</nav>
    <section class="note-item"><a style="display:none" href="/explore/abc123"></a>
    <a class="title" href="/explore/abc123?xsec_token=public-link-signature&amp;xsec_source=pc_feed">公开笔记 AI</a>
    <span class="like-wrapper"><span class="count">1.2万</span></span></section>
    <section class="note-item" hidden><a class="title" href="/explore/abc456">隐藏笔记</a></section>
    </body></html>`);
  const { platform } = await single({ platforms: ['xiaohongshu'] }, () => page);
  assert.equal(platform.status, 'ok');
  assert.equal(platform.items.length, 1);
  const item = platform.items[0];
  assert.equal(item.sourceKind, 'recommendation_feed');
  assert.deepEqual(item.metrics, { likeCount: 12000 });
  assert.equal(item.evidenceLevel, 'title_only');
  assert.match(item.url, /xsec_token=public-link-signature&xsec_source=pc_feed/);
});

test('woshipm extracts its own article cards and does not follow an external hot-board link', async () => {
  const { platform, calls } = await single({ platforms: ['woshipm'] }, () => html(`<html><body>
    <a href="https://www.pmbaobao.com/hotnews/">今日热榜</a>
    <article class="postlist-item"><a href="https://www.woshipm.com/ai/123456.html" title="产品测试标题"><img src="x"></a>
    <p itemprop="description">短导语</p><time datetime="2026-09-04T10:00:00+08:00"></time></article>
    </body></html>`));
  assert.equal(platform.status, 'ok');
  assert.equal(platform.items[0].sourceKind, 'official_public_feed');
  assert.equal(platform.items[0].publishedAt, '2026-09-04T02:00:00.000Z');
  assert.deepEqual(platform.items[0].metrics, {});
  assert.equal(platform.items[0].evidenceLevel, 'title_and_excerpt');
  assert.equal(calls.length, 1);
});

test('supplied Weixin article extracts a short excerpt and preserves source URL and date', async () => {
  const longText = '正文'.repeat(500);
  const { platform } = await single({ platforms: ['weixin'], sourceUrlsByPlatform: { weixin: [WX] } }, () => html(`<html><head><title>测试</title>
    <meta property="article:published_time" content="2026-09-04T10:00:00+08:00"></head><body>
    <h1 id="activity-name">AI 文章</h1><div id="js_content">${longText}<script>evil()</script></div></body></html>`));
  const item = platform.items[0];
  assert.equal(item.sourceKind, 'user_article');
  assert.equal(item.evidenceLevel, 'article_excerpt');
  assert.equal(item.sourceUrl, WX);
  assert.equal(item.url, WX);
  assert.equal(item.excerpt.length, 180);
  assert.equal(item.publishedAt, '2026-09-04T02:00:00.000Z');
  assert.equal(item.limitations.includes('article_body_not_read'), false);
  assert.doesNotMatch(JSON.stringify(item), /evil\(\)/);
});

test('metadata title and description alone never claim article-body evidence', async () => {
  const { platform } = await single({ platforms: ['weixin'], sourceUrlsByPlatform: { weixin: [WX] } }, () => html('<html><head><meta property="og:title" content="文章元数据"><meta property="og:description" content="公开摘要"></head><body></body></html>'));
  assert.equal(platform.items[0].evidenceLevel, 'title_and_excerpt');
  assert.ok(platform.items[0].limitations.includes('article_body_not_read'));
});

test('official subscription/album URLs work while a third-party feed is not attributed to Weixin', async () => {
  const album = 'https://mp.weixin.qq.com/mp/appmsgalbum?album_id=123';
  const { platform, calls } = await single({ platforms: ['weixin'], sourceUrlsByPlatform: { weixin: [album] } }, () => html(`<html><body><a href="${WX}">订阅文章</a><a href="https://example.com/fake">外部文章</a></body></html>`));
  assert.equal(platform.items[0].sourceKind, 'user_subscription');
  assert.equal(platform.items[0].url, WX);
  assert.equal(platform.items[0].evidenceLevel, 'title_only');
  assert.equal(calls.length, 1, 'do not crawl linked articles without a supplied URL');
  const rejected = await single({ platforms: ['weixin'], sourceUrlsByPlatform: { weixin: ['https://rsshub.app/wechat/account'] } });
  assert.equal(rejected.calls.length, 0);
  assert.equal(rejected.platform.status, 'source_unavailable');
});

test('RSS and Atom parse official links without executing XML entities', async () => {
  const source = 'https://mp.weixin.qq.com/feed';
  for (const body of [
    `<?xml version="1.0"?><rss><channel><item><title>订阅标题</title><link>${WX}</link><description>摘要</description><pubDate>2026-09-04T12:00:00Z</pubDate></item></channel></rss>`,
    `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><title>订阅标题</title><link rel="alternate" href="${WX}"/><summary>摘要</summary><published>2026-09-04T12:00:00Z</published></entry></feed>`,
  ]) {
    const { platform } = await single({ platforms: ['weixin'], sourceUrlsByPlatform: { weixin: [source] } }, () => ({ status: 200, headers: { 'content-type': 'application/rss+xml' }, body }));
    assert.equal(platform.status, 'ok');
    assert.equal(platform.items[0].sourceKind, 'user_subscription');
    assert.equal(platform.items[0].publishedAt, '2026-09-04T12:00:00.000Z');
  }
  const entity = await single({ platforms: ['weixin'], sourceUrlsByPlatform: { weixin: [source] } }, () => html('<?xml version="1.0"?><!DOCTYPE rss [<!ENTITY x SYSTEM "file:///etc/passwd">]><rss>&x;</rss>'));
  assert.equal(entity.platform.sources[0].code, 'unsafe_xml');
});

test('partial source failures keep good articles and report each attempted URL', async () => {
  const unavailable = 'https://mp.weixin.qq.com/s/unavailable';
  const { platform } = await single({ platforms: ['weixin'], sourceUrlsByPlatform: { weixin: [WX, unavailable] } }, url => url.href === WX ? wxArticle() : { status: 403, headers: {}, body: 'blocked' });
  assert.equal(platform.status, 'partial');
  assert.equal(platform.items.length, 1);
  assert.deepEqual(platform.sources.map(s => s.url), [WX, unavailable]);
  assert.deepEqual(platform.sources.map(s => s.status), ['ok', 'source_unavailable']);
  assert.equal(platform.sources[1].capturedAt, NOW);
});

test('duplicate URLs and repeated items retain a stable ID without discarding the original link', async () => {
  const a = 'https://www.toutiao.com/trending/123/?foo=one';
  const b = 'https://www.toutiao.com/trending/123/?foo=two';
  const f = () => ttRows([{ Title: '同一话题', Url: a }, { Title: '同一话题', Url: b }]);
  const { platform, calls } = await single({ sourceUrlsByPlatform: { toutiao: [TT, TT] } }, f);
  const second = await single({}, f);
  assert.equal(calls.length, 1);
  assert.equal(platform.items.length, 1);
  assert.equal(platform.items[0].url, a);
  assert.equal(platform.items[0].id, second.platform.items[0].id);
});

test('future and impossible publication dates are omitted and explicitly marked', async t => {
  for (const [date, warning] of [
    ['2099-01-01T00:00:00Z', 'future_publication_date_omitted'],
    ['2026-02-30T00:00:00Z', 'invalid_publication_date'],
    ['昨天', 'unverifiable_publication_date'],
  ]) await t.test(date, async () => {
    const { platform } = await single({ platforms: ['weixin'], sourceUrlsByPlatform: { weixin: [WX] } }, () => wxArticle('日期测试', `<meta property="article:published_time" content="${date}">`));
    assert.equal(Object.hasOwn(platform.items[0], 'publishedAt'), false);
    assert.ok(platform.items[0].limitations.includes(warning));
  });
});

test('malicious and encoded script titles are plain sanitized text, never executable markup', async () => {
  const { platform } = await single({}, () => ttRows([
    { Title: '<img src=x onerror=alert(1)>AI<script>stealCookie()</script>', Url: 'https://www.toutiao.com/trending/1/' },
    { Title: '&lt;script&gt;injected()&lt;/script&gt;正常标题', Url: 'https://www.toutiao.com/trending/2/' },
    { Title: '<script>onlyBad()</script>', Url: 'https://www.toutiao.com/trending/3/' },
  ]));
  assert.equal(platform.status, 'partial');
  assert.deepEqual(platform.items.map(item => item.title), ['AI', '正常标题']);
  assert.doesNotMatch(JSON.stringify(platform.items), /<|>|stealCookie|injected\(|onerror|onlyBad/);
});

test('SSRF, lookalike domains, IP literals, userinfo, non-HTTPS and custom ports are blocked before DNS/HTTP', async t => {
  for (const url of [
    'http://www.toutiao.com/', 'https://www.toutiao.com:8443/',
    'https://www.toutiao.com.evil.test/', 'https://evil-toutiao.com/',
    'https://www.toutiao.com@evil.test/', 'https://user:password@www.toutiao.com/',
    'https://www.toutiao.com./', 'https://www.tоutiao.com/',
    'https://localhost/', 'https://127.0.0.1/', 'https://2130706433/', 'https://0x7f000001/',
    'https://10.0.0.1/', 'https://169.254.169.254/', 'https://[::1]/', 'https://[::ffff:127.0.0.1]/',
    'file:///etc/passwd', 'gopher://localhost/', 'data:text/html,test',
    'https://www.toutiao.com\\@evil.test/', 'https://www.toutiao.com/\nsecret',
    'https://www.zhihu.com/hot',
  ]) await t.test(url, async () => {
    let lookedUp = false;
    const { platform, calls } = await single({ sourceUrlsByPlatform: { toutiao: [url] } }, undefined, {
      lookup: async () => { lookedUp = true; return [{ address: '93.184.215.14', family: 4 }]; },
    });
    assert.equal(platform.status, 'source_unavailable');
    assert.equal(platform.sources[0].code, 'unsafe_url');
    assert.equal(platform.sourceUrl, null);
    assert.equal(calls.length, 0);
    assert.equal(lookedUp, false);
  });
});

test('DNS rejects private, reserved, IPv6, mixed and empty answers; only vetted address reaches transport', async t => {
  for (const addresses of [
    ['127.0.0.1'], ['10.1.2.3'], ['100.64.0.1'], ['169.254.169.254'], ['172.31.1.2'],
    ['192.168.1.1'], ['198.18.0.1'], ['192.0.2.1'], ['224.0.0.1'], ['255.255.255.255'],
    ['::1'], ['::ffff:127.0.0.1'], ['64:ff9b::7f00:1'], ['fc00::1'], ['fe80::1'],
    ['93.184.215.14', '127.0.0.1'], [],
  ]) await t.test(addresses.join(',') || 'empty', async () => {
    const { platform, calls } = await single({}, undefined, { lookup: async () => addresses.map(address => ({ address, family: address.includes(':') ? 6 : 4 })) });
    assert.equal(platform.sources[0].code, 'unsafe_dns');
    assert.equal(calls.length, 0);
  });
});

test('redirect whitelist is checked at every hop, including encoded local paths and platform changes', async t => {
  for (const target of ['https://127.0.0.1/', 'http://www.toutiao.com/', 'https://www.toutiao.com.evil.test/', 'https://www.zhihu.com/hot', '//localhost/admin', 'https://www.toutiao.com:9443/']) {
    await t.test(target, async () => {
      const { platform, calls } = await single({}, () => ({ status: 302, headers: { location: target }, body: '' }));
      assert.equal(platform.sources[0].code, 'unsafe_url');
      assert.equal(calls.length, 1);
    });
  }
});

test('same-platform redirects are pinned anew, bounded and never replay Set-Cookie or Authorization', async () => {
  let lookups = 0;
  const { platform, calls } = await single({}, url => url.pathname === '/new-board'
    ? ttRows() : { status: 302, headers: { location: '/new-board', 'set-cookie': 'private_session=do-not-replay' }, body: '' }, {
    lookup: async () => [{ address: ++lookups === 1 ? '93.184.215.14' : '93.184.215.15', family: 4 }],
  });
  assert.equal(platform.status, 'ok');
  assert.equal(platform.sourceUrl, TT);
  assert.equal(platform.sources[0].finalUrl, 'https://www.toutiao.com/new-board');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].options.address, '93.184.215.15');
  assert.doesNotMatch(JSON.stringify(calls.map(c => c.options.headers)), /cookie|authorization|private_session/i);
  const loop = await single({}, () => ({ status: 302, headers: { location: '/loop' }, body: '' }));
  assert.equal(loop.calls.length, 3);
  assert.equal(loop.platform.sources[0].code, 'redirect_limit');
});

test('login redirect is stopped before requesting a login endpoint', async () => {
  const { platform, calls } = await single({}, () => ({ status: 302, headers: { location: '/login' }, body: '' }));
  assert.equal(platform.status, 'needs_login');
  assert.equal(calls.length, 1);
});

test('response size, encoding and content-type caps reject unsupported bodies', async t => {
  for (const [response, code] of [
    [html('x'.repeat(2 * 1024 * 1024 + 1)), 'response_too_large'],
    [{ status: 200, headers: { 'content-encoding': 'gzip' }, body: 'compressed' }, 'unsupported_encoding'],
    [{ status: 200, headers: { 'content-type': 'image/png' }, body: 'binary' }, 'unsupported_content'],
  ]) await t.test(code, async () => {
    const { platform } = await single({}, () => response);
    assert.equal(platform.status, 'source_unavailable');
    assert.equal(platform.sources[0].code, code);
  });
});

test('lookup and request timeouts terminate without waiting forever', async t => {
  for (const stage of ['lookup', 'request']) await t.test(stage, async () => {
    const { platform } = await single({}, undefined, { timeoutMs: 10, [stage]: () => new Promise(() => {}) });
    assert.equal(platform.status, 'source_unavailable');
    assert.equal(platform.sources[0].code, 'timeout');
  });
});

test('untrusted item links are dropped without losing valid same-platform evidence', async () => {
  const { platform, calls } = await single({}, () => ttRows([
    { Title: '有效标题', Url: 'https://www.toutiao.com/trending/1/' },
    { Title: '不安全网址', Url: 'javascript:alert(1)' },
    { Title: '别站冒充', Url: 'https://www.zhihu.com/question/123' },
    { Title: '伪域名', Url: 'https://www.toutiao.com.evil.test/trending/2' },
  ]));
  assert.equal(platform.status, 'partial');
  assert.equal(platform.items.length, 1);
  assert.equal(calls.length, 1);
});

test('negative or missing metrics do not become invented heat/zero and Douyin board time is not publishedAt', async () => {
  const { platform } = await single({ platforms: ['douyin'] }, () => json({ data: { word_list: [
    { word: '抖音测试话题', sentence_id: '100', hot_value: -1, event_time: 1700000000 },
  ] } }));
  assert.equal(platform.status, 'ok');
  const item = platform.items[0];
  assert.equal(item.url, platform.sourceUrl, 'no fabricated article URL when only a board entry is available');
  assert.deepEqual(item.metrics, { rank: 1 });
  assert.equal(Object.hasOwn(item, 'publishedAt'), false);
  assert.equal(item.evidenceLevel, 'title_only');
});

test('different Douyin sentence IDs survive same-URL deduplication while repeated native IDs collapse', async () => {
  const response = json({ data: { word_list: [
    { word: '第一个真实榜单条目', sentence_id: '9000000000000000001', url: 'https://www.douyin.com/hot/' },
    { word: '第二个真实榜单条目', sentence_id: '9000000000000000002', url: 'https://www.douyin.com/hot/' },
    { word: '第一个条目重复展示', sentence_id: '9000000000000000001', url: 'https://www.douyin.com/hot/' },
  ] } });
  const first = await single({ platforms: ['douyin'], sourceUrlsByPlatform: { douyin: [] } }, () => response);
  const second = await single({ platforms: ['douyin'] }, () => response);
  assert.equal(first.platform.items.length, 2);
  assert.notEqual(first.platform.items[0].id, first.platform.items[1].id);
  assert.deepEqual(first.platform.items.map(item => item.id), second.platform.items.map(item => item.id));
  assert.equal(first.platform.items[0].url, first.platform.items[1].url);
});

test('empty source fields request supported platform endpoints and the six-source Weixin radar', async () => {
  const f = fixtures(url => url.hostname === 'www.toutiao.com' ? ttRows() : html(''));
  const result = await collectTopicSignals({
    sourceUrlsByPlatform: Object.fromEntries(SUPPORTED_TOPIC_PLATFORMS.map(id => [id, []])),
    keyword: 'AI工具、产品、效率工作流和职业实践',
  }, f.deps);
  assert.equal(f.calls.length, SUPPORTED_TOPIC_PLATFORMS.length - 1 + 6);
  assert.deepEqual(result.platforms.map(p => p.id), SUPPORTED_TOPIC_PLATFORMS);
  assert.equal(result.platforms.find(p => p.id === 'sspai').sourceUrl, SSPAI);
  assert.equal(result.platforms.find(p => p.id === 'toutiao').items.length, 1);
  assert.equal(result.platforms.find(p => p.id === 'weixin').sources.length, 6);
});

test('bounded explicit source arrays replace defaults; invalid input never initiates a network call', async () => {
  const f = fixtures();
  for (const options of [
    { platforms: ['unknown'] }, { platforms: ['优派'] }, { platforms: 'toutiao' },
    { platforms: [...SUPPORTED_TOPIC_PLATFORMS, 'sspai'] },
    { sourceUrlsByPlatform: { unknown: [] } }, { limit: 0 }, { limit: 51 }, { limit: 1.2 },
    { keyword: {} }, { keyword: 'a'.repeat(201) }, { sourceUrlsByPlatform: [] },
  ]) await assert.rejects(collectTopicSignals(options, f.deps), TypeError);
  const empty = await collectTopicSignals({ platforms: ['toutiao'], sourceUrlsByPlatform: { toutiao: [] } }, f.deps);
  assert.equal(empty.platforms[0].status, 'ok');
  const many = await collectTopicSignals({ platforms: ['toutiao'], sourceUrlsByPlatform: { toutiao: [TT, TT, TT, TT] } }, f.deps);
  assert.equal(many.platforms[0].status, 'source_unavailable');
  assert.equal(f.calls.length, 1);
});

test('Sspai uses visible public homepage cards as selected/recent content signals, never ranked popularity', async () => {
  const page = html(`<html><body><nav><a href="/store">商店</a></nav>${sspaiCard()}
    <div hidden>${sspaiCard('/post/456', '隐藏卡片')}</div>
    <script>window.fakeHotList = [{title:'伪热点'}]</script></body></html>`);
  const { platform, calls } = await single({ platforms: ['sspai'], sourceUrlsByPlatform: { sspai: [] } }, () => page);
  assert.equal(platform.status, 'ok');
  assert.equal(platform.sourceUrl, SSPAI);
  assert.equal(platform.sources[0].name, '少数派首页精选/近期内容信号');
  assert.equal(calls.length, 1, 'only read the public list, never follow articles');
  assert.equal(platform.items.length, 1);
  const item = platform.items[0];
  assert.equal(item.platform, 'sspai');
  assert.match(item.id, /^sspai:[a-f0-9]{24}$/);
  assert.equal(item.url, 'https://sspai.com/post/123');
  assert.equal(item.sourceUrl, SSPAI);
  assert.equal(item.sourceName, platform.sources[0].name);
  assert.equal(item.sourceKind, 'official_public_feed');
  assert.equal(item.evidenceLevel, 'title_only');
  assert.equal(item.capturedAt, NOW);
  assert.equal(Object.hasOwn(item, 'publishedAt'), false);
  assert.deepEqual(item.metrics, {});
  for (const limit of ['partial_homepage_sample', 'publication_date_unknown', 'popularity_unknown',
    'article_body_not_read', 'not_sitewide_ranking', 'selection_probability_unknown']) assert.ok(item.limitations.includes(limit));
});

test('Sspai RSS and Atom keep dates and sanitized excerpts without claiming article-body or hot-list evidence', async () => {
  for (const body of [
    '<?xml version="1.0"?><rss><channel><item><title>RSS 测试文章</title><link>https://sspai.com/post/123</link><description><![CDATA[公开摘要<script>bad()</script>]]></description><pubDate>Fri, 04 Sep 2026 10:00:00 +0000</pubDate></item></channel></rss>',
    '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Atom 测试文章</title><link rel="alternate" href="https://sspai.com/post/123"/><summary>公开摘要</summary><published>2026-09-04T10:00:00Z</published></entry></feed>',
  ]) {
    const { platform, calls } = await single({ platforms: ['sspai'], sourceUrlsByPlatform: { sspai: ['https://sspai.com/feed'] } },
      () => ({ status: 200, headers: { 'content-type': 'application/rss+xml' }, body }));
    assert.equal(platform.status, 'ok');
    assert.equal(calls.length, 1);
    const item = platform.items[0];
    assert.equal(item.sourceKind, 'official_public_feed');
    assert.equal(item.evidenceLevel, 'title_and_excerpt');
    assert.equal(item.excerpt, '公开摘要');
    assert.equal(item.publishedAt, '2026-09-04T10:00:00.000Z');
    assert.deepEqual(item.metrics, {});
    assert.ok(item.limitations.includes('article_body_not_read'));
    assert.ok(item.limitations.includes('not_sitewide_ranking'));
  }
});

test('Sspai source scope rejects other sites, feed mirrors, unsafe URLs and non-article links', async () => {
  for (const url of ['https://www.woshipm.com/', 'https://rsshub.app/sspai/index', 'https://sspai.com.evil.test/',
    'http://sspai.com/', 'https://sspai.com:8443/', 'https://user:pass@sspai.com/', 'https://127.0.0.1/']) {
    const { platform, calls } = await single({ platforms: ['sspai'], sourceUrlsByPlatform: { sspai: [url] } }, undefined,
      { lookup: async () => { assert.fail('unsafe sources must fail before DNS'); } });
    assert.equal(platform.sources[0].code, 'unsafe_url');
    assert.equal(calls.length, 0);
  }
  const { platform } = await single({ platforms: ['sspai'] }, () => html(`<html><body>${[
    '/post/123', '/store', '/u/456', '/post/not-a-number', 'https://www.woshipm.com/ai/123.html',
    'https://sspai.com.evil.test/post/123', 'javascript:alert(1)', '',
  ].map(url => sspaiCard(url)).join('')}</body></html>`));
  assert.equal(platform.status, 'partial');
  assert.equal(platform.items.length, 1);
  assert.equal(platform.items[0].url, 'https://sspai.com/post/123');
  const missingLink = await single({ platforms: ['sspai'] }, () => html('<rss><channel><item><title>没有文章链接</title></item></channel></rss>'));
  assert.equal(missingLink.platform.sources[0].code, 'invalid_items');
  assert.deepEqual(missingLink.platform.items, []);
});

test('Sspai IDs stay stable across homepage/feed, www aliases, tracking parameters and capture times', async () => {
  const first = await single({ platforms: ['sspai'] }, () => html(`<html><body>${sspaiCard('/post/123?utm_source=home')}${sspaiCard('https://www.sspai.com/post/123/?from=feed', '另一个展示标题')}${sspaiCard('/post/456')}</body></html>`));
  const second = await single({ platforms: ['sspai'], sourceUrlsByPlatform: { sspai: ['https://sspai.com/feed'] } },
    () => html('<rss><channel><item><title>更新后的标题</title><link>https://sspai.com/post/123</link></item></channel></rss>'),
    { now: () => Date.parse(NOW) + 60000 });
  assert.equal(first.platform.items.length, 2);
  assert.notEqual(first.platform.items[0].id, first.platform.items[1].id);
  assert.equal(first.platform.items[0].id, second.platform.items[0].id);
  assert.equal(first.platform.items[0].url, 'https://sspai.com/post/123?utm_source=home');
  const radar = await single({ platforms: ['weixin'], sourceUrlsByPlatform: { weixin: [SSPAI] } }, () => html(`<html><body>${sspaiCard()}</body></html>`));
  assert.equal(radar.platform.items[0].sourceKind, 'topic_radar');
  assert.ok(radar.platform.items[0].limitations.includes('not_weixin_native_popularity'));
  assert.notEqual(radar.platform.items[0].id, first.platform.items[0].id);
});

test('Sspai empty, script-only, login, blocked and unsafe XML sources never create sample topics or open a browser', async () => {
  for (const [response, code] of [
    [html(''), 'empty_response'], [html('<html><body></body></html>'), 'empty_source'],
    [html('<html><body><script>window.data={title:"假的近期文章"}</script></body></html>'), 'empty_source'],
    [html('<rss><channel></channel></rss>'), 'empty_source'], [json({ data: [] }), 'empty_source'],
    [html('<html><head><title>登录</title></head><body>请先登录</body></html>'), 'login_required'],
    [{ status: 403, headers: {}, body: '' }, 'http_403'],
    [html('<?xml version="1.0"?><!DOCTYPE rss [<!ENTITY x SYSTEM "file:///etc/passwd">]><rss>&x;</rss>'), 'unsafe_xml'],
  ]) {
    const { platform, calls } = await single({ platforms: ['sspai'] }, () => response,
      { browserSource: async () => { assert.fail('Sspai must not request a logged-in browser'); } });
    assert.equal(platform.sources[0].code, code);
    assert.deepEqual(platform.items, []);
    assert.equal(calls.length, 1);
  }
});

test('Sspai preserves DNS checks and validates redirects before any second request', async () => {
  const unsafeDns = await single({ platforms: ['sspai'] }, undefined,
    { lookup: async () => [{ address: '93.184.215.14', family: 4 }, { address: '127.0.0.1', family: 4 }] });
  assert.equal(unsafeDns.platform.sources[0].code, 'unsafe_dns');
  assert.equal(unsafeDns.calls.length, 0);
  for (const location of ['https://127.0.0.1/', 'https://www.woshipm.com/', 'https://sspai.com.evil.test/', '/login']) {
    const { platform, calls } = await single({ platforms: ['sspai'] }, () => ({ status: 302, headers: { location }, body: '' }));
    assert.equal(platform.sources[0].code, location === '/login' ? 'login_required' : 'unsafe_url');
    assert.equal(calls.length, 1);
  }
  let lookups = 0;
  const rebound = await single({ platforms: ['sspai'] }, () => ({ status: 302, headers: { location: 'https://www.sspai.com/' }, body: '' }),
    { lookup: async () => [{ address: ++lookups === 1 ? '93.184.215.14' : '127.0.0.1', family: 4 }] });
  assert.equal(rebound.platform.sources[0].code, 'unsafe_dns');
  assert.equal(rebound.calls.length, 1);
});

test('source concurrency is bounded across multiple collector calls and per-host starts are throttled', async () => {
  let concurrent = 0; let maximum = 0; const pauses = [];
  const f = fixtures(async () => {
    concurrent++; maximum = Math.max(maximum, concurrent);
    await new Promise(resolve => setTimeout(resolve, 5)); concurrent--;
    return ttRows();
  }, { sleep: async ms => { pauses.push(ms); } });
  await Promise.all(Array.from({ length: 5 }, () => collectTopicSignals({ platforms: ['toutiao'] }, f.deps)));
  assert.ok(maximum <= 3);
  assert.ok(pauses.length > 0);
  assert.ok(pauses.every(ms => ms > 0));
});

test('Weixin defaults to all six authorized radar families, reports missing sources and interleaves successful origins', async () => {
  const { platform, calls } = await single({ platforms: ['weixin'], limit: 5 }, url => {
    if (url.hostname === 'www.aibase.com') throw Error('TLS failure');
    if (url.hostname === 'www.woshipm.com') return html('<html><body><li class="widget-post-item--withImage"><div class="title"><a href="/ai/123.html">AI 产品经理真实卡片</a></div></li></body></html>');
    if (url.hostname === 'sspai.com') return html('<html><body><article class="comp__ArticleCard"><a class="article__card__link" href="/post/123"><p class="article__card__title">少数派工具信号</p></a></article></body></html>');
    const links = Array.from({ length: 8 }, (_, i) => `<entry><title>来源文章 ${i}</title><link rel="alternate" href="${url.origin}/p/topic-${i}"/><published>2026-09-04T10:00:00Z</published><summary>公开摘要</summary></entry>`).join('');
    return { status: 200, headers: { 'content-type': 'application/atom+xml' }, body: `<?xml version="1.0"?><feed>${links}</feed>` };
  });
  assert.equal(calls.length, 6);
  assert.deepEqual(calls.map(call => new URL(call.url).hostname), ['www.aibase.com', 'www.woshipm.com', 'sspai.com', 'simonwillison.net', 'jack-clark.net', 'www.latent.space']);
  assert.equal(platform.status, 'partial');
  assert.equal(platform.coverage.attempted, 6);
  assert.equal(platform.coverage.readable, 5);
  assert.equal(platform.coverage.missing[0].name, 'AIbase 新闻');
  assert.match(platform.reason, /非公众号原生热榜或阅读量/);
  assert.equal(platform.items.length, 5);
  assert.equal(new Set(platform.items.map(item => item.sourceUrl)).size, 5);
  for (const item of platform.items) {
    assert.equal(item.platform, 'weixin');
    assert.equal(item.sourceKind, 'topic_radar');
    assert.deepEqual(item.metrics, {});
    assert.ok(item.limitations.includes('not_weixin_native_popularity'));
    assert.match(item.id, /^weixin:/);
  }
});

test('a radar source cannot redirect to another authorized radar family or leak cross-source cookies', async () => {
  const { platform, calls } = await single({ platforms: ['weixin'], sourceUrlsByPlatform: { weixin: ['https://simonwillison.net/'] } }, () => ({
    status: 302, headers: { location: 'https://jack-clark.net/', 'set-cookie': 'secret=1' }, body: '',
  }));
  assert.equal(platform.status, 'source_unavailable');
  assert.equal(platform.sources[0].code, 'unsafe_redirect');
  assert.equal(calls.length, 1);
});

test('XHS SSR hidden feed is reported as requiring rendering instead of claimed as visible', async () => {
  const { platform } = await single({ platforms: ['xiaohongshu'] }, () => html('<html><body><div class="feeds-container" style="visibility:hidden"><section class="note-item"><a class="title" href="/explore/abc123">尚未显示的推荐</a></section></div></body></html>'), { browserSource: async () => null });
  assert.equal(platform.status, 'source_unavailable');
  assert.equal(platform.sources[0].code, 'requires_render');
  assert.deepEqual(platform.items, []);
});

test('woshipm sidebar HTML is a labeled partial homepage sample and RSS publication dates support RFC822', async () => {
  const f = await single({ platforms: ['woshipm'] }, () => html('<html><body><li class="widget-post-item--withImage u-block"><div class="title"><a href="https://www.woshipm.com/ai/123456.html">真实侧栏结构的文章</a></div></li></body></html>'));
  assert.equal(f.platform.items.length, 1);
  assert.ok(f.platform.items[0].limitations.includes('partial_homepage_sample'));
  const rss = await single({ platforms: ['weixin'], sourceUrlsByPlatform: { weixin: ['https://jack-clark.net/feed/'] } }, () => ({
    status: 200, headers: { 'content-type': 'application/rss+xml' },
    body: '<?xml version="1.0"?><rss><channel><item><title>Import AI 测试</title><link>https://jack-clark.net/2026/09/04/test/</link><pubDate>Fri, 04 Sep 2026 10:00:00 +0000</pubDate></item></channel></rss>',
  }));
  assert.equal(rss.platform.items[0].publishedAt, '2026-09-04T10:00:00.000Z');
  assert.equal(rss.platform.items[0].sourceKind, 'topic_radar');
});

test('native HTTPS request pins DNS, uses GET only, disables pooling and stops an oversized streaming response', async t => {
  const https = require('node:https');
  const { EventEmitter } = require('node:events');
  const { PassThrough } = require('node:stream');
  let seen;
  t.mock.method(https, 'request', (url, options, receive) => {
    seen = options;
    const req = new EventEmitter();
    req.destroy = () => {};
    req.end = () => {
      const res = new PassThrough();
      res.statusCode = 200;
      res.headers = { 'content-type': 'text/html' };
      receive(res);
      res.write(Buffer.alloc(1024 * 1024 + 1));
      res.end(Buffer.alloc(1024 * 1024));
    };
    return req;
  });
  const result = await collectTopicSignals({ platforms: ['toutiao'] }, {
    lookup: async () => [{ address: '93.184.215.14', family: 4 }], sleep: async () => {},
  });
  assert.equal(result.platforms[0].sources[0].code, 'response_too_large');
  assert.equal(seen.method, 'GET');
  assert.equal(seen.agent, false);
  assert.equal(seen.family, 4);
  assert.equal(seen.headers.Cookie, undefined);
  seen.lookup('ignored.example', {}, (error, address, family) => {
    assert.equal(error, null); assert.equal(address, '93.184.215.14'); assert.equal(family, 4);
  });
  seen.lookup('ignored.example', { all: true }, (error, records) => {
    assert.equal(error, null); assert.deepEqual(records, [{ address: '93.184.215.14', family: 4 }]);
  });
});
