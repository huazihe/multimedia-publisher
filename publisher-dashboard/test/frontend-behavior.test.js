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
    '<script>alert(1)</script><button controls>发布</button>',
    '<pre><code class="language-html">&lt;button data-action="code"&gt;示例&lt;/button&gt;</code></pre>',
  ].join(''), document);

  assert.match(sanitized, /<p>正文 <a>链接<\/a><\/p>/);
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
  const createSource = extractFunctionSource('createPublishOperationId', 'beginSinglePublishOperation');
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
    saveContent: async id => { transitionState.dirtyContentIds.delete(id); },
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
