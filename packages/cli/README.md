# @weibot/cli

WEIBOT 命令行入口。它只使用独立 Node/CDP runtime，不依赖旧 Chrome 插件。

## 构建

```bash
npx -y pnpm@9.15.9 --filter @weibot/cli build
```

## 平台列表

```bash
node packages/cli/dist/index.js platforms
node packages/cli/dist/index.js platforms --auth
```

## 登录

```bash
node packages/cli/dist/index.js login zhihu
node packages/cli/dist/index.js auth zhihu
```

登录浏览器默认使用 `./.weibot-login/<platform>` 作为独立用户数据目录。Cookie 默认写入 `cookies.json`，也可以通过 `--cookie-file` 或 `WEIBOT_COOKIE_FILE` 指定。

## 发布草稿

```bash
node packages/cli/dist/index.js sync article.md -p zhihu,juejin
node packages/cli/dist/index.js sync article.md -p zip-download --download-dir ./exports
```

## 环境变量

| 变量 | 说明 |
| --- | --- |
| `WEIBOT_COOKIE_FILE` | Cookie JSON 文件路径 |
| `WEIBOT_STORAGE_DIR` | Node runtime 持久化目录 |
| `WEIBOT_DOWNLOAD_DIR` | 本地导出目录 |
| `WEIBOT_DOUYIN_CDP_PORT` | 抖音登录浏览器 DevTools 端口 |
| `WEIBOT_TOUTIAO_CDP_PORT` | 头条登录浏览器 DevTools 端口 |
| `WEIBOT_XIAOHONGSHU_CDP_PORT` | 小红书登录浏览器 DevTools 端口 |
| `WEIBOT_QIEHAO_CDP_PORT` | 企鹅号登录浏览器 DevTools 端口 |
