---
name: wechat-zhihu
description: "Publish Markdown/HTML articles to Zhihu (鐭ヤ箮) through the WEIBOT standalone Node runtime. Use when the user asks to sync, save, publish, or check auth for Zhihu without the legacy browser plugin."
---

# Wechat Zhihu

Platform ID: `zhihu`.

## Workflow

1. Use the standalone Node runtime: `weibot`.
2. Use `--cookie-file <cookies.json>` or `WEIBOT_COOKIE_FILE` for Zhihu login cookies.
3. Check auth before publishing when cookies are new or uncertain.
4. Publish Markdown/HTML as a draft and report the returned draft URL.

## Commands

```bash
weibot --cookie-file cookies.json auth zhihu
weibot --cookie-file cookies.json sync article.md -p zhihu
weibot --cookie-file cookies.json sync article.html -p zhihu -t "Article Title"
```

Do not require the legacy browser plugin. If auth fails, ask the user to refresh/export Zhihu cookies.
