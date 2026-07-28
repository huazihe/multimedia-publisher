---
name: wechat-yuque
description: "Publish Markdown/HTML articles to Yuque (璇泙) through the WEIBOT standalone Node runtime. Use when the user asks to sync, save, publish, or check auth for Yuque without the legacy browser plugin."
---

# Wechat Yuque

Platform ID: `yuque`.

## Workflow

1. Use `weibot`.
2. Provide Yuque cookies with `--cookie-file <cookies.json>` or `WEIBOT_COOKIE_FILE`.
3. Check auth before publishing.
4. Publish and report the created document result.

## Commands

```bash
weibot --cookie-file cookies.json auth yuque
weibot --cookie-file cookies.json sync article.md -p yuque
weibot --cookie-file cookies.json sync article.html -p yuque -t "Article Title"
```

Do not require the legacy browser plugin. If auth fails, ask the user to refresh/export Yuque cookies.
