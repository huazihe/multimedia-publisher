'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { test } = require('node:test');
const vm = require('node:vm');

const dashboardRoot = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(dashboardRoot, 'public', 'app.js'), 'utf8');
const requireFromCore = createRequire(path.resolve(dashboardRoot, '..', 'packages', 'core', 'package.json'));
const { parseHTML } = (() => {
  try {
    return require('linkedom');
  } catch (error) {
    if (error?.code !== 'MODULE_NOT_FOUND') throw error;
    return requireFromCore('linkedom');
  }
})();

function extractFunctionSource(name, nextName) {
  const starts = [
    appSource.indexOf(`function ${name}(`),
    appSource.indexOf(`async function ${name}(`),
  ].filter(index => index >= 0);
  const start = starts.length ? Math.min(...starts) : -1;
  const ends = [
    appSource.indexOf(`\nfunction ${nextName}(`, start),
    appSource.indexOf(`\nasync function ${nextName}(`, start),
  ].filter(index => index >= 0);
  const end = ends.length ? Math.min(...ends) : -1;
  if (start < 0 || end < 0) return null;
  return appSource.slice(start, end).trim();
}

function extractUntil(name, marker) {
  const start = appSource.indexOf(`function ${name}(`);
  const end = appSource.indexOf(marker, start);
  if (start < 0 || end < 0) return null;
  return appSource.slice(start, end).trim();
}

test('client format inference treats .txt as authoritative', () => {
  const source = extractFunctionSource('inferImportFormat', 'importedBodyByteLength');
  assert.ok(source);
  const inferImportFormat = vm.runInNewContext(`(${source})`);
  assert.equal(inferImportFormat('article.txt', '<article><h1>HTML-looking text</h1></article>'), 'text');
  assert.equal(inferImportFormat('article.txt', '# Markdown-looking text'), 'text');
  assert.equal(inferImportFormat('article.md', '<article>raw html in markdown</article>'), 'markdown');
  assert.equal(inferImportFormat('article.html', '# markdown heading'), 'html');
});

test('request sends the bootstrap CSRF token on mutations only', async () => {
  const source = extractFunctionSource('request', 'loadLayoutTemplates');
  assert.ok(source);
  const calls = [];
  const request = vm.runInNewContext(`(${source})`, {
    API: 'http://127.0.0.1:18810',
    state: { workbenchCsrfToken: 'csrf-token-for-test' },
    fetch: async (url, options) => {
      calls.push({ url, options });
      return { json: async () => ({ ok: true }) };
    },
  });
  await request('/api/content/import', { method: 'POST', body: '{}' });
  await request('/api/bootstrap');
  assert.equal(calls[0].options.headers['X-Workbench-CSRF'], 'csrf-token-for-test');
  assert.equal(calls[1].options.headers['X-Workbench-CSRF'], undefined);
});

