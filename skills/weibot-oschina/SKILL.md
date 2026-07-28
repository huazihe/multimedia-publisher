---
name: wechat-oschina
description: "Publish Markdown/HTML articles to OSChina (寮€婧愪腑鍥? through the WEIBOT standalone Node runtime. Use when the user asks to sync, save, publish, or check auth for OSChina without the legacy browser plugin."
---

# Wechat OSChina

Platform ID: `oschina`.

## Workflow

1. Use `weibot`.
2. Provide OSChina cookies with `--cookie-file <cookies.json>` or `WEIBOT_COOKIE_FILE`.
3. Check auth before publishing.
4. Publish as a draft and report the result.

## Commands

```bash
weibot --cookie-file cookies.json auth oschina
weibot --cookie-file cookies.json sync article.md -p oschina
weibot --cookie-file cookies.json sync article.html -p oschina -t "Article Title"
```

Do not require the legacy browser plugin. If auth fails, ask the user to refresh/export OSChina cookies.
