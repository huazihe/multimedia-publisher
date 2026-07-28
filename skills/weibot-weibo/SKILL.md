---
name: wechat-weibo
description: "Publish Markdown/HTML articles to Weibo (寰崥) through the WEIBOT standalone Node runtime. Use when the user asks to sync, save, publish, or check auth for Weibo without the legacy browser plugin."
---

# Wechat Weibo

Platform ID: `weibo`.

## Workflow

1. Use `weibot`.
2. Provide Weibo cookies with `--cookie-file <cookies.json>` or `WEIBOT_COOKIE_FILE`.
3. Check auth before publishing when cookies are uncertain.
4. Publish as a draft and report the result.

## Commands

```bash
weibot --cookie-file cookies.json auth weibo
weibot --cookie-file cookies.json sync article.md -p weibo
weibot --cookie-file cookies.json sync article.html -p weibo -t "Article Title"
```

Do not require the legacy browser plugin. If auth fails, ask the user to refresh/export Weibo cookies.
