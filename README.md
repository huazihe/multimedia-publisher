# 创作者工作台

导入一份文章，预览各平台排版，同步平台草稿，再由你确认最终发表。

## 部署

推荐 Node.js 24（最低22.13）、pnpm 9，以及可交互的桌面环境。

```bash
git clone https://github.com/huazihe/multimedia-publisher.git
cd multimedia-publisher
npx -y pnpm@9.15.9 install --frozen-lockfile
npm run build
npm start
```

打开 <http://127.0.0.1:18810/>。

需要 Google Chrome、Edge 或 Playwright Chromium。可以安装项目自带的 Chromium：

```bash
npx playwright install chromium
```

也可以通过 `CHROME_PATH` 指定已安装的浏览器。没有桌面环境的云服务器不能直接完成当前的平台扫码登录；不要把服务直接暴露到公网。

## 使用

1. 导入 Markdown、HTML 或文本，可同时选择本地配图。
2. 编辑正文，切换平台预览；公众号可选择排版模板。
3. 在“平台登录”中连接自己的账号。
4. 勾选平台，点击“同步草稿 / 准备内容”。
5. 从结果列表打开平台稿件，检查后自行发表。

工作台不会自动公开文章或群发通知。图片上传、草稿保存与平台审核是不同状态；显示“待核对”时，请先检查平台结果，不要重复提交。

## 功能与限制

- Markdown/HTML 导入、本地配图、编辑与预览。
- 公众号排版模板、人人都是产品经理的表格转图。
- 多平台草稿准备、原稿保存、失败结果恢复。
- 抖音、企鹅号目前仅支持纯文字草稿。
- 小红书、优设、简书、网易号在标准版本中提供手工入口。
- 各平台的登录和投稿规则以平台实际页面为准。

飞书导入和选题分析为可选功能，分别需要配置自己的 Lark CLI user 账号和 Codex CLI。没有这些工具也可以使用本地文章导入。

## 配置

配置通过启动进程的环境变量传入，示例见 [.env.example](.env.example)。不会自动读取或公开你的凭据文件。

| 变量 | 用途 |
| --- | --- |
| `HOST`、`PORT` | 监听地址、端口；默认 `127.0.0.1:18810` |
| `PUBLISHER_DATA_DIR` | 文章、图片和任务数据目录 |
| `CREATOR_COOKIE_FILE` | 本机 Cookie 文件位置 |
| `CREATOR_STORAGE_DIR` | CLI 本地存储目录 |
| `CREATOR_LOGIN_DIR` | 各平台共用的登录浏览器数据目录 |
| `CREATOR_DOWNLOAD_DIR` | 导出目录 |
| `CHROME_PATH` | 可选浏览器可执行文件路径 |
| `PUBLISHER_LARK_CLI` | 可选 Lark CLI 可执行文件路径 |
| `PUBLISHER_FEISHU_PROFILE` | 可选个人 user profile |

默认只允许本机访问。账号、文章、浏览器配置和数据库只应保存在部署者自己的环境中，不能提交到 Git。

## 命令行

```bash
node packages/cli/dist/index.js platforms
node packages/cli/dist/index.js login zhihu
node packages/cli/dist/index.js sync article.md -p zhihu,juejin
```

更多命令见 [CLI 使用说明](packages/cli/README.md)。

## 许可证

[GPL-3.0](LICENSE)。包含来自 [Wechatsync](https://github.com/wechatsync/Wechatsync) 的开源组件，保留其适用许可证与声明。
