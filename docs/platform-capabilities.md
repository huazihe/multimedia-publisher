# 优先平台能力核查

2026-09-07 工作台策略：所有平台均由作者进行最终发表及群发通知确认，HTTP接口不接受自动 `direct`。下方的自动公开发布列描述历史适配器实现或缺口，不代表工作台提供自动公开功能。新目录字段 `preparation_mode` / `preparation_label` 描述准备方式，`supports_direct` 统一为 false。

当前工作台将小红书（装有可选实现时）、今日头条、豆瓣按编辑器准备处理；旧适配器返回成功也不直接认定草稿已保存。企鹅号与抖音只处理纯文字草稿。ZIP使用独立的本地导出状态，不计为平台草稿或已发表。

当前目录：常用入口21项（16通用内容、4技术/知识、1本地ZIP），底层37项保留历史兼容。工业/B2B等垂直平台已退出常用选择和自动登录检查。新增简书、网易号为手工写作入口，不提供自动草稿/上传/发布，也不声称已核验登录；官方来源和限制见[通用文章平台接入说明](general-article-platforms.md)。

最近核查：2026-09-06。范围：`weixin`、`woshipm`、`sspai`、`xiaohongshu`、`uisdc`、`douyin`。这里的“已实现”指当前代码具有对应路径；本轮未操作真实用户账号，未保存远程草稿、上传远程图片或公开发布，因此不代表实号验收通过。优设为新增手工投稿平台。

## 能力矩阵

| 平台 | 平台草稿 | 自动公开发布 | 正文图片 | 封面 / 题图 | UI 应呈现的边界 |
|---|---|---|---|---|---|
| 优设 `uisdc` | 不支持自动草稿 | 不支持自动送审/公开，操作前拒绝 | 只做本地阅读预览，不自动上传 | 人工提供文档/高清配图链接 | 提供登录和“去优设投稿”，交由官网表单审核 |
| 微信公众号 `weixin` | 已实现 `operate_appmsg?sub=create&type=77`，校验 HTTP、`appMsgId` 和错误码；无正文回读，请求后回执不明返回 `uncertain` | 入口明确拒绝，发生在任何 Header 规则、认证或网络写入之前 | 独立严格处理所有正文图片；下载/上传失败、非图片、无效图片来源、无效回执均阻断草稿；错误脱敏，保留 alt、去重并清理替代来源 | 未实现 `article.cover`；未猜测封面参数 | 允许“保存平台草稿”；禁用直发、自动封面设置；提示手动设置封面 |
| 人人都是产品经理 `woshipm` | 已实现 `admin-ajax.php` + `action=add_draft`，校验有效 `post_id`；无正文回读，草稿请求发出后断线、缺ID等均为 `uncertain` | 入口明确拒绝，发生在任何 Header 规则或网络写入之前 | 有 `tensorflow/upyun/upload`，上传失败和无效本地图片做阻断 | 未使用 `article.cover` | 允许“保存平台草稿”；禁用直发、自动封面设置；回执不明提供人工检查入口 |
| 少数派 `sspai` | 新增实现 `matrix/editor/article/add`、`type:4`，回读完整标题、正文、草稿类型和题图；本地契约测试，不是实号验收 | 明确拒绝，且拒绝发生在认证、图片上传或新增草稿前 | 新增官方前端同款“申请上传凭证 → 七牛上传 → 校验图片 key”流程；失败阻断新增草稿 | 新增 `banner` / `banner_id`，封面与正文重复图片复用一次上传；不自动裁切 | 可预览；草稿能力标注“接口已实现，待实号验收”；禁用直发；题图需人工检查尺寸与裁切 |
| 小红书 `xiaohongshu` | **未实现云端草稿保存**；移除 `draft` 能力，填页返回 `success:false, uncertain:true` | 只有按钮点击与错误检查；没有最终作品回执，返回 `success:false, uncertain:true` | CDP 上传，封面优先、去重；超过当前9张上限直接拒绝，不截取前9张；预览计数不一致时停止提交 | `article.cover` 只作为第一张图片；没有独立封面选择/裁切 | 明确为填页和待核查；标题超过适配器38字上限时拒绝，不自动截断 |
| 抖音 `douyin` | 草稿 API 写入与回读须匹配本次ID、标题和完整正文；仅纯文字 | 只有按钮点击与错误检查；没有最终作品回执，返回 `success:false, uncertain:true` | 所有模式在CDP前拒绝带内嵌图片的正文，不能静默丢图 | 草稿带封面会提前拒绝；直发可尝试指定封面，但上传未完成时阻断 | 草稿标注“仅文字”；标题超过适配器30字上限时拒绝；点击结果和断线等结果不明时为待核查 |
| 通用 `BrowserForm` | 除企鹅号外没有云端草稿回执路径，移除 `draft` 能力；填页返回不确定结果。企鹅号必须有 HTTP 成功、code 0 和有效文章 ID 才能成功 | 通用按钮点击一律返回不确定结果；企鹅号直发在填表前拒绝 | 没有通用正文图片上传能力 | 没有通用封面能力 | 不能把填表视作保存；移除填表自动重试，不在回执不明时删除平台编辑缓存 |

