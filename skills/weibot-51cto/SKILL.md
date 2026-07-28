---
name: wechat-51cto
description: "Publish Markdown/HTML articles to 51CTO through the WEIBOT standalone Node runtime. Use when the user asks to sync, save, publish, or check auth for 51CTO without the legacy browser plugin."
---

# Wechat 51CTO

Platform ID: `51cto`.

## Workflow

1. Use `weibot`.
2. Provide 51CTO cookies with `--cookie-file <cookies.json>` or `WEIBOT_COOKIE_FILE`.
3. Check auth before publishing.
4. Publish as a draft and report the result.

## Commands

```bash
weibot --cookie-file cookies.json auth 51cto
weibot --cookie-file cookies.json sync article.md -p 51cto
weibot --cookie-file cookies.json sync article.html -p 51cto -t "Article Title"
```

Do not require the legacy browser plugin. If auth fails, ask the user to refresh/export 51CTO cookies.
