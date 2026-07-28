# WEIBOT

WEIBOT 是一个独立的多平台内容发布工具，支持通过可视化面板或 CLI 将 Markdown/HTML 内容保存到多个平台草稿。

旧的 Chrome 插件兼容层、MCP bridge 和 extension 包已经移除。当前发布链路只走独立 Node/CDP runtime。

新开会话或接手开发前，请先阅读 [WEIBOT_项目同步文档.md](WEIBOT_项目同步文档.md)，里面记录当前平台状态、登录态机制、已知问题和验证命令。

## 项目结构

```text
WEIBOT/
  packages/
    core/          平台适配器、Node runtime、发布引擎
    cli/           weibot 命令行入口
  publisher-dashboard/  单机可视化面板
  skills/         独立平台发布与内容处理 skills 文档
    weixin-layout/         微信公众号文章排版 Skill
```

## 常用命令

```bash
npm run dashboard
npm run build
npx -y pnpm@9.15.9 --filter @weibot/cli build
node packages/cli/dist/index.js platforms
```

登录平台：

```bash
node packages/cli/dist/index.js login zhihu
node packages/cli/dist/index.js auth zhihu
```

发布到平台草稿：

```bash
node packages/cli/dist/index.js sync article.md -p zhihu,juejin
```

## 环境变量

```text
WEIBOT_COOKIE_FILE       Cookie JSON 文件路径
WEIBOT_STORAGE_DIR       Node runtime 持久化目录
WEIBOT_DOWNLOAD_DIR      本地导出目录
WEIBOT_DOUYIN_CDP_PORT   抖音登录浏览器 DevTools 端口
WEIBOT_TOUTIAO_CDP_PORT  头条登录浏览器 DevTools 端口
WEIBOT_XIAOHONGSHU_CDP_PORT  小红书登录浏览器 DevTools 端口
WEIBOT_QIEHAO_CDP_PORT   企鹅号登录浏览器 DevTools 端口
```

## 验证

```bash
npm --prefix publisher-dashboard test
npx -y pnpm@9.15.9 --filter @weibot/cli build
```

公众号文章排版 Skill：

```bash
python3 skills/weixin-layout/scripts/pick_layout.py --json --seed 20260722
```
