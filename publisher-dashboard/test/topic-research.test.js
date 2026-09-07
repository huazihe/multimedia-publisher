'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SUPPORTED_TOPIC_PLATFORMS, collectTopicSignals } = require('../topic-sources');
const topics = require('../topic-research');

// All collections/analyzers below are local fixtures. No model process,
// network request, server or production topic-research directory is used.
const NOW = '2026-09-05T12:00:00.000Z';
const sourceUrl = 'https://sspai.com/?utm_source=fixture';
function collection() {
  return { collectedAt: NOW, platforms: [{ id: 'sspai', status: 'ok', sourceUrl,
    reason: '首页精选/近期内容信号，非全站热榜', items: [{ id: 'sspai:123', platform: 'sspai',
      title: '少数派公开内容测试', url: 'https://sspai.com/post/123?utm_source=fixture', sourceUrl,
      sourceName: '少数派首页精选/近期内容信号', capturedAt: NOW, sourceKind: 'official_public_feed',
      evidenceLevel: 'title_only', metrics: {}, limitations: ['partial_homepage_sample',
        'publication_date_unknown', 'popularity_unknown', 'article_body_not_read',
        'not_sitewide_ranking', 'selection_probability_unknown'] }] }] };
}
function analysis(id, platforms = ['sspai']) {
  return { status: 'ready', summary: '从公开来源提出待核实方向', cards: [{ id: 'topic-card',
    topic: '用真实任务验证工具是否适用', platforms, reader_problem: '这个工具适合哪些任务？',
    angle: '补做同任务实测', why_now: '首页出现相关内容，发布时间待核实', reader_payoff: '适用条件与限制',
    evidence_ids: [id], missing_evidence: ['文章正文', '原始发布时间', '作者实测'], risk: 'medium' }] };
}
function temporaryRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'creator-topic-research-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('request defaults and model schema share the supported platform priority list', () => {
  assert.equal(topics.SUPPORTED_TOPIC_PLATFORMS, SUPPORTED_TOPIC_PLATFORMS);
  assert.equal(topics.PLATFORM_IDS, SUPPORTED_TOPIC_PLATFORMS);
  assert.deepEqual(topics.validateRequest({}).platforms, SUPPORTED_TOPIC_PLATFORMS);
  assert.deepEqual(topics.validateRequest({ platforms: [...SUPPORTED_TOPIC_PLATFORMS] }).platforms, SUPPORTED_TOPIC_PLATFORMS);
  assert.deepEqual(topics.validateRequest({ platforms: ['sspai', 'sspai'], sourceUrlsByPlatform: { sspai: [] } }).platforms, ['sspai']);
  const platformSchema = topics.OUTPUT_SCHEMA.properties.cards.items.properties.platforms;
  assert.equal(platformSchema.items.enum, SUPPORTED_TOPIC_PLATFORMS);
  assert.equal(platformSchema.maxItems, SUPPORTED_TOPIC_PLATFORMS.length);
  for (const request of [{ platforms: [] }, { platforms: [...SUPPORTED_TOPIC_PLATFORMS, 'sspai'] },
    { platforms: ['unknown'] }, { platforms: ['优派'] }, { platforms: ['you pai'] },
    { sourceUrlsByPlatform: { unknown: [] } }]) assert.throws(() => topics.validateRequest(request), { statusCode: 400 });
});

test('Sspai normalization retains source provenance, missing dates and sample limitations', () => {
  const input = collection();
  const [signal] = topics.normalizedSignals(input);
  assert.match(signal.id, /^sspai-[a-f0-9]{16}$/);
  assert.equal(signal.sourceUrl, sourceUrl);
  assert.equal(signal.sourceName, input.platforms[0].items[0].sourceName);
  assert.equal(signal.sourceKind, 'official_public_feed');
  assert.equal(signal.evidenceLevel, 'title_only');
  assert.equal(signal.publishedAt, null);
  assert.equal(signal.capturedAt, NOW);
  assert.deepEqual(signal.metrics, {});
  assert.deepEqual(signal.limitations, input.platforms[0].items[0].limitations);
  input.platforms[0].items[0].title = '文章标题调整';
  input.platforms[0].items[0].capturedAt = '2026-09-05T12:01:00.000Z';
  assert.equal(topics.normalizedSignals(input)[0].id, signal.id);
});