test('defensive client sanitizer removes active content while keeping safe article and code markup', () => {
  const source = extractFunctionSource('sanitizeClientCanonicalHtml', 'editableArticleHtml');
  assert.ok(source, '缺少客户端 canonical HTML 防御性净化函数');
  const { document } = parseHTML('<main></main>');
  const sanitizeClientCanonicalHtml = vm.runInNewContext(`(${source})`, { document });
  const sanitized = sanitizeClientCanonicalHtml([
    '<p id="x" style="color:red" onclick="alert(1)" data-action="publish">正文 ',
    '<a href="javascript:alert(1)">链接</a></p>',
    '<img src="data:text/html;base64,PHNjcmlwdD4=" onerror="alert(1)" alt="图">',
    '<table><tr><th align="left">Name</th><td align="right">Value</td></tr></table>',
    '<script>alert(1)</script><button controls>发布</button>',
    '<pre><code class="language-html">&lt;button data-action="code"&gt;示例&lt;/button&gt;</code></pre>',
  ].join(''), document);

  assert.match(sanitized, /<p>正文 <a>链接<\/a><\/p>/);
  assert.match(sanitized, /<th align="left">Name<\/th><td align="right">Value<\/td>/);
  assert.match(sanitized, /<pre><code class="language-html">/);
  assert.doesNotMatch(sanitized, /<script|<button\b|<[^>]+\s(?:on\w+|style|data-action|id)\s*=|<[^>]+\scontrols(?:\s|>|=)|(?:href|src)="(?:javascript:|data:text\/html)/i);
});

test('single publish operation token rejects overlap and stale completion', () => {
  const beginSource = extractFunctionSource('beginSinglePublishOperation', 'finishSinglePublishOperation');
  const finishSource = extractFunctionSource('finishSinglePublishOperation', 'canCancelSinglePublish');
  const cancelSource = extractFunctionSource('canCancelSinglePublish', 'handleSinglePublishDialogCancel');
  assert.ok(beginSource && finishSource && cancelSource, '缺少单平台发布 operation token helpers');
  const beginSinglePublishOperation = vm.runInNewContext(`(${beginSource})`);
  const finishSinglePublishOperation = vm.runInNewContext(`(${finishSource})`);
  const canCancelSinglePublish = vm.runInNewContext(`(${cancelSource})`);
  const publishState = {
    singlePublishSubmitting: false,
    singlePublishOperationToken: '',
    singlePublishOperationSequence: 0,
  };
  const first = beginSinglePublishOperation(publishState, { contentId: 'c1', platform: 'zhihu', mode: 'direct' });
  assert.ok(first?.token);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(canCancelSinglePublish(publishState), false);
  assert.equal(beginSinglePublishOperation(publishState, { contentId: 'c2', platform: 'juejin', mode: 'direct' }), null);
  assert.equal(finishSinglePublishOperation(publishState, 'stale-token'), false);
  assert.equal(publishState.singlePublishSubmitting, true);
  assert.equal(finishSinglePublishOperation(publishState, first.token), true);
  assert.equal(publishState.singlePublishSubmitting, false);
  assert.equal(canCancelSinglePublish(publishState), true);
});

test('opening publish confirmation creates an immutable operationId', () => {
  const createSource = extractFunctionSource('createPublishOperationId', 'beginBatchPublishOperation');
  const openSource = extractFunctionSource('openSinglePublishConfirmation', 'cancelSinglePublish');
  assert.ok(createSource && openSource);
  const createPublishOperationId = vm.runInNewContext(`(${createSource})`, {
    crypto: { randomUUID: () => '12345678-1234-4123-8123-123456789abc' },
  });
  const state = {
    singlePublishSubmitting: false,
    pendingSinglePublish: null,
    data: { contents: [{ id: 'c1', title: '确认文章' }] },
  };
  const dialog = { showModal: () => {} };
  const fields = {
    '#single-publish-article': { textContent: '' },
    '#single-publish-platform': { textContent: '' },
    '#single-publish-mode': { textContent: '' },
    '#platform-publish-dialog': dialog,
  };
  const openSinglePublishConfirmation = vm.runInNewContext(`(${openSource})`, {
    state,
    canCancelSinglePublish: publishState => !publishState.singlePublishSubmitting,
    createPublishOperationId,
    toast: () => {},
    $: selector => fields[selector],
    platformName: platform => platform,
    setSinglePublishFeedback: () => {},
  });
  assert.equal(openSinglePublishConfirmation({ contentId: 'c1', platform: 'zhihu', mode: 'direct' }), true);
  assert.equal(state.pendingSinglePublish.operationId, '12345678-1234-4123-8123-123456789abc');
  assert.equal(Object.isFrozen(state.pendingSinglePublish), true);
});

test('batch double-click keeps one immutable operationId and sends one publish request', async () => {
  const createSource = extractFunctionSource('createPublishOperationId', 'beginBatchPublishOperation');
  const beginSource = extractFunctionSource('beginBatchPublishOperation', 'finishBatchPublishOperation');
  const finishSource = extractFunctionSource('finishBatchPublishOperation', 'setBatchPublishBusy');
  const publishSource = extractFunctionSource('publishContent', 'checkAuth');
  assert.ok(createSource && beginSource && finishSource && publishSource, '缺少批量发布幂等 helpers');

  const createPublishOperationId = vm.runInNewContext(`(${createSource})`, {
    crypto: { randomUUID: () => 'batch-operation-00000001' },
  });
  const beginBatchPublishOperation = vm.runInNewContext(`(${beginSource})`, { createPublishOperationId });
  const finishBatchPublishOperation = vm.runInNewContext(`(${finishSource})`);
  const state = {
    selectedContentId: 'content-batch-double-click',
    selectedPlatforms: new Set(['zhihu']),
    batchPublishSubmitting: false,
    batchPublishOperation: null,
    lastProgress: [],
  };
  let releaseRequest;
  const requestGate = new Promise(resolve => { releaseRequest = resolve; });
  const requests = [];
  const busyStates = [];
  const publishContent = vm.runInNewContext(`(${publishSource})`, {
    state,
    $: () => null,
    readSelectedPlatforms: () => ['zhihu'],
    beginBatchPublishOperation,
    finishBatchPublishOperation,
    setBatchPublishBusy: busy => busyStates.push(busy),
    saveContent: async () => {},
    renderProgress: () => {},
    request: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      return requestGate;
    },
    toast: () => {},
    loadData: async () => {},
    switchView: () => {},
  });

  const first = publishContent();
  const second = publishContent();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].body.operationId, 'batch-operation-00000001');
  assert.equal(Object.isFrozen(state.batchPublishOperation), true);
  assert.deepEqual(busyStates, [true]);
  assert.equal(await second, false);

  releaseRequest({ ok: true });
  assert.equal(await first, true);
  assert.deepEqual(busyStates, [true, false]);
  assert.equal(state.batchPublishSubmitting, false);
  assert.equal(state.batchPublishOperation, null);
});