`PlatformMeta.capabilities` 没有 `direct` 能力字段；`article` 也不能代表可以公开发布。UI、后端和 CLI 不应仅凭 `article`、`draftOnly:false` 或 `success:true` 判定公开成功。

## 集成与状态约定

1. 少数派已注册到 core。新增登录配置：`id: 'sspai'`、`name: '少数派'`、`loginUrl: 'https://sspai.com/login'`、`domains: ['.sspai.com']`。首页 `https://sspai.com`；官方图标 `https://cdn-static.sspai.com/favicon/sspai.ico`；创作页 `https://sspai.com/write`；草稿列表 `https://sspai.com/my/post/draft`。这些值均来自实际读取的官网 HTML 或官方公开前端代码。
2. 当前适配器从 runtime 的 `sspai_jwt_token` / `sspai_cross_token` Cookie 读取登录凭据，再通过 `GET /api/v1/user/info/get` 验证当前用户。官方页面把同一 token 存入 `localStorage.ssToken` 与这两类 Cookie。沿用正常登录后的 Cookie 同步即可；不能只凭 Cookie 存在显示已登录。无需为少数派增加 CDP 发布环境变量。
3. 微信、人人、少数派在 `publish()` 入口拒绝直发；工作台API在创建任务前拒绝，UI对应按钮也已禁用，不产生草稿副作用。
4. core 新增 `SyncResult.uncertain?: boolean`。小红书、抖音直发及通用 BrowserForm 的填页/点击均返回 `success:false, uncertain:true`，不填虚构 `postId` 或 `draftOnly`。CLI 和 dashboard 必须优先保留“不确定/待核查”状态，展示 `message`、`postUrl`，不可当成可自动重试的普通失败，也不可写成 `published` / `platform_draft`。微信和少数派在草稿请求发出后回执不明也使用此字段。
5. 批量“同步草稿”与“直接发布”分开，微信、人人、少数派可勾选批量草稿，但不可直发。小红书没有云端草稿保存依据，界面和执行前确认明确说明只填入编辑器；结果仍是待核对，不冒充草稿成功。抖音草稿不带图，确认中提示限制，含内嵌图片仍由适配器阻断，不能静默丢图。
6. 常用目录为20个文章平台＋1个ZIP工具；底层37个入口用于兼容，不能把注册数量当成可自动发布平台数量。

CLI和工作台已接入 `[UNCERTAIN]` 状态、人工检查链接及禁止重复提交规则；无变化的本地保存、更换模板、发布模式或批次子集都不能绕过同一内容、重叠平台的未决记录。通用 `CodeAdapter.processImages` 保持原行为，严格图片处理进入微信与人人/少数派适配器。企鹅号暂不具备图片上传链路，因此带图或封面在进入浏览器前拒绝，纯文字草稿须校验回执和ID。

小红书自动化实现是未随本项目开源的可选适配器。公开克隆在安装或构建前由 `scripts/prepare-optional-adapters.mjs` 生成手工入口桥接，不声称支持自动登录、图片上传或草稿保存。已有本机实现不会被覆盖。相应私有实现专项测试在公开版不适用；公开手工入口有独立的零操作测试。下文小红书自动化行为仅描述装有私有适配器的本机版本，不代表公开版能力。

### 不确定结果接口

```ts
{
  platform: 'xiaohongshu',
  success: false,
  uncertain: true,
  error: '小红书未获得可验证的公开发布回执。',
  message: '已尝试点击发布，请检查创作者中心的发布页面及笔记管理；核查前不要重复提交。',
  postUrl: 'https://creator.xiaohongshu.com/publish/publish?source=official',
  timestamp: Date.now()
}
```

