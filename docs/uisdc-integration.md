# 优设接入：手工投稿与只读身份核验

核验日期：2026-09-06。范围为匿名公开 HTTP 页面、官网引用的 JavaScript、官方图标和本地模拟测试。没有使用真实账号、浏览器登录态、付费模型，也没有上传、创建草稿、投稿或发布。

## 工作台接入信息

| 字段 | 值 |
| --- | --- |
| Platform ID / 名称 | `uisdc` / 优设 |
| 模式 | `manual-only` |
| homepage | `https://www.uisdc.com/` |
| loginURL | `https://www.uisdc.com/#login` |
| submissionURL | `https://www.uisdc.com/contribution?type=post` |
| 投稿总入口 | `https://www.uisdc.com/contribution` |
| 投稿记录入口 | `https://www.uisdc.com/history`（未读取真实账号记录） |
| 身份核验 URL | `https://www.uisdc.com/api/v1/user/mine`，仅 GET |
| 官方图标 | `https://www.uisdc.com/favicon-32x32.ico` |
| 本地图标 | `publisher-dashboard/public/assets/platform-icons/uisdc.ico` |
| 工作台图标地址 | `/assets/platform-icons/uisdc.ico` |
| 默认平台顺序 | 小红书 → 优设 → 抖音 |

登录并不是猜测出的 `/login` 路径：官网登录按钮带有 `data-modal-id="modal_login"`；官网 `web.js?v=4.6.13` 明确在页面加载时检查 `location.hash === "#login"` 并触发该按钮。扫码登录框及后续登录过程没有进行交互验收。

## 官方页面与脚本证据