test('full publish confirmation stays successful when post-success refresh fails', async () => {
  const source = extractFunctionSource('confirmSinglePlatformPublish', 'hasDirtyCanonicalContent');
  const beginSource = extractFunctionSource('beginSinglePublishOperation', 'finishSinglePublishOperation');
  const finishSource = extractFunctionSource('finishSinglePublishOperation', 'canCancelSinglePublish');
  assert.ok(source && beginSource && finishSource);
  const beginSinglePublishOperation = vm.runInNewContext(`(${beginSource})`);
  const finishSinglePublishOperation = vm.runInNewContext(`(${finishSource})`);
  const state = {
    pendingSinglePublish: Object.freeze({
      contentId: 'c1',
      platform: 'zhihu',
      mode: 'direct',
      operationId: 'full-confirm-operation-0001',
    }),
    singlePublishSubmitting: false,
    singlePublishOperationToken: '',
    singlePublishOperationSequence: 0,
  };
  const events = [];
  let requestBody;
  const dialog = { close: () => events.push('close') };
  const confirmSinglePlatformPublish = vm.runInNewContext(`(${source})`, {
    state,
    beginSinglePublishOperation,
    finishSinglePublishOperation,
    setSinglePublishBusy: busy => events.push(`busy:${busy}`),
    setSinglePublishFeedback: message => events.push(`feedback:${message}`),
    platformName: platform => platform,
    $: selector => selector.startsWith('[data-content-body') ? null : dialog,
    request: async (url, options) => {
      events.push('post-success');
      requestBody = JSON.parse(options.body);
      return { job: { results: [{ platform: 'zhihu', status: 'success', message: 'published' }] } };
    },
    loadData: async () => {
      events.push('refresh-failed');
      throw new Error('refresh offline');
    },
    toast: (message, type) => events.push(`toast:${type || 'ok'}:${message}`),
    encodeURIComponent,
  });

  assert.equal(await confirmSinglePlatformPublish(), true);
  assert.equal(requestBody.operationId, 'full-confirm-operation-0001');
  assert.equal(state.pendingSinglePublish, null);
  assert.equal(state.singlePublishSubmitting, false);
  assert.ok(events.indexOf('close') < events.indexOf('refresh-failed'));
  assert.ok(events.some(event => event.includes('发布成功，但列表刷新失败')));
  assert.equal(events.some(event => event.includes('平台操作失败')), false);
});

test('draft job and platform statuses render as saved drafts across results and history', () => {
  const classSource = extractFunctionSource('statusClass', 'statusLabel');
  const labelSource = extractFunctionSource('statusLabel', 'toast');
  const platformSource = extractFunctionSource('resultPlatformNode', 'resultDetailNode');
  const historySource = extractFunctionSource('historyResultChip', 'historyJobResult');
  assert.ok(classSource && labelSource && platformSource && historySource);
  const statusClass = vm.runInNewContext(`(${classSource})`);
  const statusLabel = vm.runInNewContext(`(${labelSource})`);
  const resultPlatformNode = vm.runInNewContext(`(${platformSource})`, {
    platformName: platform => platform,
    escapeHtml: value => String(value),
  });
  const historyResultChip = vm.runInNewContext(`(${historySource})`, {
    platformName: platform => platform,
    statusLabel,
    escapeHtml: value => String(value),
    resultPlatformNode,
    resultDetailNode: () => '',
  });

  assert.equal(statusClass('draft_saved'), 'draft');
  assert.equal(statusClass('platform_draft'), 'draft');
  assert.equal(statusLabel('draft_saved'), '草稿已保存');
  assert.equal(statusLabel('platform_draft'), '平台草稿已保存');
  assert.match(resultPlatformNode({ platform: 'zhihu', status: 'platform_draft', url: 'https://example.invalid/draft' }), /<button/);
  assert.match(historyResultChip({ platform: 'zhihu', status: 'platform_draft', message: '' }), /平台草稿已保存/);
});

test('single draft confirmation treats platform_draft as a successful result', async () => {
  const source = extractFunctionSource('confirmSinglePlatformPublish', 'hasDirtyCanonicalContent');
  const beginSource = extractFunctionSource('beginSinglePublishOperation', 'finishSinglePublishOperation');
  const finishSource = extractFunctionSource('finishSinglePublishOperation', 'canCancelSinglePublish');
  const beginSinglePublishOperation = vm.runInNewContext(`(${beginSource})`);
  const finishSinglePublishOperation = vm.runInNewContext(`(${finishSource})`);
  const state = {
    pendingSinglePublish: Object.freeze({
      contentId: 'draft-content',
      platform: 'zhihu',
      mode: 'draft',
      operationId: 'draft-confirm-operation-0001',
    }),
    singlePublishSubmitting: false,
    singlePublishOperationToken: '',
    singlePublishOperationSequence: 0,
  };
  const toasts = [];
  const confirmSinglePlatformPublish = vm.runInNewContext(`(${source})`, {
    state,
    beginSinglePublishOperation,
    finishSinglePublishOperation,
    setSinglePublishBusy: () => {},
    setSinglePublishFeedback: () => {},
    platformName: platform => platform,
    $: selector => selector.startsWith('[data-content-body') ? null : { close() {} },
    request: async () => ({
      job: { results: [{ platform: 'zhihu', status: 'platform_draft', message: '草稿写入完成' }] },
    }),
    loadData: async () => {},
    toast: (message, type) => toasts.push({ message, type: type || '' }),
    encodeURIComponent,
  });

  assert.equal(await confirmSinglePlatformPublish(), true);
  assert.deepEqual(toasts, [{ message: 'zhihu：草稿写入完成', type: '' }]);
});

