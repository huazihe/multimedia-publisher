---
name: wechat-weixin
description: "Publish Markdown/HTML articles to WeChat Official Account (寰俊鍏紬鍙? through the WEIBOT standalone Node runtime. Use when the user asks to sync, save, publish, or check auth for WeChat Official Account without the legacy browser plugin."
---

# Wechat Weixin

Platform ID: `weixin`.

## Workflow

1. Use `weibot`.
2. Provide WeChat Official Account cookies with `--cookie-file <cookies.json>` or `WEIBOT_COOKIE_FILE`.
3. Check auth before publishing.
4. Publish as a draft and report the result.

## Commands

```bash
weibot --cookie-file cookies.json auth weixin
weibot --cookie-file cookies.json sync article.md -p weixin
weibot --cookie-file cookies.json sync article.html -p weixin -t "Article Title"
```

Do not require the legacy browser plugin. If auth fails, ask the user to refresh/export WeChat Official Account cookies.
