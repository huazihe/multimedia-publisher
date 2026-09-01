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

function evaluateContentRevisionMerger(state) {
  const source = extractFunctionSource('mergeContentRevisionMetadata', 'saveContent');
  return source ? vm.runInNewContext(`(${source})`, { state }) : () => false;
}

function evaluateCanonicalConflictMarker(state, $, toast) {
  const source = extractFunctionSource('markContentCanonicalConflict', 'mergeContentRevisionMetadata');
  return source ? vm.runInNewContext(`(${source})`, { state, $, toast }) : () => false;
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

test('request exposes HTTP status codes to frontend conflict handling', async () => {
  const source = extractFunctionSource('request', 'loadLayoutTemplates');
  assert.ok(source);
  const request = vm.runInNewContext(`(${source})`, {
    API: 'http://127.0.0.1:18810',
    state: { workbenchCsrfToken: 'csrf-token-for-test' },
    fetch: async () => ({
      status: 409,
      json: async () => ({ ok: false, error: '内容版本冲突' }),
    }),
  });

  await assert.rejects(
    () => request('/api/content/c1', { method: 'POST', body: '{}' }),
    error => {
      assert.equal(error.statusCode, 409);
      assert.match(error.message, /版本冲突/);
      return true;
    }
  );
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
    data: { contents: [{ id: 'content-batch-double-click', status: '已排版', layout_html: '', updated_at: '2026-09-02T08:00:00.000Z' }] },
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
    beginContentOperation: contentId => ({ contentId, token: 'batch-content-operation' }),
    contentOperationIsStable: () => true,
    preserveContentOperationChanges: () => {},
    endContentOperation: () => true,
    setBatchPublishBusy: busy => busyStates.push(busy),
    saveContent: async () => {},
    renderProgress: () => {},
    request: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      return requestGate;
    },
    toast: () => {},
    loadData: async () => ({ applied: true }),
    switchView: () => {},
    mergeContentRevisionMetadata: evaluateContentRevisionMerger(state),
  });

  const first = publishContent();
  const second = publishContent();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].body.operationId, 'batch-operation-00000001');
  assert.equal(requests[0].body.expectedUpdatedAt, '2026-09-02T08:00:00.000Z');
  assert.equal(Object.isFrozen(state.batchPublishOperation), true);
  assert.deepEqual(busyStates, [true]);
  assert.equal(await second, false);

  releaseRequest({
    ok: true,
    content: { id: 'content-batch-double-click', status: '已发布', layout_html: '', updated_at: '2026-09-02T08:00:00.001Z' },
    sourceUpdatedAt: '2026-09-02T08:00:00.000Z',
    canonicalConflict: false,
    needsReload: false,
  });
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
    data: { contents: [{ id: 'c1', status: '已排版', layout_html: '', updated_at: '2026-09-02T08:00:00.000Z' }] },
  };
  const events = [];
  let requestBody;
  const dialog = { close: () => events.push('close') };
  const confirmSinglePlatformPublish = vm.runInNewContext(`(${source})`, {
    state,
    beginSinglePublishOperation,
    finishSinglePublishOperation,
    beginContentOperation: contentId => ({ contentId, token: 'single-content-operation' }),
    contentOperationIsStable: () => true,
    preserveContentOperationChanges: () => {},
    endContentOperation: () => true,
    setSinglePublishBusy: busy => events.push(`busy:${busy}`),
    setSinglePublishFeedback: message => events.push(`feedback:${message}`),
    platformName: platform => platform,
    $: selector => selector.startsWith('[data-content-body') ? null : dialog,
    request: async (url, options) => {
      events.push('post-success');
      requestBody = JSON.parse(options.body);
      return {
        job: { results: [{ platform: 'zhihu', status: 'success', message: 'published' }] },
        content: { id: 'c1', status: '已排版', layout_html: '', updated_at: '2026-09-02T08:00:00.000Z' },
        sourceUpdatedAt: '2026-09-02T08:00:00.000Z',
        canonicalConflict: false,
        needsReload: false,
      };
    },
    loadData: async () => {
      events.push('refresh-failed');
      throw new Error('refresh offline');
    },
    toast: (message, type) => events.push(`toast:${type || 'ok'}:${message}`),
    encodeURIComponent,
    mergeContentRevisionMetadata: evaluateContentRevisionMerger(state),
  });

  assert.equal(await confirmSinglePlatformPublish(), true);
  assert.equal(requestBody.operationId, 'full-confirm-operation-0001');
  assert.equal(requestBody.expectedUpdatedAt, '2026-09-02T08:00:00.000Z');
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

