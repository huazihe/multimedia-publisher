# 多平台内容发布工作台对抗式加固实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不迁移数据库、不触发真实发布的前提下，收口对抗式审查发现的全部发布一致性、数据并发、安全、平台适配、品牌和 CI 问题。

**Architecture:** 继续以现有 SQLite 内容记录为事实真源，使用 `updated_at` 乐观锁和派生 HTML 内嵌哈希避免 schema 变化；平台预览和发布统一经过同一个平台源构造器；发布结果逐平台落库并支持 `uncertain` 终态。33 平台规则由显式档案管理，未知限制以人工复核提示代替猜测。

**Tech Stack:** Node.js 24、TypeScript、JavaScript、SQLite、Vitest、Node Test Runner、Playwright、GitHub Actions。

---

## 文件职责

- `publisher-dashboard/server.js`：内容 API、乐观锁、平台源构造、预览、发布任务和 HTTP 安全边界。
- `publisher-dashboard/layout-templates.js`：公众号模板渲染、账号资料和派生元数据。
- `publisher-dashboard/public/app.js`：编辑状态、冲突反馈、平台预览和发布确认交互。
- `publisher-dashboard/public/index.html`：批量发布确认对话框结构。
- `publisher-dashboard/public/styles.css`：确认框、冲突提示和成熟度提示样式。
- `publisher-dashboard/test/server.test.js`：服务端回归、发布快照和安全边界测试。
- `publisher-dashboard/test/frontend-behavior.test.js`：前端并发、确认和状态机行为测试。
- `publisher-dashboard/test/frontend-contract.test.js`：DOM、路由和文案契约测试。
- `publisher-dashboard/test/layout-templates.test.js`：模板元数据和无品牌默认值测试。
- `packages/cli/src/direct.ts`：Markdown front matter 解析和发布源读取。
- `packages/cli/src/direct.test.ts`：CLI 标题解析、预览与发布输入一致性测试。
- `packages/core/src/adapters/platform-profiles.ts`：33 平台适配档案。
- `packages/core/src/adapters/prepare.ts`：按档案生成格式、限制警告和成熟度提示。
- `packages/core/src/adapters/__tests__/prepare.test.ts`：平台矩阵与适配输出测试。
- `packages/core/src/lib/safe-image-download.ts`：小红书图片下载的 URL、IP、大小、MIME、超时和清理边界。
- `packages/core/src/lib/__tests__/safe-image-download.test.ts`：安全图片下载单元测试。
- `packages/core/src/adapters/platforms/xiaohongshu.ts`：消费受控图片批次并在 finally 清理。
- `README.md`、`package.json`：产品对外名称和兼容说明。
- `.github/workflows/ci.yml`：无真实凭据的类型检查、测试和敏感文件扫描。

---

### Task 1：正文乐观锁、字段上限与排版失效

**Files:**
- Modify: `publisher-dashboard/server.js`
- Modify: `publisher-dashboard/public/app.js`
- Test: `publisher-dashboard/test/server.test.js`
- Test: `publisher-dashboard/test/frontend-behavior.test.js`

- [ ] **Step 1: 写服务端并发与字段上限失败测试**

在 `server.test.js` 添加：

```js
test('stale content update returns 409 and preserves the newer document', async () => {
  const first = updateContent(fixture.id, {
    expectedUpdatedAt: fixture.updated_at,
    title: 'writer A', summary: '', type: '导入文章', body: '<p>A</p>',
  });
  assert.throws(
    () => updateContent(fixture.id, {
      expectedUpdatedAt: fixture.updated_at,
      title: 'writer B', summary: '', type: '导入文章', body: '<p>B</p>',
    }),
    error => error.statusCode === 409,
  );
  assert.equal(getDashboardData().contents.find(item => item.id === fixture.id).title, first.title);
});

test('content update clears a layout derived from the previous canonical body', () => {
  const laidOut = layoutContent(fixture.id, listLayoutTemplates()[0].filename);
  const updated = updateContent(fixture.id, {
    expectedUpdatedAt: laidOut.updated_at,
    title: '新标题', summary: '新摘要', type: laidOut.type, body: '<p>新正文</p>',
  });
  assert.equal(updated.layout_html, '');
  assert.equal(updated.status, '已导入');
});

test('content update rejects oversized fields and bodies', () => {
  assert.throws(() => updateContent(fixture.id, {
    expectedUpdatedAt: fixture.updated_at,
    title: 'T'.repeat(201), summary: '', type: '导入文章', body: '<p>x</p>',
  }), error => error.statusCode === 400);
  assert.throws(() => updateContent(fixture.id, {
    expectedUpdatedAt: fixture.updated_at,
    title: 'ok', summary: '', type: '导入文章', body: 'B'.repeat(5 * 1024 * 1024 + 1),
  }), error => error.statusCode === 413);
});
```

