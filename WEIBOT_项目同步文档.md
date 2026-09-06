# WEIBOT 项目同步文档

更新时间：2026-06-25

> 新开 Codex 会话、接手开发、排查发布问题时，请先读本文件。  
> 本文件记录“当前项目到底在做什么、哪些已经完成、哪些还没好、怎么验证”，避免每次重新解释。

## 1. 项目定位

当前项目是把原本依赖 Chrome 插件的多平台发布能力，改造成一个独立的本地单机发布工具。

核心目标：

- 不再依托旧 Chrome 插件。
- 多平台发布逻辑拆成独立 adapter / skill 式能力。
- 提供一个本地可视化面板 WEIBOT，用于内容中心、选题计划、平台登录、一键发布、发布历史。
- 数据本地保存，不走第三方服务。

当前项目名称与命令已经从旧的 WechatSync 方向改为 WEIBOT / `@weibot/*`。如果代码或旧文档里还出现 WechatSync，多数是历史遗留，不代表还要依赖旧插件。

## 2. 主要目录

```text
<项目克隆目录>/multimedia-publisher
├─ packages\core                 # 核心发布 adapter、运行时、平台逻辑
├─ packages\cli                  # 独立 CLI，入口 dist/index.js
├─ publisher-dashboard           # 本地可视化面板
│  ├─ server.js                  # 面板后端、SQLite、调用 CLI、平台登录导出
│  ├─ public\app.js              # 前端交互逻辑
│  ├─ public\styles.css          # 前端样式
│  ├─ public\index.html          # 页面入口
│  └─ data\publisher.sqlite      # SQLite 数据库
├─ cookies.json                  # 本地导出的平台 Cookie，禁止在聊天里输出原文
├─ .weibot-login                 # 各平台登录浏览器 profile / session
└─ WEIBOT_项目同步文档.md        # 本文件
```

## 3. 启动与验证命令

安装依赖建议用 pnpm，不建议用 yarn v1，因为 workspace 解析会出问题。

```bat
npx -y pnpm@9.15.9 install --no-frozen-lockfile
```

构建 CLI：

```bat
npx -y pnpm@9.15.9 --filter @weibot/cli build
```

启动面板：

```bat
npm run dashboard
```

默认地址：

```text
http://127.0.0.1:18810
```

如果 18810 被占用，服务会自动尝试 18811、18812 等后续端口。看到两个地址时，通常是旧服务还没关。

跑面板测试：

```bat
npm run dashboard:test
```

检查平台登录状态：

```bat
node packages/cli/dist/index.js --runtime node platforms --auth
```

单平台检查：

```bat
node packages/cli/dist/index.js --runtime node auth zhihu
node packages/cli/dist/index.js --runtime node auth weixin
```

注意：2026-06-24 已修复 CLI 默认不读 `cookies.json` 的问题。现在 `auth` / `platforms --auth` 默认会读取当前项目根目录的 `cookies.json`。

## 4. 登录态机制

当前有两类登录态：

### 4.1 Cookie 型平台

这些平台主要靠 `cookies.json` 里的 Cookie 发请求。

关键点：

- `cookies.json` 里有域名记录，不等于登录仍然有效。
- 平台可能服务端失效 Cookie。
- 不允许在聊天、日志、文档里输出 Cookie 原文。

### 4.2 Chrome CDP 会话型平台

这些平台需要打开带 DevTools 端口的 Chrome/Edge 浏览器，由代码连接页面上下文。

典型平台：

```text
douyin, toutiao, xiaohongshu, qiehao, douban,
china-vision, bjx-club, elecfans, eet-china, eeworld,
ca800, b2b168, app17, huangye88, 51sole
```

关键点：

- `.weibot-login\<platform>\session.json` 记录 browserPath、port、userDataDir。
- 端口活着，不代表页面已经登录。
- 目录存在，不代表登录有效。
- 旧版本生成过很多 `login_xxx` 临时目录，可能已经失效。
- 新逻辑登录时应尽量使用固定 profile 目录：`.weibot-login\<platform>\profile`。
- 2026-06-25 修复：面板发布前不再对 CDP 平台强制跑慢速 `auth` 预检。头条号 auth 曾经需要 70 秒以上才返回“已登录”，而面板预检只有 60 秒，导致实际已登录的会话被误判为未登录，发布流程被提前拦截。现在发布前只校验 session/profile 存在，最终登录态由各平台 adapter 在发布页判断。