test('publish dialog cancel handler blocks Escape while an operation is busy', () => {
  const source = extractFunctionSource('handleSinglePublishDialogCancel', 'setSinglePublishFeedback');
  assert.ok(source, '缺少发布确认框 cancel handler');
  let prevented = 0;
  let cancelled = 0;
  const busyState = { singlePublishSubmitting: true };
  const busyHandler = vm.runInNewContext(`(${source})`, {
    state: busyState,
    canCancelSinglePublish: state => !state.singlePublishSubmitting,
    setSinglePublishFeedback: () => {},
    cancelSinglePublish: () => { cancelled += 1; },
  });
  assert.equal(busyHandler({ preventDefault: () => { prevented += 1; } }), false);
  assert.equal(prevented, 1);
  assert.equal(cancelled, 0);

  busyState.singlePublishSubmitting = false;
  assert.equal(busyHandler({ preventDefault: () => { prevented += 1; } }), true);
  assert.equal(cancelled, 1);
});

test('opening another publish confirmation cannot reset an active operation', () => {
  const source = extractFunctionSource('openSinglePublishConfirmation', 'cancelSinglePublish');
  assert.ok(source);
  let toastMessage = '';
  const publishState = {
    singlePublishSubmitting: true,
    pendingSinglePublish: Object.freeze({ contentId: 'c1', platform: 'zhihu', mode: 'direct' }),
    data: { contents: [{ id: 'c2', title: '另一篇文章' }] },
  };
  const openSinglePublishConfirmation = vm.runInNewContext(`(${source})`, {
    state: publishState,
    canCancelSinglePublish: state => !state.singlePublishSubmitting,
    toast: message => { toastMessage = message; },
    $: () => { throw new Error('busy path must not touch dialog'); },
    platformName: value => value,
    setSinglePublishFeedback: () => {},
  });
  assert.equal(openSinglePublishConfirmation({ contentId: 'c2', platform: 'juejin', mode: 'direct' }), false);
  assert.equal(publishState.pendingSinglePublish.contentId, 'c1');
  assert.equal(publishState.singlePublishSubmitting, true);
  assert.match(toastMessage, /正在执行|等待完成/);
});

test('dirty transition saves first and never calls transition after save failure', async () => {
  const dirtySource = extractFunctionSource('hasDirtyCanonicalContent', 'runContentTransition');
  const transitionSource = extractFunctionSource('runContentTransition', 'handleBeforeUnload');
  assert.ok(dirtySource && transitionSource, '缺少 dirty canonical transition helpers');
  const hasDirtyCanonicalContent = vm.runInNewContext(`(${dirtySource})`);
  const dirtyIds = new Set(['content-1']);
  assert.equal(hasDirtyCanonicalContent(dirtyIds), true);
  assert.equal(hasDirtyCanonicalContent(new Set()), false);

  let transitioned = 0;
  let toastMessage = '';
  const transitionState = {
    selectedContentId: 'content-1',
    dirtyContentIds: dirtyIds,
    contentTransitionInFlight: false,
  };
  const failedTransition = vm.runInNewContext(`(${transitionSource})`, {
    state: transitionState,
    hasDirtyCanonicalContent,
    saveContent: async () => { throw new Error('save failed'); },
    toast: message => { toastMessage = message; },
  });
  assert.equal(await failedTransition(() => { transitioned += 1; }), false);
  assert.equal(transitioned, 0);
  assert.match(toastMessage, /save failed/);

  const successfulTransition = vm.runInNewContext(`(${transitionSource})`, {
    state: transitionState,
    hasDirtyCanonicalContent,
    saveContent: async id => {
      transitionState.dirtyContentIds.delete(id);
      return { content: { id }, stable: true };
    },
    toast: () => {},
  });
  assert.equal(await successfulTransition(() => { transitioned += 1; }), true);
  assert.equal(transitioned, 1);

  const unloadSource = extractFunctionSource('handleBeforeUnload', 'generateContent');
  assert.ok(unloadSource);
  let prevented = 0;
  const dirtyUnload = vm.runInNewContext(`(${unloadSource})`, {
    hasDirtyCanonicalContent: () => true,
  });
  const unloadEvent = { preventDefault: () => { prevented += 1; }, returnValue: undefined };
  assert.equal(dirtyUnload(unloadEvent), '');
  assert.equal(prevented, 1);
  assert.equal(unloadEvent.returnValue, '');
  const cleanUnload = vm.runInNewContext(`(${unloadSource})`, {
    hasDirtyCanonicalContent: () => false,
  });
  assert.equal(cleanUnload({ preventDefault: () => { prevented += 1; } }), undefined);
});

