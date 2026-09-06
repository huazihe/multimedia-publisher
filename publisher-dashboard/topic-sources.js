'use strict';

const https = require('node:https');
const dns = require('node:dns').promises;
const { isIP, BlockList } = require('node:net');
const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const path = require('node:path');
const { collectBrowserTopicSignals, BROWSER_PLATFORMS } = require('./topic-browser-source');
const { parseHTML, DOMParser } = (() => {
  try { return require('linkedom'); } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
    return createRequire(path.resolve(__dirname, '../packages/core/package.json'))('linkedom');
  }
})();

const SUPPORTED_TOPIC_PLATFORMS = Object.freeze(['weixin', 'woshipm', 'sspai', 'xiaohongshu', 'uisdc', 'douyin', 'zhihu', 'toutiao']);
// Compatibility export for callers using the original name; includes all supported platforms.
const SIX_PLATFORMS = SUPPORTED_TOPIC_PLATFORMS;
const HOSTS = Object.freeze({
  douyin: ['www.douyin.com', 'douyin.com'],
  xiaohongshu: ['www.xiaohongshu.com', 'xiaohongshu.com'],
  toutiao: ['www.toutiao.com', 'toutiao.com'],
  zhihu: ['www.zhihu.com', 'zhihu.com', 'zhuanlan.zhihu.com'],
  woshipm: ['www.woshipm.com', 'woshipm.com'],
  sspai: ['sspai.com', 'www.sspai.com'],
  uisdc: ['uisdc.com', 'www.uisdc.com'],
  // User-authorized xiaopu-writing topic radar, NOT Weixin native analytics.
  weixin: ['mp.weixin.qq.com', 'www.aibase.com', 'aibase.com', 'www.woshipm.com', 'woshipm.com',
    'sspai.com', 'www.sspai.com', 'simonwillison.net', 'jack-clark.net', 'www.latent.space', 'latent.space'],
});
const DEFAULTS = Object.freeze({
  douyin: 'https://www.douyin.com/aweme/v1/web/hot/search/list/',
  xiaohongshu: 'https://www.xiaohongshu.com/explore',
  toutiao: 'https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc',
  zhihu: 'https://www.zhihu.com/api/v3/feed/topstory/hot-lists/total?limit=50',
  woshipm: 'https://www.woshipm.com/',
  sspai: 'https://sspai.com/',
  uisdc: 'https://www.uisdc.com/archives',
});
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_SOURCES = 3;
// The six source families explicitly accepted from topic-evidence.md. RSS/Atom
// URLs below were discovered on these sites' own link[rel=alternate] elements.
const TOPIC_RADAR = Object.freeze([
  { name: 'AIbase 新闻', url: 'https://www.aibase.com/zh/news' },
  { name: '人人都是产品经理 AI', url: 'https://www.woshipm.com/ai' },
  { name: '少数派', url: 'https://sspai.com/' },
  { name: 'Simon Willison', url: 'https://simonwillison.net/atom/everything/' },
  { name: 'Import AI', url: 'https://jack-clark.net/feed/' },
  { name: 'Latent.Space', url: 'https://www.latent.space/feed' },
]);
const TIMEOUT_MS = 12000;
const HEADERS = Object.freeze({
  'User-Agent': 'Mozilla/5.0 (compatible; TopicSignals/1.0)',
  Accept: 'application/json, text/html, application/rss+xml, application/atom+xml;q=0.9',
  'Accept-Encoding': 'identity',
});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const blocked = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) blocked.addSubnet(address, prefix, 'ipv4');

// Only public IPv4 is used; all IPv6 (including mapped, NAT64 and local forms)
// is rejected rather than relying on an incomplete IPv6 special-range list.
function publicAddress(address) {
  return typeof address === 'string' && isIP(address) === 4 && !blocked.check(address, 'ipv4');
}

class SourceError extends Error {
  constructor(code, message, status = 'source_unavailable') {
    super(message); this.code = code; this.status = status;
  }
}
function fail(code, message, status) { throw new SourceError(code, message, status); }
function siteFamily(host) { return host.replace(/^www\./, ''); }
function safeUrl(raw, platform, base) {
  if (typeof raw !== 'string' || raw.length > 8192 || /[\u0000-\u0020\u007f\\]/u.test(raw)) {
    fail('unsafe_url', '来源 URL 格式不安全');
  }
  let url;
  try { url = base ? new URL(raw, base) : new URL(raw); } catch { fail('unsafe_url', '来源 URL 无效'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      !HOSTS[platform]?.includes(url.hostname) || isIP(url.hostname)) {
    fail('unsafe_url', '仅允许该平台白名单域名的 HTTPS 来源，不接受自定义端口、凭据或 IP');
  }
  url.hash = '';
  return url;
}

function header(headers, name) {
  if (typeof headers?.get === 'function') return headers.get(name) || '';
  const value = Object.entries(headers || {}).find(([key]) => key.toLowerCase() === name)?.[1];
  return typeof value === 'string' ? value : '';
}

// GET-only transport: no proxy environment, Cookie jar, Authorization, shell,
// automatic redirects, connection reuse, or unvalidated second DNS lookup.
function requestHttps(url, { address, signal, maxBytes = MAX_BYTES, headers = HEADERS }) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'GET', headers, signal, family: 4, agent: false,
      lookup: (_host, options, callback) => options.all
        ? callback(null, [{ address, family: 4 }]) : callback(null, address, 4),
    }, res => {
      const chunks = []; let bytes = 0;
      if (Number(res.headers['content-length']) > maxBytes) {
        res.destroy(); req.destroy();
        reject(new SourceError('response_too_large', '来源响应超过大小上限')); return;
      }
      res.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > maxBytes) {
          res.destroy(); req.destroy();
          reject(new SourceError('response_too_large', '来源响应超过大小上限'));
        } else chunks.push(chunk);
      });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
      res.on('aborted', () => reject(new SourceError('truncated_response', '来源响应中断')));
    });
    req.on('error', reject);
    req.end();
  });
}

