# Shared Platform Adaptation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dynamic local content workflow that imports external articles, preserves all six existing dashboard views, renders WeChat templates, previews platform-specific output, and publishes the exact prepared output per platform.

**Architecture:** Add a pure `prepareArticleForPlatform()` module to `@weibot/core` and make both CLI publishing and dashboard preview consume it. Keep one canonical article in the existing `contents` table; imports, WeChat layouts, and platform previews are derived without a database migration. Extend the existing dashboard rather than replacing its navigation or views.

**Tech Stack:** TypeScript, Vitest, Node.js `node:test`, Node SQLite, LinkeDOM, Commander, vanilla HTML/CSS/JavaScript.

---

## File map

- Create `packages/core/src/adapters/prepare.ts`: pure platform preparation and preview metadata.
- Create `packages/core/src/adapters/__tests__/prepare.test.ts`: representative HTML, Markdown, and text platform tests.
- Modify `packages/core/src/adapters/index.ts`: export the preparation API.
- Modify `packages/cli/src/direct.ts`: prepare separately for every platform before adapter publish and expose JSON preview.
- Modify `packages/cli/src/index.ts`: register the `preview` command.
- Modify `packages/cli/package.json`: add the focused Vitest command.
- Create `packages/cli/test/fixtures/article.md`: stable CLI preview fixture.
- Create `publisher-dashboard/layout-templates.js`: safe template discovery and rendering.
- Create `publisher-dashboard/test/layout-templates.test.js`: all-template compatibility checks.
- Modify `publisher-dashboard/server.js`: import, template, preview, and single-platform publish APIs.
- Modify `publisher-dashboard/test/server.test.js`: import and job snapshot tests.
- Modify `publisher-dashboard/public/index.html`: import dialog and platform publish confirmation dialog.
- Modify `publisher-dashboard/public/app.js`: dynamic import, preview, template, and single-platform actions while preserving existing view routing.
- Modify `publisher-dashboard/public/styles.css`: responsive editor/preview workspace using the existing visual language.
- Modify `package.json`: build core/CLI before dashboard integration tests and startup.

---

### Task 1: Pure shared preparation layer

**Files:**
- Create: `packages/core/src/adapters/prepare.ts`
- Create: `packages/core/src/adapters/__tests__/prepare.test.ts`
- Modify: `packages/core/src/adapters/index.ts`

- [ ] **Step 1: Write failing preparation tests**

```ts
import { describe, expect, it } from 'vitest'
import { prepareArticleForPlatform } from '../prepare'

const article = {
  title: '验收常见误区',
  markdown: '# 验收常见误区\n\n[外链](https://example.com)\n\n![图](https://img.example.com/a.png)',
  html: '<h1>验收常见误区</h1><p><a href="https://example.com">外链</a></p><img src="https://img.example.com/a.png">',
}

describe('prepareArticleForPlatform', () => {
  it('keeps HTML but removes external links for WeChat', () => {
    const result = prepareArticleForPlatform(article, 'weixin')
    expect(result.format).toBe('html')
    expect(result.content).not.toContain('https://example.com')
    expect(result.content).toContain('外链')
  })

  it('returns Markdown for Juejin', () => {
    const result = prepareArticleForPlatform(article, 'juejin')
    expect(result.format).toBe('markdown')
    expect(result.content).toContain('[外链](https://example.com)')
  })

  it('returns short plain text and image limits for Xiaohongshu', () => {
    const result = prepareArticleForPlatform(article, 'xiaohongshu')
    expect(result.format).toBe('text')
    expect(result.content).not.toContain('<h1>')
    expect(result.limits.maxImages).toBe(9)
  })
})
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx -y pnpm@9.15.9 --filter @weibot/core test --run src/adapters/__tests__/prepare.test.ts`

Expected: FAIL because `../prepare` does not exist.

- [ ] **Step 3: Implement the preparation contract**

