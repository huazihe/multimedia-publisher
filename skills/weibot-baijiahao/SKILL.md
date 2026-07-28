---
name: wechat-baijiahao
description: "Publish Markdown/HTML articles to Baijiahao (鐧惧鍙? through the WEIBOT standalone Node runtime. Use when the user asks to sync, save, publish, or check auth for Baijiahao without the legacy browser plugin."
---

# Wechat Baijiahao

Platform ID: `baijiahao`.

## Workflow

1. Use `weibot`.
2. Provide Baijiahao cookies with `--cookie-file <cookies.json>` or `WEIBOT_COOKIE_FILE`.
3. Check auth before publishing.
4. Publish as a draft and report the result.

## Commands

```bash
weibot --cookie-file cookies.json auth baijiahao
weibot --cookie-file cookies.json sync article.md -p baijiahao
weibot --cookie-file cookies.json sync article.html -p baijiahao -t "Article Title"
```

Do not require the legacy browser plugin. If auth fails, ask the user to refresh/export Baijiahao cookies.