## 5. 当前登录状态说明

登录状态是易变状态，以本机实时命令为准。

2026-06-24 最近一次在当前项目根目录验证：

```text
weixin 微信公众号：CLI 已登录，用户：维步智能科技
zhihu 知乎：CLI 已登录，用户：槐序深巷
toutiao 今日头条：CDP 会话型；2026-06-25 已验证 direct 直发，作品管理中显示“已发布”
zip-download Markdown 压缩包：本地导出能力，不依赖平台 Cookie
```

其余平台如果显示未登录、Cookie 不可用、会话不可用，优先从面板“平台登录”重新登录，不要只看 `cookies.json` 是否有记录。

## 6. 当前平台能力状态

### 6.1 相对可用 / 已验证过的方向

```text
zip-download     Markdown 压缩包，本地导出，最稳定
weixin           微信公众号，曾成功保存草稿
zhihu            知乎，曾发布/草稿内容正确，当前 CLI 仍可验证登录
douyin           抖音，直接发布已跑通：正文、封面图、最终发布按钮均通过 CDP 自动完成
xiaohongshu      小红书，直接发布已跑通：图文上传后进入笔记管理，状态为审核中
```

### 6.2 需要重新登录或重点复测

```text
toutiao          今日头条，CDP 会话型；已修正文写入 AI 助手、误判保存成功、面板预检超时误判未登录、配图被删除/无封面问题；草稿模式已验证可上传正文图片到头条 CDN 并插入编辑器，direct 会走“预览并发布 -> 发布”两段式并校验提交成功
qiehao           企鹅号，已抓过草稿接口，但用户实测草稿为空过，需复测接口有效性
douban           豆瓣，曾出现登录导出后仍无法识别/草稿箱为空，需复测
cnblogs          博客园，发布时出现未登录或登录过期，需要重新登录验证
```

### 6.3 工业/论坛类平台

第一批做过或接入过：

```text
china-vision     中国机器视觉网
bjx-club         北极星社区
elecfans         电子发烧友
eet-china        电子工程专辑
eeworld          电子工程世界
ca800            中国自动化网
b2b168           八方资源网
app17            阿仪网
huangye88        黄页88网
51sole           搜了网
```

这些大多是 CDP 表单型，不同站点流程差异很大。当前更像“半自动填表/草稿”，不应承诺全部稳定发布。

已知问题：

- `china-vision`、`ca800`、`b2b168` 近期发布时出现未登录或会话过期。
- `elecfans` 曾出现标题能填、正文没填进去。
- `eet-china` 曾无法定位上传/草稿位置。
- `huangye88` 当前入口 `https://fabuxinxi.huangye88.com/` 是“选择分类”页，不是直接发布表单。已加防护：停留分类页时会明确提示需要先选分类，不再误判接口可用。

### 6.4 已决定不做 / 暂时移除

用户明确说过以下平台不要继续做：

```text
AI中国网
传感器专家网
控制工程网
智客公社
海报号
优酷
```

代码中 `RETIRED_PLATFORM_IDS` 包括：

```text
cnaiplus, zhike, cechina, sensorexpert
```

不要在没有用户重新确认的情况下把这些平台加回主流程。

## 7. 面板当前功能

面板在 `publisher-dashboard`。

当前 V1 方向：

- 数据看板
- 选题计划
- 内容中心
- 发布中心
- 平台登录
- 发布历史
- 进度反馈

数据存储：

```text
publisher-dashboard\data\publisher.sqlite
```

草稿 Markdown：

```text
publisher-dashboard\data\drafts
```

前端已经拆分：

```text
publisher-dashboard\public\index.html
publisher-dashboard\public\app.js
publisher-dashboard\public\styles.css
```

不要再把所有样式和逻辑塞回单个 HTML。

## 8. 最近关键修复记录

### 8.1 CLI 默认 Cookie 文件

问题：

- `login` 默认写 `cookies.json`
- `auth` / `platforms --auth` 之前默认不读 `cookies.json`
- 新会话容易误判为全部未登录

修复：

- `packages\cli\src\index.ts` 中 `--cookie-file` 默认值改为 `process.env.WEIBOT_COOKIE_FILE || 'cookies.json'`

