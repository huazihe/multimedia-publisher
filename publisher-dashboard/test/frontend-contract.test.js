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

test('keeps a compact creator brand with a writing mascot and matching tab icon', () => {
  assert.equal(document.querySelector('title').textContent, '创作者工作台');
  assert.equal(document.querySelector('.brand-copy').textContent.trim(), '创作者工作台');
  const logo=document.querySelector('.brand-mascot');
  assert.ok(logo);assert.match(logo.getAttribute('src'), /creator-writing-mascot\.png/);
  assert.equal(document.querySelector('link[rel="icon"]').getAttribute('href'),logo.getAttribute('src'));
  assert.equal(document.querySelector('.brand-mark'),null);
  assert.equal(document.querySelector('.workspace-utility-note'),null);
  assert.doesNotMatch(indexSource,/留心创作|安心分发/);
});

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
  assert.doesNotMatch(appSource, /toggle-employee-menu|select-employee|const EMPLOYEES/);
  assert.match(appSource, /start-login/);
  assert.match(appSource, /publish-selected/);
  assert.match(appSource, /data-history-filter/);
});

test('the sidebar owns its icon-only collapse control and has no virtual employees',()=>{
  const toggle=document.querySelector('[data-action="toggle-sidebar"]');
  assert.ok(toggle.closest('#workspace-navigation'));
  assert.equal(toggle.textContent.trim(),'');assert.ok(toggle.querySelector('svg'));
  assert.equal(toggle.getAttribute('aria-controls'),'workspace-navigation');
  assert.equal(document.querySelector('.workspace-utility-bar'),null);
  assert.equal(document.querySelector('[data-employee-picker]'),null);
  assert.ok(document.querySelector('#publish-recovery-dialog'));
});

