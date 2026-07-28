---
name: wechat-segmentfault
description: "Publish Markdown/HTML articles to SegmentFault (鎬濆惁) through the WEIBOT standalone Node runtime. Use when the user asks to sync, save, publish, or check auth for SegmentFault without the legacy browser plugin."
---

# Wechat SegmentFault

Platform ID: `segmentfault`.

## Workflow

1. Use `weibot`.
2. Provide SegmentFault cookies with `--cookie-file <cookies.json>` or `WEIBOT_COOKIE_FILE`.
3. Check auth before publishing.
4. Publish as a draft and report the result.

## Commands

```bash
weibot --cookie-file cookies.json auth segmentfault
weibot --cookie-file cookies.json sync article.md -p segmentfault
weibot --cookie-file cookies.json sync article.html -p segmentfault -t "Article Title"
```

Do not require the legacy browser plugin. If auth fails, ask the user to refresh/export SegmentFault cookies.
