# 简书与网易号：通用文章平台手工入口

核验日期：2026-09-06。两个平台已接入 core 默认适配器注册表，当前模式均为 `manual-only`。这是有官方来源的手工写作入口，不代表自动同步或实号发布已可用。

工作台集成已完成：两平台进入16个通用内容入口，CSDN等4个平台放在可折叠技术组，ZIP独立为本地工具。工业/B2B及其他垂直站点从活动目录退出，但适配代码、登录资料、历史和原稿不删除。活动目录在服务端筛选，非纯CSS隐藏；历史平台的新投递在平台调用前拒绝。

已完成CLI登录配置、官方图标与写作后台入口、本地等比图片预览、手工能力提示和自动认证检查排除；未实际操作用户账号或投递。真实UI通过4种屏宽、分组展开、20张平台连接卡、18个自动检查目标及新增入口参数检查；原稿与任务哈希不变。完整回归core253、CLI108、dashboard512通过（共4项默认浏览器专项未计为通过）。

## 结构化交接

`localIcon` 是 dashboard 静态资源 URL，对应文件位于 `publisher-dashboard/public` 下。`domains` 仅列出已确认的平台站点域名，不是实号 Cookie / SSO 范围证明，不能据此显示“已验证登录”。

```json
[
  {
    "id": "jianshu",
    "name": "简书",
    "homepage": "https://www.jianshu.com/",
    "loginURL": "https://www.jianshu.com/sign_in",
    "writeURL": "https://www.jianshu.com/writer#/",
    "domains": ["jianshu.com", "www.jianshu.com"],
    "localIcon": "/assets/platform-icons/jianshu.png",
    "mode": "manual-only",
    "capabilities": [],
    "authStatus": "unverified",
    "sources": [
      "https://www.jianshu.com/",
      "https://www.jianshu.com/sign_in",
      "https://www.jianshu.com/writer#/",
      "https://cdn2.jianshu.io/assets/apple-touch-icons/152-bf209460fc1c17bfd3e2b84c8e758bc11ca3e570fd411c3bbd84149b97453b99.png"
    ],
    "verification": "公开页面均返回 HTTP 200；首页直接列出登录、写文章链接和官方图标；未核验登录后的编辑器、自动保存或发布回执。"
  },
  {
    "id": "netease",
    "name": "网易号",
    "homepage": "https://mp.163.com/",
    "loginURL": "https://mp.163.com/login.html",
    "writeURL": "https://mp.163.com/index.html",
    "domains": ["mp.163.com"],
    "localIcon": "/assets/platform-icons/netease.png",
    "mode": "manual-only",
    "capabilities": [],
    "authStatus": "unverified",
    "sources": [
      "https://mp.163.com/",
      "https://mp.163.com/login.html",
      "https://mp.163.com/index.html",
      "https://static.ws.126.net/163/mp/main/static/js/main.193d2b58.chunk.js",
      "https://static.ws.126.net/163/mp/college/static/js/main.0cacc537.chunk.js",
      "https://static.ws.126.net/163/f2e/news/yxybd_pc/resource/static/share-icon.png"
    ],
    "verification": "公开页面均返回 HTTP 200；官方脚本证实登录页与发布图文入口；writeURL 为后台入口，登录后点击发布图文；账号专属编辑页与写入回执未验证。"
  }
]
```

## 一手来源与访问限制

### 简书

