---
name: wechat-xueqiu
description: "Publish Markdown/HTML articles to Xueqiu (闆悆) through the WEIBOT standalone Node runtime. Use when the user asks to sync, save, publish, or check auth for Xueqiu without the legacy browser plugin."
---

# Wechat Xueqiu

Platform ID: `xueqiu`.

## Workflow

1. Use `weibot`.
2. Provide Xueqiu cookies with `--cookie-file <cookies.json>` or `WEIBOT_COOKIE_FILE`.
3. Check auth before publishing.
4. Publish as a draft and report the result.

## Commands

```bash
weibot --cookie-file cookies.json auth xueqiu
weibot --cookie-file cookies.json sync article.md -p xueqiu
weibot --cookie-file cookies.json sync article.html -p xueqiu -t "Article Title"
```

Do not require the legacy browser plugin. If auth fails, ask the user to refresh/export Xueqiu cookies.