- [ ] **Step 2: 运行红灯测试**

Run:

```bash
npm --prefix publisher-dashboard test -- --test-name-pattern="stale content update|clears a layout|oversized fields"
```

Expected: FAIL；旧版本仍覆盖、排版未清空或超限输入仍被接受。

- [ ] **Step 3: 实现无迁移乐观锁与统一验证**

在 `server.js` 增加并使用：

```js
const MAX_REQUEST_BODY_BYTES = 8 * 1024 * 1024;
const MAX_CONTENT_BODY_BYTES = 5 * 1024 * 1024;
const CONTENT_FIELD_LIMITS = { title: 200, summary: 1000, type: 100, filename: 255 };

function unicodeLength(value) {
  return Array.from(String(value || '')).length;
}

function nextTimestamp(previous) {
  return new Date(Math.max(Date.now(), Date.parse(previous || '') + 1)).toISOString();
}

function validateContentFields({ title, summary, type, body }) {
  if (unicodeLength(title) > CONTENT_FIELD_LIMITS.title) throw statusError('标题不能超过 200 字', 400);
  if (unicodeLength(summary) > CONTENT_FIELD_LIMITS.summary) throw statusError('摘要不能超过 1000 字', 400);
  if (unicodeLength(type) > CONTENT_FIELD_LIMITS.type) throw statusError('内容类型不能超过 100 字', 400);
  if (Buffer.byteLength(body, 'utf8') > MAX_CONTENT_BODY_BYTES) throw statusError('正文不能超过 5 MiB', 413);
}
```

把 `readBody` 默认 `Infinity` 改为 `MAX_REQUEST_BODY_BYTES`。`updateContent` 要求 `expectedUpdatedAt`，使用条件更新：

```js
const result = db.prepare(`
  UPDATE contents
  SET title = ?, summary = ?, body = ?, type = ?, layout_html = '', status = ?, updated_at = ?
  WHERE id = ? AND updated_at = ?
`).run(title, summary, body, type, resetStatus, timestamp, contentId, expectedUpdatedAt);
if (result.changes !== 1) throw statusError('文章已在其他标签页更新，请重新载入', 409);
```

- [ ] **Step 4: 写前端只在真实输入时变脏的失败测试**

```js
test('focus alone does not mark canonical content dirty and save sends expectedUpdatedAt', () => {
  assert.doesNotMatch(appSource, /addEventListener\('focusin',\s*\(\)\s*=>\s*markContentDirty/);
  assert.match(appSource, /expectedUpdatedAt:\s*current\?\.updated_at/);
  assert.match(appSource, /文章已在其他标签页更新/);
});
```

- [ ] **Step 5: 运行前端红灯测试并实现**

Run:

```bash
npm --prefix publisher-dashboard test -- --test-name-pattern="focus alone"
```

Expected: FAIL。随后删除 `focusin` 脏标记，只保留 `input`，保存请求带 `expectedUpdatedAt`；409 时保留编辑器 DOM，不自动 reload。

- [ ] **Step 6: 运行相关测试并提交**

```bash
npm --prefix publisher-dashboard test -- --test-name-pattern="content update|stale content|focus alone|layout"
git add publisher-dashboard/server.js publisher-dashboard/public/app.js publisher-dashboard/test/server.test.js publisher-dashboard/test/frontend-behavior.test.js
git commit -m "fix: protect canonical content revisions"
```

Expected: PASS。

---

### Task 2：安全 Markdown 序列化与非重复 H1 保留

**Files:**
- Modify: `publisher-dashboard/server.js`
- Modify: `packages/cli/src/direct.ts`
- Test: `publisher-dashboard/test/server.test.js`
- Test: `packages/cli/src/direct.test.ts`

- [ ] **Step 1: 写 H1 和 front matter 失败测试**

```js
test('contentToMarkdown preserves a leading H1 that differs from the article title', () => {
  const content = importContent({
    title: '封面标题', format: 'markdown', filename: 'article.md',
    body: '# 正文章节\n\n不能丢失。',
  });
  assert.match(contentToMarkdown(content), /^# 正文章节$/m);
});

test('contentToMarkdown safely serializes multiline and Markdown-significant titles', () => {
  const markdown = contentToMarkdown({ title: '标题\n# 注入', body: '<p>正文</p>' });
  assert.match(markdown, /^title: "标题\\n# 注入"$/m);
  assert.equal((markdown.match(/^# /gm) || []).length, 1);
});
```