```ts
export type PreparedFormat = 'html' | 'markdown' | 'text'

export interface PlatformPreparedArticle {
  platform: string
  title: string
  format: PreparedFormat
  content: string
  htmlPreview: string
  imageCount: number
  warnings: string[]
  limits: { maxImages?: number; maxTitleLength?: number }
  article: Article
}

export function prepareArticleForPlatform(article: Article, platformId: string): PlatformPreparedArticle {
  const entry = createDefaultAdapterEntries().find(item => item.meta.id === platformId)
  if (!entry) throw new Error(`平台不存在: ${platformId}`)
  const config = { ...DEFAULT_PREPROCESS_CONFIG, ...(entry.preprocessConfig || {}) }
  const format = TEXT_PLATFORM_IDS.has(platformId) ? 'text' : config.outputFormat
  const html = sanitizeHtml(article.html || markdownToHtml(article.markdown || ''), config)
  const markdown = htmlToMarkdown(html)
  const content = format === 'html' ? html : format === 'markdown' ? markdown : stripMarkup(markdown)
  return buildPreparedResult(article, entry.meta, format, content, html)
}
```

Implement `sanitizeHtml`, `stripMarkup`, image counting, title limits, and warnings in the same module using LinkeDOM. Remove scripts, event attributes, unsafe protocols, iframes, comments, empty images, and external links according to `PreprocessConfig`.

- [ ] **Step 4: Export the API**

Add to `packages/core/src/adapters/index.ts`:

```ts
export * from './prepare'
```

- [ ] **Step 5: Verify GREEN and commit**

Run:

```bash
npx -y pnpm@9.15.9 --filter @weibot/core test --run src/adapters/__tests__/prepare.test.ts
npm run typecheck
```

Expected: preparation tests pass and both packages typecheck.

Commit:

```bash
git add packages/core/src/adapters
git commit -m "Add shared platform preparation layer"
```

---

### Task 2: Make CLI preview and publishing share prepared output

**Files:**
- Modify: `packages/cli/src/direct.ts`
- Modify: `packages/cli/src/index.ts`
- Modify: `packages/cli/package.json`
- Create: `packages/cli/src/direct.test.ts`
- Create: `packages/cli/test/fixtures/article.md`

- [ ] **Step 1: Write a failing CLI preview test**

```ts
import { describe, expect, it } from 'vitest'
import { buildPlatformPreview } from './direct'

describe('buildPlatformPreview', () => {
  it('returns the same prepared content used by sync', () => {
    const result = buildPlatformPreview('test/fixtures/article.md', 'xiaohongshu', {})
    expect(result.platform).toBe('xiaohongshu')
    expect(result.format).toBe('text')
  })
})
```

Create `packages/cli/test/fixtures/article.md` with:

```markdown
# CLI 预览测试

这是一篇用于验证平台预览与实际同步共用适配逻辑的文章。
```

Add to `packages/cli/package.json`:

```json
"test": "vitest run"
```

and add `"vitest": "^1.1.0"` to `devDependencies`.

- [ ] **Step 2: Run and verify RED**

Run: `npx -y pnpm@9.15.9 --filter @weibot/cli test -- src/direct.test.ts`

Expected: FAIL because `buildPlatformPreview` is not exported.

- [ ] **Step 3: Add preview and per-platform preparation**

In `runDirectSync`, replace the shared `article` passed to every adapter with:

```ts
const prepared = prepareArticleForPlatform(article, platform)
const result = await adapter.publish(prepared.article, {
  draftOnly: !directMode,
  publishMode: directMode ? 'direct' : 'draft',
})
```

Add:

```ts
export interface DirectPreviewOptions extends Omit<DirectSyncOptions, 'platforms'> {
  platform: string
}

export function buildPlatformPreview(file: string, platform: string, options: Omit<DirectSyncOptions, 'platforms'>) {
  const article = buildArticle(path.resolve(file), { ...options, platforms: platform })
  return prepareArticleForPlatform(article, platform)
}

export async function runDirectPreview(file: string, options: DirectPreviewOptions): Promise<void> {
  process.stdout.write(`${JSON.stringify(buildPlatformPreview(file, options.platform, options))}\n`)
}
```

- [ ] **Step 4: Register the CLI command**

```ts
program
  .command('preview <file>')
  .description('输出单个平台的本地适配预览，不登录、不发布')
  .requiredOption('-p, --platform <platform>', '目标平台')
  .option('-t, --title <title>', '文章标题')
  .action(async (file, options) => {
    await runDirectPreview(file, options).catch(handleError)
  })
```

