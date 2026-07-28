---
name: wechat-csdn
description: "Publish Markdown/HTML articles to CSDN through the WEIBOT standalone Node runtime. Use when the user asks to sync, save, publish, or check auth for CSDN without the legacy browser plugin."
---

# Wechat CSDN

Platform ID: `csdn`.

## Workflow

1. Use `weibot`.
2. Provide CSDN cookies with `--cookie-file <cookies.json>` or `WEIBOT_COOKIE_FILE`.
3. Check auth before publishing.
4. Publish as a draft and report the draft URL or failure.

## Commands

```bash
weibot --cookie-file cookies.json auth csdn
weibot --cookie-file cookies.json sync article.md -p csdn
weibot --cookie-file cookies.json sync article.html -p csdn -t "Article Title"
```

Do not require the legacy browser plugin. If auth fails, ask the user to refresh/export CSDN cookies.