test('defines an accessible semantic import dialog for paste and local text files', () => {
  const dialog = document.querySelector('dialog#import-dialog');
  assert.ok(dialog, '缺少 import-dialog');
  assert.equal(dialog.getAttribute('aria-labelledby'), 'import-dialog-title');
  assert.ok(document.querySelector('#import-dialog-title'));

  const tabs = [...dialog.querySelectorAll('[role="tab"][data-import-tab]')];
  assert.deepEqual(tabs.map(tab => tab.dataset.importTab), ['paste', 'file', 'feishu']);
  assert.deepEqual(tabs.map(tab => ({
    id: tab.id,
    selected: tab.getAttribute('aria-selected'),
    controls: tab.getAttribute('aria-controls'),
    tabIndex: tab.getAttribute('tabindex'),
  })), [
    { id: 'import-paste-tab', selected: 'true', controls: 'import-paste-panel', tabIndex: '0' },
    { id: 'import-file-tab', selected: 'false', controls: 'import-file-panel', tabIndex: '-1' },
    { id: 'import-feishu-tab', selected: 'false', controls: 'import-feishu-panel', tabIndex: '-1' },
  ]);
  const panels = [...dialog.querySelectorAll('[role="tabpanel"]')];
  assert.deepEqual(panels.map(panel => ({
    id: panel.id,
    labelledBy: panel.getAttribute('aria-labelledby'),
    hidden: panel.hasAttribute('hidden'),
  })), [
    { id: 'import-paste-panel', labelledBy: 'import-paste-tab', hidden: false },
    { id: 'import-file-panel', labelledBy: 'import-file-tab', hidden: true },
    { id: 'import-feishu-panel', labelledBy: 'import-feishu-tab', hidden: true },
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
    '<strong>加粗</strong>',
    '<em>强调</em>',
    '<b>粗体</b>',
    '<i>斜体</i>',
    '<u>下划线</u>',
    '<s>删除</s>',
    '<del>删除</del>',
    '<span>行内容器</span>',
    '<caption>表题</caption>',
    '<colgroup></colgroup>',
    '<col>',
    '<tfoot></tfoot>',
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
  assert.equal(inferImportFormat('authoritative.txt', '<article>仍是纯文本</article>'), 'text');
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
  const importState = { importTab: 'paste', importReadToken: 0, importReader: null };
  const setImportTab = vm.runInNewContext(`(${setImportTabSource})`, {
    state: importState,
    $$: selector => [...importDocument.querySelectorAll(selector)],
    $: selector => importDocument.querySelector(selector),
    setImportFeedback: () => {},
    invalidateImportRead: state => { state.importReadToken += 1; return state.importReadToken; },
  });
  setImportTab('file');
  assert.equal(importState.importTab, 'file');
  assert.deepEqual(
    [...importDocument.querySelectorAll('[data-import-tab]')].map(tab => [
      tab.getAttribute('aria-selected'),
      tab.getAttribute('tabindex'),
    ]),
    [['false', '-1'], ['true', '0'], ['false', '-1']],
  );
  assert.equal(importDocument.querySelector('#import-paste-panel').hidden, true);
  assert.equal(importDocument.querySelector('#import-file-panel').hidden, false);
  setImportTab('feishu');
  assert.equal(importDocument.querySelector('#import-file-panel').hidden, true);
  assert.equal(importDocument.querySelector('#import-feishu-panel').hidden, false);

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
});

function renderPlatformWorkspace(activePlatform) {
  const source = extractFunctionSource(appSource, 'platformAdaptationHtml', 'platformPaneFocusKey');
  assert.ok(source);
  const featured = ['weixin', 'woshipm', 'sspai', 'xiaohongshu', 'uisdc', 'douyin'];
  const platforms = [...featured, 'csdn'].map(id => ({ id, name: id === 'csdn' ? 'CSDN' : id }));
  const render = vm.runInNewContext(`(${source})`, {
    state: { activePreviewPlatform: activePlatform, data: { platforms }, previewDevice: 'desktop' },
    FEATURED_PREVIEW_PLATFORMS: featured,
    UISDC_SUBMISSION_URL: 'https://www.uisdc.com/contribution?type=post',
    sortLoginPlatforms: items => items,
    ensureActivePreviewPlatform: () => {},
    previewPlatformRecord: id => platforms.find(platform => platform.id === id),
    platformTabId: id => `platform-preview-tab-${id}`,
    platformName: id => platforms.find(platform => platform.id === id)?.name || id,
    escapeHtml: value => String(value ?? ''),
    platformAvatar: () => '',
    wechatTemplateControls: () => '<div>微信模板</div>',
    platformPreviewResult: () => '<div>预览</div>',
    platformPreparationMode: id => ['uisdc','jianshu','netease'].includes(id) ? 'manual' : ['xiaohongshu','toutiao','douban'].includes(id) ? 'editor' : ['douyin','qiehao'].includes(id) ? 'draft-text' : 'draft',
    platformHandoffResult: () => null,
  });
  return parseHTML(`<main>${render({ id: 'content-1' })}</main>`).document;
}

test('keeps six featured platform tabs when another platform is selected', () => {
  const featured = ['weixin', 'woshipm', 'sspai', 'xiaohongshu', 'uisdc', 'douyin'];
  const documentWithOther = renderPlatformWorkspace('csdn');
  const tabs = [...documentWithOther.querySelectorAll('.platform-preview-tabs [role="tab"]')];
  assert.deepEqual(tabs.map(tab => tab.dataset.platform), featured);
  assert.equal(tabs.length, featured.length);
  assert.equal(tabs.filter(tab => tab.getAttribute('aria-selected') === 'true').length, 0);
  assert.deepEqual(tabs.filter(tab => tab.getAttribute('tabindex') === '0').map(tab => tab.dataset.platform), ['weixin']);
  assert.equal(documentWithOther.querySelector('[data-platform-preview-select] option[selected]')?.value, 'csdn');
  assert.match(documentWithOther.querySelector('.platform-adaptation-head h2').textContent, /CSDN/);
  assert.equal(documentWithOther.querySelector('#platform-preview-panel').getAttribute('aria-label'), 'CSDN 平台适配预览');

  const documentWithFeatured = renderPlatformWorkspace('woshipm');
  const featuredTabs = [...documentWithFeatured.querySelectorAll('.platform-preview-tabs [role="tab"]')];
  assert.equal(featuredTabs.length, featured.length);
  assert.deepEqual(featuredTabs.filter(tab => tab.getAttribute('aria-selected') === 'true').map(tab => tab.dataset.platform), ['woshipm']);
  assert.deepEqual(featuredTabs.filter(tab => tab.getAttribute('tabindex') === '0').map(tab => tab.dataset.platform), ['woshipm']);
  assert.equal(documentWithFeatured.querySelector('#platform-preview-panel').getAttribute('aria-labelledby'), 'platform-preview-tab-woshipm');
});

test('uisdc offers the official manual submission entry without fake draft or direct actions', () => {
  const doc=renderPlatformWorkspace('uisdc');
  assert.equal(doc.querySelector('[data-action="open-platform-session"]').getAttribute('data-url'),'https://www.uisdc.com/contribution?type=post');
  assert.equal(doc.querySelector('[data-action="open-platform-draft"]'),null);
  assert.equal(doc.querySelector('[data-action="open-platform-direct"]'),null);
  assert.match(doc.querySelector('#platform-delivery-note').textContent,/手工投稿|官方表单/);
});

test('keeps draft operations ahead of the preview and hands final publication to the user', () => {
  const doc=renderPlatformWorkspace('woshipm');
  const children=[...doc.querySelector('#platform-preview-panel').children];
  assert.ok(children.findIndex(e=>e.classList.contains('platform-publish-actions'))<children.findIndex(e=>e.hasAttribute('data-platform-preview-live')));
  assert.equal(doc.querySelector('[data-action="open-platform-direct"]'),null);
  const handoff=doc.querySelector('[data-action="open-platform-session"]');
  assert.equal(handoff.textContent,'检查草稿并发表');assert.equal(handoff.hasAttribute('disabled'),true);
  assert.match(doc.querySelector('#platform-delivery-note').textContent,/不会公开发表/);
});

test('woshipm iframe has its own responsive reading canvas without restyling WeChat templates', () => {
  const source=extractFunctionSource(appSource,'platformPreviewDocument','wechatTemplateControls');
  const render=vm.runInNewContext(`(${source})`,{escapeHtml:s=>String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'),platformName:p=>p});
  const input={format:'html',htmlPreview:'<p>原稿</p><img src="/uploads/example.png">'};
  const doc=parseHTML(render(input,'woshipm')).document;
  const html=doc.querySelector('iframe').getAttribute('srcdoc');
  assert.match(html,/class="workbench-reading-column"/);assert.match(html,/max-width:100%!important/);assert.match(html,/height:auto!important/);
  assert.ok(!/overflow-x:hidden/.test(html));
  const wechat=parseHTML(render(input,'weixin')).document.querySelector('iframe').getAttribute('srcdoc');
  assert.equal(wechat,input.htmlPreview);
});

test('restores focus for platform selector, device controls, and featured tabs after rerender', () => {
  const keySource = extractFunctionSource(appSource, 'platformPaneFocusKey', 'restorePlatformPaneFocus');
  const restoreSource = extractFunctionSource(appSource, 'restorePlatformPaneFocus', 'renderPlatformAdaptationPane');
  assert.ok(keySource, '缺少稳定焦点键读取函数');
  assert.ok(restoreSource, '缺少重绘后焦点恢复函数');
  const platformPaneFocusKey = vm.runInNewContext(`(${keySource})`);
  const restorePlatformPaneFocus = vm.runInNewContext(`(${restoreSource})`);
  const { document: focusDocument } = parseHTML(`
    <section id="focus-host">
      <select data-platform-focus-key="selector"><option>CSDN</option></select>
      <button data-platform-focus-key="device:desktop">桌面</button>
      <button data-platform-focus-key="device:mobile">手机</button>
      <button role="tab" data-platform-focus-key="tab:weixin">微信</button>
    </section>
    <button id="outside">外部</button>
  `);
  const host = focusDocument.querySelector('#focus-host');
  const controls = [...host.querySelectorAll('[data-platform-focus-key]')];
  assert.deepEqual(controls.map(control => platformPaneFocusKey(control, host)), [
    'selector',
    'device:desktop',
    'device:mobile',
    'tab:weixin',
  ]);
  assert.equal(platformPaneFocusKey(focusDocument.querySelector('#outside'), host), '');

  let restored = '';
  controls.forEach(control => {
    control.focus = () => { restored = control.dataset.platformFocusKey; };
  });
  for (const key of ['selector', 'device:desktop', 'device:mobile', 'tab:weixin']) {
    restored = '';
    restorePlatformPaneFocus(host, key);
    assert.equal(restored, key);
  }
  assert.match(appSource, /const focusKey\s*=\s*platformPaneFocusKey\(document\.activeElement, host\)/);
  assert.match(appSource, /restorePlatformPaneFocus\(host, focusKey\)/);
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

  assert.match(appSource, /FEATURED_PREVIEW_PLATFORMS\s*=\s*\[['"]weixin['"],\s*['"]woshipm['"],\s*['"]sspai['"],\s*['"]xiaohongshu['"],\s*['"]uisdc['"],\s*['"]douyin['"]\]/);
  assert.match(appSource, /allPlatforms\.map\(/, '全部平台下拉框必须由完整平台数据动态生成');
  assert.match(appSource, /data-platform-preview-select/);
  assert.match(appSource, /data-preview-device=["']desktop["']/);
  assert.match(appSource, /data-preview-device=["']mobile["']/);

  assert.match(appSource, /<iframe[^>]*\ssandbox\s+srcdoc=/s);
  assert.match(appSource, /<pre[^>]*>\$\{escapeHtml\([^)]*(?:content|markdown|text)/s);
  assert.match(appSource, /async function layoutContent[\s\S]*?expectedUpdatedAt[\s\S]*?\/layout/);
  assert.match(appSource, /async function saveDraft[\s\S]*?expectedUpdatedAt[\s\S]*?\/save-draft/);
  assert.match(appSource, /async function confirmSinglePlatformPublish[\s\S]*?expectedUpdatedAt[\s\S]*?\/publish-platform/);
  assert.match(appSource, /async function publishContent[\s\S]*?expectedUpdatedAt[\s\S]*?\/api\/publish/);
  assert.match(appSource, /if\s*\((?:templateProvided\s*&&\s*)?!template\)\s*(?:\{|)\s*throw\s+new Error/);
  assert.match(appSource, /mode:\s*['"]draft['"]/);
  assert.match(appSource, /mode:\s*['"]direct['"]/);
  assert.match(appSource, /operationId:\s*operation\.operationId/);
  assert.match(appSource, /platform-publish-dialog['"]\)\.close\(\)[\s\S]*?await loadData\(\)/, '发布成功必须先关闭确认框再刷新数据');
  assert.match(appSource, /同步结果已返回，但列表刷新失败/);
  assert.match(appSource, /workbenchCsrfToken/);
  assert.match(appSource, /X-Workbench-CSRF/);
  assert.match(appSource, /state\.workbenchCsrfToken\s*=\s*res\.data\.csrfToken/);
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

test('browser consumes server-normalized canonical HTML without an ad-hoc Markdown parser', () => {
  assert.doesNotMatch(appSource, /function\s+markdownToEditableHtml\s*\(/);
  assert.match(appSource, /sanitizeClientCanonicalHtml\(`\$\{body\}\$\{contentImagesHtml/);
});

test('platform preview distinguishes relative image references and pending table conversion', () => {
  const fnSource = extractFunctionSource(appSource, 'platformPreviewResult', 'platformAdaptationHtml');
  assert.ok(fnSource);
  const key = 'content::revision::woshipm';
  const run = (html, platform = 'woshipm') => {
    const preview = { title: '文章', format: 'html', htmlPreview: html, article: { html }, warnings: [], imageCount: 1 };
    const fn = vm.runInNewContext(`(${fnSource})`, {
      state: { previewCache: new Map([[key, preview]]), previewErrors: new Map(), previewLoading: new Set(), previewDevice: 'desktop' },
      platformPreviewKey: () => key,
      platformName: id => id,
      escapeHtml: value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
      previewLimitChips: () => '1 个图片引用',
      platformPreviewDocument: () => '<p>预览</p>',
    });
    return fn({ id: 'content' }, platform);
  };
  const local = run('<table><tr><td>内容</td></tr></table><img src="%E6%8F%92%E5%9B%BE/local.png">');
  assert.match(local, /1 个本地或相对图片引用/);
  assert.match(local, /尚未将表格转成图片/);
  assert.match(local, /已保存母稿的适配结果/);
  const remote = run('<p>正文</p><img src="https://example.com/image.png">');
  assert.doesNotMatch(remote, /本地或相对图片引用|尚未将表格转成图片/);
  assert.match(remote, /图片可用性与平台最终效果仍需核对/);
  assert.doesNotMatch(run('<table><tr><td>内容</td></tr></table>', 'zhihu'), /尚未将表格转成图片/);
});
