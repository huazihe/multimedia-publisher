---
name: wechat-woshipm
description: "Publish Markdown/HTML articles to Woshipm (浜轰汉閮芥槸浜у搧缁忕悊) through the WEIBOT standalone Node runtime. Use when the user asks to sync, save, publish, or check auth for Woshipm without the legacy browser plugin."
---

# Wechat Woshipm

Platform ID: `woshipm`.

## Workflow

1. Use `weibot`.
2. Provide Woshipm cookies with `--cookie-file <cookies.json>` or `WEIBOT_COOKIE_FILE`.
3. Check auth before publishing.
4. Publish as a draft and report the result.

## Commands

```bash
weibot --cookie-file cookies.json auth woshipm
weibot --cookie-file cookies.json sync article.md -p woshipm
weibot --cookie-file cookies.json sync article.html -p woshipm -t "Article Title"
```

Do not require the legacy browser plugin. If auth fails, ask the user to refresh/export Woshipm cookies.
