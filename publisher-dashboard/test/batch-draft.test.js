'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { createRequire } = require('node:module');
const requireFromCore = createRequire(path.resolve(__dirname, '../../packages/core/package.json'));
const { parseHTML } = requireFromCore('linkedom');
const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
const platforms = [
  { id: 'weixin', name: '微信公众号', delivery_mode: 'draft' },
  { id: 'woshipm', name: '人人都是产品经理', delivery_mode: 'draft' },
  { id: 'sspai', name: '少数派', delivery_mode: 'draft' },
  { id: 'zhihu', name: '知乎' },
  { id: 'uisdc', name: '优设', delivery_mode: 'manual' },
];

function load(name, context) {
  const match = new RegExp(`^(?:async )?function ${name}\\(`, 'm').exec(source);
  assert.ok(match, `missing ${name}`);
  const rest = source.slice(match.index);
  const next = /\n(?:async )?function \w+\(/.exec(rest);
  return vm.runInNewContext(`(${next ? rest.slice(0, next.index) : rest})`, context);
}

function harness(ids = ['weixin', 'woshipm', 'sspai'], accepted = true) {
  const requests = [], prompts = [], toasts = [];
  const state = { data: { platforms, contents: [{ id: 'article', title: '验收稿', updated_at: 'v1' }] },
    selectedContentId: 'article', selectedPlatforms: new Set(ids), batchPublishSubmitting: false };
  const context = { state, $: () => null, $$: () => [], crypto: { randomUUID: () => 'batch-draft-test-operation' },
    window: { confirm: message => { prompts.push(message); return accepted; } },
    platformName: id => platforms.find(p => p.id === id)?.name || id,
    escapeHtml: text => text, platformAvatar: () => '', readSelectedPlatforms: () => [...state.selectedPlatforms],
    beginContentOperation: () => ({}), endContentOperation: () => {}, setBatchPublishBusy: () => {},
    contentOperationIsStable: () => true, renderProgress: () => {}, mergeContentRevisionMetadata: () => true,
    loadData: async () => ({ applied: true }), switchView: () => {},
    toast: message => toasts.push(message),
    request: async (url, options) => { requests.push({ url, body: JSON.parse(options.body) }); return { content: state.data.contents[0] }; },
  };
  for (const name of ['createPublishOperationId', 'beginBatchPublishOperation', 'finishBatchPublishOperation',
    'batchPlatformRestriction', 'confirmBatchPublish', 'platformPreparationMode']) {
    if (source.includes(`function ${name}(`)) context[name] = load(name, context);
  }
  return { state, context, requests, prompts, toasts, publish: load('publishContent', context) };
}

test('batch picker allows all three draft-only platforms and still blocks manual-only entries', () => {
  const { context } = harness();
  const { document } = parseHTML(load('platformPickerHtml', context)(platforms));
  for (const id of ['weixin', 'woshipm', 'sspai']) {
    assert.equal(document.querySelector(`[data-platform-choice="${id}"]`).hasAttribute('disabled'), false, id);
  }
  assert.equal(document.querySelector('[data-platform-choice="uisdc"]').hasAttribute('disabled'), true);
});

test('batch primary action sends three platforms as drafts and never direct', async () => {
  const h = harness();
  assert.equal(await h.publish(), true);
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].url, '/api/publish');
  assert.equal(h.requests[0].body.publishMode, 'draft');
  assert.deepEqual(h.requests[0].body.platforms, ['weixin', 'woshipm', 'sspai']);
  assert.equal(h.prompts.length, 1);
  assert.match(h.prompts[0], /微信公众号.*人人都是产品经理.*少数派/);
  assert.match(h.prompts[0], /不会公开发布/);
});

test('cancelled batch confirmation sends nothing and does not acquire a publish lock', async () => {
  const h = harness(['zhihu'], false);
  assert.equal(await h.publish(), false);
  assert.equal(h.requests.length, 0);
  assert.equal(h.state.batchPublishSubmitting, false);
});

test('automatic direct publishing is blocked for every platform before confirmation and request', async () => {
  const allowed = harness(['zhihu']);
  await allowed.publish('article', 'direct');
  assert.equal(allowed.requests.length, 0);
  assert.equal(allowed.prompts.length, 0);
  const blocked = harness();
  await blocked.publish('article', 'direct');
  assert.equal(blocked.requests.length, 0);
  assert.equal(blocked.prompts.length, 0);
  assert.match(blocked.toasts.at(-1), /同步草稿/);
  const manual = harness(['uisdc']);
  await manual.publish();
  assert.equal(manual.requests.length, 0);
});

test('selection counts drafts, disables direct on mixed selection, and locks both actions in flight', () => {
  const h = harness();
  const { document } = parseHTML('<span data-selected-platform-count></span><button data-action="publish-selected"></button><button data-action="publish-selected-direct"></button><p data-batch-delivery-note></p>');
  const context = { ...h.context, getSelectedContent: () => h.state.data.contents[0], $$: selector => [...document.querySelectorAll(selector)] };
  const sync = load('syncPublishSelectionUi', context);
  sync();
  const draft = document.querySelector('[data-action="publish-selected"]');
  const direct = document.querySelector('[data-action="publish-selected-direct"]');
  assert.equal(document.querySelector('[data-selected-platform-count]').textContent, '已选择 3 项');
  assert.equal(draft.disabled, false);
  assert.equal(direct.disabled, true);
  h.state.selectedPlatforms = new Set(['zhihu']); sync();
  assert.equal(direct.disabled, true);
  h.state.batchPublishSubmitting = true; sync();
  assert.equal(draft.disabled, true); assert.equal(direct.disabled, true);
});

test('handoff uses only the selected article latest platform attempt and never an older draft after failure', () => {
  const h = harness();
  h.state.data.jobs = [
    {content_id:'other',results:[{platform:'weixin',status:'platform_draft',url:'https://example.invalid/other'}]},
    {content_id:'article',results:[{platform:'weixin',status:'failed'}]},
    {content_id:'article',results:[{platform:'weixin',status:'platform_draft',url:'https://example.invalid/stale'}]},
  ];
  const handoff = load('platformHandoffResult',h.context);
  assert.equal(handoff('article','weixin'),null);
  h.state.data.jobs[1].results[0] = {platform:'weixin',status:'uncertain',url:'https://example.invalid/current'};
  assert.equal(handoff('article','weixin').url,'https://example.invalid/current');
});