1. [官网首页](https://www.uisdc.com/) 返回 HTTP 200，导航“文章投稿”链接到 `/contribution`，“我要投稿”链接到 `/contribution?type=post`；`rel="shortcut icon"` 指向本次下载的图标。
2. [文章投稿页](https://www.uisdc.com/contribution?type=post) 返回 HTTP 200，展示“您是否已在其他平台发布过此文”、已发布文章链接、文档/高清配图压缩包网盘链接（支持飞书等在线文档）、联系微信及版权风险告知。页面说明投稿进入审核，预计 5 个工作日。该时限是平台说明，不是工作台承诺。
3. 投稿页链接到 [《优设文章投稿规范2026版》](https://uisdc520.feishu.cn/docx/XHa3d3Expozj7qx9gIfc02XPndb)。只确认了官网给出的链接，没有访问该飞书文档或复述其正文。
4. [官方投稿脚本 tougao.js](https://www.uisdc.com/wp-content/themes/U/ui/2021/js/tougao.js?v=4.6.13) 中，文章表单调用 `POST uisdc.ajax`，包含 `action:"tougao"`、`type`、`url`、`published_url`、`read`、`published`、`wechat`、`jwt`，以响应 `data === "done"` 显示投稿成功。页面内配置 `uisdc.ajax = "https://www.uisdc.com/ajax.php"`。这是送审动作，不是文章正文草稿保存；本次没有调用该接口，适配器也没有实现它。
5. [官方 web.js](https://assets.uisdc.com/assets/2021/js/web.js?v=4.6.13) 和投稿脚本包含 `GET https://www.uisdc.com/api/v1/user/mine`，使用 `Authorization: Bearer <uisdcjwt>` 并读取 `response.data.id`、`nickname` 等当前用户信息。本次不带凭证的 GET 返回 HTTP 401，正文为 `code:"rest_forbidden"`、`data.status:401`。已登录成功响应只做了依照脚本结构的模拟测试。

本次读取的脚本 SHA-256：

| 资源 | SHA-256 |
| --- | --- |
| web.js?v=4.6.13 | `94d238fbd89216ba8c96da18e51b07881bb381464df65b7cb07c255e300da684` |
| tougao.js?v=4.6.13 | `65a4bde582ca0bad01bd8ec44933f5a7e7318e00ea5b85a27ddd8d955f2c1dd9` |
| 官方 favicon-32x32.ico / 本地 uisdc.ico | `51654252b08f09b7fd9f46ae2e33046d592b90e7140f4fbe058edbba42f9c9d5` |

图标为直接下载的 32×32、32 位 ICO 原文件，未重绘、转换或改色；工作台展示时也应保留原色，不施加灰度、反色或统一着色滤镜。

## Cookie 与认证边界

- 官网脚本读取 `currentUser` Cookie 作为前端展示资料，并从 `localStorage.uisdcjwt` 或 `uisdcjwt` Cookie 获取 JWT。`currentUser` 可被本地修改，不能作为工作台登录成功依据。
- 实际身份接口主机为 `www.uisdc.com`。适配器通过 `cookies.get('uisdc.com')` 获取候选，仅接受规范化后完全等于 `uisdc.com` 或 `www.uisdc.com` 的 `uisdcjwt` Cookie，允许对应前导点写法；还检查到期时间、请求路径适用范围与头部字符安全性。不接受 `assets.uisdc.com`、相似域名或无关子域。
- 上述域名是根据官方请求主机确定的适用范围；没有读取真实账号 Cookie，因此没有确认生产登录响应究竟使用 host-only 还是 `Domain=.uisdc.com`，也没有确认其 HttpOnly/SameSite 属性。若主代理需要配置候选域，可以使用 `.uisdc.com` 作为站点收集范围，但不能把“收集到任意 Cookie”视为通过认证，也不应额外收集微信的 `.qq.com` 凭证。
- 只有 GET 成功且 `data.id` 为有效正整数身份时，`checkAuth()` 才返回 `isAuthenticated:true`。请求不重试、不跟随重定向；没有 token、仅有 `currentUser`、凭证过期、身份响应无效或网络失败时均不报告已登录。
- 当前运行时没有读取网站 localStorage 的通用接口。本实现不会操作浏览器或擅自把 localStorage 凭证复制为 Cookie。只在 localStorage 登录而没有适用 Cookie 时，明确返回“无法验证”，这不等于证明用户在网页上未登录。
- 返回结果不包含 JWT、Cookie 值或原始异常文本。`AuthResult` 当前只有布尔字段，调用方必须展示 `error`，不要将所有 `false` 都简化成“账号未登录”。

## 真实能力

`UisdcAdapter.integrationMode` 为 `manual-only`，`meta.capabilities` 为空数组。身份核验通过也不会解锁发布功能。

| 操作 | 当前结果 |
| --- | --- |
| 平台注册、官方入口和图标 | 已实现 |
| 有适用 JWT Cookie 时只读核验当前身份 | 已实现；匿名 401 实测，成功身份结构为模拟测试 |
| 自动保存草稿 | 不支持；本次未发现文章草稿写入/回读证据 |
| 自动上传配图 | 不支持；`uploadImage()` 在运行时访问前抛出明确错误 |
| 自动送审、自动公开发布 | 不支持；所有 `publish()` 模式均提前返回 `success:false` |
| 人工投稿 | 打开官网投稿页，人工准备文档/配图链接并填写表单，交平台审核 |

`publish()` 不检查账号、不读取凭证、不触发网络或浏览器、不生成远端 ID，也不返回草稿成功或不确定成功状态。手工入口位于 `message` 中，未借用 `postUrl` 假装存在远端文章。

## 给工作台主代理的接线信息

核心注册顺序已调整为小红书 → 优设 → 抖音，原有少数派注册和其他工作者改动保留。工作台若有独立展示排序，需要在主代理负责的文件中同步该顺序。

工作台应显示“手工投稿”，提供 `submissionURL` 和登录入口，隐藏或禁用优设的自动草稿、自动发布、自动上传动作；不能仅因已连接或 `checkAuth()` 成功而开启这些动作。本子任务未修改 `prepare.ts`、`app.js`、`server.js`、任何 `topic*` 文件、CLI 登录配置或共享类型。

## 适合默认观察的公开内容信号

官网首页同样可通过匿名 HTTP 取得完整文章卡片，本次确认的卡片容器为 `.list-item.item-article`，内部结构如下（选择器对应真实 HTML，省略无关元素）：

```text
.list-item.item-article
  .item-wrap > .item-cont
    .item-top .item-thumb img[src]         封面
    .item-main h2.item-title a[href]       标题、文章 URL
    .item-main .item-desc .desc-wrap       摘要
    .item-meta .meta-time                 相对时间
    .item-meta .meta-author[href]         作者主页
    .item-meta .meta-name[data-val]        编码后的作者 HTML
    .item-meta .meta-tag a                标签
```

本次实例文章 URL 为 `https://www.uisdc.com/astra-arrives`，页面给出的相对时间为 `24小时前`，是抓取时的站点显示值。`.meta-name` 的正文在原始 HTML 中可能为空，作者资料在 `data-val` 中：URL 解码、将 `+` 还原为空格后，作为惰性 HTML 解析并仅取 `.uname` 的纯文本，不执行脚本、不直接插入页面。首页混合推荐内容，不能将位置直接解释为精确时间排序或热度排名。

[所有文章列表](https://www.uisdc.com/archives) 是官网导航给出的“最新”入口，匿名 HTTP 200 可直接取得文章列表 HTML，适合做默认的只读观察源。可提取 `h2.item-title a` 的标题与链接，同一 `.item-main` 内的 `.meta-time` 相对时间、`.u-name` 作者、`.meta-tag a` 标签；页面提供下一页链接 `https://www.uisdc.com/archives/page/2`。

页面混有推荐和侧栏，不能将整页所有链接都当作主文章列表。部分卡片或推荐条目有 `.item-views` 阅读量；它并非每篇都有，也不是经过验证的统一热度排序。默认建议按文章 URL 去重、保留页面给出的相对时间，并将缺失阅读量保留为空，不推算精确发布时间。本页没有发现声明的 RSS alternate 链接；本次不猜测 RSS/API、不生成选题、不开启定时任务。

## 本地验证

在 `packages/core` 下执行：

```sh
./node_modules/.bin/vitest run src/adapters/__tests__/uisdc.test.ts src/adapters/__tests__/sspai.test.ts --cache=false
./node_modules/.bin/tsc --noEmit
```

结果：优设 42 项、少数派 54 项，共 96 项测试通过；core 类型检查通过。测试覆盖注册唯一性与顺序、保留少数派、全部发布选项拒绝、零运行时访问、图片上传拒绝、身份结构核对、错误/无凭证处理、Cookie 域/路径/过期限制和凭证不泄露。没有执行真实账号写入、浏览器扫码交互或工作台端到端验收。
## 工作台集成验收（2026-09-06）

已完成独立UI排序、登录配置、官方原色图标、预览与手工投稿入口；草稿/直发API在任务创建前拒绝优设。公开选题信号已接入同一Skill和8平台选择器，archives实采10条标题线索。实际archives卡片使用`.archive-allposts .f-box.c-box > .item-wrap > .item-main`，不能只复用首页选择器。

工作台入口参数、图标解码、排序及移动端无溢出已检查；官方打开动作以隔离响应验证，没有实际打开外部浏览器、扫码或投稿。原稿、发布任务及现有选题库未改变。