test('uncertain publish results render manual verification guidance with escaped details', () => {
  const classSource = extractFunctionSource('statusClass', 'statusLabel');
  const labelSource = extractFunctionSource('statusLabel', 'toast');
  const platformSource = extractFunctionSource('resultPlatformNode', 'resultDetailNode');
  const detailSource = extractFunctionSource('resultDetailNode', 'jobResult');
  const jobSource = extractFunctionSource('jobResult', 'historyResultChip');
  const historySource = extractFunctionSource('historyResultChip', 'historyJobResult');
  assert.ok(classSource && labelSource && platformSource && detailSource && jobSource && historySource);
  const escapeHtml = value => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  const statusClass = vm.runInNewContext(`(${classSource})`);
  const statusLabel = vm.runInNewContext(`(${labelSource})`);
  const resultPlatformNode = vm.runInNewContext(`(${platformSource})`, {
    platformName: platform => platform,
    escapeHtml,
  });
  const resultDetailNode = vm.runInNewContext(`(${detailSource})`, { escapeHtml });
  const jobResult = vm.runInNewContext(`(${jobSource})`, {
    resultPlatformNode,
    resultDetailNode,
    statusLabel,
    escapeHtml,
  });
  const historyResultChip = vm.runInNewContext(`(${historySource})`, {
    platformName: platform => platform,
    statusLabel,
    escapeHtml,
    resultPlatformNode,
    resultDetailNode,
  });
  const maliciousMessage = 'adapter uncertain <img src=x onerror=alert(1)> & needs review';
  const uncertain = { platform: 'juejin', status: 'uncertain', message: maliciousMessage };
  const failed = { platform: 'zhihu', status: 'failed', message: maliciousMessage };

  assert.match(appSource, /\['uncertain', '\u7ed3\u679c\u5f85\u6838\u5bf9'\]/);
  assert.equal(statusClass('uncertain'), 'failed');
  assert.equal(statusLabel('uncertain'), '结果待核对');
  for (const html of [
    resultDetailNode(uncertain),
    jobResult({ results: [uncertain] }),
    historyResultChip(uncertain),
  ]) {
    assert.match(html, /禁止自动重试，请到平台后台人工核对/);
    assert.match(html, /adapter uncertain &lt;img src=x onerror=alert\(1\)&gt; &amp; needs review/);
    assert.doesNotMatch(html, /<img src=x/);
  }
  assert.match(jobResult({ results: [uncertain] }), /failed-result/);
  assert.match(historyResultChip(uncertain), /history-result-chip failed/);
  assert.doesNotMatch(historyResultChip(uncertain), /history-result-chip success/);

  const failedDetail = resultDetailNode(failed);
  assert.match(failedDetail, /adapter uncertain &lt;img src=x onerror=alert\(1\)&gt; &amp; needs review/);
  assert.doesNotMatch(failedDetail, /<img src=x/);
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
    data: { contents: [{ id: 'draft-content', status: '已排版', layout_html: '', updated_at: '2026-09-02T08:00:00.000Z' }] },
  };
  const toasts = [];
  const confirmSinglePlatformPublish = vm.runInNewContext(`(${source})`, {
    state,
    beginSinglePublishOperation,
    finishSinglePublishOperation,
    beginContentOperation: contentId => ({ contentId, token: 'single-draft-content-operation' }),
    contentOperationIsStable: () => true,
    preserveContentOperationChanges: () => {},
    endContentOperation: () => true,
    setSinglePublishBusy: () => {},
    setSinglePublishFeedback: () => {},
    platformName: platform => platform,
    $: selector => selector.startsWith('[data-content-body') ? null : { close() {} },
    request: async () => ({
      job: { results: [{ platform: 'zhihu', status: 'platform_draft', message: '草稿写入完成' }] },
      content: { id: 'draft-content', status: '已排版', layout_html: '', updated_at: '2026-09-02T08:00:00.000Z' },
      sourceUpdatedAt: '2026-09-02T08:00:00.000Z',
      canonicalConflict: false,
      needsReload: false,
    }),
    loadData: async () => ({ applied: true }),
    toast: (message, type) => toasts.push({ message, type: type || '' }),
    encodeURIComponent,
    mergeContentRevisionMetadata: evaluateContentRevisionMerger(state),
    markContentCanonicalConflict: evaluateCanonicalConflictMarker(
      state,
      selector => selector.startsWith('[data-content-body') ? null : { close() {} },
      (message, type) => toasts.push({ message, type: type || '' })
    ),
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
    beginContentOperation: contentId => ({ contentId, token: 'failed-transition-operation' }),
    contentOperationIsStable: () => true,
    preserveContentOperationChanges: () => {},
    endContentOperation: () => true,
    saveContent: async () => { throw new Error('save failed'); },
    toast: message => { toastMessage = message; },
  });
  assert.equal(await failedTransition(() => { transitioned += 1; }), false);
  assert.equal(transitioned, 0);
  assert.match(toastMessage, /save failed/);

  const successfulTransition = vm.runInNewContext(`(${transitionSource})`, {
    state: transitionState,
    hasDirtyCanonicalContent,
    beginContentOperation: contentId => ({ contentId, token: 'successful-transition-operation' }),
    contentOperationIsStable: () => true,
    preserveContentOperationChanges: () => {},
    endContentOperation: () => true,
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

test('focusing a content editor without input does not mark it dirty', () => {
  const source = extractFunctionSource('bindContentEditorDirtyTracking', 'layoutContent');
  assert.ok(source);
  const contentId = 'focus-only-content';
  const { document, window } = parseHTML(`
    <div data-content-body="${contentId}" contenteditable="true"><p>正文</p></div>
    <input data-content-title="${contentId}" value="标题">
    <textarea data-content-summary="${contentId}">摘要</textarea>
  `);
  let dirtyMarks = 0;
  const bindContentEditorDirtyTracking = vm.runInNewContext(`(${source})`, {
    $: selector => document.querySelector(selector),
    markContentDirty: () => { dirtyMarks += 1; },
  });
  bindContentEditorDirtyTracking(contentId);

  document.querySelector('[data-content-body]').dispatchEvent(new window.Event('focusin', { bubbles: true }));
  document.querySelector('[data-content-title]').dispatchEvent(new window.Event('focusin', { bubbles: true }));
  assert.equal(dirtyMarks, 0);

  document.querySelector('[data-content-body]').dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(dirtyMarks, 1);
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
    contentOperationLocks: new Map(),
    contentOperationSequence: 0,
    contentCanonicalConflicts: new Set(),
    contentOperationLocks: new Map(),
    contentOperationSequence: 0,
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
  const snapshotSource = extractFunctionSource('contentOperationSnapshot', 'setContentOperationBusy');
  const stableSource = extractFunctionSource('contentOperationIsStable', 'preserveContentOperationChanges');
  const preserveSource = extractFunctionSource('preserveContentOperationChanges', 'endContentOperation');
  const contentOperationSnapshot = vm.runInNewContext(`(${snapshotSource})`, { state, $ });
  const contentOperationIsStable = vm.runInNewContext(`(${stableSource})`, { state, contentOperationSnapshot });
  const preserveContentOperationChanges = vm.runInNewContext(`(${preserveSource})`, { state, contentOperationSnapshot });
  const beginContentOperation = target => {
    const context = { contentId: String(target), token: 'deferred-save-operation', snapshot: contentOperationSnapshot(target) };
    state.contentOperationLocks.set(String(target), context);
    return context;
  };
  const endContentOperation = context => state.contentOperationLocks.delete(context.contentId);
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
    beginContentOperation,
    contentOperationIsStable,
    preserveContentOperationChanges,
    endContentOperation,
    mergeContentRevisionMetadata: evaluateContentRevisionMerger(state),
    markContentCanonicalConflict: evaluateCanonicalConflictMarker(state, $, () => {}),
  });

  const pendingSave = saveContent(contentId, { silent: true });
  assert.equal(submittedBody.body, '<p>first revision</p>');
  assert.equal(submittedBody.expectedUpdatedAt, content.updated_at);

  editor.innerHTML = '<p>second revision stays live</p>';
  titleEditor.value = 'Second title stays live';
  summaryEditor.value = 'Second summary stays live';
  assert.equal(markContentDirty(contentId), false);
  state.contentEditRevisions.set(contentId, state.contentEditRevisions.get(contentId) + 1);
  resolveRequest({
    content: {
      ...content,
      title: 'First title',
      summary: 'First summary',
      body: '<p>first revision normalized</p>',
      status: '草稿已保存',
      updated_at: '2026-08-31T02:00:00.000Z',
    },
    sourceUpdatedAt: content.updated_at,
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

test('skipReload save advances the revision token before the next save without replacing newer editor DOM', async () => {
  const saveSource = extractFunctionSource('saveContent', 'markContentDirty');
  assert.ok(saveSource);
  const contentId = 'skip-reload-revision';
  const editor = { isContentEditable: true, innerHTML: '<p>First local body</p>' };
  const titleEditor = { value: 'First local title' };
  const summaryEditor = { value: 'First local summary' };
  const content = {
    id: contentId,
    title: 'Stored title',
    summary: 'Stored summary',
    body: '<p>Stored body</p>',
    type: '行业分析',
    plan_date: '2026-08-31',
    status: '已排版',
    layout_html: '<article>Stored layout</article>',
    images: [],
    selected_platforms: [],
    created_at: '2026-08-31T00:00:00.000Z',
    updated_at: '2026-08-31T01:00:00.000Z',
  };
  const state = {
    selectedContentId: contentId,
    data: { contents: [content] },
    dirtyContentIds: new Set([contentId]),
    contentEditRevisions: new Map([[contentId, 1]]),
    contentOperationLocks: new Map(),
  };
  const nodes = new Map([
    [`[data-content-body="${contentId}"]`, editor],
    [`[data-content-title="${contentId}"]`, titleEditor],
    [`[data-content-summary="${contentId}"]`, summaryEditor],
  ]);
  const submitted = [];
  const responseTokens = [
    '2026-08-31T02:00:00.000Z',
    '2026-08-31T03:00:00.000Z',
  ];
  const $ = selector => nodes.get(selector) || null;
  const saveContent = vm.runInNewContext(`(${saveSource})`, {
    state,
    $,
    request: async (url, options) => {
      const payload = JSON.parse(options.body);
      submitted.push(payload);
      return {
        content: {
          ...content,
          title: payload.title,
          summary: payload.summary,
          body: payload.body,
          type: payload.type,
          status: '正文已生成',
          layout_html: '',
          updated_at: responseTokens[submitted.length - 1],
        },
        sourceUpdatedAt: payload.expectedUpdatedAt,
      };
    },
    clearPlatformPreviews: () => {},
    toast: () => {},
    loadData: async () => { throw new Error('skipReload save must not reload'); },
    encodeURIComponent,
    beginContentOperation: target => ({ contentId: String(target), token: `save-${submitted.length + 1}` }),
    contentOperationIsStable: () => true,
    preserveContentOperationChanges: () => { throw new Error('stable save must not preserve an unstable revision'); },
    endContentOperation: () => true,
    mergeContentRevisionMetadata: evaluateContentRevisionMerger(state),
    markContentCanonicalConflict: evaluateCanonicalConflictMarker(state, $, () => {}),
  });

  const first = await saveContent(contentId, { silent: true, skipReload: true });
  assert.equal(first.stable, true);

  editor.innerHTML = '<p>Second local body</p>';
  titleEditor.value = 'Second local title';
  summaryEditor.value = 'Second local summary';
  state.contentEditRevisions.set(contentId, 2);
  state.dirtyContentIds.add(contentId);

  const second = await saveContent(contentId, { silent: true, skipReload: true });

  assert.equal(second.stable, true);
  assert.deepEqual(submitted.map(payload => payload.expectedUpdatedAt), [
    '2026-08-31T01:00:00.000Z',
    '2026-08-31T02:00:00.000Z',
  ]);
  assert.equal(state.data.contents[0].updated_at, '2026-08-31T03:00:00.000Z');
  assert.equal(editor.innerHTML, '<p>Second local body</p>');
  assert.equal(titleEditor.value, 'Second local title');
  assert.equal(summaryEditor.value, 'Second local summary');
  assert.equal(state.contentEditRevisions.get(contentId), 2);
});

function createRefreshFailureRevisionHarness(contentId, harnessOptions = {}) {
  const editor = { isContentEditable: true, innerHTML: '<p>First local body</p>' };
  const titleEditor = { value: 'First local title' };
  const summaryEditor = { value: 'First local summary' };
  const content = {
    id: contentId,
    title: 'Stored title',
    summary: 'Stored summary',
    body: '<p>Stored body</p>',
    type: '行业分析',
    plan_date: '2026-09-02',
    status: '已排版',
    layout_html: '<article>Stored layout</article>',
    images: [],
    selected_platforms: [],
    created_at: '2026-09-02T07:00:00.000Z',
    updated_at: '2026-09-02T08:00:00.000Z',
  };
  const state = {
    selectedContentId: contentId,
    data: { contents: [content] },
    dirtyContentIds: new Set([contentId]),
    contentEditRevisions: new Map([[contentId, 1]]),
    contentOperationLocks: new Map(),
    contentOperationSequence: 0,
    contentCanonicalConflicts: new Set(),
  };
  const nodes = new Map([
    [`[data-content-body="${contentId}"]`, editor],
    [`[data-content-title="${contentId}"]`, titleEditor],
    [`[data-content-summary="${contentId}"]`, summaryEditor],
    [`[data-save-content-button="${contentId}"]`, { classList: { add() {}, remove() {} } }],
    [`[data-content-save-state="${contentId}"]`, { textContent: '', classList: { add() {}, remove() {} } }],
  ]);
  const $ = selector => nodes.get(selector) || null;
  const submitted = [];
  const derivedSubmitted = [];
  let canonicalSaveCount = 0;
  const currentResponseContent = (updatedAt, overrides = {}) => ({
    ...content,
    title: titleEditor.value,
    summary: summaryEditor.value,
    body: editor.innerHTML,
    status: '正文已生成',
    layout_html: '',
    updated_at: updatedAt,
    ...overrides,
  });
  const request = async (url, options = {}) => {
    if (url === `/api/content/${encodeURIComponent(contentId)}`) {
      const payload = JSON.parse(options.body);
      submitted.push(payload);
      canonicalSaveCount += 1;
      return {
        content: currentResponseContent(
          canonicalSaveCount === 1 ? '2026-09-02T08:00:00.001Z' : '2026-09-02T08:00:00.003Z'
        ),
        sourceUpdatedAt: payload.expectedUpdatedAt,
      };
    }
    if (url.endsWith('/layout')) {
      const payload = JSON.parse(options.body || '{}');
      derivedSubmitted.push({ operation: 'layout', payload });
      if (harnessOptions.derivedConflict === 'layout') {
        const error = new Error('文章已在其他标签页更新，请重新加载最新版本');
        error.statusCode = 409;
        throw error;
      }
      return {
        content: currentResponseContent('2026-09-02T08:00:00.002Z', {
          status: '已排版',
          layout_html: '<article>New layout</article>',
        }),
        sourceUpdatedAt: payload.expectedUpdatedAt,
      };
    }
    if (url.endsWith('/save-draft')) {
      const payload = JSON.parse(options.body || '{}');
      derivedSubmitted.push({ operation: 'draft', payload });
      if (harnessOptions.derivedConflict === 'draft') {
        const error = new Error('文章已在其他标签页更新，请重新加载最新版本');
        error.statusCode = 409;
        throw error;
      }
      return {
        job: {
          id: 'job-refresh-failure',
          content_id: contentId,
          title: titleEditor.value,
          status: 'local_draft',
          platforms: ['zhihu'],
          results: [],
          created_at: '2026-09-02T08:00:00.002Z',
          updated_at: '2026-09-02T08:00:00.002Z',
        },
        content: currentResponseContent('2026-09-02T08:00:00.002Z', {
          status: '草稿已保存',
          selected_platforms: ['zhihu'],
        }),
        sourceUpdatedAt: payload.expectedUpdatedAt,
      };
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  let operationSequence = 0;
  const beginContentOperation = target => ({ contentId: String(target), token: `refresh-operation-${++operationSequence}` });
  const contentOperationIsStable = () => true;
  const preserveContentOperationChanges = () => { throw new Error('stable refresh-failure flow must not preserve an unstable edit'); };
  const endContentOperation = () => true;
  const toasts = [];
  const toast = (message, type) => toasts.push({ message, type: type || '' });
  const loadData = async () => { throw new Error('bootstrap unavailable'); };
  const mergeContentRevisionMetadata = evaluateContentRevisionMerger(state);
  const markContentCanonicalConflict = evaluateCanonicalConflictMarker(state, $, toast);
  const saveSource = extractFunctionSource('saveContent', 'markContentDirty');
  const saveContent = vm.runInNewContext(`(${saveSource})`, {
    state,
    $,
    request,
    clearPlatformPreviews: () => {},
    toast,
    loadData,
    encodeURIComponent,
    beginContentOperation,
    contentOperationIsStable,
    preserveContentOperationChanges,
    endContentOperation,
    mergeContentRevisionMetadata,
    markContentCanonicalConflict,
  });

  return {
    contentId,
    state,
    $,
    request,
    loadData,
    saveContent,
    submitted,
    derivedSubmitted,
    toasts,
    toast,
    beginContentOperation,
    contentOperationIsStable,
    preserveContentOperationChanges,
    endContentOperation,
    mergeContentRevisionMetadata,
    markContentCanonicalConflict,
    editSecondRevision() {
      editor.innerHTML = '<p>Second local body</p>';
      titleEditor.value = 'Second local title';
      summaryEditor.value = 'Second local summary';
      state.contentEditRevisions.set(contentId, 2);
      state.dirtyContentIds.add(contentId);
    },
  };
}

test('canonical save keeps the new revision when bootstrap refresh fails and the next save reuses it', async () => {
  const harness = createRefreshFailureRevisionHarness('canonical-refresh-failure');

  const first = await harness.saveContent(harness.contentId, { userInitiated: true });
  assert.equal(first.refreshFailed, true);
  assert.equal(first.saveError, undefined);
  assert.equal(harness.state.data.contents[0].updated_at, '2026-09-02T08:00:00.001Z');
  assert.equal(harness.state.dirtyContentIds.has(harness.contentId), false);
  assert.match(harness.toasts.at(-1).message, /已保存.*刷新失败/);

  harness.editSecondRevision();
  const second = await harness.saveContent(harness.contentId, { silent: true, skipReload: true });

  assert.equal(second.stable, true);
  assert.deepEqual(harness.submitted.map(payload => payload.expectedUpdatedAt), [
    '2026-09-02T08:00:00.000Z',
    '2026-09-02T08:00:00.001Z',
  ]);
  assert.equal(harness.$(`[data-content-body="${harness.contentId}"]`).innerHTML, '<p>Second local body</p>');
  assert.equal(harness.state.contentEditRevisions.get(harness.contentId), 2);
});

for (const operation of ['layout', 'draft']) {
  test(`${operation} keeps returned revision through bootstrap failure and the next save reuses it`, async () => {
    const harness = createRefreshFailureRevisionHarness(`${operation}-refresh-failure`);
    const source = operation === 'layout'
      ? extractFunctionSource('layoutContent', 'saveDraft')
      : extractFunctionSource('saveDraft', 'publishContent');
    const dependencies = {
      state: harness.state,
      $: harness.$,
      request: harness.request,
      saveContent: harness.saveContent,
      loadData: harness.loadData,
      toast: harness.toast,
      encodeURIComponent,
      beginContentOperation: harness.beginContentOperation,
      contentOperationIsStable: harness.contentOperationIsStable,
      preserveContentOperationChanges: harness.preserveContentOperationChanges,
      endContentOperation: harness.endContentOperation,
      mergeContentRevisionMetadata: harness.mergeContentRevisionMetadata,
      CONTENT_CHANGED_DURING_SAVE_MESSAGE: '正文在保存期间又有修改，请先保存后重试',
      readSelectedPlatforms: () => ['zhihu'],
      openLayoutDialog: () => {},
      getSelectedContent: () => harness.state.data.contents[0],
    };
    const runOperation = vm.runInNewContext(`(${source})`, dependencies);

    const first = await runOperation(harness.contentId);
    assert.equal(first, true);
    assert.equal(harness.derivedSubmitted[0].payload.expectedUpdatedAt, '2026-09-02T08:00:00.001Z');
    assert.equal(harness.state.data.contents[0].updated_at, '2026-09-02T08:00:00.002Z');
    assert.match(harness.toasts.at(-1).message, /已生成.*刷新失败|已保存.*刷新失败/);

    harness.editSecondRevision();
    const second = await harness.saveContent(harness.contentId, { silent: true, skipReload: true });

    assert.equal(second.stable, true);
    assert.deepEqual(harness.submitted.map(payload => payload.expectedUpdatedAt), [
      '2026-09-02T08:00:00.000Z',
      '2026-09-02T08:00:00.002Z',
    ]);
    assert.equal(harness.$(`[data-content-body="${harness.contentId}"]`).innerHTML, '<p>Second local body</p>');
    assert.equal(harness.state.contentEditRevisions.get(harness.contentId), 2);
  });
}

test('all successful content mutation flows share metadata merge before refresh', () => {
  const mergeSource = extractFunctionSource('mergeContentRevisionMetadata', 'saveContent');
  assert.ok(mergeSource, '缺少共享 content revision metadata helper');
  for (const [name, nextName] of [
    ['saveContent', 'markContentDirty'],
    ['layoutContent', 'saveDraft'],
    ['saveDraft', 'publishContent'],
    ['confirmSinglePlatformPublish', 'hasDirtyCanonicalContent'],
    ['publishContent', 'checkAuth'],
  ]) {
    const source = extractFunctionSource(name, nextName);
    const mergeIndex = source.indexOf('mergeContentRevisionMetadata(');
    const refreshIndex = source.indexOf('loadData(');
    assert.ok(mergeIndex >= 0, `${name} must merge returned content metadata`);
    assert.ok(refreshIndex < 0 || mergeIndex < refreshIndex, `${name} must merge metadata before refresh`);
  }
});

test('revision metadata merge requires matching source proof and rejects canonical conflicts', () => {
  const contentId = 'guarded-metadata-merge';
  const state = {
    data: {
      contents: [{
        id: contentId,
        title: 'Local DOM title',
        status: '正文已生成',
        layout_html: '',
        updated_at: '2026-09-02T09:00:00.001Z',
      }],
    },
    contentEditRevisions: new Map([[contentId, 7]]),
  };
  const mergeContentRevisionMetadata = evaluateContentRevisionMerger(state);
  const returnedContent = {
    id: contentId,
    title: 'Other-tab title must not merge',
    status: '已排版',
    layout_html: '<article>Derived layout</article>',
    updated_at: '2026-09-02T09:00:00.003Z',
  };

  assert.equal(mergeContentRevisionMetadata(returnedContent, contentId, {
    expectedUpdatedAt: '2026-09-02T09:00:00.001Z',
    sourceUpdatedAt: '2026-09-02T09:00:00.002Z',
  }), false);
  assert.equal(mergeContentRevisionMetadata(returnedContent, contentId, {
    expectedUpdatedAt: '2026-09-02T09:00:00.001Z',
    sourceUpdatedAt: '2026-09-02T09:00:00.001Z',
    canonicalConflict: true,
    needsReload: true,
  }), false);
  assert.equal(state.data.contents[0].updated_at, '2026-09-02T09:00:00.001Z');
  assert.equal(state.data.contents[0].status, '正文已生成');
  assert.equal(state.data.contents[0].layout_html, '');
  assert.equal(state.contentEditRevisions.get(contentId), 7);

  assert.equal(mergeContentRevisionMetadata(returnedContent, contentId, {
    expectedUpdatedAt: '2026-09-02T09:00:00.001Z',
    sourceUpdatedAt: '2026-09-02T09:00:00.001Z',
  }), true);
  assert.equal(state.data.contents[0].updated_at, '2026-09-02T09:00:00.003Z');
  assert.equal(state.data.contents[0].status, '已排版');
  assert.equal(state.contentEditRevisions.get(contentId), 7);
});

for (const operation of ['layout', 'draft']) {
  test(`second-tab update before ${operation} keeps the saved token isolated, marks conflict, and blocks later Save`, async () => {
    const harness = createRefreshFailureRevisionHarness(`${operation}-admission-conflict`, {
      derivedConflict: operation,
    });
    const source = operation === 'layout'
      ? extractFunctionSource('layoutContent', 'saveDraft')
      : extractFunctionSource('saveDraft', 'publishContent');
    const runOperation = vm.runInNewContext(`(${source})`, {
      state: harness.state,
      $: harness.$,
      request: harness.request,
      saveContent: harness.saveContent,
      loadData: async () => { throw new Error('stale derived admission must not refresh'); },
      toast: harness.toast,
      encodeURIComponent,
      beginContentOperation: harness.beginContentOperation,
      contentOperationIsStable: harness.contentOperationIsStable,
      preserveContentOperationChanges: harness.preserveContentOperationChanges,
      endContentOperation: harness.endContentOperation,
      mergeContentRevisionMetadata: harness.mergeContentRevisionMetadata,
      markContentCanonicalConflict: harness.markContentCanonicalConflict,
      CONTENT_CHANGED_DURING_SAVE_MESSAGE: '正文在保存期间又有修改，请先保存后重试',
      readSelectedPlatforms: () => ['zhihu'],
      openLayoutDialog: () => { throw new Error('stale layout must not open preview'); },
      getSelectedContent: () => harness.state.data.contents[0],
    });

    assert.equal(await runOperation(harness.contentId), false);
    assert.equal(harness.derivedSubmitted[0].payload.expectedUpdatedAt, '2026-09-02T08:00:00.001Z');
    assert.equal(harness.state.data.contents[0].updated_at, '2026-09-02T08:00:00.001Z');
    assert.equal(harness.state.dirtyContentIds.has(harness.contentId), true);
    assert.equal(harness.state.contentCanonicalConflicts.has(harness.contentId), true);
    assert.match(harness.toasts.at(-1).message, /其他标签页.*重新加载/);

    harness.editSecondRevision();
    const requestsBeforeBlockedSave = harness.submitted.length;
    const blocked = await harness.saveContent(harness.contentId, { userInitiated: true });
    assert.equal(blocked.blocked, true);
    assert.equal(blocked.conflict, true);
    assert.equal(harness.submitted.length, requestsBeforeBlockedSave);
    assert.equal(harness.$(`[data-content-body="${harness.contentId}"]`).innerHTML, '<p>Second local body</p>');
  });
}

for (const mode of ['single', 'batch']) {
  test(`${mode} publish canonicalConflict never merges a token and marks the editor blocked`, async () => {
    const contentId = `${mode}-publish-response-conflict`;
    const content = {
      id: contentId,
      title: 'Local snapshot title',
      summary: 'Local summary',
      body: '<p>Local snapshot body</p>',
      type: '行业分析',
      status: '正文已生成',
      layout_html: '',
      updated_at: '2026-09-02T10:00:00.001Z',
    };
    const state = {
      selectedContentId: contentId,
      data: { contents: [content] },
      dirtyContentIds: new Set(),
      contentEditRevisions: new Map([[contentId, 3]]),
      contentOperationLocks: new Map(),
      contentCanonicalConflicts: new Set(),
      selectedPlatforms: new Set(['zhihu']),
      lastProgress: [],
      batchPublishSubmitting: false,
      batchPublishOperation: null,
      pendingSinglePublish: mode === 'single' ? Object.freeze({
        contentId,
        platform: 'zhihu',
        mode: 'direct',
        operationId: 'frontend-single-conflict-0001',
      }) : null,
      singlePublishSubmitting: false,
      singlePublishOperationToken: '',
      singlePublishOperationSequence: 0,
    };
    const toasts = [];
    const toast = (message, type) => toasts.push({ message, type: type || '' });
    const saveButton = { classList: { remove() {} } };
    const saveState = { textContent: '', classList: { add() {} } };
    const dialog = { close() {} };
    const $ = selector => {
      if (selector.startsWith('[data-content-body')) return null;
      if (selector.startsWith('[data-save-content-button')) return saveButton;
      if (selector.startsWith('[data-content-save-state')) return saveState;
      return dialog;
    };
    const mergeContentRevisionMetadata = evaluateContentRevisionMerger(state);
    const markContentCanonicalConflict = evaluateCanonicalConflictMarker(state, $, toast);
    let refreshes = 0;
    let requestBody;
    const request = async (url, options) => {
      requestBody = JSON.parse(options.body);
      return {
        job: {
          id: `${mode}-conflict-job`,
          content_id: contentId,
          title: content.title,
          status: 'published',
          platforms: ['zhihu'],
          created_at: '2026-09-02T10:00:00.002Z',
          updated_at: '2026-09-02T10:00:00.002Z',
          results: [{
            id: `${mode}-conflict-result`,
            job_id: `${mode}-conflict-job`,
            platform: 'zhihu',
            status: 'success',
            message: 'snapshot published',
            url: 'https://example.invalid/snapshot',
            post_id: `${mode}-post`,
            created_at: '2026-09-02T10:00:00.002Z',
          }],
        },
        rawOutput: 'snapshot published',
        content: null,
        sourceUpdatedAt: content.updated_at,
        canonicalConflict: true,
        needsReload: true,
        cached: false,
      };
    };
    const common = {
      state,
      $,
      request,
      beginContentOperation: target => ({ contentId: String(target), token: `${mode}-content-operation` }),
      contentOperationIsStable: () => true,
      preserveContentOperationChanges: () => { throw new Error('publish conflict must not pair server metadata with local DOM'); },
      endContentOperation: () => true,
      saveContent: async () => ({ stable: true }),
      loadData: async () => { refreshes += 1; throw new Error('canonical conflict must not refresh automatically'); },
      toast,
      mergeContentRevisionMetadata,
      markContentCanonicalConflict,
      CONTENT_CHANGED_DURING_SAVE_MESSAGE: '正文在保存期间又有修改，请先保存后重试',
      encodeURIComponent,
    };

    let result;
    if (mode === 'single') {
      const beginSource = extractFunctionSource('beginSinglePublishOperation', 'finishSinglePublishOperation');
      const finishSource = extractFunctionSource('finishSinglePublishOperation', 'canCancelSinglePublish');
      const source = extractFunctionSource('confirmSinglePlatformPublish', 'hasDirtyCanonicalContent');
      result = await vm.runInNewContext(`(${source})`, {
        ...common,
        beginSinglePublishOperation: vm.runInNewContext(`(${beginSource})`),
        finishSinglePublishOperation: vm.runInNewContext(`(${finishSource})`),
        setSinglePublishBusy: () => {},
        setSinglePublishFeedback: () => {},
        platformName: platform => platform,
      })();
    } else {
      const createSource = extractFunctionSource('createPublishOperationId', 'beginBatchPublishOperation');
      const beginSource = extractFunctionSource('beginBatchPublishOperation', 'finishBatchPublishOperation');
      const finishSource = extractFunctionSource('finishBatchPublishOperation', 'setBatchPublishBusy');
      const source = extractFunctionSource('publishContent', 'checkAuth');
      const createPublishOperationId = vm.runInNewContext(`(${createSource})`, {
        crypto: { randomUUID: () => 'frontend-batch-conflict-0001' },
      });
      result = await vm.runInNewContext(`(${source})`, {
        ...common,
        readSelectedPlatforms: () => ['zhihu'],
        beginBatchPublishOperation: vm.runInNewContext(`(${beginSource})`, { createPublishOperationId }),
        finishBatchPublishOperation: vm.runInNewContext(`(${finishSource})`),
        setBatchPublishBusy: () => {},
        renderProgress: () => {},
        switchView: () => { throw new Error('conflicted publish must not navigate'); },
      })(contentId);
    }

    assert.equal(result, false);
    assert.equal(requestBody.expectedUpdatedAt, content.updated_at);
    assert.equal(state.data.contents[0].updated_at, content.updated_at);
    assert.equal(state.data.contents[0].status, '正文已生成');
    assert.equal(state.contentEditRevisions.get(contentId), 3);
    assert.equal(state.dirtyContentIds.has(contentId), true);
    assert.equal(state.contentCanonicalConflicts.has(contentId), true);
    assert.equal(refreshes, 0);
    assert.match(toasts.at(-1).message, /其他标签页.*重新加载/);
  });
}

test('a 409 save conflict preserves the editor DOM and displays an explicit reload-latest message', async () => {
  const saveSource = extractFunctionSource('saveContent', 'markContentDirty');
  assert.ok(saveSource);
  const contentId = 'cross-tab-conflict';
  const { document } = parseHTML(`
    <div data-content-body="${contentId}" contenteditable="true"><p>Unsaved local body</p></div>
    <input data-content-title="${contentId}" value="Unsaved local title">
    <textarea data-content-summary="${contentId}">Unsaved local summary</textarea>
    <span data-content-save-state="${contentId}"></span>
  `);
  const storedContent = {
    id: contentId,
    title: 'Stored title',
    summary: 'Stored summary',
    body: '<p>Stored body</p>',
    type: '行业分析',
    updated_at: '2026-08-31T01:00:00.000Z',
  };
  const state = {
    selectedContentId: contentId,
    data: { contents: [storedContent] },
    dirtyContentIds: new Set([contentId]),
    contentOperationLocks: new Map(),
  };
  const messages = [];
  let reloads = 0;
  const conflict = new Error('内容版本冲突');
  conflict.statusCode = 409;
  const saveContent = vm.runInNewContext(`(${saveSource})`, {
    state,
    $: selector => document.querySelector(selector),
    request: async () => { throw conflict; },
    clearPlatformPreviews: () => { throw new Error('conflict must not clear previews'); },
    toast: (message, type) => messages.push({ message, type }),
    loadData: async () => { reloads += 1; },
    encodeURIComponent,
    beginContentOperation: target => ({ contentId: String(target), token: 'conflict-save' }),
    contentOperationIsStable: () => true,
    preserveContentOperationChanges: () => {},
    endContentOperation: () => true,
    markContentCanonicalConflict: evaluateCanonicalConflictMarker(
      state,
      selector => document.querySelector(selector),
      (message, type) => messages.push({ message, type })
    ),
  });

  const result = await saveContent(contentId, { silent: true });

  assert.equal(result.conflict, true);
  assert.equal(result.stable, false);
  assert.equal(document.querySelector('[data-content-body]').innerHTML, '<p>Unsaved local body</p>');
  assert.equal(document.querySelector('[data-content-title]').value, 'Unsaved local title');
  assert.equal(document.querySelector('[data-content-summary]').value, 'Unsaved local summary');
  assert.equal(state.dirtyContentIds.has(contentId), true);
  assert.equal(reloads, 0);
  assert.match(messages.map(item => item.message).join('\n'), /文章已在其他标签页更新/);
  assert.match(document.querySelector('[data-content-save-state]').textContent, /重新加载最新版本/);
});

for (const testCase of [
  { statusCode: 400, message: '标题不能超过 200 个 Unicode 字符' },
  { statusCode: 413, message: '正文不能超过 5 MiB' },
]) {
  test(`normal Save surfaces ${testCase.statusCode}, stays dirty, unlocks controls, and preserves caller errors`, async () => {
    const saveSource = extractFunctionSource('saveContent', 'markContentDirty');
    const snapshotSource = extractFunctionSource('contentOperationSnapshot', 'setContentOperationBusy');
    const busySource = extractFunctionSource('setContentOperationBusy', 'beginContentOperation');
    const beginSource = extractFunctionSource('beginContentOperation', 'contentOperationIsStable');
    const stableSource = extractFunctionSource('contentOperationIsStable', 'preserveContentOperationChanges');
    const preserveSource = extractFunctionSource('preserveContentOperationChanges', 'endContentOperation');
    const endSource = extractFunctionSource('endContentOperation', 'createPublishOperationId');
    assert.ok(saveSource && snapshotSource && busySource && beginSource && stableSource && preserveSource && endSource);
    const contentId = `save-error-${testCase.statusCode}`;
    const { document } = parseHTML(`
      <div data-content-body="${contentId}" contenteditable="true"><p>Unsaved local body</p></div>
      <input data-content-title="${contentId}" value="Unsaved local title">
      <textarea data-content-summary="${contentId}">Unsaved local summary</textarea>
      <button class="is-hidden" data-action="save-content" data-id="${contentId}" data-save-content-button="${contentId}">保存</button>
      <button data-action="layout-content" data-id="${contentId}">排版</button>
      <span data-content-save-state="${contentId}"></span>
    `);
    const state = {
      selectedContentId: contentId,
      data: {
        contents: [{
          id: contentId,
          title: 'Stored title',
          summary: 'Stored summary',
          body: '<p>Stored body</p>',
          type: '行业分析',
          status: '已排版',
          layout_html: '<article>Stored layout</article>',
          updated_at: '2026-09-02T08:00:00.000Z',
        }],
      },
      dirtyContentIds: new Set([contentId]),
      contentEditRevisions: new Map([[contentId, 1]]),
      contentOperationLocks: new Map(),
      contentOperationSequence: 0,
    };
    const $ = selector => document.querySelector(selector);
    const $$ = selector => [...document.querySelectorAll(selector)];
    const contentOperationSnapshot = vm.runInNewContext(`(${snapshotSource})`, { state, $ });
    const setContentOperationBusy = vm.runInNewContext(`(${busySource})`, { state, $, $$ });
    const beginContentOperation = vm.runInNewContext(`(${beginSource})`, {
      state,
      contentOperationSnapshot,
      setContentOperationBusy,
    });
    const contentOperationIsStable = vm.runInNewContext(`(${stableSource})`, { state, contentOperationSnapshot });
    const preserveContentOperationChanges = vm.runInNewContext(`(${preserveSource})`, {
      state,
      contentOperationSnapshot,
    });
    const endContentOperation = vm.runInNewContext(`(${endSource})`, { state, setContentOperationBusy });
    const messages = [];
    const requestError = new Error(testCase.message);
    requestError.statusCode = testCase.statusCode;
    const saveContent = vm.runInNewContext(`(${saveSource})`, {
      state,
      $,
      request: async () => {
        assert.equal($('[data-content-body]').getAttribute('contenteditable'), 'false');
        assert.equal($('[data-action="save-content"]').disabled, true);
        assert.equal($('[data-action="layout-content"]').disabled, true);
        throw requestError;
      },
      clearPlatformPreviews: () => { throw new Error('failed save must not clear previews'); },
      toast: (message, type) => messages.push({ message, type }),
      loadData: async () => { throw new Error('failed save must not reload'); },
      encodeURIComponent,
      beginContentOperation,
      contentOperationIsStable,
      preserveContentOperationChanges,
      endContentOperation,
    });

    const result = await saveContent(contentId, { userInitiated: true });

    assert.equal(result.saveError, true);
    assert.equal(result.statusCode, testCase.statusCode);
    assert.equal(result.stable, false);
    assert.equal(state.dirtyContentIds.has(contentId), true);
    assert.equal(state.contentOperationLocks.size, 0);
    assert.equal($('[data-content-body]').innerHTML, '<p>Unsaved local body</p>');
    assert.equal($('[data-content-title]').value, 'Unsaved local title');
    assert.equal($('[data-content-summary]').value, 'Unsaved local summary');
    assert.equal($('[data-content-body]').getAttribute('contenteditable'), 'true');
    assert.equal($('[data-action="save-content"]').disabled, false);
    assert.equal($('[data-action="layout-content"]').disabled, false);
    assert.equal($('[data-save-content-button]').classList.contains('is-hidden'), false);
    assert.match($('[data-content-save-state]').textContent, /保存失败.*请修改后重试/);
    assert.match($('[data-content-save-state]').textContent, new RegExp(testCase.message.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.deepEqual(messages.at(-1), {
      message: $('[data-content-save-state]').textContent,
      type: 'error',
    });

    await assert.rejects(
      () => saveContent(contentId, { silent: true }),
      error => error.statusCode === testCase.statusCode
    );
    assert.equal(state.contentOperationLocks.size, 0);
    assert.equal($('[data-content-body]').getAttribute('contenteditable'), 'true');
  });
}

test('per-content operation lock disables editing and controls while blocking dirty revisions', () => {
  const snapshotSource = extractFunctionSource('contentOperationSnapshot', 'setContentOperationBusy');
  const busySource = extractFunctionSource('setContentOperationBusy', 'beginContentOperation');
  const beginSource = extractFunctionSource('beginContentOperation', 'contentOperationIsStable');
  const stableSource = extractFunctionSource('contentOperationIsStable', 'preserveContentOperationChanges');
  const preserveSource = extractFunctionSource('preserveContentOperationChanges', 'endContentOperation');
  const endSource = extractFunctionSource('endContentOperation', 'createPublishOperationId');
  assert.ok(snapshotSource && busySource && beginSource && stableSource && preserveSource && endSource, '缺少 per-content operation lock helpers');

  const { document } = parseHTML(`
    <div data-content-body="locked-content" contenteditable="true"><p>正文</p></div>
    <input data-content-title="locked-content" value="标题">
    <textarea data-content-summary="locked-content">摘要</textarea>
    <button data-action="save-content" data-id="locked-content">保存</button>
    <button data-action="layout-content" data-id="locked-content">排版</button>
    <button data-action="save-draft" data-id="locked-content">草稿</button>
    <button data-action="publish-selected">发布</button>
  `);
  const state = {
    selectedContentId: 'locked-content',
    contentEditRevisions: new Map([['locked-content', 7]]),
    dirtyContentIds: new Set(),
    contentOperationLocks: new Map(),
    contentOperationSequence: 0,
  };
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const contentOperationSnapshot = vm.runInNewContext(`(${snapshotSource})`, { state, $ });
  const setContentOperationBusy = vm.runInNewContext(`(${busySource})`, { state, $, $$ });
  const beginContentOperation = vm.runInNewContext(`(${beginSource})`, {
    state,
    contentOperationSnapshot,
    setContentOperationBusy,
  });
  const contentOperationIsStable = vm.runInNewContext(`(${stableSource})`, {
    state,
    contentOperationSnapshot,
  });
  const endContentOperation = vm.runInNewContext(`(${endSource})`, { state, setContentOperationBusy });
  const dirtySource = extractFunctionSource('markContentDirty', 'bindContentEditorDirtyTracking');
  const markContentDirty = vm.runInNewContext(`(${dirtySource})`, { state, $ });

  const operation = beginContentOperation('locked-content');
  assert.ok(operation);
  assert.equal(beginContentOperation('locked-content'), null);
  assert.equal($('[data-content-body]').getAttribute('contenteditable'), 'false');
  assert.equal($('[data-content-title]').disabled, true);
  assert.equal($('[data-content-summary]').disabled, true);
  assert.equal($$('[data-action]').every(button => button.disabled), true);
  assert.equal(contentOperationIsStable(operation), true);
  assert.equal(markContentDirty('locked-content'), false);
  assert.equal(state.contentEditRevisions.get('locked-content'), 7);

  assert.equal(endContentOperation(operation), true);
  assert.equal($('[data-content-body]').getAttribute('contenteditable'), 'true');
  assert.equal($('[data-content-title]').disabled, false);
  assert.equal($$('[data-action]').every(button => !button.disabled), true);
  assert.equal(markContentDirty('locked-content'), true);
  assert.equal(state.contentEditRevisions.get('locked-content'), 8);
});

function createFullContentOperationHarness(contentId = 'full-operation-content') {
  const { document } = parseHTML(`
    <div data-content-body="${contentId}" contenteditable="true"><p>live body</p></div>
    <input data-content-title="${contentId}" value="Live title">
    <textarea data-content-summary="${contentId}">Live summary</textarea>
    <button data-action="save-content" data-id="${contentId}">保存</button>
    <button data-action="layout-content" data-id="${contentId}">排版</button>
    <button data-action="save-draft" data-id="${contentId}">草稿</button>
    <button data-action="publish-selected">发布</button>
  `);
  const content = {
    id: contentId,
    title: 'Live title',
    summary: 'Live summary',
    body: '<p>live body</p>',
    type: '行业分析',
    status: '已排版',
    selected_platforms: ['zhihu'],
    updated_at: '2026-08-31T01:00:00.000Z',
  };
  const state = {
    selectedContentId: contentId,
    selectedDate: '',
    planStartDate: '',
    planEndDate: '',
    contentPage: 1,
    contentPageSize: 8,
    data: { contents: [content], platforms: [], today: '2026-08-31' },
    workbenchCsrfToken: '',
    dirtyContentIds: new Set([contentId]),
    contentEditRevisions: new Map([[contentId, 1]]),
    contentOperationLocks: new Map(),
    contentOperationSequence: 0,
    selectedPlatforms: new Set(['zhihu']),
    batchPublishSubmitting: false,
    batchPublishOperation: null,
    lastProgress: [],
    layoutTemplatesLoaded: true,
    authAutoChecked: true,
  };
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const helperSources = {
    snapshot: extractFunctionSource('contentOperationSnapshot', 'setContentOperationBusy'),
    busy: extractFunctionSource('setContentOperationBusy', 'beginContentOperation'),
    begin: extractFunctionSource('beginContentOperation', 'contentOperationIsStable'),
    stable: extractFunctionSource('contentOperationIsStable', 'preserveContentOperationChanges'),
    preserve: extractFunctionSource('preserveContentOperationChanges', 'endContentOperation'),
    end: extractFunctionSource('endContentOperation', 'createPublishOperationId'),
  };
  const contentOperationSnapshot = vm.runInNewContext(`(${helperSources.snapshot})`, { state, $ });
  const setContentOperationBusy = vm.runInNewContext(`(${helperSources.busy})`, { state, $, $$ });
  const beginContentOperation = vm.runInNewContext(`(${helperSources.begin})`, {
    state,
    contentOperationSnapshot,
    setContentOperationBusy,
  });
  const contentOperationIsStable = vm.runInNewContext(`(${helperSources.stable})`, { state, contentOperationSnapshot });
  const preserveContentOperationChanges = vm.runInNewContext(`(${helperSources.preserve})`, { state, contentOperationSnapshot });
  const endContentOperation = vm.runInNewContext(`(${helperSources.end})`, { state, setContentOperationBusy });
  const markSource = extractFunctionSource('markContentDirty', 'bindContentEditorDirtyTracking');
  const markContentDirty = vm.runInNewContext(`(${markSource})`, { state, $ });

  const deferred = new Map();
  const requests = [];
  let downstreamCompleted = false;
  const defer = key => {
    let resolve;
    let reject;
    let signalStarted;
    const started = new Promise(done => { signalStarted = done; });
    const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
    deferred.set(key, { promise, signalStarted });
    return { started, resolve, reject };
  };
  const bootstrapData = () => ({
    csrfToken: 'csrf-after-operation',
    contents: [{ ...content, body: '<p>server refreshed body</p>', updated_at: '2026-08-31T03:00:00.000Z' }],
    platforms: [],
    today: '2026-08-31',
  });
  const request = async (url, options = {}) => {
    const key = url === `/api/content/${encodeURIComponent(contentId)}`
      ? 'save'
      : url.endsWith('/layout') ? 'layout'
        : url.endsWith('/save-draft') ? 'draft'
          : url === '/api/publish' ? 'publish'
            : url === '/api/bootstrap' ? 'bootstrap' : url;
    requests.push(key);
    const gate = deferred.get(key);
    if (gate) {
      gate.signalStarted();
      await gate.promise;
      deferred.delete(key);
    }
    const payload = options.body ? JSON.parse(options.body) : {};
    if (key === 'save') {
      return {
        content: { ...content, updated_at: '2026-08-31T02:00:00.000Z' },
        sourceUpdatedAt: payload.expectedUpdatedAt,
      };
    }
    if (key === 'layout') {
      downstreamCompleted = true;
      return {
        content: { ...content, status: '已排版', updated_at: '2026-08-31T02:30:00.000Z' },
        sourceUpdatedAt: payload.expectedUpdatedAt,
      };
    }
    if (key === 'draft') {
      downstreamCompleted = true;
      return {
        job: { status: 'local_draft', results: [] },
        content: { ...content, status: '草稿已保存', updated_at: '2026-08-31T02:30:00.000Z' },
        sourceUpdatedAt: payload.expectedUpdatedAt,
      };
    }
    if (key === 'publish') {
      downstreamCompleted = true;
      return {
        job: { status: 'published', results: [] },
        content: { ...content, status: '已发布', updated_at: '2026-08-31T02:30:00.000Z' },
        sourceUpdatedAt: payload.expectedUpdatedAt,
        canonicalConflict: false,
        needsReload: false,
      };
    }
    if (key === 'bootstrap') return { data: bootstrapData() };
    return { ok: true };
  };
  let renders = 0;
  const loadSource = extractFunctionSource('loadData', 'getSelectedContent');
  const loadData = vm.runInNewContext(`(${loadSource})`, {
    state,
    request,
    getMonday: () => '2026-08-31',
    addDays: () => '2026-09-06',
    syncContentPageToSelected: () => {},
    applyContentPlatforms: () => {},
    getSelectedContent: () => state.data.contents[0],
    render: () => { renders += 1; },
    loadLayoutTemplates: async () => [],
    layoutTemplatesRequest: null,
    checkAllAuth: async () => {},
    setTimeout: () => 0,
    contentOperationIsStable,
  });
  const toasts = [];
  const toast = (message, type) => toasts.push({ message, type: type || '' });
  const saveSource = extractFunctionSource('saveContent', 'markContentDirty');
  const saveContent = vm.runInNewContext(`(${saveSource})`, {
    state,
    $,
    request,
    clearPlatformPreviews: () => {},
    toast,
    loadData,
    encodeURIComponent,
    beginContentOperation,
    contentOperationIsStable,
    preserveContentOperationChanges,
    endContentOperation,
    mergeContentRevisionMetadata: evaluateContentRevisionMerger(state),
    markContentCanonicalConflict: evaluateCanonicalConflictMarker(state, $, toast),
  });

  return {
    contentId,
    state,
    document,
    $,
    $$,
    request,
    requests,
    defer,
    loadData,
    saveContent,
    toast,
    toasts,
    markContentDirty,
    beginContentOperation,
    contentOperationIsStable,
    preserveContentOperationChanges,
    endContentOperation,
    renderCount: () => renders,
    downstreamCompleted: () => downstreamCompleted,
    programmaticEdit() {
      state.contentEditRevisions.set(contentId, (state.contentEditRevisions.get(contentId) || 0) + 1);
      $(`[data-content-body="${contentId}"]`).innerHTML = '<p>programmatic newer body</p>';
    },
  };
}

test('layout operation blocks input and aborts final refresh after a programmatic edit during layout request', async () => {
  const harness = createFullContentOperationHarness('layout-full-lock');
  const layoutGate = harness.defer('layout');
  const source = extractFunctionSource('layoutContent', 'saveDraft');
  let previews = 0;
  const layoutContent = vm.runInNewContext(`(${source})`, {
    state: harness.state,
    $: harness.$,
    request: harness.request,
    saveContent: harness.saveContent,
    beginContentOperation: harness.beginContentOperation,
    contentOperationIsStable: harness.contentOperationIsStable,
    preserveContentOperationChanges: harness.preserveContentOperationChanges,
    endContentOperation: harness.endContentOperation,
    loadData: harness.loadData,
    toast: harness.toast,
    openLayoutDialog: () => { previews += 1; },
    getSelectedContent: () => harness.state.data.contents[0],
    encodeURIComponent,
    beginContentOperation: harness.beginContentOperation,
    contentOperationIsStable: harness.contentOperationIsStable,
    preserveContentOperationChanges: harness.preserveContentOperationChanges,
    endContentOperation: harness.endContentOperation,
    CONTENT_CHANGED_DURING_SAVE_MESSAGE: '正文在保存期间又有修改，请先保存后重试',
    mergeContentRevisionMetadata: evaluateContentRevisionMerger(harness.state),
  });

  const pending = layoutContent(harness.contentId, 'style_10.html');
  await layoutGate.started;
  const editorLocked = harness.$('[data-content-body]').getAttribute('contenteditable') === 'false';
  const revision = harness.state.contentEditRevisions.get(harness.contentId);
  const inputBlocked = harness.markContentDirty(harness.contentId) === false;
  const revisionBlocked = harness.state.contentEditRevisions.get(harness.contentId) === revision;
  harness.programmaticEdit();
  layoutGate.resolve();

  assert.equal(await pending, false);
  assert.equal(editorLocked, true);
  assert.equal(inputBlocked, true);
  assert.equal(revisionBlocked, true);
  assert.equal(harness.requests.filter(key => key === 'bootstrap').length, 0);
  assert.equal(previews, 0);
  assert.equal(harness.$('[data-content-body]').innerHTML, '<p>programmatic newer body</p>');
  assert.equal(harness.state.dirtyContentIds.has(harness.contentId), true);
  assert.equal(harness.$('[data-content-body]').getAttribute('contenteditable'), 'true');
  assert.equal(harness.$$('[data-action]').every(button => !button.disabled), true);
});

test('draft operation aborts refresh after a programmatic edit during draft request', async () => {
  const harness = createFullContentOperationHarness('draft-full-lock');
  const draftGate = harness.defer('draft');
  const source = extractFunctionSource('saveDraft', 'publishContent');
  const saveDraft = vm.runInNewContext(`(${source})`, {
    state: harness.state,
    $: harness.$,
    request: harness.request,
    saveContent: harness.saveContent,
    beginContentOperation: harness.beginContentOperation,
    contentOperationIsStable: harness.contentOperationIsStable,
    preserveContentOperationChanges: harness.preserveContentOperationChanges,
    endContentOperation: harness.endContentOperation,
    loadData: harness.loadData,
    toast: harness.toast,
    readSelectedPlatforms: () => ['zhihu'],
    beginContentOperation: harness.beginContentOperation,
    contentOperationIsStable: harness.contentOperationIsStable,
    preserveContentOperationChanges: harness.preserveContentOperationChanges,
    endContentOperation: harness.endContentOperation,
    CONTENT_CHANGED_DURING_SAVE_MESSAGE: '正文在保存期间又有修改，请先保存后重试',
    mergeContentRevisionMetadata: evaluateContentRevisionMerger(harness.state),
  });

  const pending = saveDraft(harness.contentId);
  await draftGate.started;
  const inputBlocked = harness.markContentDirty(harness.contentId) === false;
  harness.programmaticEdit();
  draftGate.resolve();

  assert.equal(await pending, false);
  assert.equal(inputBlocked, true);
  assert.equal(harness.requests.filter(key => key === 'bootstrap').length, 0);
  assert.equal(harness.$('[data-content-body]').innerHTML, '<p>programmatic newer body</p>');
  assert.equal(harness.$('[data-content-body]').getAttribute('contenteditable'), 'true');
});

test('guarded loadData does not render or overwrite DOM when revision changes while bootstrap is pending', async () => {
  const harness = createFullContentOperationHarness('load-full-lock');
  const bootstrapGate = harness.defer('bootstrap');
  const operation = harness.beginContentOperation(harness.contentId);
  const pending = harness.loadData({ operationContext: operation });
  await bootstrapGate.started;
  const inputBlocked = harness.markContentDirty(harness.contentId) === false;
  harness.programmaticEdit();
  bootstrapGate.resolve();

  const result = await pending;
  assert.equal(inputBlocked, true);
  assert.equal(result.applied, false);
  assert.equal(harness.renderCount(), 0);
  assert.equal(harness.state.data.contents[0].body, '<p>live body</p>');
  assert.equal(harness.$('[data-content-body]').innerHTML, '<p>programmatic newer body</p>');
  harness.preserveContentOperationChanges(operation);
  harness.endContentOperation(operation);
  assert.equal(harness.$('[data-content-body]').getAttribute('contenteditable'), 'true');
});

test('layout operation releases editor and controls when downstream request throws', async () => {
  const harness = createFullContentOperationHarness('layout-error-unlock');
  const layoutGate = harness.defer('layout');
  const source = extractFunctionSource('layoutContent', 'saveDraft');
  let lockedAtRequest = false;
  const request = async (url, options) => {
    if (url.endsWith('/layout')) lockedAtRequest = harness.$('[data-content-body]').getAttribute('contenteditable') === 'false';
    return harness.request(url, options);
  };
  const layoutContent = vm.runInNewContext(`(${source})`, {
    state: harness.state,
    $: harness.$,
    request,
    saveContent: harness.saveContent,
    loadData: harness.loadData,
    toast: harness.toast,
    openLayoutDialog: () => {},
    getSelectedContent: () => harness.state.data.contents[0],
    encodeURIComponent,
    beginContentOperation: harness.beginContentOperation,
    contentOperationIsStable: harness.contentOperationIsStable,
    preserveContentOperationChanges: harness.preserveContentOperationChanges,
    endContentOperation: harness.endContentOperation,
    CONTENT_CHANGED_DURING_SAVE_MESSAGE: '正文在保存期间又有修改，请先保存后重试',
    mergeContentRevisionMetadata: evaluateContentRevisionMerger(harness.state),
  });

  const pending = layoutContent(harness.contentId, 'style_10.html');
  await layoutGate.started;
  layoutGate.reject(new Error('layout unavailable'));
  await assert.rejects(pending, /layout unavailable/);
  assert.equal(lockedAtRequest, true);
  assert.equal(harness.$('[data-content-body]').getAttribute('contenteditable'), 'true');
  assert.equal(harness.$$('[data-action]').every(button => !button.disabled), true);
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
    contentOperationLocks: new Map(),
    contentOperationSequence: 0,
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
  const loadData = async () => { reloads += 1; return { applied: true }; };
  const toast = (message, type) => toasts.push({ message, type: type || '' });
  const dirtySource = extractFunctionSource('markContentDirty', 'bindContentEditorDirtyTracking');
  const saveSource = extractFunctionSource('saveContent', 'markContentDirty');
  const markContentDirty = vm.runInNewContext(`(${dirtySource})`, { state, $ });
  const snapshotSource = extractFunctionSource('contentOperationSnapshot', 'setContentOperationBusy');
  const stableSource = extractFunctionSource('contentOperationIsStable', 'preserveContentOperationChanges');
  const preserveSource = extractFunctionSource('preserveContentOperationChanges', 'endContentOperation');
  const contentOperationSnapshot = vm.runInNewContext(`(${snapshotSource})`, { state, $ });
  const contentOperationIsStable = vm.runInNewContext(`(${stableSource})`, { state, contentOperationSnapshot });
  const preserveContentOperationChanges = vm.runInNewContext(`(${preserveSource})`, { state, contentOperationSnapshot });
  const beginContentOperation = target => {
    const key = String(target);
    if (state.contentOperationLocks.has(key)) return null;
    const context = { contentId: key, token: `deferred-${key}`, snapshot: contentOperationSnapshot(key) };
    state.contentOperationLocks.set(key, context);
    return context;
  };
  const endContentOperation = context => state.contentOperationLocks.delete(context.contentId);
  const saveContent = vm.runInNewContext(`(${saveSource})`, {
    state,
    $,
    request,
    clearPlatformPreviews: () => {},
    toast,
    loadData,
    encodeURIComponent,
    beginContentOperation,
    contentOperationIsStable,
    preserveContentOperationChanges,
    endContentOperation,
    mergeContentRevisionMetadata: evaluateContentRevisionMerger(state),
    markContentCanonicalConflict: evaluateCanonicalConflictMarker(state, $, toast),
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
    beginContentOperation,
    contentOperationIsStable,
    preserveContentOperationChanges,
    endContentOperation,
    reloadCount: () => reloads,
    editAndResolve() {
      editor.innerHTML = '<p>newer live revision</p>';
      titleEditor.value = 'Newer live title';
      summaryEditor.value = 'Newer live summary';
      assert.equal(markContentDirty(contentId), false);
      state.contentEditRevisions.set(contentId, state.contentEditRevisions.get(contentId) + 1);
      resolveSave({
        content: {
          ...content,
          title: 'Saved title',
          summary: 'Saved summary',
          body: '<p>saved revision normalized</p>',
          updated_at: '2026-08-31T02:00:00.000Z',
        },
        sourceUpdatedAt: content.updated_at,
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
    beginContentOperation: harness.beginContentOperation,
    contentOperationIsStable: harness.contentOperationIsStable,
    preserveContentOperationChanges: harness.preserveContentOperationChanges,
    endContentOperation: harness.endContentOperation,
    request: harness.request,
    toast: (message, type) => harness.toasts.push({ message, type: type || '' }),
    loadData: async () => { throw new Error('unstable layout must not reload'); },
    openLayoutDialog: () => { throw new Error('unstable layout must not open preview'); },
    getSelectedContent: () => harness.state.data.contents[0],
    encodeURIComponent,
    CONTENT_CHANGED_DURING_SAVE_MESSAGE: '正文在保存期间又有修改，请先保存后重试',
    mergeContentRevisionMetadata: evaluateContentRevisionMerger(harness.state),
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
    beginContentOperation: harness.beginContentOperation,
    contentOperationIsStable: harness.contentOperationIsStable,
    preserveContentOperationChanges: harness.preserveContentOperationChanges,
    endContentOperation: harness.endContentOperation,
    readSelectedPlatforms: () => ['zhihu'],
    request: harness.request,
    toast: (message, type) => harness.toasts.push({ message, type: type || '' }),
    loadData: async () => { throw new Error('unstable draft must not reload'); },
    CONTENT_CHANGED_DURING_SAVE_MESSAGE: '正文在保存期间又有修改，请先保存后重试',
    mergeContentRevisionMetadata: evaluateContentRevisionMerger(harness.state),
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
    beginContentOperation: harness.beginContentOperation,
    contentOperationIsStable: harness.contentOperationIsStable,
    preserveContentOperationChanges: harness.preserveContentOperationChanges,
    endContentOperation: harness.endContentOperation,
    setBatchPublishBusy: busy => busyStates.push(busy),
    saveContent: harness.saveContent,
    renderProgress: () => { throw new Error('unstable publish must not render progress'); },
    request: harness.request,
    toast: (message, type) => harness.toasts.push({ message, type: type || '' }),
    loadData: async () => { throw new Error('unstable publish must not reload'); },
    switchView: () => { throw new Error('unstable publish must not navigate'); },
    CONTENT_CHANGED_DURING_SAVE_MESSAGE: '正文在保存期间又有修改，请先保存后重试',
    mergeContentRevisionMetadata: evaluateContentRevisionMerger(harness.state),
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
    beginContentOperation: harness.beginContentOperation,
    contentOperationIsStable: harness.contentOperationIsStable,
    preserveContentOperationChanges: harness.preserveContentOperationChanges,
    endContentOperation: harness.endContentOperation,
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
    mergeContentRevisionMetadata: evaluateContentRevisionMerger(harness.state),
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
    beginContentOperation: harness.beginContentOperation,
    contentOperationIsStable: harness.contentOperationIsStable,
    preserveContentOperationChanges: harness.preserveContentOperationChanges,
    endContentOperation: harness.endContentOperation,
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
  assert.match(appSource, /if \(name === 'save-content'\)\s+void saveContent\(id, \{ userInitiated: true \}\)/);
});