- [官网首页](https://www.jianshu.com/)：HTTP 200，标题为“简书 - 创作你的创作”；导航原始 HTML 含 `href="/sign_in"` 与 `href="/writer#/"`，分别对应“登录”和“写文章”。
- [登录页](https://www.jianshu.com/sign_in)：HTTP 200，标题为“登录 - 简书”。
- [写作页](https://www.jianshu.com/writer#/)：HTTP 200，标题为“简书 - 写文章”，返回前端应用容器与公开脚本引用。这个响应不能证明实号登录或编辑器可操作。
- 首页 `rel="apple-touch-icon-precomposed"`、`sizes="152x152"` 明确引用所下载的 [官方 PNG](https://cdn2.jianshu.io/assets/apple-touch-icons/152-bf209460fc1c17bfd3e2b84c8e758bc11ca3e570fd411c3bbd84149b97453b99.png)。原图为橙红色“简书 / Jianshu.com”，白底，无重新绘制、调色或转码。
- 本轮没有取得足以实现自动写稿、回读及当前身份校验的可靠契约；这不表示平台不存在此类内部接口。

### 网易号

- [官网首页](https://mp.163.com/) 与 [登录页](https://mp.163.com/login.html)：均为 HTTP 200，标题“网易号”。
- [写作后台入口](https://mp.163.com/index.html)：HTTP 200，标题“媒体开放平台 - 网易号”；公开 HTML 引用了 [main.193d2b58.chunk.js](https://static.ws.126.net/163/mp/main/static/js/main.193d2b58.chunk.js)。该脚本的“发布图文”按钮使用 `/index.html#/post/article?wemediaId=` 拼接当前账号的 `wemediaId`；认证失败分支跳转 `/login.html?url=...`。
- 因未读取账号信息，交接只提供后台入口，用户登录后点击“发布图文”。不伪造 `wemediaId`，不把不含账号参数的编辑器深链标记为实号可用。
- 另对不带账号参数的 `https://mp.163.com/index.html#/post/article` 做过公开 GET，得到同一应用壳 HTTP 200；URL 的 fragment 不会发给 HTTP 服务端，因此这不验证前端路由与账号上下文，未将它作为交付写作入口。
- 首页引用的 [main.0cacc537.chunk.js](https://static.ws.126.net/163/mp/college/static/js/main.0cacc537.chunk.js) 可读，包含写稿相关内部路径，同时依赖 `sign`、`timestamp`、`NECaptchaValidate`、`neg.getToken()` / `ursToken` 等参数及权限判断。仅有公开脚本并不足以确认本轮可可靠自动写稿及核验回执；未执行这些写入请求，未求解或绕过验证码。
- 首页 `rel="icon"` 引用所下载的 [官方 PNG](https://static.ws.126.net/163/f2e/news/yxybd_pc/resource/static/share-icon.png)。原文件实际为 200×200，红底白字“网易 NEWS”；这是网易号首页使用的官方站点图标，不声称是另行绘制的“网易号”字标。保留原色、透明区域及原文件字节。

本轮已访问的页面与静态资源未出现 HTTP 403、明确拒绝访问或验证码拦截页。验证方式仅为无登录态的公开 HTTP 与原图查看；未启动浏览器、未接入全局 CDP、未访问用户现有浏览器、未获取真实凭据、未登录、未上传、未建草稿、未发布。HTTP 200 及公开应用壳可读，均不证明登录后后台或端到端实号可用。

## 实现边界

- `JianshuAdapter` / `NeteaseAdapter` 通过 `platforms/index.ts` 导出，在 `defaults.ts` 各注册一次；共享 `manual-base.ts` 的拒绝策略。
- 两者 `integrationMode` 为 `manual-only`，`meta.capabilities` 为 `[]`。这里表示已实现的自动化能力，而非官网功能清单。
- `checkAuth()` 固定返回 `isAuthenticated: false`，错误信息明确为“无法验证”，引导在官网确认；不读 Cookie、不请求接口、不打开浏览器。此值代表当前集成未验证身份，不是判定用户在官网一定未登录。
- `publish()` 对默认模式、草稿、直接发布及冲突选项均在任何 runtime 访问之前返回 `success: false`；不产生 `postId`、`postUrl`、`draftOnly` 或 `uncertain` 成功/疑似写入回执，不调用图片进度回调。
- `uploadImage()` 在 runtime 访问之前抛出手工操作提示。未实现编辑、删除或草稿列表能力。
- 工业/B2B 历史适配器仍保留；dashboard 活跃目录、分组、历史展示及其调用链由主代理处理。本子任务没有改动 CLI、`prepare.ts`、server、前端页面、样式或现有测试。

## 原图校验

| 本地文件 | 实际尺寸 | 文件字节 | SHA-256 |
| --- | --- | --- | --- |
| `publisher-dashboard/public/assets/platform-icons/jianshu.png` | 152×152 | 5145 | `bf209460fc1c17bfd3e2b84c8e758bc11ca3e570fd411c3bbd84149b97453b99` |
| `publisher-dashboard/public/assets/platform-icons/netease.png` | 200×200 | 4221 | `1b6e27e18e92400f312f44c089b6a766bc9a4b027c9576faac714bd2af41475b` |

## 本地验证

新增 `packages/core/src/adapters/__tests__/general-article-platforms.test.ts`：覆盖两平台注册、官方入口、空能力、registry 获取、未验证登录、全部发布选项、上传拒绝、未初始化调用、原图字节一致性和工业平台兼容保留。使用拒绝任何属性读取的 runtime Proxy，检查拒绝路径确实在网络、凭据和浏览器访问之前结束。

命令在 `packages/core` 运行，使用已有本地依赖：

```sh
./node_modules/.bin/vitest run src/adapters/__tests__/general-article-platforms.test.ts src/adapters/__tests__/uisdc.test.ts src/adapters/__tests__/sspai.test.ts --no-cache
./node_modules/.bin/tsc --noEmit
```

本轮结果：新增测试最终 33/33 通过；现有优设测试 42/42、少数派测试 54/54 通过，现有测试文件未修改。`tsc --noEmit` 退出码 0。新增图标测试首轮因相对路径多一级失败，修正后复跑新增测试全部通过。注册文件 `git diff --check` 通过；交接 JSON 可解析且两条本地图标路径均存在。

本轮共验证 129 项本地测试，未运行全仓测试、dashboard UI 或真实平台发布验收。
