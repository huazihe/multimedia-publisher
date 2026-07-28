---
name: weibot
description: "Standalone multi-platform article publisher for WEIBOT. Use when Codex needs to sync, cross-post, directly publish, or save Markdown/HTML articles to supported Chinese content platforms without relying on the legacy browser plugin. Supports Zhihu, Juejin, Douyin, Xiaohongshu, CSDN, Weibo, Bilibili, WeChat Official Account, Yuque, Douban, Sohu, Xueqiu, 51CTO, OSChina, SegmentFault, CNBlogs, Eastmoney, local ZIP export, and related auth checks."
---

# WEIBOT

Publish Markdown/HTML articles with the standalone Node runtime. Do not require the legacy browser plugin for publishing.

## Runtime Model

- Use the CLI in Node mode: `weibot ...`.
- Prefer `weibot login <platform>` to open an isolated browser login window and export a Cookie JSON file.
- Authentication comes from that Cookie JSON file, not from the browser extension.
- Use `--cookie-file <cookies.json>` or set `WEIBOT_COOKIE_FILE`.
- Use `--runtime extension` only when the user explicitly asks for the legacy legacy browser plugin bridge or browser-page extraction.

Supported public adapter IDs in this repository:

`zhihu`, `juejin`, `douyin`, `xiaohongshu`, `weibo`, `bilibili`, `baijiahao`, `csdn`, `yuque`, `douban`, `sohu`, `xueqiu`, `weixin`, `woshipm`, `51cto`, `imooc`, `oschina`, `segmentfault`, `cnblogs`, `eastmoney`, `zip-download`.

## Commands

Check supported platforms:

```bash
weibot platforms
```

Open browser login and export cookies:

```bash
weibot login juejin
weibot login douyin
weibot --cookie-file cookies.json login zhihu
```

Check login state:

```bash
weibot --cookie-file cookies.json auth zhihu
weibot --cookie-file cookies.json platforms --auth
```

Publish to one or more platforms:

```bash
weibot --cookie-file cookies.json sync article.md -p juejin,zhihu
weibot sync article.md -p douyin
weibot sync article.md -p douyin --direct
weibot sync article.md -p xiaohongshu --direct
weibot --cookie-file cookies.json sync article.html -p weixin -t "Article Title"
weibot --cookie-file cookies.json sync article.md -p csdn --cover cover.png
```

Direct publish mode:

- `douyin --direct`: fills article title/body, uploads the first article image as the required cover, then clicks the real publish button through Chrome CDP.
- `xiaohongshu --direct`: uploads image-text assets, fills title/body, then clicks Xiaohongshu's bottom `xhs-publish-btn` component through Chrome CDP.
- Other platforms may still save drafts or fail direct-mode validation unless their adapter has a verified final publish path.

Preview without publishing:

```bash
weibot sync article.md -p juejin --dry-run
```

## Cookie File

Accept either of these JSON shapes:

```json
{
  ".juejin.cn": "sessionid=...; uid_tt=...",
  ".zhihu.com": [{ "name": "_zap", "value": "...", "domain": ".zhihu.com", "path": "/" }]
}
```

```json
[
  { "name": "sessionid", "value": "...", "domain": ".juejin.cn", "path": "/" }
]
```

Never ask for account passwords. If auth fails, ask the user to rerun `login <platform>` and then rerun `auth`.

## Workflow

1. Confirm the target platform IDs.
2. Confirm an article file exists and has a title, or pass `--title`.
3. Run `login <platform>` if the Cookie JSON is missing, expired, or uncertain.
4. Run `auth` for the target platform.
5. Run `sync` in Node mode.
6. Report draft URLs and per-platform failures.
