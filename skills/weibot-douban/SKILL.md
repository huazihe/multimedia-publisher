---
name: wechat-douban
description: "Publish Markdown/HTML articles to Douban (璞嗙摚) through the WEIBOT standalone Node runtime. Use when the user asks to sync, save, publish, or check auth for Douban without the legacy browser plugin."
---

# Wechat Douban

Platform ID: `douban`.

## Workflow

1. Use `weibot`.
2. Provide Douban cookies with `--cookie-file <cookies.json>` or `WEIBOT_COOKIE_FILE`.
3. Check auth before publishing.
4. Publish as a draft and report the result.

## Commands

```bash
weibot --cookie-file cookies.json auth douban
weibot --cookie-file cookies.json sync article.md -p douban
weibot --cookie-file cookies.json sync article.html -p douban -t "Article Title"
```

Do not require the legacy browser plugin. If auth fails, ask the user to refresh/export Douban cookies.
