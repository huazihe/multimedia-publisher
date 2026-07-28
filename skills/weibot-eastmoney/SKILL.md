---
name: wechat-eastmoney
description: "Publish Markdown/HTML articles to Eastmoney (涓滄柟璐㈠瘜) through the WEIBOT standalone Node runtime. Use when the user asks to sync, save, publish, or check auth for Eastmoney without the legacy browser plugin."
---

# Wechat Eastmoney

Platform ID: `eastmoney`.

## Workflow

1. Use `weibot`.
2. Provide Eastmoney cookies with `--cookie-file <cookies.json>` or `WEIBOT_COOKIE_FILE`.
3. Check auth before publishing.
4. Publish as a draft and report the result.

## Commands

```bash
weibot --cookie-file cookies.json auth eastmoney
weibot --cookie-file cookies.json sync article.md -p eastmoney
weibot --cookie-file cookies.json sync article.html -p eastmoney -t "Article Title"
```

Do not require the legacy browser plugin. If auth fails, ask the user to refresh/export Eastmoney cookies.