test('collector IDs deduplicate Sspai feed variants and remain separate from the Weixin radar namespace', async () => {
  const collected = await collectTopicSignals({ platforms: ['weixin', 'sspai'],
    sourceUrlsByPlatform: { weixin: ['https://sspai.com/feed'], sspai: ['https://sspai.com/feed'] } }, {
    now: () => Date.parse(NOW), sleep: async () => {}, lookup: async () => [{ address: '93.184.215.14', family: 4 }],
    request: async () => ({ status: 200, headers: { 'content-type': 'application/rss+xml' }, body:
      '<rss><channel><item><title>文章一</title><link>https://sspai.com/post/123</link></item><item><title>重复文章一</title><link>https://www.sspai.com/post/123/?utm_source=test</link></item><item><title>文章二</title><link>https://sspai.com/post/456</link></item></channel></rss>' }),
    browserSource: async () => { assert.fail('no browser fallback expected'); },
  });
  const signals = topics.normalizedSignals(collected);
  assert.equal(signals.length, 4);
  assert.equal(new Set(signals.map(s => s.id)).size, 4);
  assert.equal(signals.filter(s => s.platform === 'sspai').length, 2);
  const sspaiSignal = signals.find(s => s.platform === 'sspai');
  const weixinSignal = signals.find(s => s.platform === 'weixin');
  assert.equal(sspaiSignal.url, weixinSignal.url);
  assert.equal(sspaiSignal.sourceKind, 'official_public_feed');
  assert.equal(weixinSignal.sourceKind, 'topic_radar');
  assert.ok(weixinSignal.limitations.includes('not_weixin_native_popularity'));
  assert.ok(sspaiSignal.limitations.includes('selection_probability_unknown'));
});

test('analysis accepts captured Sspai references and rejects invented IDs or unselected platforms', () => {
  const signals = topics.normalizedSignals(collection());
  const valid = analysis(signals[0].id);
  assert.equal(topics.validateAnalysis(valid, signals, ['sspai']), valid);
  assert.throws(() => topics.validateAnalysis(analysis('sspai-invented'), signals, ['sspai']), /不存在的证据/);
  assert.throws(() => topics.validateAnalysis(analysis('sspai:123'), signals, ['sspai']), /不存在的证据/);
  assert.throws(() => topics.validateAnalysis(analysis(signals[0].id, ['weixin']), signals, ['sspai']), /超出所选平台/);
  assert.throws(() => topics.validateAnalysis(analysis(signals[0].id, ['优派']), signals, SUPPORTED_TOPIC_PLATFORMS), /超出所选平台/);
});

test('shared service forwards Sspai evidence and boundaries to the injected analyzer with tracking removed', async t => {
  let received;
  const service = topics.createTopicResearchService({ root: temporaryRoot(t), collector: async request => {
    assert.deepEqual(request.platforms, ['sspai']);
    assert.equal(request.keyword, '');
    return collection();
  }, analyzer: async input => { received = input; return analysis(input.signals[0].id); } });
  const run = service.start({ platforms: ['sspai'], keyword: '效率工具' });
  await run.done;
  const saved = service.get(run.id);
  assert.equal(saved.status, 'ready');
  assert.equal(saved.analysis.cards.length, 1);
  assert.deepEqual(received.platforms, ['sspai']);
  assert.equal(received.keyword, '效率工具');
  assert.equal(received.signals[0].url, 'https://sspai.com/post/123');
  assert.equal(received.signals[0].sourceUrl, 'https://sspai.com/');
  assert.equal(received.signals[0].sourceName, '少数派首页精选/近期内容信号');
  assert.deepEqual(received.signals[0].limitations, saved.signals[0].limitations);
  assert.equal(saved.signals[0].sourceUrl, sourceUrl, 'stored original provenance must be preserved');
});

test('Sspai empty collection blocks analysis and cannot overwrite an earlier saved result', async t => {
  let empty = false; let calls = 0;
  const service = topics.createTopicResearchService({ root: temporaryRoot(t), collector: async () => empty
    ? { collectedAt: NOW, platforms: [{ id: 'sspai', status: 'source_unavailable', reason: '公开来源没有数据', items: [] }] }
    : collection(), analyzer: async input => { calls++; return analysis(input.signals[0].id); } });
  const first = service.start({ platforms: ['sspai'] }); await first.done;
  const previous = service.get(first.id);
  empty = true;
  const second = service.start({ platforms: ['sspai'] }); await second.done;
  assert.notEqual(first.id, second.id);
  assert.equal(calls, 1);
  assert.equal(service.get(second.id).status, 'blocked');
  assert.equal(service.get(second.id).analysis, undefined);
  assert.deepEqual(service.get(first.id), previous);
});

test('invented Sspai model references fail without losing the collected evidence', async t => {
  const service = topics.createTopicResearchService({ root: temporaryRoot(t), collector: async () => collection(),
    analyzer: async () => analysis('invented') });
  const run = service.start({ platforms: ['sspai'] }); await run.done;
  const saved = service.get(run.id);
  assert.equal(saved.status, 'analysis_failed');
  assert.equal(saved.analysis, undefined);
  assert.equal(saved.signals.length, 1);
  assert.deepEqual(saved.collection, collection());
  assert.match(saved.error, /不存在的证据/);
});

test('the existing shared Skill covers all supported platforms and Sspai source limits', () => {
  const skill = fs.readFileSync(path.resolve(__dirname, '../../skills/platform-topic-scout/SKILL.md'), 'utf8');
  for (const platform of SUPPORTED_TOPIC_PLATFORMS) assert.ok(skill.includes('`' + platform + '`'));
  assert.match(skill, /https:\/\/sspai\.com\//);
  assert.match(skill, /精选\/近期内容信号/);
  assert.match(skill, /上精选概率/);
  assert.match(skill, /不算成两份独立证据/);
  assert.doesNotMatch(skill, /六平台|六个主流平台/);
});
