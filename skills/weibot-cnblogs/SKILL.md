---
name: wechat-cnblogs
description: "Publish Markdown/HTML articles to CNBlogs (鍗氬鍥? through the WEIBOT standalone Node runtime. Use when the user asks to sync, save, publish, or check auth for CNBlogs without the legacy browser plugin."
---

# Wechat CNBlogs

Platform ID: `cnblogs`.

## Workflow

1. Use `weibot`.
2. Provide CNBlogs cookies with `--cookie-file <cookies.json>` or `WEIBOT_COOKIE_FILE`.
3. Check auth before publishing.
4. Publish as a draft and report the result.

## Commands

```bash
weibot --cookie-file cookies.json auth cnblogs
weibot --cookie-file cookies.json sync article.md -p cnblogs
weibot --cookie-file cookies.json sync article.html -p cnblogs -t "Article Title"
```

Do not require the legacy browser plugin. If auth fails, ask the user to refresh/export CNBlogs cookies.