- [ ] **Step 5: Verify preview and sync tests, then commit**

Run:

```bash
npm run build
node packages/cli/dist/index.js preview README.md -p xiaohongshu
node packages/cli/dist/index.js sync README.md -p zip-download --dry-run
```

Expected: preview prints JSON and dry-run performs no external write.

Commit:

```bash
git add packages/cli
git commit -m "Use shared preparation in CLI preview and sync"
```

---

### Task 3: Import external articles into the existing content store

**Files:**
- Modify: `publisher-dashboard/server.js`
- Modify: `publisher-dashboard/test/server.test.js`

- [ ] **Step 1: Write failing import tests**

```js
test('imports markdown into the content center', () => {
  const content = importContent({ filename: 'article.md', body: '# 导入标题\n\n正文' })
  try {
    assert.equal(content.title, '导入标题')
    assert.equal(content.status, '已导入')
  } finally {
    db.prepare('DELETE FROM contents WHERE id = ?').run(content.id)
  }
})

test('rejects empty imported content', () => {
  assert.throws(() => importContent({ filename: 'empty.txt', body: '   ' }), /正文不能为空/)
})
```

- [ ] **Step 2: Run and verify RED**

Run: `npm --prefix publisher-dashboard test`

Expected: FAIL because `importContent` does not exist.

- [ ] **Step 3: Implement import without a schema migration**

```js
function importContent(payload = {}) {
  const body = String(payload.body || '').trim();
  if (!body) throw new Error('正文不能为空');
  const filename = String(payload.filename || '');
  if (filename && !/\.(md|markdown|html?|txt)$/i.test(filename)) throw new Error('仅支持 .md、.html、.txt');
  const title = String(payload.title || '').trim() || titleFromImportedBody(body, filename);
  const id = makeId('content');
  const summary = String(payload.summary || '').trim() || stripHtml(body).replace(/\s+/g, ' ').slice(0, 120);
  db.prepare(`
    INSERT INTO contents
      (id, title, summary, body, type, plan_date, status, layout_html, images, selected_platforms, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, NULL, '已导入', '', ?, ?, ?, ?)
  `).run(
    id,
    title,
    summary,
    body,
    String(payload.type || '导入文章'),
    encodeJson([]),
    encodeJson([]),
    now(),
    now()
  );
  return normalizeContent(one('SELECT * FROM contents WHERE id = ?', id));
}
```

Add `POST /api/content/import` and export `importContent` for tests.

- [ ] **Step 4: Verify GREEN and commit**

Run: `npm --prefix publisher-dashboard test`

Expected: import tests and all original dashboard tests pass.

Commit: `git commit -am "Add dashboard article import API"`

---

### Task 4: Normalize and render all WeChat templates

**Files:**
- Create: `publisher-dashboard/layout-templates.js`
- Create: `publisher-dashboard/test/layout-templates.test.js`
- Modify: `publisher-dashboard/server.js`
- Modify: `publisher-dashboard/package.json`

- [ ] **Step 1: Write failing all-template tests**

```js
test('discovers 40 safe templates', () => {
  assert.equal(listLayoutTemplates().length, 40)
})

test('renders every template without sample placeholders', () => {
  for (const template of listLayoutTemplates()) {
    const html = renderLayoutTemplate(template.filename, {
      title: '真实标题', summary: '真实导语', body: '## 第一节\n\n真实正文',
    })
    assert.match(html, /真实标题/)
    assert.match(html, /真实正文/)
    assert.doesNotMatch(html, /此处为|替换为|文章主标题/)
  }
})
```

- [ ] **Step 2: Run and verify RED**

Run: `npm --prefix publisher-dashboard test`

Expected: FAIL because `layout-templates.js` does not exist.

- [ ] **Step 3: Implement template discovery and rendering**

Use `parseHTML` from LinkeDOM. Validate the basename, resolve only inside `skills/weixin-layout/templates`, remove scripts/event handlers, replace the first `h1`, replace a lead selector, replace the main content container with normalized headings/paragraphs, update footer copy, and set `data-wechat-template` on `<body>`.

