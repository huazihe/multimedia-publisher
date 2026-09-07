# 创作者工作台 CLI

在项目根目录安装依赖并构建：

```bash
npx -y pnpm@9.15.9 install --frozen-lockfile
npm run build
```

查看平台、登录并同步草稿：

```bash
node packages/cli/dist/index.js platforms
node packages/cli/dist/index.js login zhihu
node packages/cli/dist/index.js auth zhihu
node packages/cli/dist/index.js sync article.md -p zhihu,juejin
```

导出 Markdown 和配图：

```bash
node packages/cli/dist/index.js sync article.md -p zip-download --download-dir ./exports
```

Cookie 默认保存在 `cookies.json`，登录浏览器使用独立的 `.creator-login/<platform>` 目录。可通过 `--cookie-file`、`--user-data-dir` 和 `--storage-dir` 指定自己的路径。

CLI 的 `creator` 命令使用 `CREATOR_COOKIE_FILE`、`CREATOR_STORAGE_DIR`、`CREATOR_DOWNLOAD_DIR` 等环境变量。完整参数见 `node packages/cli/dist/index.js --help`。

默认保存草稿，不代表文章已公开或审核通过。缺少可靠结果时请到平台核对，勿重复提交。