test('deferred save preserves a newer editor revision and merges only server metadata', async () => {
  const saveSource = extractFunctionSource('saveContent', 'markContentDirty');
  const dirtySource = extractFunctionSource('markContentDirty', 'bindContentEditorDirtyTracking');
  assert.ok(saveSource && dirtySource, '缺少 revision-aware canonical save helpers');
  const contentId = 'content-revision-race';
  const editor = { isContentEditable: true, innerHTML: '<p>first revision</p>' };
  const titleEditor = { value: 'First title' };
  const summaryEditor = { value: 'First summary' };
  const saveButton = { classList: { remove() {} } };
  const saveState = { textContent: '', classList: { add() {} } };
  const content = {
    id: contentId,
    title: 'Stored title',
    summary: 'Stored summary',
    body: '<p>stored body</p>',
    type: '行业分析',
    status: '已排版',
    updated_at: '2026-08-31T01:00:00.000Z',
  };
  const state = {
    selectedContentId: contentId,
    data: { contents: [content] },
    dirtyContentIds: new Set(),
    contentEditRevisions: new Map(),
  };
  const nodes = new Map([
    [`[data-content-body="${contentId}"]`, editor],
    [`[data-content-title="${contentId}"]`, titleEditor],
    [`[data-content-summary="${contentId}"]`, summaryEditor],
    [`[data-save-content-button="${contentId}"]`, saveButton],
    [`[data-content-save-state="${contentId}"]`, saveState],
  ]);
  const $ = selector => nodes.get(selector) || null;
  const markContentDirty = vm.runInNewContext(`(${dirtySource})`, { state, $ });
  markContentDirty(contentId);

  let resolveRequest;
  let submittedBody;
  const requestGate = new Promise(resolve => { resolveRequest = resolve; });
  let reloads = 0;
  const saveContent = vm.runInNewContext(`(${saveSource})`, {
    state,
    $,
    request: async (url, options) => {
      submittedBody = JSON.parse(options.body);
      return requestGate;
    },
    clearPlatformPreviews: () => {},
    toast: () => {},
    loadData: async () => { reloads += 1; },
    encodeURIComponent,
  });

  const pendingSave = saveContent(contentId, { silent: true });
  assert.equal(submittedBody.body, '<p>first revision</p>');

  editor.innerHTML = '<p>second revision stays live</p>';
  titleEditor.value = 'Second title stays live';
  summaryEditor.value = 'Second summary stays live';
  markContentDirty(contentId);
  resolveRequest({
    content: {
      ...content,
      title: 'First title',
      summary: 'First summary',
      body: '<p>first revision normalized</p>',
      status: '草稿已保存',
      updated_at: '2026-08-31T02:00:00.000Z',
    },
  });

  const saveResult = await pendingSave;

  assert.equal(saveResult.stable, false);
  assert.equal(saveResult.content.updated_at, '2026-08-31T02:00:00.000Z');
  assert.equal(editor.innerHTML, '<p>second revision stays live</p>');
  assert.equal(titleEditor.value, 'Second title stays live');
  assert.equal(summaryEditor.value, 'Second summary stays live');
  assert.equal(state.dirtyContentIds.has(contentId), true);
  assert.equal(state.contentEditRevisions.get(contentId), 2);
  assert.equal(state.data.contents[0].body, '<p>second revision stays live</p>');
  assert.equal(state.data.contents[0].title, 'Second title stays live');
  assert.equal(state.data.contents[0].summary, 'Second summary stays live');
  assert.equal(state.data.contents[0].status, '草稿已保存');
  assert.equal(state.data.contents[0].updated_at, '2026-08-31T02:00:00.000Z');
  assert.equal(reloads, 0);
});

function createDeferredCanonicalSaveHarness(contentId = 'content-downstream-race') {
  const editor = { isContentEditable: true, innerHTML: '<p>saved revision</p>' };
  const titleEditor = { value: 'Saved title' };
  const summaryEditor = { value: 'Saved summary' };
  const content = {
    id: contentId,
    title: 'Stored title',
    summary: 'Stored summary',
    body: '<p>stored body</p>',
    type: '行业分析',
    status: '已排版',
    updated_at: '2026-08-31T01:00:00.000Z',
  };
  const state = {
    selectedContentId: contentId,
    data: { contents: [content] },
    dirtyContentIds: new Set(),
    contentEditRevisions: new Map(),
    contentTransitionInFlight: false,
    selectedPlatforms: new Set(['zhihu']),
    batchPublishSubmitting: false,
    batchPublishOperation: null,
    lastProgress: [],
  };
  const nodes = new Map([
    [`[data-content-body="${contentId}"]`, editor],
    [`[data-content-title="${contentId}"]`, titleEditor],
    [`[data-content-summary="${contentId}"]`, summaryEditor],
  ]);
  const $ = selector => nodes.get(selector) || null;
  let resolveSave;
  let signalSaveStarted;
  const saveResponse = new Promise(resolve => { resolveSave = resolve; });
  const saveStarted = new Promise(resolve => { signalSaveStarted = resolve; });
  const downstreamRequests = [];
  const request = async (url, options = {}) => {
    if (url === `/api/content/${encodeURIComponent(contentId)}` && options.method === 'POST') {
      signalSaveStarted();
      return saveResponse;
    }
    downstreamRequests.push({ url, options });
    if (url.endsWith('/layout')) return { content: { ...content, status: '已排版' } };
    if (url.includes('/publish-platform')) return { job: { results: [] } };
    return { ok: true, job: { results: [] } };
  };
  let reloads = 0;
  const toasts = [];
  const loadData = async () => { reloads += 1; };
  const toast = (message, type) => toasts.push({ message, type: type || '' });
  const dirtySource = extractFunctionSource('markContentDirty', 'bindContentEditorDirtyTracking');
  const saveSource = extractFunctionSource('saveContent', 'markContentDirty');
  const markContentDirty = vm.runInNewContext(`(${dirtySource})`, { state, $ });
  const saveContent = vm.runInNewContext(`(${saveSource})`, {
    state,
    $,
    request,
    clearPlatformPreviews: () => {},
    toast,
    loadData,
    encodeURIComponent,
  });
  markContentDirty(contentId);

  return {
    contentId,
    state,
    $,
    request,
    saveContent,
    saveStarted,
    downstreamRequests,
    toasts,
    reloadCount: () => reloads,
    editAndResolve() {
      editor.innerHTML = '<p>newer live revision</p>';
      titleEditor.value = 'Newer live title';
      summaryEditor.value = 'Newer live summary';
      markContentDirty(contentId);
      resolveSave({
        content: {
          ...content,
          title: 'Saved title',
          summary: 'Saved summary',
          body: '<p>saved revision normalized</p>',
          updated_at: '2026-08-31T02:00:00.000Z',
        },
      });
    },
  };
}

