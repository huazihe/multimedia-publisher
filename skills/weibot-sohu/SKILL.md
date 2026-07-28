---
name: wechat-sohu
description: "Publish Markdown/HTML articles to Sohu (鎼滅嫄鍙? through the WEIBOT standalone Node runtime. Use when the user asks to sync, save, publish, or check auth for Sohu without the legacy browser plugin."
---

# Wechat Sohu

Platform ID: `sohu`.

## Workflow

1. Use `weibot`.
2. Provide Sohu cookies with `--cookie-file <cookies.json>` or `WEIBOT_COOKIE_FILE`.
3. Check auth before publishing.
4. Publish as a draft and report the result.

## Commands

```bash
weibot --cookie-file cookies.json auth sohu
weibot --cookie-file cookies.json sync article.md -p sohu
weibot --cookie-file cookies.json sync article.html -p sohu -t "Article Title"
```

Do not require the legacy browser plugin. If auth fails, ask the user to refresh/export Sohu cookies.
