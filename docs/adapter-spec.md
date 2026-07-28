# WEIBOT Adapter Spec

WEIBOT adapter 是独立的发布 skill/平台适配器。适配器运行在 `@weibot/core` 的 Node runtime 中，可以使用 Cookie、HTTP API、Chrome/Edge CDP 会话或本地文件导出能力。

## 目标

- 不依赖旧浏览器插件兼容层。
- 每个平台保持独立 adapter，便于单独登录、检查、发布和维护。
- 发布默认保存草稿，由用户在目标平台最终确认。

## 基本接口

```ts
interface PlatformAdapter {
  meta: PlatformMeta
  checkAuth(): Promise<AuthResult>
  publish(article: Article, options?: PublishOptions): Promise<SyncResult>
}
```

## Runtime 能力

- `runtime.cookies`: 读取 Cookie JSON 中的登录态。
- `runtime.storage`: 保存平台临时状态。
- `runtime.http`: 发起带 Cookie 的 HTTP 请求。
- CDP 平台可通过 `WEIBOT_<PLATFORM>_CDP_PORT` 接入已登录浏览器。

## Adapter 实现原则

- 优先使用稳定的公开/半公开草稿接口。
- 必须保留 `checkAuth()`，让 dashboard 首次加载和用户手动检查都能复用。
- 对需要浏览器上下文的平台，错误提示应明确引导用户运行 `weibot login <platform>` 或在 dashboard 完成平台登录。
- 返回 `SyncResult` 时尽量携带 `postUrl`、`postId` 或可打开的管理页 URL。