test('layout aborts when the canonical body changes during its deferred save', async () => {
  const harness = createDeferredCanonicalSaveHarness('layout-save-race');
  const source = extractFunctionSource('layoutContent', 'saveDraft');
  const layoutContent = vm.runInNewContext(`(${source})`, {
    state: harness.state,
    $: harness.$,
    saveContent: harness.saveContent,
    request: harness.request,
    toast: (message, type) => harness.toasts.push({ message, type: type || '' }),
    loadData: async () => { throw new Error('unstable layout must not reload'); },
    openLayoutDialog: () => { throw new Error('unstable layout must not open preview'); },
    getSelectedContent: () => harness.state.data.contents[0],
    encodeURIComponent,
    CONTENT_CHANGED_DURING_SAVE_MESSAGE: '正文在保存期间又有修改，请先保存后重试',
  });

  const pending = layoutContent(harness.contentId, 'style_10.html');
  await harness.saveStarted;
  harness.editAndResolve();
  assert.equal(await pending, false);
  assert.equal(harness.downstreamRequests.length, 0);
  assert.equal(harness.reloadCount(), 0);
  assert.deepEqual(harness.toasts.at(-1), { message: '正文在保存期间又有修改，请先保存后重试', type: 'error' });
});

test('saveDraft aborts when the canonical body changes during its deferred save', async () => {
  const harness = createDeferredCanonicalSaveHarness('draft-save-race');
  const source = extractFunctionSource('saveDraft', 'publishContent');
  const saveDraft = vm.runInNewContext(`(${source})`, {
    state: harness.state,
    $: harness.$,
    saveContent: harness.saveContent,
    readSelectedPlatforms: () => ['zhihu'],
    request: harness.request,
    toast: (message, type) => harness.toasts.push({ message, type: type || '' }),
    loadData: async () => { throw new Error('unstable draft must not reload'); },
    CONTENT_CHANGED_DURING_SAVE_MESSAGE: '正文在保存期间又有修改，请先保存后重试',
  });

  const pending = saveDraft(harness.contentId);
  await harness.saveStarted;
  harness.editAndResolve();
  assert.equal(await pending, false);
  assert.equal(harness.downstreamRequests.length, 0);
  assert.equal(harness.reloadCount(), 0);
  assert.deepEqual(harness.toasts.at(-1), { message: '正文在保存期间又有修改，请先保存后重试', type: 'error' });
});

test('batch publish aborts when the canonical body changes during its deferred save', async () => {
  const harness = createDeferredCanonicalSaveHarness('batch-save-race');
  const createSource = extractFunctionSource('createPublishOperationId', 'beginBatchPublishOperation');
  const beginSource = extractFunctionSource('beginBatchPublishOperation', 'finishBatchPublishOperation');
  const finishSource = extractFunctionSource('finishBatchPublishOperation', 'setBatchPublishBusy');
  const createPublishOperationId = vm.runInNewContext(`(${createSource})`, {
    crypto: { randomUUID: () => 'batch-save-race-operation-0001' },
  });
  const beginBatchPublishOperation = vm.runInNewContext(`(${beginSource})`, { createPublishOperationId });
  const finishBatchPublishOperation = vm.runInNewContext(`(${finishSource})`);
  const source = extractFunctionSource('publishContent', 'checkAuth');
  const busyStates = [];
  const publishContent = vm.runInNewContext(`(${source})`, {
    state: harness.state,
    $: harness.$,
    readSelectedPlatforms: () => ['zhihu'],
    beginBatchPublishOperation,
    finishBatchPublishOperation,
    setBatchPublishBusy: busy => busyStates.push(busy),
    saveContent: harness.saveContent,
    renderProgress: () => { throw new Error('unstable publish must not render progress'); },
    request: harness.request,
    toast: (message, type) => harness.toasts.push({ message, type: type || '' }),
    loadData: async () => { throw new Error('unstable publish must not reload'); },
    switchView: () => { throw new Error('unstable publish must not navigate'); },
    CONTENT_CHANGED_DURING_SAVE_MESSAGE: '正文在保存期间又有修改，请先保存后重试',
  });

  const pending = publishContent(harness.contentId);
  await harness.saveStarted;
  harness.editAndResolve();
  assert.equal(await pending, false);
  assert.equal(harness.downstreamRequests.length, 0);
  assert.equal(harness.reloadCount(), 0);
  assert.deepEqual(busyStates, [true, false]);
  assert.deepEqual(harness.toasts.at(-1), { message: '正文在保存期间又有修改，请先保存后重试', type: 'error' });
});