验证：

```bat
node packages/cli/dist/index.js --runtime node auth zhihu
node packages/cli/dist/index.js --runtime node auth weixin
```

### 8.2 发布失败回写登录状态

问题：

- 发布时提示未登录/过期，但平台登录页没有提示重新登录。

修复：

- `publisher-dashboard\server.js` 增加登录失败关键词识别。
- 发布结果如果包含未登录、登录过期、401、403 等，会把平台写成 `logged_out`。

### 8.3 平台检查策略

问题：

- 自动检查仅凭 session 目录就误判已登录。

修复：

- 自动静默检查不再把旧会话文件直接当成已登录。
- 手动“全部检查”会走真实检查。

### 8.4 黄页88防误判

问题：

- 黄页88发布入口其实是分类选择页，不是正文发布页。

修复：

- `packages\core\src\adapters\platforms\browser-form.ts` 对黄页88分类页加防护，提示需要先选分类。

### 8.5 直接发布模式

用户要求发布中心不要再默认“保存草稿”，而是尽量直接公开发布。

当前处理：

- CLI `sync` 增加 `--direct` 参数。
- 发布中心 `/api/publish` 默认传 `publishMode: direct`，前端按钮文案改为“直接发布”。
- `packages\cli\src\direct.ts` 在 direct 模式下会校验适配器结果：如果平台仍然只返回草稿或“填入页面待确认”，会记为失败，不再冒充发布成功。
- `browser-form` 行业/论坛表单类平台在 direct 模式下会尝试自动点击“发布/发表/提交/投稿”按钮，并避开“保存/草稿/预览”按钮。
- 抖音在 direct 模式下会填正文、上传封面图，并通过 CDP 鼠标事件点击最终发布按钮；已验证 Douyin create 接口返回成功。
- 小红书在 direct 模式下会上传图文、填标题正文，并识别底部 `xhs-publish-btn` 组件点击发布；已验证进入笔记管理 `审核中`。
- 今日头条在 direct 模式下已验证可发布：会填入标题/正文，隐藏 AI 助手遮罩，必要时选择“无封面”，点击“预览并发布”后继续点击最终“发布”，并以“提交成功”响应/作品管理“已发布”作为成功依据。

注意：

- 知乎、掘金、微信公众号、B 站、百家号等目前多数仍只掌握草稿接口或草稿 API，未抓到最终发布接口前不会被标记为直接发布成功。
- 小红书图文仍要求至少 1 张图片。
- 直接发布是公开动作，平台若要求分类、封面、验证码、原创声明或二次确认，可能仍需要用户在打开的登录浏览器页面处理。

## 9. 接手排查建议

如果新会话要继续排查，按这个顺序：

1. 先跑：

```bat
node packages/cli/dist/index.js --runtime node platforms --auth
```

2. 不要输出 Cookie 原文，只汇总平台状态。

3. 如果面板显示和 CLI 不一致，优先看：

```text
publisher-dashboard\server.js
packages\cli\src\index.ts
packages\core\src\runtime\node.ts
```

4. 如果某平台发布失败，先单平台检查：

```bat
node packages/cli/dist/index.js --runtime node auth <platform>
```

5. CDP 平台还要检查 `.weibot-login\<platform>\session.json`：

- port 是否还活着
- userDataDir 是否还是旧 `login_xxx`
- 页面是否真的已登录

6. 修改 core adapter 后必须重新 build CLI：

```bat
npx -y pnpm@9.15.9 --filter @weibot/cli build
```

7. 修改 dashboard 后至少跑：

```bat
npm run dashboard:test
```

## 10. 重要注意事项

- 不要在聊天里打印 `cookies.json` 原文。
- 不要把“Cookie 文件里有记录”当成“平台已登录”。
- 不要把“CDP 端口活着”当成“平台已登录”。
- 不要把黄页88当普通正文表单，它需要先选分类。
- 遇到 18810 被占用，先确认是不是旧 dashboard 服务没关。
- 如果前端没变化，检查 `index.html` 里的资源版本号，避免浏览器缓存旧 `app.js` / `styles.css`。
- 如果要继续做新的平台，优先用真实浏览器抓接口或 CDP 自动化走完整发布流程，不要只凭页面 URL 猜。