`uncertain:true` 意味着已有输入、上传、点击或草稿请求，可能存在平台自动保存或远程写入，但缺少可靠最终结果。调用方应等待人工核查，不自动重发。入参无效、缺少运行条件或不支持的直发在操作前拒绝时，不设置此字段。公开发布回执和平台实际排版仍未实号验收。

优设依据、认证与投稿限制见[优设接入说明](uisdc-integration.md)。人人与优设本地预览图片已按正文等比限宽；未声称目标网站最终排版经过实号验证。

## 少数派接口依据与实现范围

公开来源：

- 首页：<https://sspai.com/>，HTML 声明官方 favicon 及公开脚本。
- 登录页：<https://sspai.com/login>，公开加载 `app.5546f32b.js`。
- 当前应用脚本：<https://static.sspai.com/static/js/app.5546f32b.js>。包含 `/login`、`/write`、`/write/:id`、`/my/post/:type(draft|publish)` 路由，API 基址、Bearer 使用方式和 Cookie 同步逻辑。
- 写作页公开脚本：<https://static.sspai.com/static/js/write.4ad2a805.js>。脚本文件名从 app 的 chunk 名称/哈希映射解析，未猜测 URL。`createNewPost` 明确传 `type:4`、`banner`、`banner_id`、`title`、`title_last`、`body`、`body_last`、`allow_comment`、`tags`、`custom_tags`、`delete_status:false`。
- 同一写作脚本的 `72054` 模块声明 `GET /matrix/editor/article/single/info/get?id=...`、`POST /matrix/editor/article/add`；本实现不调用其中的 `update`、`auto/save` 或任何发布分支。
- 同一写作脚本的题图组件声明 `GET /matrix/editor/attachment/upload/token/get?cname=...`，取 `data.token`、`data.key`、`data.id`，向 `https://upload.qiniup.com/` 提交 `file`、`token`、`key`，把 `key` / `id` 存为 `banner` / `banner_id`。接受 PNG/JPEG/GIF，默认大小上限 5 MB。实现额外要求七牛响应 `key` 与凭证 `key` 一致；不一致时失败，不宣称上传完成。
- 文章管理脚本：<https://static.sspai.com/static/js/posts_manage.32d88fb6.js>。`openWritePage` 使用 `/write/${id}`，证实草稿交接地址。
- 未带账号访问 `GET https://sspai.com/api/v1/user/info/get` 的实际返回为 `{"error":3004,"msg":"请登录","data":null,"total":0}`。

静态 CDN 初次无 Referer 返回 403，补上页面本身的 Referer 后公开脚本返回 200，未经过登录墙或验证码。未连接用户 CDP。公开写作脚本引用的独立 `xeditor.js` 资源本轮返回 404，因此不对真实编辑器渲染兼容性作已验收声明。

新增草稿成功条件比“收到 ID”更严格：必须回读同一 ID、`type===4`、完整 `title_last` / `body_last` 一致，有封面时同时检查 `banner` / `banner_id`。服务器如果规范化 HTML 而导致不一致，会保守返回失败并附检查入口，不会自行重试或删除。文章请求失败前已经上传的图片可能留在平台素材中，后续人工检查可处理。

## 本地验证

截至2026-09-06，core全量验证通过：8个测试文件、220个用例，其中少数派54个、发布完整性30个、浏览器发布结果20个、人人图片/回执33个；`tsc --noEmit`通过。覆盖严格图片处理、直发拒绝、不确定结果、回执缺失、断线防重试、完整草稿回读和图片上传未完成时停止提交。注册清单为34个适配器、33个真实站点，少数派唯一注册。

`packages/core/src/adapters/__tests__/sspai.test.ts` 使用 mock runtime；覆盖注册与 HTML 准备、Cookie 域名/有效期/登出状态、当前用户接口校验、直发零副作用拒绝、图片与题图上传字段、认证不流向图片下载/七牛、图片去重、失败阻断、草稿完整回读及异常创建不重试。未进行真实账号上传、远程草稿或公开发布测试。

核查其他平台主要代码位置：`packages/core/src/adapters/platforms/{weixin,woshipm,xiaohongshu,douyin,browser-form}.ts`，返回接口在 `packages/core/src/types.ts`，上层结果转换由主代理在 `packages/cli/src/direct.ts` 与 `publisher-dashboard/server.js` 接续。
