---
name: wechat-bilibili
description: "Publish Markdown/HTML articles to Bilibili (B绔? through the WEIBOT standalone Node runtime. Use when the user asks to sync, save, publish, or check auth for Bilibili without the legacy browser plugin."
---

# Wechat Bilibili

Platform ID: `bilibili`.

## Workflow

1. Use `weibot`.
2. Provide Bilibili cookies with `--cookie-file <cookies.json>` or `WEIBOT_COOKIE_FILE`.
3. Check auth before publishing.
4. Publish as a draft and report the returned result.

## Commands

```bash
weibot --cookie-file cookies.json auth bilibili
weibot --cookie-file cookies.json sync article.md -p bilibili
weibot --cookie-file cookies.json sync article.html -p bilibili -t "Article Title"
```

Do not require the legacy browser plugin. If auth fails, ask the user to refresh/export Bilibili cookies.