// Some local VPN DNS returns 198.18/15 fake IPs. Never connect to them. A
// fixed, certificate-verified public resolver may supply actual public A
// records. Only the allowlisted hostname (never keyword, URL or credentials)
// leaves via this fallback. The resolver itself is pinned to 8.8.8.8:443;
// it cannot redirect. This changes no machine/network configuration.
async function resolvePublic(hostname, { signal }) {
  let records = [];
  try { records = await dns.lookup(hostname, { family: 4, all: true }); } catch { /* public DNS fallback */ }
  if (records.length && records.every(record => publicAddress(record.address))) return records;
  const response = await requestHttps(new URL(`https://dns.google/resolve?name=${encodeURIComponent(hostname)}&type=A`), {
    address: '8.8.8.8', signal, maxBytes: 16384,
    headers: { Accept: 'application/dns-json', 'Accept-Encoding': 'identity' },
  });
  if (response.status !== 200) fail('dns_unavailable', '公共 DNS 查询失败');
  let data;
  try { data = JSON.parse(response.body.toString('utf8')); } catch { fail('dns_unavailable', '公共 DNS 响应无效'); }
  if (data.Status !== 0 || !Array.isArray(data.Answer)) fail('dns_unavailable', '未取得公开来源的公网地址');
  return data.Answer.filter(record => record.type === 1).map(record => ({ address: record.data, family: 4 }));
}

// One process-wide queue enforces <= 3 simultaneous source reads and >= 1s
// between starts for the same platform, including concurrent collector calls.
let active = 0;
const waiters = [];
const nextHostAt = new Map();
async function withSlot(work) {
  if (active >= 3) await new Promise(resolve => waiters.push(resolve));
  else active++;
  try { return await work(); } finally {
    if (waiters.length) waiters.shift()(); else active--;
  }
}
async function throttle(hostname, pause) {
  const now = Date.now();
  const start = Math.max(now, nextHostAt.get(hostname) || 0);
  nextHostAt.set(hostname, start + 1000);
  if (start > now) await pause(start - now);
}
function abortable(operation, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new SourceError('timeout', '来源请求超时'));
    if (signal.aborted) return abort();
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve().then(operation).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

async function readSource(raw, platform, deps) {
  let url = safeUrl(raw, platform);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs);
  const signal = controller.signal;
  try {
    for (let redirects = 0; redirects <= 2; redirects++) {
      if (/\/(?:login|signin|passport)(?:\/|$)/i.test(url.pathname)) {
        fail('login_required', '来源跳转到登录页面', 'needs_login');
      }
      await abortable(() => throttle(url.hostname, deps.sleep), signal);
      const records = await abortable(() => deps.lookup(url.hostname, { family: 4, all: true, signal }), signal);
      if (!Array.isArray(records) || !records.length || records.some(record => !publicAddress(record.address))) {
        fail('unsafe_dns', 'DNS 未返回全公网 IPv4 地址，已阻止访问');
      }
      const response = await abortable(() => deps.request(url, {
        address: records[0].address, signal, maxBytes: MAX_BYTES, headers: HEADERS,
      }), signal);
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (redirects === 2) fail('redirect_limit', '来源重定向次数超过上限');
        const location = header(response.headers, 'location');
        if (!location) fail('invalid_redirect', '来源重定向缺少地址');
        const next = safeUrl(location, platform, url);
        if (siteFamily(next.hostname) !== siteFamily(url.hostname)) fail('unsafe_redirect', '禁止重定向到其他来源站点');
        url = next;
        continue;
      }
      if (response.status === 401) fail('login_required', '官方来源要求登录或身份验证（HTTP 401）', 'needs_login');
      if (response.status === 403) fail('http_403', '官方来源拒绝访问（HTTP 403），未尝试绕过');
      if (response.status === 429) fail('rate_limited', '官方来源限流（HTTP 429），未自动重试');
      if (response.status < 200 || response.status >= 300 || !Number.isInteger(response.status)) {
        fail('http_error', `官方来源请求失败（HTTP ${Number(response.status) || 'unknown'}）`);
      }
      if (header(response.headers, 'content-encoding') && header(response.headers, 'content-encoding') !== 'identity') {
        fail('unsupported_encoding', '来源未返回请求的未压缩正文');
      }
      const contentType = header(response.headers, 'content-type');
      if (contentType && !/^(?:text\/(?:html|plain|xml)|application\/(?:json|[^;\s]+\+json|xml|rss\+xml|atom\+xml|xhtml\+xml))(?:;|$)/i.test(contentType)) {
        fail('unsupported_content', '来源不是可读取的 HTML、JSON 或订阅文档');
      }
      if (!(typeof response.body === 'string' || Buffer.isBuffer(response.body))) fail('invalid_response', '来源响应正文无效');
      if (Buffer.byteLength(response.body) > MAX_BYTES) fail('response_too_large', '来源响应超过大小上限');
      const body = response.body.toString('utf8').replace(/^\uFEFF/, '');
      if (!body.trim()) fail('empty_response', '官方来源返回空响应，未取得选题数据');
      return { body, finalUrl: url.href, capturedAt: new Date(deps.now()).toISOString() };
    }
  } finally { clearTimeout(timer); }
}

