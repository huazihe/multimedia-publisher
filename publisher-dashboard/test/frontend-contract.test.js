'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const vm = require('node:vm');

const dashboardRoot = path.resolve(__dirname, '..');
const indexPath = path.join(dashboardRoot, 'public', 'index.html');
const appPath = path.join(dashboardRoot, 'public', 'app.js');
const stylesPath = path.join(dashboardRoot, 'public', 'styles.css');
const indexSource = fs.readFileSync(indexPath, 'utf8');
const appSource = fs.readFileSync(appPath, 'utf8');
const stylesSource = fs.readFileSync(stylesPath, 'utf8');
const requireFromCore = createRequire(path.resolve(dashboardRoot, '..', 'packages', 'core', 'package.json'));
const { parseHTML } = (() => {
  try {
    return require('linkedom');
  } catch (error) {
    if (error?.code !== 'MODULE_NOT_FOUND') throw error;
    return requireFromCore('linkedom');
  }
})();
const { document } = parseHTML(indexSource);

function extractFunctionSource(source, name, nextName) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf(`\nfunction ${nextName}(`, start);
  if (start < 0 || end < 0) return null;
  return source.slice(start, end).trim();
}

test('keeps the six dynamic dashboard views and delegated navigation contract', () => {
  const views = ['dashboard', 'plans', 'content', 'publish', 'platforms', 'history'];
  assert.deepEqual(
    [...document.querySelectorAll('.nav-btn[data-view]')].map(button => button.dataset.view),
    views,
  );
  assert.deepEqual(
    [...document.querySelectorAll('main .view[id]')].map(section => section.id),
    views.map(view => `view-${view}`),
  );
  assert.match(appSource, /function switchView\s*\(/);
  assert.match(appSource, /function render\s*\(/);
  assert.match(appSource, /async function loadData\s*\(/);
  assert.match(appSource, /document\.addEventListener\(['"]click['"]/);
  assert.match(appSource, /toggle-sidebar/);
  assert.match(appSource, /toggle-employee-menu/);
  assert.match(appSource, /start-login/);
  assert.match(appSource, /publish-selected/);
  assert.match(appSource, /data-history-filter/);
});

test('defines an accessible semantic import dialog for paste and local text files', () => {
  const dialog = document.querySelector('dialog#import-dialog');
  assert.ok(dialog, '缺少 import-dialog');
  assert.equal(dialog.getAttribute('aria-labelledby'), 'import-dialog-title');
  assert.ok(document.querySelector('#import-dialog-title'));

  const tabs = [...dialog.querySelectorAll('[role="tab"][data-import-tab]')];
  assert.deepEqual(tabs.map(tab => tab.dataset.importTab), ['paste', 'file']);
  assert.deepEqual(tabs.map(tab => ({
    id: tab.id,
    selected: tab.getAttribute('aria-selected'),
    controls: tab.getAttribute('aria-controls'),
    tabIndex: tab.getAttribute('tabindex'),
  })), [
    { id: 'import-paste-tab', selected: 'true', controls: 'import-paste-panel', tabIndex: '0' },
    { id: 'import-file-tab', selected: 'false', controls: 'import-file-panel', tabIndex: '-1' },
  ]);
  const panels = [...dialog.querySelectorAll('[role="tabpanel"]')];
  assert.deepEqual(panels.map(panel => ({
    id: panel.id,
    labelledBy: panel.getAttribute('aria-labelledby'),
    hidden: panel.hasAttribute('hidden'),
  })), [
    { id: 'import-paste-panel', labelledBy: 'import-paste-tab', hidden: false },
    { id: 'import-file-panel', labelledBy: 'import-file-tab', hidden: true },
  ]);

  const title = dialog.querySelector('#import-title-input');
  const textarea = dialog.querySelector('#import-content-input');
  const file = dialog.querySelector('#import-file-input[type="file"]');
  assert.ok(title && dialog.querySelector('label[for="import-title-input"]'));
  assert.ok(textarea && dialog.querySelector('label[for="import-content-input"]'));
  assert.ok(file && dialog.querySelector('label[for="import-file-input"]'));
  assert.equal(file.getAttribute('accept'), '.md,.markdown,.html,.htm,.txt');
  assert.match(dialog.textContent, /5\s*MiB/i);
  assert.ok(dialog.querySelector('[data-action="submit-import"]'));
  assert.ok(dialog.querySelector('[data-action="cancel-import"]'));
});

test('infers all supported HTML fragments without confusing Markdown autolinks or code', () => {
  const source = extractFunctionSource(appSource, 'inferImportFormat', 'importedBodyByteLength');
  assert.ok(source, 'inferImportFormat 必须保持为可独立测试的纯函数');
  const inferImportFormat = vm.runInNewContext(`(${source})`);
  const htmlFragments = [
    '<!doctype html><html><head><title>T</title></head><body><main>正文</main></body></html>',
    '<ul><li>项目</li></ul>',
    '<ol><li>项目</li></ol>',
    '<li>项目</li>',
    '<blockquote>引用</blockquote>',
    '<table></table>',
    '<thead></thead>',
    '<tbody></tbody>',
    '<tr></tr>',
    '<th>标题</th>',
    '<td>单元格</td>',
    '<figure></figure>',
    '<figcaption>图注</figcaption>',
    '<pre>代码</pre>',
    '<code>const value = 1;</code>',
    '<hr>',
    '<br>',
    '<img src="/cover.png" alt="封面">',
    '<a href="https://example.com">链接</a>',
    '<h3>标题</h3>',
    '<article>文章</article>',
    '<main>正文</main>',
    '<section>章节</section>',
    '<div>容器</div>',
    '<p>段落</p>',
  ];
  for (const fragment of htmlFragments) {
    assert.equal(inferImportFormat('', fragment), 'html', fragment);
  }

  for (const markdown of [
    '<https://example.com/path?q=1>',
    '<ftp://files.example.com/pub/article.txt>',
    '<writer@example.com>',
    '`<table><tr><td>inline</td></tr></table>`',
    '``<code>`inline tick`</code>``',
    '```html\n<table><tr><td>fenced</td></tr></table>\n```',
    '    <figure><img src="code.png"></figure>',
  ]) {
    assert.equal(inferImportFormat('', markdown), 'markdown', markdown);
  }
  assert.equal(inferImportFormat('', '2 < 3，且 5 > 4'), 'text');
});

test('implements roving tabindex and keyboard navigation for import and platform tabs', () => {
  const source = extractFunctionSource(appSource, 'nextTabIndexForKey', 'handleTablistKeydown');
  assert.ok(source, '缺少可单元测试的 Tab 键盘索引函数');
  const nextTabIndexForKey = vm.runInNewContext(`(${source})`);
  assert.equal(nextTabIndexForKey('ArrowRight', 0, 3), 1);
  assert.equal(nextTabIndexForKey('ArrowRight', 2, 3), 0);
  assert.equal(nextTabIndexForKey('ArrowLeft', 0, 3), 2);
  assert.equal(nextTabIndexForKey('ArrowLeft', 2, 3), 1);
  assert.equal(nextTabIndexForKey('Home', 2, 3), 0);
  assert.equal(nextTabIndexForKey('End', 0, 3), 2);
  assert.equal(nextTabIndexForKey('Enter', 1, 3), -1);

  const setImportTabSource = extractFunctionSource(appSource, 'setImportTab', 'resetImportDialog');
  assert.ok(setImportTabSource);
  const { document: importDocument } = parseHTML(indexSource);
  const importState = { importTab: 'paste' };
  const setImportTab = vm.runInNewContext(`(${setImportTabSource})`, {
    state: importState,
    $$: selector => [...importDocument.querySelectorAll(selector)],
    $: selector => importDocument.querySelector(selector),
    setImportFeedback: () => {},
  });
  setImportTab('file');
  assert.equal(importState.importTab, 'file');
  assert.deepEqual(
    [...importDocument.querySelectorAll('[data-import-tab]')].map(tab => [
      tab.getAttribute('aria-selected'),
      tab.getAttribute('tabindex'),
    ]),
    [['false', '-1'], ['true', '0']],
  );
  assert.equal(importDocument.querySelector('#import-paste-panel').hidden, true);
  assert.equal(importDocument.querySelector('#import-file-panel').hidden, false);

  const handleSource = extractFunctionSource(appSource, 'handleTablistKeydown', 'setImportFeedback');
  assert.ok(handleSource);
  const activations = [];
  const handleTablistKeydown = vm.runInNewContext(`(${handleSource})`, {
    nextTabIndexForKey,
    setImportTab: tab => activations.push(`import:${tab}`),
    selectPreviewPlatform: platform => activations.push(`platform:${platform}`),
  });
  const { document: keyboardDocument } = parseHTML(`
    <div role="tablist">
      <button role="tab" data-platform="weixin">微信</button>
      <button role="tab" data-platform="zhihu">知乎</button>
    </div>
  `);
  const keyboardTabs = [...keyboardDocument.querySelectorAll('[role="tab"]')];
  let focusedPlatform = '';
  let prevented = false;
  keyboardTabs.forEach(tab => {
    tab.focus = () => { focusedPlatform = tab.dataset.platform; };
  });
  assert.equal(handleTablistKeydown({
    key: 'ArrowRight',
    target: keyboardTabs[0],
    preventDefault: () => { prevented = true; },
  }), true);
  assert.equal(prevented, true);
  assert.equal(focusedPlatform, 'zhihu');
  assert.deepEqual(activations, ['platform:zhihu']);

  assert.match(appSource, /button\.setAttribute\(['"]tabindex['"],\s*active\s*\?\s*['"]0['"]\s*:\s*['"]-1['"]\)/);
  assert.match(appSource, /function handleTablistKeydown\s*\(/);
  assert.match(appSource, /\['ArrowLeft',\s*'ArrowRight',\s*'Home',\s*'End'\]/);
  assert.match(appSource, /nextTab\.focus\(\)/);
  assert.match(appSource, /class="platform-preview-tabs" role="tablist"/);
  assert.match(appSource, /role="tab"[^>]+aria-controls="platform-preview-panel"[^>]+aria-selected=[^>]+tabindex=/);
  assert.match(appSource, /id="platform-preview-panel"[^>]+role="tabpanel"[^>]+aria-labelledby=/);
  assert.match(appSource, /focusedPlatform[\s\S]*?\?\.focus\(\)/);
});

test('defines an explicit article/platform/mode publish confirmation dialog', () => {
  const dialog = document.querySelector('dialog#platform-publish-dialog');
  assert.ok(dialog, '缺少 platform-publish-dialog');
  assert.equal(dialog.getAttribute('aria-labelledby'), 'platform-publish-dialog-title');
  assert.ok(dialog.querySelector('#single-publish-article'));
  assert.ok(dialog.querySelector('#single-publish-platform'));
  assert.ok(dialog.querySelector('#single-publish-mode'));
  assert.ok(dialog.querySelector('[data-action="confirm-single-publish"]'));
  assert.ok(dialog.querySelector('[data-action="cancel-single-publish"]'));
});

test('implements import, lazy adaptation preview, templated WeChat layout, and single-platform publish contracts', () => {
  for (const stateField of [
    'layoutTemplates',
    'activePreviewPlatform',
    'previewCache',
    'previewLoading',
    'previewErrors',
    'selectedWechatTemplate',
    'pendingSinglePublish',
  ]) {
    assert.match(appSource, new RegExp(`\\b${stateField}\\b`), `缺少状态 ${stateField}`);
  }

  assert.match(appSource, /\/api\/layout-templates/);
  assert.match(appSource, /\/api\/content\/import/);
  assert.match(appSource, /platform-preview\?platform=/);
  assert.match(appSource, /\/layout/);
  assert.match(appSource, /\/publish-platform/);
  assert.match(appSource, /new FileReader\s*\(/);
  assert.match(appSource, /\.readAsText\s*\(/);
  assert.match(appSource, /5\s*\*\s*1024\s*\*\s*1024/);
  assert.match(appSource, /function inferImportFormat\s*\(/);
  assert.match(appSource, /const sourceFilename\s*=\s*state\.importTab === ['"]file['"]\s*\?\s*state\.importFileName\s*:\s*['"]/);
  assert.doesNotMatch(appSource, /new FormData\s*\(/, '原始文件不得作为 multipart 上传');

  assert.match(appSource, /FEATURED_PREVIEW_PLATFORMS\s*=\s*\[['"]weixin['"],\s*['"]zhihu['"],\s*['"]juejin['"],\s*['"]xiaohongshu['"],\s*['"]toutiao['"]\]/);
  assert.match(appSource, /allPlatforms\.map\(/, '全部平台下拉框必须由完整平台数据动态生成');
  assert.match(appSource, /data-platform-preview-select/);
  assert.match(appSource, /data-preview-device=["']desktop["']/);
  assert.match(appSource, /data-preview-device=["']mobile["']/);

  assert.match(appSource, /<iframe[^>]*\ssandbox\s+srcdoc=/s);
  assert.match(appSource, /<pre[^>]*>\$\{escapeHtml\([^)]*(?:content|markdown|text)/s);
  assert.match(appSource, /body:\s*JSON\.stringify\(\{\s*template\s*\}\)/);
  assert.match(appSource, /if\s*\((?:templateProvided\s*&&\s*)?!template\)\s*(?:\{|)\s*throw\s+new Error/);
  assert.match(appSource, /mode:\s*['"]draft['"]/);
  assert.match(appSource, /mode:\s*['"]direct['"]/);
  assert.match(appSource, /await loadData\(\)[\s\S]*?platformResult\?\.status === ['"]success['"]/, '单平台结果必须回载数据后再按真实状态提示');
  assert.match(appSource, /selected\s*&&\s*state\.activeView === ['"]content['"]/, '平台预览只应在内容中心激活时懒加载');
});

test('isolates global actions from editable/imported content containers', () => {
  assert.match(appSource, /function isActionEventIsolated\s*\(/);
  assert.match(appSource, /\[data-user-editable\]/);
  const delegatedClick = appSource.slice(appSource.indexOf("document.addEventListener('click'"));
  assert.match(
    delegatedClick,
    /if\s*\(isActionEventIsolated\(event\.target\)\)\s*return[\s\S]*?closest\(['"]\[data-action\]['"]\)/,
  );
  for (const eventName of ['change', 'input', 'keydown']) {
    assert.match(
      appSource,
      new RegExp(`document\\.addEventListener\\(['"]${eventName}['"], event => \\{\\s*if \\(isActionEventIsolated\\(event\\.target\\)\\) return`),
      `${eventName} 委托必须先隔离用户内容`,
    );
  }
  assert.match(appSource, /function bindContentEditorDirtyTracking\s*\(/);
  assert.match(appSource, /if\s*\(selected\)\s*bindContentEditorDirtyTracking\(selected\.id\)/);
  assert.match(appSource, /field\.addEventListener\(['"]input['"],\s*\(\)\s*=>\s*markContentDirty\(id\)\)/);
});

test('contains unique static ids and responsive, horizontally safe workspace rules', () => {
  const ids = [...document.querySelectorAll('[id]')].map(element => element.id);
  assert.equal(new Set(ids).size, ids.length, 'index.html 包含重复 id');
  assert.match(stylesSource, /\.content-adaptation-workspace/);
  assert.match(stylesSource, /\.platform-preview-tabs[\s\S]*?overflow-x:\s*auto/);
  assert.match(stylesSource, /@media\s*\(max-width:\s*820px\)/);
  assert.match(stylesSource, /@media\s*\(max-width:\s*560px\)/);
  assert.match(stylesSource, /overflow-x:\s*hidden/);
});

test('keeps the browser JavaScript syntactically valid', () => {
  const result = spawnSync(process.execPath, ['--check', appPath], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
