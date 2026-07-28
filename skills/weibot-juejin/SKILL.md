---
name: wechat-juejin
description: "Publish Markdown/HTML articles to Juejin (鎺橀噾) through the WEIBOT standalone Node runtime. Use when the user asks to sync, save, publish, or check auth for Juejin without the legacy browser plugin."
---

# Wechat Juejin

Platform ID: `juejin`.

## Workflow

1. Use `weibot`.
2. Provide Juejin cookies with `--cookie-file <cookies.json>` or `WEIBOT_COOKIE_FILE`.
3. Run auth if the cookie file changed.
4. Publish as a draft and report the draft URL.

## Commands

```bash
weibot --cookie-file cookies.json auth juejin
weibot --cookie-file cookies.json sync article.md -p juejin
weibot --cookie-file cookies.json sync article.html -p juejin -t "Article Title"
```

Do not require the legacy browser plugin. If auth fails, ask the user to refresh/export Juejin cookies.