function cleanText(value, limit = 240) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  let text = String(value).slice(0,20000);
  for (let pass = 0; pass < 2; pass++) {
    const { document } = parseHTML(`<html><body>${text}</body></html>`);
    document.querySelectorAll('script,style,iframe,object,embed,svg,template,noscript').forEach(node => node.remove());
    text = document.body.textContent;
  }
  return [...text.replace(/<[^>]*>/g, '').replace(/[<>]/g, '').replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim()].slice(0, limit).join('');
}
function count(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const match = String(value).trim().replace(/,/g, '').match(/^(\d+(?:\.\d+)?)\s*(万|亿|[kKmM])?$/);
  if (!match) return undefined;
  const result = Number(match[1]) * ({ 万: 1e4, 亿: 1e8, k: 1e3, K: 1e3, m: 1e6, M: 1e6 }[match[2]] || 1);
  return Number.isFinite(result) && result >= 0 && result <= Number.MAX_SAFE_INTEGER ? result : undefined;
}
function publicationDate(value, capturedAt) {
  if (value == null || value === '') return {};
  let date;
  if ((typeof value === 'number' || /^\d{10}(?:\d{3})?$/.test(String(value))) && Number(value) > 0) {
    date = new Date(Number(value) * (Number(value) < 1e12 ? 1000 : 1));
  } else if (typeof value === 'string') {
    const iso = value.trim();
    if (/^(?:[A-Za-z]{3},\s*)?\d{1,2}\s+[A-Za-z]{3}\s+\d{4}\s+\d{2}:\d{2}(?::\d{2})?\s+(?:GMT|UTC|[+-]\d{4})$/i.test(iso)) {
      return publicationDate(Date.parse(iso), capturedAt);
    }
    const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ]|$)/);
    if (!match) return { dateWarning: 'unverifiable_publication_date' };
    const day = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`);
    if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== match[0].slice(0, 10)) {
      return { dateWarning: 'invalid_publication_date' };
    }
    date = new Date(iso.length === 10 ? `${iso}T00:00:00+08:00`
      : /(?:Z|[+-]\d{2}:?\d{2})$/i.test(iso) ? iso : `${iso.replace(' ', 'T')}+08:00`);
  }
  if (!date || !Number.isFinite(date.getTime())) return { dateWarning: 'invalid_publication_date' };
  if (date.getTime() > Date.parse(capturedAt)) return { dateWarning: 'future_publication_date_omitted' };
  return { publishedAt: date.toISOString() };
}
function identityUrl(url, platform) {
  const key = new URL(url);
  if (siteFamily(key.hostname) === 'sspai.com' && /^\/post\/\d+\/?$/.test(key.pathname)) key.hostname = 'sspai.com';
  if (platform === 'weixin' && key.pathname === '/s') {
    const params = new URLSearchParams();
    for (const name of ['__biz', 'mid', 'idx']) if (key.searchParams.has(name)) params.set(name, key.searchParams.get(name));
    if (params.has('__biz') && params.has('mid')) key.search = params.toString();
  } else key.search = '';
  return key.href.replace(/\/$/, '');
}
function normalizeItem(raw, context) {
  const title = cleanText(raw.title);
  if (!title) return null;
  let url;
  try { url = safeUrl(raw.url || context.finalUrl, context.platform, context.finalUrl).href; } catch { return null; }
  // Public lists/feeds must point to real article paths, not profiles, store
  // links, missing feed links or a fabricated fallback to the source homepage.
  if (context.platform === 'sspai' && (!raw.url || !isArticleUrl(url, 'sspai', context.finalUrl))) return null;
  const excerpt = cleanText(raw.excerpt, 180);
  const date = publicationDate(raw.publishedAt, context.capturedAt);
  const metrics = {};
  for (const key of ['rank', 'hotValue', 'likeCount', 'viewCount', 'commentCount']) {
    const value = count(raw.metrics?.[key]);
    if (value !== undefined && (key !== 'rank' || (Number.isInteger(value) && value > 0))) metrics[key] = value;
  }
  if (raw.metrics?.heatText) metrics.heatText = cleanText(raw.metrics.heatText, 60);
  const sourceKind = context.sourceKind === 'topic_radar' ? 'topic_radar' : raw.sourceKind || context.sourceKind;
  const nativeId = typeof raw.nativeId === 'string' || Number.isSafeInteger(raw.nativeId) ? cleanText(raw.nativeId, 160) : '';
  const key = nativeId ? `native:${nativeId}` : raw.url ? identityUrl(url, context.platform) : `${url}:${title}`;
  const limitations = [];
  if (date.dateWarning) limitations.push(date.dateWarning);
  if (!date.publishedAt) limitations.push('publication_date_unknown');
  if (!Object.keys(metrics).length) limitations.push('popularity_unknown');
  if (!raw.bodyRead) limitations.push('article_body_not_read');
  if (sourceKind === 'topic_radar') limitations.push('not_weixin_native_popularity');
  if (siteFamily(new URL(context.finalUrl).hostname) === 'sspai.com') {
    limitations.push('not_sitewide_ranking', 'selection_probability_unknown');
  }
  if (context.platform === 'uisdc') limitations.push('not_sitewide_ranking');
  if (raw.partialPage) limitations.push('partial_homepage_sample');
  return {
    id: `${context.platform}:${createHash('sha256').update(key).digest('hex').slice(0, 24)}`,
    platform: context.platform, title, url, sourceUrl: context.sourceUrl,
    capturedAt: context.capturedAt, sourceKind, metrics,
    ...(context.sourceName ? { sourceName: context.sourceName } : {}),
    evidenceLevel: raw.bodyRead && excerpt ? 'article_excerpt' : excerpt ? 'title_and_excerpt' : 'title_only',
    ...(date.publishedAt ? { publishedAt: date.publishedAt } : {}),
    ...(excerpt ? { excerpt } : {}), limitations,
    ...(raw.displayedTime ? { displayedTime: cleanText(raw.displayedTime, 60) } : {}),
  };
}

function parseJson(data, platform) {
  if (platform === 'toutiao' && Array.isArray(data.data)) return data.data.slice(0, 300).map((row, i) => ({
    title: row?.Title, url: row?.Url, nativeId: row?.ClusterIdStr,
    metrics: { rank: i + 1, hotValue: row?.HotValue }, sourceKind: 'official_hot_list',
  }));
  if (platform === 'douyin' && Array.isArray(data.data?.word_list)) return data.data.word_list.slice(0, 300).map((row, i) => ({
    title: row?.word, url: row?.url, nativeId: row?.sentence_id,
    metrics: { rank: i + 1, hotValue: row?.hot_value }, sourceKind: 'official_hot_list',
    // event_time and query/board generation times are not article publication dates.
  }));
  if (platform === 'zhihu' && Array.isArray(data.data)) return data.data.slice(0, 300).map((row, i) => ({
    title: row?.target?.title, url: row?.target?.url?.replace(/^https:\/\/api\.zhihu\.com\/questions\//, 'https://www.zhihu.com/question/'),
    excerpt: row?.target?.excerpt, publishedAt: row?.target?.created,
    metrics: { rank: i + 1, heatText: row?.detail_text }, sourceKind: 'official_hot_list',
  }));
  return [];
}
function attr(document, selector, name = 'content') { return document.querySelector(selector)?.getAttribute(name); }
function isArticleUrl(raw, platform, base) {
  try {
    const url = safeUrl(raw, platform, base);
    return ({
      douyin: /^\/video\/\d+\/?$/, xiaohongshu: /^\/explore\/[a-f0-9]+\/?$/i,
      toutiao: /^\/article\/\d+\/?$/, zhihu: /^\/(?:question|p)\/\d+(?:\/answer\/\d+)?\/?$/,
      woshipm: /^\/[^/]+\/\d+\.html$/, sspai: /^\/post\/\d+\/?$/, weixin: /^\/s(?:\/[^/]+)?\/?$/,
      uisdc: /^\/(?!archives\/?$|contribution\/?$|history\/?$|login\/?$|about\/?$|search\/?$)[a-z0-9][a-z0-9-]*\/?$/i,
    })[platform].test(url.pathname);
  } catch { return false; }
}

function parseDocument(body, context) {
  const trimmed = body.trim();
  if (/^[{[]/.test(trimmed)) {
    let data;
    try { data = JSON.parse(trimmed); } catch { fail('invalid_json', '来源 JSON 无法解析'); }
    if (data === null || typeof data !== 'object') fail('invalid_json', '来源 JSON 结构无效');
    const rows = parseJson(data, context.platform);
    if (!rows.length && /login|authentication|登录|身份.*验证/i.test(String(data.error?.name || '') + String(data.error?.message || '') + String(data.message || ''))) {
      fail('login_required', '官方接口要求登录或身份验证', 'needs_login');
    }
    return rows;
  }
  const xml = /^<\?xml|^<(?:rss|feed)\b/i.test(trimmed);
  if (xml) {
    if (/<!DOCTYPE|<!ENTITY/i.test(body)) fail('unsafe_xml', '订阅文档包含不允许的实体声明');
    const document = new DOMParser().parseFromString(body, 'text/xml');
    return [...document.querySelectorAll('item,entry')].slice(0, 300).map(entry => ({
      title: entry.querySelector('title')?.textContent,
      url: entry.querySelector('link[rel="alternate"]')?.getAttribute('href') || entry.querySelector('link')?.getAttribute('href') || entry.querySelector('link')?.textContent,
      excerpt: entry.querySelector('description,summary,content')?.textContent,
      publishedAt: entry.querySelector('pubDate,published')?.textContent,
      sourceKind: context.platform === 'sspai' ? 'official_public_feed' : 'user_subscription',
    }));
  }
  const { document } = parseHTML(body);
  const hiddenXhsFeed = context.platform === 'xiaohongshu' && [...document.querySelectorAll('.feeds-container[style]')]
    .some(node => /visibility\s*:\s*hidden/i.test(node.getAttribute('style')) && node.querySelector('section.note-item'));
  document.querySelectorAll('script,style,iframe,object,embed,svg,template,noscript,[hidden],[aria-hidden="true"]').forEach(node => node.remove());
  document.querySelectorAll('[style]').forEach(node => {
    if (/(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(node.getAttribute('style'))) node.remove();
  });
  const pageTitle = cleanText(document.querySelector('title')?.textContent);
  if (/^(?:登录|登陆|请先登录|安全验证|验证码)|sign\s?in|captcha|access denied|just a moment/i.test(pageTitle)) {
    fail(/登录|登陆|sign\s?in/i.test(pageTitle) ? 'login_required' : 'access_challenge',
      '官方来源显示登录或访问验证页面', /登录|登陆|sign\s?in/i.test(pageTitle) ? 'needs_login' : 'source_unavailable');
  }
  const rows = [];
  if (context.platform === 'xiaohongshu') {
    for (const card of [...document.querySelectorAll('section.note-item')].slice(0, 300)) {
      const link = card.querySelector('a.title[href]');
      if (link) rows.push({ title: link.textContent, url: link.getAttribute('href'),
        metrics: { likeCount: card.querySelector('.like-wrapper .count')?.textContent }, sourceKind: 'recommendation_feed' });
    }
  }
  const origin = new URL(context.finalUrl).hostname;
  if (siteFamily(origin) === 'woshipm.com') {
    for (const card of [...document.querySelectorAll('.postlist-item,li.widget-post-item--withImage')].slice(0, 300)) {
      const link = [...card.querySelectorAll('a[href]')].find(a => isArticleUrl(a.getAttribute('href'), 'woshipm', context.finalUrl) && cleanText(a.getAttribute('title') || a.textContent));
      if (link) rows.push({ title: link.getAttribute('title') || link.textContent, url: link.getAttribute('href'),
        excerpt: card.querySelector('[itemprop="description"],.post-excerpt,.postlist-item__excerpt')?.textContent,
        publishedAt: attr(card, 'time[datetime]', 'datetime'), sourceKind: 'official_public_feed',
        partialPage: card.classList.contains('widget-post-item--withImage') });
    }
    if (!rows.length) {
      for (const link of [...document.querySelectorAll('h2 a[href],h3 a[href],.title a[href],.post-title a[href]')].slice(0, 300)) {
        if (isArticleUrl(link.getAttribute('href'), 'woshipm', context.finalUrl) && cleanText(link.textContent).length >= 8) {
          rows.push({ title: link.textContent, url: link.getAttribute('href'), sourceKind: 'official_public_feed', partialPage: true });
        }
      }
    }
  }
  if ((context.platform === 'sspai' || context.sourceKind === 'topic_radar') && siteFamily(origin) === 'sspai.com') {
    for (const card of [...document.querySelectorAll('article.comp__ArticleCard')].slice(0, 100)) {
      const link = card.querySelector('a.article__card__link[href]');
      if (link) rows.push({ title: card.querySelector('.article__card__title')?.textContent,
        url: link.getAttribute('href'), sourceKind: 'official_public_feed', partialPage: true });
    }
  }
  if (context.platform === 'uisdc' && siteFamily(origin) === 'uisdc.com') {
    for (const card of [...document.querySelectorAll('.list-item.item-article')].slice(0, 100)) {
      const link = card.querySelector('h2.item-title a[href]');
      if (link && isArticleUrl(link.getAttribute('href'), 'uisdc', context.finalUrl)) rows.push({
        title: link.textContent, url: link.getAttribute('href'),
        excerpt: card.querySelector('.item-desc .desc-wrap')?.textContent,
        displayedTime: card.querySelector('.meta-time')?.textContent,
        sourceKind: 'official_public_feed', partialPage: true,
      });
    }
    // The official /archives page uses f-box cards rather than homepage cards.
    for (const main of [...document.querySelectorAll('.archive-allposts .f-box.c-box > .item-wrap > .item-main')].slice(0,100)) {
      const link=main.querySelector('h2.item-title a[href]');
      if(link && isArticleUrl(link.getAttribute('href'),'uisdc',context.finalUrl)) rows.push({
        title:link.textContent,url:link.getAttribute('href'),excerpt:main.querySelector('.item-desc .desc-wrap,.item-desc')?.textContent,
        displayedTime:main.querySelector('.meta-time')?.textContent,sourceKind:'official_public_feed',partialPage:true,
      });
    }
  }
  if (context.sourceKind === 'topic_radar' && siteFamily(origin) === 'aibase.com') {
    for (const link of [...document.querySelectorAll('a[href]')].slice(0, 600)) {
      const href = link.getAttribute('href');
      if (/^(?:https:\/\/(?:www\.)?aibase\.com)?\/zh\/news\/\d+\/?$/.test(href)) {
        const title = link.querySelector('h2,h3')?.textContent || link.getAttribute('title') || link.textContent;
        if (cleanText(title).length >= 6) rows.push({ title, url: href, partialPage: true });
      }
    }
  }
  if (context.platform === 'weixin' && !isArticleUrl(context.finalUrl, 'weixin', context.finalUrl)) {
    for (const link of [...document.querySelectorAll('a[href]')].slice(0, 600)) {
      if (isArticleUrl(link.getAttribute('href'), 'weixin', context.finalUrl)) rows.push({
        title: link.textContent || link.getAttribute('title'), url: link.getAttribute('href'), sourceKind: 'user_subscription',
      });
    }
  }
  if (!rows.length && isArticleUrl(context.finalUrl, context.platform, context.finalUrl)) {
    const content = document.querySelector(context.platform === 'weixin' ? '#js_content'
      : 'article .article-content, .article-content, .rich_media_content, .RichText, .note-content, #noteContainer .desc, article');
    const title = context.platform === 'weixin'
      ? document.querySelector('#activity-name')?.textContent || attr(document, 'meta[property="og:title"]')
      : attr(document, 'meta[property="og:title"]') || document.querySelector('h1')?.textContent;
    if (title) rows.push({ title, url: context.finalUrl, bodyRead: !!cleanText(content?.textContent),
      excerpt: content?.textContent || attr(document, 'meta[property="og:description"]') || attr(document, 'meta[name="description"]'),
      publishedAt: attr(document, 'meta[property="article:published_time"]') || attr(document, 'time[datetime]', 'datetime') || document.querySelector('#publish_time')?.textContent?.trim(),
      sourceKind: 'user_article',
    });
  }
  if (!rows.length) {
    const visible = cleanText(document.body?.textContent || document.textContent, 10000);
    if (/请先登[录陆]|登[录陆]后(?:查看|浏览|访问|继续)|扫码登[录陆]|登录探索更多|登录查看更多/i.test(visible)) {
      fail('login_required', '公开页面没有目标内容，并提示登录后查看', 'needs_login');
    }
    if (/验证码|安全验证|访问异常|访问过于频繁|captcha|verify you are human|access denied/i.test(visible)) {
      fail('access_challenge', '官方来源要求验证码或访问验证，未尝试绕过');
    }
    if (hiddenXhsFeed) fail('requires_render', '公开 HTML 含推荐卡片，但列表被隐藏并依赖客户端渲染；未验证实际展示');
  }
  return rows;
}

/**
 * Read public first-party topic signals. No publishing, account credentials or
 * AI calls. options: {platforms = SUPPORTED_TOPIC_PLATFORMS, keyword = '', limit = 10,
 * sourceUrlsByPlatform = {weixin: ['https://mp.weixin.qq.com/s/...']}}.
 * Nonempty source arrays REPLACE defaults. Missing/empty arrays use defaults,
 * so the UI's initial {platform: []} fields never disable collection.
 * Weixin defaults to the six user-authorized xiaopu-writing topic-radar source
 * families above. It is NOT a Weixin hot list or native readership signal.
 * Sspai reads its public homepage/feeds as selected/recent content signals,
 * never a sitewide hot list, popularity ranking or selection probability.
 * Explicit mp.weixin.qq.com article/album URLs remain supported. Unknown
 * domains and third-party feed mirrors are rejected.
 * keyword is returned as keywordHint for the shared AI analysis stage. It
 * never filters the collection, sends a platform search, or changes ranks.
 *
 * Status: ok | partial | needs_login | needs_browser | source_unavailable | needs_sources.
 * sourceKind: official_hot_list | official_public_feed | user_article |
 * user_subscription | topic_radar | recommendation_feed. evidenceLevel: title_only | title_and_excerpt |
 * article_excerpt. Missing dates/metrics are omitted (never guessed/zeroed).
 * Titles/excerpts are untrusted plain text; consumers must use textContent or
 * context-appropriate escaping. sourceUrl and sources[] preserve provenance.
 *
 * deps is a TRUSTED test seam, never accept it from HTTP input:
 * {now:()=>Date|number, lookup:async(host,{signal})=>[{address,family:4}],
 * request:async(URL,{address,signal,maxBytes,headers})=>{status,headers,body},
 * sleep:async(ms)=>void, timeoutMs, browserSource:collectBrowserTopicSignals}.
 * For the three supported platforms, empty/unrendered/401 HTTP sources get
 * at most one project-session browser fallback. Unsafe URLs, 403, captcha,
 * rate limits and other hard failures never trigger that fallback.
 */
async function collectTopicSignals(options = {}, injected = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('options must be an object');
  const { platforms = SUPPORTED_TOPIC_PLATFORMS, keyword = '', limit = 10, sourceUrlsByPlatform = {} } = options;
  if (!Array.isArray(platforms) || platforms.length > SUPPORTED_TOPIC_PLATFORMS.length || platforms.some(id => !SUPPORTED_TOPIC_PLATFORMS.includes(id))) throw new TypeError('platforms must contain only SUPPORTED_TOPIC_PLATFORMS identifiers within the supported count');
  if (typeof keyword !== 'string' || keyword.length > 200) throw new TypeError('keyword must be a string of at most 200 characters');
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new TypeError('limit must be an integer between 1 and 50');
  if (!sourceUrlsByPlatform || typeof sourceUrlsByPlatform !== 'object' || Array.isArray(sourceUrlsByPlatform)) throw new TypeError('sourceUrlsByPlatform must be an object');
  if (Object.keys(sourceUrlsByPlatform).some(id => !SUPPORTED_TOPIC_PLATFORMS.includes(id))) throw new TypeError('sourceUrlsByPlatform contains an unsupported platform');
  const deps = { now: Date.now, lookup: resolvePublic, request: requestHttps, sleep, timeoutMs: TIMEOUT_MS,
    browserSource: collectBrowserTopicSignals, ...injected };
  deps.timeoutMs = Math.max(1, Math.min(TIMEOUT_MS, Number(deps.timeoutMs) || TIMEOUT_MS));
  const collectedAt = new Date(deps.now()).toISOString();
  const keywordHint = cleanText(keyword, 200);
  const results = await Promise.all([...new Set(platforms)].map(async platform => {
    const supplied = Object.hasOwn(sourceUrlsByPlatform, platform) &&
      !(Array.isArray(sourceUrlsByPlatform[platform]) && sourceUrlsByPlatform[platform].length === 0);
    const urls = supplied ? sourceUrlsByPlatform[platform] : platform === 'weixin' ? TOPIC_RADAR.map(source => source.url) : [DEFAULTS[platform]];
    const result = { id: platform, status: 'needs_sources', sourceUrl: null, reason: '', items: [], sources: [] };
    const maxSources = platform === 'weixin' ? 6 : MAX_SOURCES;
    if (!Array.isArray(urls) || urls.length > maxSources || urls.some(url => typeof url !== 'string')) {
      return { ...result, status: 'source_unavailable', reason: `来源必须是最多 ${maxSources} 个白名单 HTTPS URL 的数组` };
    }
    if (!urls.length) {
      result.reason = platform === 'weixin' ? '已显式清空公众号选题雷达来源；请配置 Skill 雷达来源或文章/订阅链接' : '请提供该平台的官方来源链接';
      return result;
    }
    const unique = [...new Set(urls)];
    try { result.sourceUrl = safeUrl(unique[0], platform).href; } catch { /* unsafe raw input is not reflected */ }
    const items = new Map();
    for (const raw of unique) {
      const source = { url: null, capturedAt: new Date(deps.now()).toISOString(), status: 'source_unavailable', reason: '', itemCount: 0 };
      try {
        source.url = safeUrl(raw, platform).href;
        const radar = platform === 'weixin' && new URL(source.url).hostname !== 'mp.weixin.qq.com';
        const sourceName = radar ? TOPIC_RADAR.find(entry => siteFamily(new URL(entry.url).hostname) === siteFamily(new URL(source.url).hostname))?.name
          : platform === 'sspai' ? (new URL(source.url).pathname === '/' ? '少数派首页精选/近期内容信号' : '少数派公开内容信号') : platform === 'uisdc' ? '优设公开文章列表（非全站热榜）' : undefined;
        if (sourceName) source.name = sourceName;
        const fetched = await withSlot(() => readSource(source.url, platform, deps));
        Object.assign(source, { finalUrl: fetched.finalUrl, capturedAt: fetched.capturedAt });
        const context = { ...fetched, platform, sourceUrl: source.url, sourceName,
          sourceKind: radar ? 'topic_radar' : supplied ? 'user_article' : 'official_public_feed' };
        const rows = parseDocument(fetched.body, context);
        let dropped = 0;
        for (const rawItem of rows) {
          const item = normalizeItem(rawItem, context);
          if (!item) { dropped++; continue; }
          source.itemCount++;
          if (!items.has(item.id)) items.set(item.id, item);
        }
        if (!source.itemCount) fail(rows.length ? 'invalid_items' : 'empty_source', rows.length ? '来源条目缺少有效标题或同平台安全链接' : '公开来源未包含可解析的选题条目；可能需登录、动态渲染或页面结构已变化');
        source.status = dropped ? 'partial' : 'ok';
        source.reason = dropped ? `已跳过 ${dropped} 条无效或不安全条目` : '已读取官方来源的可见条目';
      } catch (error) {
        source.capturedAt = new Date(deps.now()).toISOString();
        source.status = error instanceof SourceError ? error.status : 'source_unavailable';
        source.code = error instanceof SourceError ? error.code : 'network_error';
        source.reason = error instanceof SourceError ? error.message : '来源网络请求或解析失败';
        if (!(error instanceof SourceError) && (/TLS|CERT/.test(String(error.code || '')) || /before secure TLS connection|certificate/i.test(String(error.message || '')))) {
          source.code = 'tls_error';
          source.reason = '来源 TLS 连接或证书校验失败；未降低证书校验要求';
        }
      }
      result.sources.push(source);
    }
    const all = [...items.values()];
    const failed = result.sources.filter(source => source.status !== 'ok');
    if (all.length) {
      result.status = failed.length ? 'partial' : 'ok';
      const matching = all;
      if (platform === 'weixin') {
        // Preserve source diversity under a small limit. This interleaving is
        // not a popularity ranking and never manufactures cross-source heat.
        const groups = [...new Set(matching.map(item => item.sourceUrl))].map(url => matching.filter(item => item.sourceUrl === url));
        for (let index = 0; result.items.length < limit && groups.some(group => index < group.length); index++) {
          for (const group of groups) if (group[index] && result.items.length < limit) result.items.push(group[index]);
        }
      } else result.items = matching.slice(0, limit);
      result.reason = failed.length ? '部分来源或条目不可用；已保留成功采集的证据'
        : '已采集；热榜、推荐流与文章证据以 sourceKind 区分，关注领域由后续分析处理';
    } else {
      result.status = result.sources.some(source => source.status === 'needs_login') ? 'needs_login' : 'source_unavailable';
      result.reason = result.sources.map(source => source.reason).join('；');
    }
    result.fetchedCount = all.length;
    if (platform === 'sspai') {
      result.reason = `少数派公开精选/近期内容信号（非全站热榜，不推算上精选概率）：${result.reason}`;
    }
    if (platform === 'uisdc') result.reason = `优设公开文章线索（非全站热榜，未读全文）：${result.reason}`;
    if (platform === 'weixin') {
      result.coverage = { attempted: result.sources.length,
        readable: result.sources.filter(source => ['ok', 'partial'].includes(source.status)).length,
        missing: result.sources.filter(source => !['ok', 'partial'].includes(source.status)).map(source => ({ url: source.url, name: source.name, reason: source.reason })) };
      if (result.sources.some(source => source.name)) {
        const missing = result.coverage.missing.map(source => `${source.name || '来源'}：${source.reason}`).join('；');
        result.reason = `公众号选题雷达（${result.coverage.readable}/${result.coverage.attempted} 来源可读，非公众号原生热榜或阅读量）：${result.reason}${missing ? `；缺失：${missing}` : ''}`;
      }
    }
    const browserEligible = new Set(['empty_response', 'empty_source', 'requires_render', 'login_required']);
    if (!result.items.length && BROWSER_PLATFORMS.includes(platform) && result.sources.length &&
        result.sources.every(source => browserEligible.has(source.code))) {
      // The only browser call site: one fallback per platform, no browser
      // startup, credentials, source URL or arbitrary CDP commands from input.
      try {
        const browser = await deps.browserSource({ platform, limit });
        if (browser) {
          const httpReason = result.reason;
          result.browserFallback = { status: browser.status, code: browser.code, reason: browser.reason };
          result.sources.push({ url: browser.sourceUrl, capturedAt: browser.capturedAt,
            status: browser.status, code: browser.code, reason: browser.reason,
            itemCount: browser.items.length, transport: 'project_browser_dom' });
          result.status = browser.status;
          result.reason = `${httpReason}；浏览器采集：${browser.reason}`;
          result.items = browser.items;
          result.fetchedCount = browser.items.length;
          if (browser.items.length) result.sourceUrl = browser.sourceUrl;
        }
      } catch {
        result.status = 'needs_browser';
        result.reason += '；项目浏览器采集不可用，请先在工作台平台登录并保持浏览器运行';
      }
    }
    return result;
  }));
  return { collectedAt, keywordHint, platforms: results };
}

module.exports = { SUPPORTED_TOPIC_PLATFORMS, SIX_PLATFORMS, collectTopicSignals };