test('single publish aborts when the canonical body changes during its deferred save', async () => {
  const harness = createDeferredCanonicalSaveHarness('single-save-race');
  harness.state.pendingSinglePublish = Object.freeze({
    contentId: harness.contentId,
    platform: 'zhihu',
    mode: 'direct',
    operationId: 'single-save-race-operation-0001',
  });
  harness.state.singlePublishSubmitting = false;
  harness.state.singlePublishOperationToken = '';
  harness.state.singlePublishOperationSequence = 0;
  const beginSource = extractFunctionSource('beginSinglePublishOperation', 'finishSinglePublishOperation');
  const finishSource = extractFunctionSource('finishSinglePublishOperation', 'canCancelSinglePublish');
  const beginSinglePublishOperation = vm.runInNewContext(`(${beginSource})`);
  const finishSinglePublishOperation = vm.runInNewContext(`(${finishSource})`);
  const source = extractFunctionSource('confirmSinglePlatformPublish', 'hasDirtyCanonicalContent');
  const feedback = [];
  const confirmSinglePlatformPublish = vm.runInNewContext(`(${source})`, {
    state: harness.state,
    beginSinglePublishOperation,
    finishSinglePublishOperation,
    setSinglePublishBusy: () => {},
    setSinglePublishFeedback: (message, type) => feedback.push({ message, type: type || '' }),
    platformName: platform => platform,
    $: harness.$,
    saveContent: harness.saveContent,
    request: harness.request,
    loadData: async () => { throw new Error('unstable single publish must not reload'); },
    toast: (message, type) => harness.toasts.push({ message, type: type || '' }),
    encodeURIComponent,
    CONTENT_CHANGED_DURING_SAVE_MESSAGE: '正文在保存期间又有修改，请先保存后重试',
  });

  const pending = confirmSinglePlatformPublish();
  await harness.saveStarted;
  harness.editAndResolve();
  assert.equal(await pending, false);
  assert.equal(harness.downstreamRequests.length, 0);
  assert.equal(harness.reloadCount(), 0);
  assert.equal(harness.state.pendingSinglePublish.operationId, 'single-save-race-operation-0001');
  assert.deepEqual(feedback.at(-1), { message: '正文在保存期间又有修改，请先保存后重试', type: 'error' });
  assert.deepEqual(harness.toasts.at(-1), { message: '正文在保存期间又有修改，请先保存后重试', type: 'error' });
});

test('navigation and article selection stay put when the deferred save becomes unstable', async () => {
  const harness = createDeferredCanonicalSaveHarness('navigation-save-race');
  const source = extractFunctionSource('runContentTransition', 'handleBeforeUnload');
  const runContentTransition = vm.runInNewContext(`(${source})`, {
    state: harness.state,
    saveContent: harness.saveContent,
    toast: (message, type) => harness.toasts.push({ message, type: type || '' }),
    CONTENT_CHANGED_DURING_SAVE_MESSAGE: '正文在保存期间又有修改，请先保存后重试',
  });
  let transitions = 0;
  const pending = runContentTransition(() => {
    transitions += 1;
    harness.state.selectedContentId = 'other-article';
  });
  await harness.saveStarted;
  harness.editAndResolve();

  assert.equal(await pending, false);
  assert.equal(transitions, 0);
  assert.equal(harness.state.selectedContentId, harness.contentId);
  assert.equal(harness.downstreamRequests.length, 0);
  assert.equal(harness.reloadCount(), 0);
  assert.deepEqual(harness.toasts.at(-1), { message: '正文在保存期间又有修改，请先保存后重试', type: 'error' });
});

function importFlowDocument() {
  const nodes = {
    '#import-content-input': { value: '# 新文章\n\n正文' },
    '#import-title-input': { value: '新文章' },
    '[data-action="submit-import"]': { disabled: false, textContent: '导入并打开' },
    '#import-dialog': { closeCalls: 0, close() { this.closeCalls += 1; } },
  };
  return { nodes, $: selector => nodes[selector] || null };
}

test('full submitImport flow does not post when dirty canonical save fails', async () => {
  const source = extractFunctionSource('submitImport', 'chooseRandomWechatTemplate');
  assert.ok(source);
  const { nodes, $ } = importFlowDocument();
  const state = {
    importSubmitting: false,
    importTab: 'paste',
    importFileName: '',
    selectedContentId: 'current-content',
  };
  let requests = 0;
  let feedback = '';
  const submitImport = vm.runInNewContext(`(${source})`, {
    state,
    $,
    importedBodyByteLength: value => value.length,
    MAX_IMPORT_FILE_BYTES: 5 * 1024 * 1024,
    inferImportFormat: () => 'markdown',
    runContentTransition: async () => false,
    request: async () => { requests += 1; },
    setImportFeedback: message => { feedback = message; },
    resetImportDialog: () => {},
    loadData: async () => {},
    switchView: () => {},
    toast: () => {},
  });

  assert.equal(await submitImport(), false);
  assert.equal(requests, 0);
  assert.equal(state.selectedContentId, 'current-content');
  assert.equal(nodes['#import-dialog'].closeCalls, 0);
  assert.equal(nodes['#import-content-input'].value, '# 新文章\n\n正文');
  assert.match(feedback, /保存失败|未导入/);
});

