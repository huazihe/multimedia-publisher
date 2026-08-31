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