在 CLI 测试添加 JSON 字符串标题解析断言。

- [ ] **Step 2: 运行红灯测试**

```bash
npm --prefix publisher-dashboard test -- --test-name-pattern="preserves a leading H1|safely serializes"
npx -y pnpm@9.15.9 --filter @weibot/cli test -- --run -t "JSON front matter title"
```

Expected: FAIL；不同 H1 被删除或 JSON 标题未解码。

- [ ] **Step 3: 实现匹配删除和可逆标题编码**

```js
function normalizedHeading(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function removeMatchingLeadingH1(markdown, title) {
  const match = String(markdown || '').match(/^\s*#\s+(.+)\r?\n+/);
  return match && normalizedHeading(match[1]) === normalizedHeading(title)
    ? markdown.slice(match[0].length)
    : markdown;
}

function markdownHeadingTitle(title) {
  return String(title || '').replace(/\s+/g, ' ').trim().replace(/([\\`*_{}\[\]<>#+.!|-])/g, '\\$1');
}
```

front matter 使用 `JSON.stringify(content.title)`；CLI `parseMarkdown` 对 `title:` 后的值优先 `JSON.parse`，失败再走兼容旧格式。

- [ ] **Step 4: 运行测试并提交**

```bash
npm --prefix publisher-dashboard test -- --test-name-pattern="contentToMarkdown"
npx -y pnpm@9.15.9 --filter @weibot/cli test -- --run
git add publisher-dashboard/server.js publisher-dashboard/test/server.test.js packages/cli/src/direct.ts packages/cli/src/direct.test.ts
git commit -m "fix: preserve canonical headings in publish snapshots"
```

Expected: PASS。

---

### Task 3：公众号模板元数据、无硬编码品牌和平台源统一

**Files:**
- Modify: `publisher-dashboard/layout-templates.js`
- Modify: `publisher-dashboard/server.js`
- Test: `publisher-dashboard/test/layout-templates.test.js`
- Test: `publisher-dashboard/test/server.test.js`

- [ ] **Step 1: 写模板无品牌与元数据失败测试**

```js
test('empty account configuration removes account copy and records canonical metadata', () => {
  const html = renderLayoutTemplate('style_10.html', {
    title: '标题', summary: '摘要', body: '<p>正文</p>',
    accountName: '', accountDescription: '', canonicalHash: 'a'.repeat(64),
  });
  assert.doesNotMatch(html, /维视智造|机器视觉/);
  assert.match(html, /data-canonical-sha256="a{64}"/);
  assert.match(html, /data-wechat-template="style_10.html"/);
});
```

- [ ] **Step 2: 写预览与发布共用公众号 HTML 源失败测试**

```js
test('WeChat preview and publish source use the current templated layout', async () => {
  const laidOut = layoutContent(fixture.id, 'style_10.html');
  const testTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'platform-source-test-'));
  try {
    const source = createPlatformSource(laidOut, 'weixin', testTempDir);
    assert.equal(source.format, 'html');
    assert.match(fs.readFileSync(source.filePath, 'utf8'), /data-wechat-template="style_10.html"/);
    assert.equal(source.contentHash, hashFile(source.filePath));
  } finally {
    fs.rmSync(testTempDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 3: 运行红灯测试**

```bash
npm --prefix publisher-dashboard test -- --test-name-pattern="empty account configuration|WeChat preview"
```

Expected: FAIL；固定品牌仍存在，发布源仍是 Markdown。

- [ ] **Step 4: 实现模板元数据和账号配置**

`renderLayoutTemplate` 接收 `canonicalHash`，从显式参数或 `PUBLISHER_ACCOUNT_*` 读取账号。账号为空时删除 footer；生成根节点写入模板、哈希和生成时间。

```js
const accountName = input.accountName === undefined
  ? String(process.env.PUBLISHER_ACCOUNT_NAME || '').trim()
  : String(input.accountName).trim();
if (!accountName && !accountDescription) footer.remove();
```

- [ ] **Step 5: 实现单一平台源构造器**

在 `server.js` 增加：

```js
function canonicalContentHash(content) {
  return createHash('sha256')
    .update(JSON.stringify([content.title, content.summary || '', content.body || '']))
    .digest('hex');
}

function hashFile(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function layoutHash(html) {
  return String(html || '').match(/data-canonical-sha256="([a-f0-9]{64})"/i)?.[1] || '';
}

function createPlatformSource(content, platform, rootDir) {
  const useLayout = platform === 'weixin'
    && layoutHash(content.layout_html) === canonicalContentHash(content);
  const format = useLayout ? 'html' : 'markdown';
  const extension = format === 'html' ? 'html' : 'md';
  const filePath = path.join(rootDir, `${platform}.${extension}`);
  fs.writeFileSync(filePath, useLayout ? content.layout_html : contentToMarkdown(content), 'utf8');
  return { platform, format, filePath, contentHash: hashFile(filePath), templated: useLayout };
}
```

预览和发布都调用该函数；幂等签名使用所有平台源哈希。

- [ ] **Step 6: 运行相关测试并提交**

```bash
npm --prefix publisher-dashboard test -- --test-name-pattern="template|WeChat|platform source|preview serializes"
git add publisher-dashboard/layout-templates.js publisher-dashboard/server.js publisher-dashboard/test/layout-templates.test.js publisher-dashboard/test/server.test.js
git commit -m "fix: publish the selected WeChat layout"
```

Expected: PASS。

---

### Task 4：逐平台结果持久化与 uncertain 终态

**Files:**
- Modify: `publisher-dashboard/server.js`
- Modify: `publisher-dashboard/public/app.js`
- Test: `publisher-dashboard/test/server.test.js`
- Test: `publisher-dashboard/test/frontend-behavior.test.js`

- [ ] **Step 1: 写异常发布终态失败测试**

```js
test('publisher exception persists completed results and leaves an uncertain terminal job', async () => {
  let fixture;
  let testServer;
  let calls = 0;
  try {
    fixture = createPublishStateFixture({
      key: 'partial-then-uncertain',
      planDate: '2099-07-01',
      selectedPlatforms: ['zhihu', 'juejin'],
      contentStatus: '已排版',
      planStatus: '已排版',
    });
    testServer = createDashboardServer({
      operationsFile: path.join(testDataDir, 'partial-then-uncertain.json'),
      instanceLockFile: path.join(testDataDir, 'partial-then-uncertain.lock'),
      preflight: async () => null,
      platformPublisher: async () => {
        calls += 1;
        if (calls === 1) return successfulPlatformPublisher()();
        throw new Error('ambiguous external result');
      },
    });
    const port = await listenOnRandomPort(testServer);
    const base = `http://127.0.0.1:${port}`;
    const response = await workbenchFetch(`${base}/api/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contentId: fixture.id,
        platforms: ['zhihu', 'juejin'],
        publishMode: 'direct',
        operationId: 'partial-then-uncertain-operation-0001',
      }),
    });
    assert.equal(response.status, 500);
    const history = await (await fetch(`${base}/api/history`)).json();
    const job = history.jobs.find(item => item.content_id === fixture.id);
    assert.equal(job.status, 'uncertain');
    assert.deepEqual(job.results.map(item => item.status), ['success', 'uncertain']);
  } finally {
    await closeServer(testServer);
    cleanupPublishStateFixture(fixture);
  }
});
```

- [ ] **Step 2: 运行红灯测试**

```bash
npm --prefix publisher-dashboard test -- --test-name-pattern="uncertain terminal job"
```

Expected: FAIL；任务仍为 `running` 且结果为空。

- [ ] **Step 3: 实现逐平台即时写入**

抽取 `persistPublishResult(jobId, platform, status, info)`。每次预检或适配器返回后立即写入；适配器抛错时写入 `uncertain`，更新任务为 `uncertain` 后再抛出。成功循环结束后再计算 `published`、`draft_saved`、`partial_failed` 或 `failed`。

前端状态映射新增：

```js
uncertain: '结果待核对',
```

并在历史页显示“禁止自动重试，请到平台后台人工核对”。

- [ ] **Step 4: 运行测试并提交**

```bash
npm --prefix publisher-dashboard test -- --test-name-pattern="publisher|uncertain|partial"
git add publisher-dashboard/server.js publisher-dashboard/public/app.js publisher-dashboard/test/server.test.js publisher-dashboard/test/frontend-behavior.test.js
git commit -m "fix: persist uncertain publish outcomes"
```

Expected: PASS。

---

### Task 5：批量直接发布确认对话框

**Files:**
- Modify: `publisher-dashboard/public/index.html`
- Modify: `publisher-dashboard/public/app.js`
- Modify: `publisher-dashboard/public/styles.css`
- Test: `publisher-dashboard/test/frontend-behavior.test.js`
- Test: `publisher-dashboard/test/frontend-contract.test.js`

- [ ] **Step 1: 写批量确认失败测试**

```js
test('batch direct publish opens confirmation and sends no request until confirmed', async () => {
  openBatchPublishConfirmation({ contentId: 'content-1', platforms: ['zhihu', 'juejin'] });
  assert.equal(document.querySelector('#batch-publish-dialog').open, true);
  assert.equal(publishRequests.length, 0);
  await confirmBatchPublish();
  assert.equal(publishRequests.length, 1);
  assert.deepEqual(publishRequests[0].platforms, ['zhihu', 'juejin']);
});

test('cancelling batch publish discards pending operation without creating operationId', () => {
  openBatchPublishConfirmation({ contentId: 'content-1', platforms: ['zhihu'] });
  cancelBatchPublish();
  assert.equal(state.pendingBatchPublish, null);
  assert.equal(state.batchPublishOperation, null);
});
```

- [ ] **Step 2: 运行红灯测试**

```bash
npm --prefix publisher-dashboard test -- --test-name-pattern="batch direct publish opens|cancelling batch"
```

Expected: FAIL；当前点击直接创建请求。

- [ ] **Step 3: 增加语义化对话框和状态机**

`index.html` 增加 `#batch-publish-dialog`，包含文章、平台列表、模式、反馈、取消和最终确认按钮。`publish-selected` 只调用 `openBatchPublishConfirmation`；`confirm-batch-publish` 才调用原执行函数并创建 operationId。执行中阻止 Escape/关闭。

- [ ] **Step 4: 运行测试并提交**

```bash
npm --prefix publisher-dashboard test -- --test-name-pattern="batch publish|confirmation|dialog"
git add publisher-dashboard/public/index.html publisher-dashboard/public/app.js publisher-dashboard/public/styles.css publisher-dashboard/test/frontend-behavior.test.js publisher-dashboard/test/frontend-contract.test.js
git commit -m "fix: confirm batch direct publishing"
```

Expected: PASS。

---

### Task 6：资源 URL、POST 预览和请求安全边界

**Files:**
- Modify: `publisher-dashboard/server.js`
- Modify: `publisher-dashboard/public/app.js`
- Test: `publisher-dashboard/test/server.test.js`
- Test: `publisher-dashboard/test/frontend-behavior.test.js`

- [ ] **Step 1: 写本地 API 图片和 GET 执行失败测试**

```js
test('canonical sanitizer rejects API paths as image sources but keeps uploads', () => {
  const content = importContent({
    title: 'probe', format: 'html',
    body: '<img src="/api/platforms?refresh=1"><img src="/uploads/safe.png">',
  });
  assert.doesNotMatch(content.body, /\/api\//);
  assert.match(content.body, /\/uploads\/safe\.png/);
});

test('platform preview is POST-only and requires CSRF', async () => {
  assert.equal((await fetch(previewUrl)).status, 404);
  assert.equal((await fetch(previewUrl, { method: 'POST' })).status, 403);
  assert.equal((await workbenchFetch(previewUrl, { method: 'POST', body: JSON.stringify({ platform: 'zhihu' }) })).status, 200);
});
```

- [ ] **Step 2: 运行红灯测试**

```bash
npm --prefix publisher-dashboard test -- --test-name-pattern="rejects API paths|POST-only"
```

Expected: FAIL。

- [ ] **Step 3: 收紧服务端和客户端 URL 规则**

`img[src]` 无 scheme 时仅允许 `/uploads/`；`a[href]` 保留锚点与普通相对链接。同步修改 `sanitizeClientCanonicalHtml.safeUrl`。

把：

```text
GET /api/content/:id/platform-preview?platform=...
GET /api/platforms?refresh=1
```

替换为：

```text
POST /api/content/:id/platform-preview  { platform }
POST /api/platforms/refresh
```

前端请求同步变更。

- [ ] **Step 4: 运行测试并提交**

```bash
npm --prefix publisher-dashboard test -- --test-name-pattern="sanit|platform preview|platforms refresh|CSRF"
git add publisher-dashboard/server.js publisher-dashboard/public/app.js publisher-dashboard/test/server.test.js publisher-dashboard/test/frontend-behavior.test.js
git commit -m "fix: isolate imported resources from local APIs"
```

Expected: PASS。

---

### Task 7：小红书图片下载安全与清理

**Files:**
- Create: `packages/core/src/lib/safe-image-download.ts`
- Create: `packages/core/src/lib/__tests__/safe-image-download.test.ts`
- Modify: `packages/core/src/adapters/platforms/xiaohongshu.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: 写私网、大小、MIME 和清理失败测试**

```ts
test('rejects loopback and private image URLs before fetch', async () => {
  const loopbackLookup = async () => [{ address: '127.0.0.1', family: 4 }]
  const privateLookup = async () => [{ address: '10.0.0.1', family: 4 }]
  await expect(validateRemoteImageUrl('http://local.test/a.png', loopbackLookup)).rejects.toThrow(/私网|环回/)
  await expect(validateRemoteImageUrl('http://private.test/a.png', privateLookup)).rejects.toThrow(/私网|环回/)
})

test('download rejects non-image MIME and responses over 15 MiB', async () => {
  const testTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-image-test-'))
  const target = path.join(testTempDir, 'image.png')
  const htmlFetch = async () => new Response('<html></html>', {
    headers: { 'content-type': 'text/html' },
  })
  const oversizedFetch = async () => new Response('x', {
    headers: {
      'content-type': 'image/png',
      'content-length': String(15 * 1024 * 1024 + 1),
    },
  })
  await expect(downloadImageToFile('https://example.test/a', target, { fetchImpl: htmlFetch })).rejects.toThrow(/图片 MIME/)
  await expect(downloadImageToFile('https://example.test/a', target, { fetchImpl: oversizedFetch })).rejects.toThrow(/15 MiB/)
  fs.rmSync(testTempDir, { recursive: true, force: true })
})

test('temporary image batch is removed after success and failure', async () => {
  const dependencies = {
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    fetchImpl: async () => new Response(Uint8Array.from([137, 80, 78, 71]), {
      headers: { 'content-type': 'image/png', 'content-length': '4' },
    }),
  }
  const batch = await createTempImageBatch(['https://example.test/a.png'], dependencies)
  await batch.cleanup()
  expect(existsSync(batch.dir)).toBe(false)
})
```

- [ ] **Step 2: 运行红灯测试**

```bash
npx -y pnpm@9.15.9 --filter @weibot/core test -- --run src/lib/__tests__/safe-image-download.test.ts
```

Expected: FAIL；模块不存在。

- [ ] **Step 3: 实现安全下载模块**

模块必须：DNS 解析后拒绝 IPv4/IPv6 环回、私网和链路本地；每次重定向重新验证；使用 `AbortSignal.timeout(15000)`；验证 `content-type`；流式累计不超过 15 MiB；所有异常删除半成品；批次暴露幂等 `cleanup()`。

```ts
export interface TempImageBatch {
  dir: string
  images: Array<{ path: string; source: string }>
  cleanup(): Promise<void>
}
```

- [ ] **Step 4: 接入小红书适配器**

```ts
let imageBatch: TempImageBatch | null = null
try {
  imageBatch = await createTempImageBatch(imageSources)
  // 使用 imageBatch.images
} finally {
  await imageBatch?.cleanup()
  client?.close()
}
```

- [ ] **Step 5: 运行核心测试并提交**

```bash
npx -y pnpm@9.15.9 --filter @weibot/core test -- --run
git add packages/core/src/lib/safe-image-download.ts packages/core/src/lib/__tests__/safe-image-download.test.ts packages/core/src/adapters/platforms/xiaohongshu.ts packages/core/src/index.ts
git commit -m "fix: harden Xiaohongshu image downloads"
```

Expected: PASS。

---

### Task 8：33 平台适配档案与诚实成熟度提示

**Files:**
- Create: `packages/core/src/adapters/platform-profiles.ts`
- Modify: `packages/core/src/adapters/index.ts`
- Modify: `packages/core/src/adapters/prepare.ts`
- Modify: `packages/core/src/adapters/__tests__/prepare.test.ts`
- Modify: `publisher-dashboard/public/app.js`
- Modify: `publisher-dashboard/test/frontend-contract.test.js`

- [ ] **Step 1: 写 33 平台档案完整性失败测试**

```ts
test('every registered platform has one explicit adaptation profile', () => {
  const ids = createDefaultAdapterEntries().map(entry => entry.meta.id).sort()
  expect(Object.keys(PLATFORM_PROFILES).sort()).toEqual(ids)
  for (const id of ids) {
    expect(['html', 'markdown', 'text']).toContain(PLATFORM_PROFILES[id].format)
    expect(['verified', 'format-only', 'manual-review']).toContain(PLATFORM_PROFILES[id].maturity)
  }
})

test('format-only platforms disclose that current platform limits are not verified', () => {
  const result = prepareArticleForPlatform(article, 'toutiao')
  expect(result.maturity).toBe('format-only')
  expect(result.warnings).toContain('当前平台使用基础格式适配，未核验平台最新限制，发布前请人工确认')
})
```

- [ ] **Step 2: 运行红灯测试**

```bash
npx -y pnpm@9.15.9 --filter @weibot/core test -- --run src/adapters/__tests__/prepare.test.ts
```

Expected: FAIL；档案模块和 maturity 不存在。

- [ ] **Step 3: 建立完整平台档案**

```ts
export const PLATFORM_PROFILES = {
  '51cto': { format: 'markdown', maturity: 'format-only' },
  csdn: { format: 'markdown', maturity: 'format-only' },
  'zip-download': { format: 'markdown', maturity: 'verified' },
  eastmoney: { format: 'html', maturity: 'format-only' },
  'china-vision': { format: 'text', maturity: 'manual-review' },
  ca800: { format: 'text', maturity: 'manual-review' },
  woshipm: { format: 'html', maturity: 'format-only' },
  toutiao: { format: 'text', maturity: 'format-only' },
  qiehao: { format: 'text', maturity: 'manual-review' },
  bilibili: { format: 'html', maturity: 'format-only' },
  cnblogs: { format: 'markdown', maturity: 'format-only' },
  b2b168: { format: 'text', maturity: 'manual-review' },
  weibo: { format: 'html', maturity: 'format-only' },
  bjx-club: { format: 'text', maturity: 'manual-review' },
  xiaohongshu: { format: 'text', maturity: 'verified', limits: { maxImages: 9, maxTitleLength: 38 }, source: 'current-adapter-contract', sourceDate: '2026-09-01' },
  oschina: { format: 'markdown', maturity: 'format-only' },
  douyin: { format: 'text', maturity: 'verified', limits: { maxTitleLength: 30 }, source: 'current-adapter-contract', sourceDate: '2026-09-01' },
  segmentfault: { format: 'markdown', maturity: 'format-only' },
  juejin: { format: 'markdown', maturity: 'format-only' },
  '51sole': { format: 'text', maturity: 'manual-review' },
  sohu: { format: 'html', maturity: 'format-only' },
  elecfans: { format: 'text', maturity: 'manual-review' },
  'eet-china': { format: 'text', maturity: 'manual-review' },
  eeworld: { format: 'text', maturity: 'manual-review' },
  baijiahao: { format: 'html', maturity: 'format-only' },
  zhihu: { format: 'html', maturity: 'format-only' },
  imooc: { format: 'markdown', maturity: 'format-only' },
  weixin: { format: 'html', maturity: 'verified' },
  douban: { format: 'text', maturity: 'format-only' },
  app17: { format: 'text', maturity: 'manual-review' },
  huangye88: { format: 'text', maturity: 'manual-review' },
  yuque: { format: 'markdown', maturity: 'format-only' },
  xueqiu: { format: 'markdown', maturity: 'format-only' },
} as const
```

`prepareArticleForPlatform` 返回 `maturity`，对非 verified 档案添加明确警告。前端在预览摘要和直接发布确认中显示成熟度与警告。

- [ ] **Step 4: 运行平台矩阵与前端契约测试并提交**

```bash
npx -y pnpm@9.15.9 --filter @weibot/core test -- --run
npm --prefix publisher-dashboard test -- --test-name-pattern="maturity|platform preview"
git add packages/core/src/adapters/platform-profiles.ts packages/core/src/adapters/index.ts packages/core/src/adapters/prepare.ts packages/core/src/adapters/__tests__/prepare.test.ts publisher-dashboard/public/app.js publisher-dashboard/test/frontend-contract.test.js
git commit -m "feat: declare adaptation maturity for every platform"
```

Expected: 33/33 档案通过。

---

### Task 9：产品品牌治理与兼容说明

**Files:**
- Modify: `README.md`
- Modify: `package.json`
- Modify: `publisher-dashboard/public/index.html`
- Test: `publisher-dashboard/test/frontend-contract.test.js`

- [ ] **Step 1: 写旧品牌对外口径失败检查**

```js
test('public dashboard and README use Multimedia Publisher branding', () => {
  assert.doesNotMatch(indexHtml, /WEIBOT|Wei Bot/i);
  assert.match(readme, /^# Multimedia Publisher · 多平台内容发布工作台/m);
  assert.doesNotMatch(readme.split('## 兼容接口')[0], /WEIBOT/i);
});
```

- [ ] **Step 2: 运行红灯测试**

```bash
npm --prefix publisher-dashboard test -- --test-name-pattern="Multimedia Publisher branding"
```

Expected: FAIL；README 仍以 WEIBOT 为主标题。

- [ ] **Step 3: 更新公开名称并保留兼容接口**

README 主标题、介绍、目录名示例改为 `Multimedia Publisher`。新增“兼容接口”章节，只在那里说明 `@weibot/*`、CLI 命令、`.weibot-login` 和 `WEIBOT_*` 暂时保留。`package.json.description` 改为通用产品说明，package name 暂不改。

- [ ] **Step 4: 运行测试并提交**

```bash
npm --prefix publisher-dashboard test -- --test-name-pattern="branding|frontend contract"
git add README.md package.json publisher-dashboard/public/index.html publisher-dashboard/test/frontend-contract.test.js
git commit -m "docs: use generic multimedia publisher branding"
```

Expected: PASS。

---

### Task 10：GitHub CI 与敏感文件门禁

**Files:**
- Create: `.github/workflows/ci.yml`
- Modify: `.gitignore`
- Test: local workflow syntax and commands

- [ ] **Step 1: 写 CI 工作流**

```yaml
name: ci
on:
  push:
  pull_request:
jobs:
  verify:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9.15.9
      - uses: actions/setup-node@v4
        with:
          node-version: '24'
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: npm run typecheck
      - run: npm test
      - name: Reject tracked secrets and runtime state
        shell: bash
        run: |
          ! git ls-files | grep -E '(^|/)(cookies(\..*)?\.json|session\.json|publisher\.sqlite(-wal|-shm)?|publish-operations\.json)$'
          ! git grep -IlE '(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----)' -- .
      - name: Ensure tests leave no tracked changes
        run: git diff --exit-code
```

- [ ] **Step 2: 本地验证 YAML 和全部命令**

```bash
ruby -e "require 'yaml'; YAML.load_file('.github/workflows/ci.yml'); puts 'yaml ok'"
npx -y pnpm@9.15.9 install --frozen-lockfile
npm run typecheck
npm test
git diff --check
```

Expected: YAML 可解析、命令退出 0、无敏感文件命中。

- [ ] **Step 3: 提交 CI**

```bash
git add .github/workflows/ci.yml .gitignore
git commit -m "ci: verify tests and sensitive file boundaries"
```

---

### Task 11：完整回归、浏览器对抗复测和 PR 更新

**Files:**
- Modify only if verification finds a regression
- Verify all changed files

- [ ] **Step 1: 运行完整静态验证**

```bash
npm run typecheck
npm test
git diff --check origin/main...HEAD
git status --short
```

Expected: core、CLI、dashboard 全部通过；工作树干净。

- [ ] **Step 2: 启动独立临时数据库服务**

```bash
PUBLISHER_DB=/tmp/multimedia-publisher-qa.sqlite \
PUBLISHER_OPERATIONS_FILE=/tmp/multimedia-publisher-qa-operations.json \
WEIBOT_COOKIE_FILE=/tmp/multimedia-publisher-no-cookies.json \
PORT=18812 node publisher-dashboard/server.js
```

不得使用真实 Cookie，不得点击最终平台发布。

- [ ] **Step 3: 用 Playwright 复测关键路径**

验证：

```text
六菜单逐一点击
侧栏收起/展开
粘贴与文件导入
两标签页旧版本保存得到 409 且不覆盖
公众号模板生成后平台预览包含模板标记
母稿编辑后旧排版消失
单平台和批量发布确认均可取消且无发布请求
注入 /api/ 图片不会产生本地 API 请求
1440/768/390/320 无横向溢出
控制台无产品代码错误
```

- [ ] **Step 4: 对抗矩阵复测**

对 33 个平台逐一调用 preview，确认：档案存在、格式与档案一致、`maturity` 存在、非 verified 有人工确认警告。使用注入 publisher 验证预览源哈希等于发布源哈希，不连接外网平台。

- [ ] **Step 5: 请求代码审查并修复所有阻断项**

使用 `superpowers:requesting-code-review`，审查范围为本计划开始提交到当前 HEAD。任何 Critical/Important 发现都先写失败测试再修复。

- [ ] **Step 6: 推送当前分支并验证 PR**

```bash
git push origin feature/shared-platform-adaptation
```

通过 GitHub API 核对 PR #1 head SHA 与本地 HEAD 相同、CI 为通过状态。不得合并 PR，除非用户另行明确要求。

---

## 计划自检

- 每个对抗式审查发现都有对应 Task 和失败测试。
- 未引入 SQLite schema 变化或数据迁移。
- 33 平台规则不编造未知限制；未知项通过成熟度和人工复核提示表达。
- CI 修改已由用户选择“全部收口”方案授权。
- 真实平台登录、Cookie 和最终发布均不进入自动验证。
- 所有生产代码修改都位于先失败、后实现的 TDD 步骤之后。