test('full submitImport flow posts and selects content after dirty guard succeeds', async () => {
  const source = extractFunctionSource('submitImport', 'chooseRandomWechatTemplate');
  assert.ok(source);
  const { nodes, $ } = importFlowDocument();
  const state = {
    importSubmitting: false,
    importTab: 'paste',
    importFileName: '',
    selectedContentId: 'current-content',
  };
  const events = [];
  let requestBody;
  const submitImport = vm.runInNewContext(`(${source})`, {
    state,
    $,
    importedBodyByteLength: value => value.length,
    MAX_IMPORT_FILE_BYTES: 5 * 1024 * 1024,
    inferImportFormat: () => 'markdown',
    runContentTransition: async transition => {
      events.push('dirty-saved');
      return transition();
    },
    request: async (url, options) => {
      events.push('import-posted');
      requestBody = JSON.parse(options.body);
      return { content: { id: 'imported-content', title: '新文章' } };
    },
    setImportFeedback: () => {},
    resetImportDialog: () => events.push('dialog-reset'),
    loadData: async () => events.push('data-loaded'),
    switchView: view => events.push(`view:${view}`),
    toast: () => {},
  });

  assert.equal(await submitImport(), true);
  assert.deepEqual(events.slice(0, 2), ['dirty-saved', 'import-posted']);
  assert.equal(requestBody.format, 'markdown');
  assert.equal(state.selectedContentId, 'imported-content');
  assert.equal(nodes['#import-dialog'].closeCalls, 1);
  assert.ok(events.includes('view:content'));
});

test('import read token aborts stale readers and only applies the latest result', () => {
  const invalidateSource = extractFunctionSource('invalidateImportRead', 'applyLatestImportRead');
  const applySource = extractFunctionSource('applyLatestImportRead', 'nextTabIndexForKey');
  assert.ok(invalidateSource && applySource, '缺少 FileReader token helpers');
  const invalidateImportRead = vm.runInNewContext(`(${invalidateSource})`);
  const applyLatestImportRead = vm.runInNewContext(`(${applySource})`);
  let aborted = 0;
  const readState = {
    importReadToken: 3,
    importReader: { abort: () => { aborted += 1; } },
  };
  const latestToken = invalidateImportRead(readState);
  assert.equal(latestToken, 4);
  assert.equal(aborted, 1);
  assert.equal(readState.importReader, null);
  let applied = '';
  assert.equal(applyLatestImportRead(readState, 3, () => { applied = 'stale'; }), false);
  assert.equal(applied, '');
  assert.equal(applyLatestImportRead(readState, 4, () => { applied = 'latest'; }), true);
  assert.equal(applied, 'latest');
});

test('user-content isolation executes against editable, imported, and sandbox boundaries', () => {
  const source = extractUntil('isActionEventIsolated', "\ndocument.addEventListener('click'");
  assert.ok(source);
  const { document, window } = parseHTML(`
    <div data-user-editable><button id="editable" data-action="publish">x</button></div>
    <article data-imported-article><select id="imported" data-history-filter="status"></select></article>
    <iframe id="preview" sandbox></iframe>
    <button id="safe" data-action="reload">safe</button>
  `);
  const isActionEventIsolated = vm.runInNewContext(`(${source})`, { Element: window.Element });
  assert.equal(isActionEventIsolated(document.querySelector('#editable')), true);
  assert.equal(isActionEventIsolated(document.querySelector('#imported')), true);
  assert.equal(isActionEventIsolated(document.querySelector('#preview')), true);
  assert.equal(isActionEventIsolated(document.querySelector('#safe')), false);
});

test('preview cache keys isolate stale responses after canonical content updates', () => {
  const source = extractFunctionSource('platformPreviewKey', 'clearPlatformPreviews');
  assert.ok(source);
  const platformPreviewKey = vm.runInNewContext(`(${source})`);
  const previous = { id: 'content-1', updated_at: '2026-08-30T10:00:00Z' };
  const current = { id: 'content-1', updated_at: '2026-08-30T10:01:00Z' };
  const previousKey = platformPreviewKey(previous, 'zhihu');
  const currentKey = platformPreviewKey(current, 'zhihu');
  assert.notEqual(previousKey, currentKey);
  const cache = new Map([[previousKey, { content: 'stale' }], [currentKey, { content: 'current' }]]);
  assert.equal(cache.get(currentKey).content, 'current');
});

test('frontend source wires cancel, dirty navigation, beforeunload, and import invalidation', () => {
  assert.match(appSource, /platform-publish-dialog[^\n]*addEventListener\(['"]cancel['"]/);
  assert.match(appSource, /window\.addEventListener\(['"]beforeunload['"]/);
  assert.match(appSource, /runContentTransition\(\(\)\s*=>\s*switchView/);
  assert.match(appSource, /runContentTransition\(\(\)\s*=>\s*\{[\s\S]*?state\.selectedContentId\s*=/);
  assert.match(appSource, /function beginPasteImport\s*\(/);
  assert.match(appSource, /import-content-input[^\n]*addEventListener\(['"]paste['"]/);
  assert.match(appSource, /function readImportFile[\s\S]*?invalidateImportRead\(state\)/);
});