```js
function safeTemplatePath(filename) {
  const basename = path.basename(String(filename || ''));
  if (basename !== filename || !basename.endsWith('.html')) throw new Error('模板名称无效');
  const target = path.join(TEMPLATE_DIR, basename);
  if (!fs.existsSync(target)) throw new Error('模板不存在');
  return target;
}
```

- [ ] **Step 4: Wire template APIs**

Add `GET /api/layout-templates`. Update `POST /api/content/:id/layout` to accept `{ template }`, call `renderLayoutTemplate`, store the complete HTML in `layout_html`, and preserve the existing generic fallback only when no template is supplied.

- [ ] **Step 5: Verify all 40 templates and commit**

Run:

```bash
npm --prefix publisher-dashboard test
python3 skills/weixin-layout/scripts/pick_layout.py --list
```

Expected: 40 template renders pass with no sample placeholders.

Commit: `git add publisher-dashboard && git commit -m "Connect WeChat template library to dashboard"`

---

### Task 5: Dashboard platform preview and single-platform publishing APIs

**Files:**
- Modify: `publisher-dashboard/server.js`
- Modify: `publisher-dashboard/test/server.test.js`
- Modify: `package.json`

- [ ] **Step 1: Write failing preview and snapshot tests**

```js
test('builds a platform preview without publishing', async () => {
  const content = generateContent('2099-03-01', '预览测试')
  try {
    const preview = await previewContentForPlatform(content.id, 'xiaohongshu')
    assert.equal(preview.platform, 'xiaohongshu')
    assert.equal(preview.format, 'text')
  } finally {
    db.prepare('DELETE FROM contents WHERE id = ?').run(content.id)
  }
})

test('publish snapshot filenames include the job id', () => {
  assert.equal(publishSnapshotName('job_1', 'content_1'), 'job_1-content_1.md')
})
```

- [ ] **Step 2: Run and verify RED**

Run: `npm run dashboard:test`

Expected: FAIL because preview and snapshot helpers do not exist.

- [ ] **Step 3: Implement preview via the CLI JSON command**

Write the current content to an ignored local preview file, run `weibot preview`, parse its single JSON line, and return it from:

```text
GET /api/content/:id/platform-preview?platform=xiaohongshu
```

Add:

```text
POST /api/content/:id/publish-platform
body: { platform, publishMode: 'draft' | 'direct' }
```

Delegate to the existing `publishContent` with exactly one platform. Use `${jobId}-${contentId}.md` for the publish snapshot.

- [ ] **Step 4: Ensure startup builds the shared layer**

Update root scripts:

```json
"dashboard": "npm run build && npm --prefix publisher-dashboard start",
"dashboard:test": "npm run build && npm --prefix publisher-dashboard test"
```

- [ ] **Step 5: Verify GREEN and commit**

Run: `npm run dashboard:test`

Expected: preview and snapshot tests pass, with no platform network write.

Commit: `git commit -am "Add platform preview and single-platform publish APIs"`

---

### Task 6: Dynamic content-center interface without navigation regression

**Files:**
- Modify: `publisher-dashboard/public/index.html`
- Modify: `publisher-dashboard/public/app.js`
- Modify: `publisher-dashboard/public/styles.css`

- [ ] **Step 1: Add DOM contract assertions to dashboard tests**

```js
test('content center keeps all six dynamic views and new dialogs', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8')
  for (const view of ['dashboard','plans','content','publish','platforms','history']) {
    assert.match(html, new RegExp(`id="view-${view}"`))
  }
  assert.match(html, /id="import-dialog"/)
  assert.match(html, /id="platform-publish-dialog"/)
})
```

- [ ] **Step 2: Run and verify RED**

Run: `npm --prefix publisher-dashboard test`

Expected: FAIL because the dialogs are absent.

- [ ] **Step 3: Add import and publish dialogs**

Add semantic dialogs to `index.html`, including paste/file tabs, title input, text area, hidden file input with `accept=".md,.markdown,.html,.htm,.txt"`, and explicit platform publish confirmation copy.

- [ ] **Step 4: Extend the existing renderer instead of replacing it**

In `app.js`, keep `switchView()` and all six existing `render*` functions. Add:

```js
async function importArticle(payload) {
  const res = await request('/api/content/import', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  state.selectedContentId = res.content.id;
  document.querySelector('#import-dialog')?.close();
  await loadData();
  switchView('content');
}

async function loadPlatformPreview(contentId, platform) {
  const res = await request(`/api/content/${encodeURIComponent(contentId)}/platform-preview?platform=${encodeURIComponent(platform)}`);
  state.platformPreviews.set(`${contentId}:${platform}`, res.preview);
  renderContent();
  return res.preview;
}

async function layoutContent(id, template = '') {
  const target = id || state.selectedContentId;
  if (!target) return toast('请选择内容', 'error');
  if ($(`[data-content-body="${target}"]`)) await saveContent(target, { silent: true });
  const res = await request(`/api/content/${encodeURIComponent(target)}/layout`, {
    method: 'POST',
    body: JSON.stringify({ template }),
  });
  state.selectedContentId = res.content.id;
  await loadData();
  openLayoutDialog(getSelectedContent());
}

function openPlatformPublishDialog(contentId, platform, publishMode) {
  state.pendingPlatformPublish = { contentId, platform, publishMode };
  $('#platform-publish-title').textContent = platformName(platform);
  $('#platform-publish-mode').textContent = publishMode === 'direct' ? '直接发布' : '保存草稿';
  $('#platform-publish-dialog').showModal();
}

async function confirmPlatformPublish() {
  const pending = state.pendingPlatformPublish;
  if (!pending) return;
  await request(`/api/content/${encodeURIComponent(pending.contentId)}/publish-platform`, {
    method: 'POST',
    body: JSON.stringify({ platform: pending.platform, publishMode: pending.publishMode }),
  });
  $('#platform-publish-dialog').close();
  state.pendingPlatformPublish = null;
  await loadData();
  switchView('history');
}
```

Read selected files with `FileReader.readAsText`; enforce 5 MB before reading. Never upload the original file.

- [ ] **Step 5: Apply the approved responsive layout**

Use existing color variables and component styles. At desktop widths, render editor and preview side-by-side; below 820px stack them. Platform tabs scroll horizontally without causing document overflow. Show template controls only for WeChat.

- [ ] **Step 6: Verify tests and commit**

Run:

```bash
npm run dashboard:test
npm run build
npm run typecheck
```

Expected: all commands pass and original navigation tests remain green.

Commit: `git add publisher-dashboard/public && git commit -m "Add dynamic import and platform preview workspace"`

---

### Task 7: Full isolated integration and browser QA

**Files:**
- Modify: `publisher-dashboard/test/server.test.js`
- Update if needed: files changed in Tasks 1–6

- [ ] **Step 1: Add one isolated end-to-end API test**

Test this exact local chain against a temporary database:

```text
import Markdown
→ edit canonical content
→ list 40 templates
→ render WeChat HTML
→ preview Zhihu/Juejin/Xiaohongshu/Toutiao
→ save zip-download draft
→ confirm publish history row
```

- [ ] **Step 2: Run the full automated suite**

Run:

```bash
npm run dashboard:test
npx -y pnpm@9.15.9 --filter @weibot/core test --run
npm run build
npm run typecheck
git diff --check
```

Expected: all pass; build output may contain the pre-existing CJS `import.meta` warning but no build failure.

- [ ] **Step 3: Start an isolated local service**

Run: `PUBLISHER_DB=/tmp/weibot-dashboard-qa.sqlite PORT=18830 node publisher-dashboard/server.js`

Expected: `多平台内容发布可视化面板: http://127.0.0.1:18830`.

- [ ] **Step 4: Browser-test the dynamic UI**

Verify:

1. All six sidebar buttons switch views.
2. Paste import and `.md`/`.html`/`.txt` file import work.
3. WeChat template selector changes complete HTML.
4. Platform tabs return different format/content/warnings.
5. Single-platform draft and direct buttons open the correct confirmation state.
6. 1440px and 390px layouts have no horizontal document overflow.
7. Browser console has no errors.

- [ ] **Step 5: Commit final QA fixes**

Commit only if QA required changes:

```bash
git add packages publisher-dashboard package.json docs
git commit -m "Finish shared content adaptation workflow"
```

- [ ] **Step 6: Start the user-facing backend**

Run: `npm run dashboard`

Expected: the final local URL is printed, returns HTTP 200, and remains running for user review.
