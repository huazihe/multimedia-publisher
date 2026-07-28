---
name: weibot-toutiao
description: "Publish Markdown/HTML articles to Toutiao Creator Center (今日头条/头条号) through the WEIBOT standalone Node runtime and a logged-in Chrome CDP session. Use when the user asks to sync, save drafts, directly publish, or check auth for Toutiao without the legacy browser plugin."
---

# WEIBOT Toutiao

Platform ID: `toutiao`.

## Runtime Model

Toutiao Creator Center is browser-session based. This skill uses the standalone Node runtime plus a logged-in Chrome/Edge DevTools session. It does not use the legacy Chrome extension.

## Workflow

1. Open the Toutiao login browser:

```bash
weibot login toutiao
```

2. Log in to Toutiao Creator Center in that browser, then finish the login export from the dashboard or CLI.
3. Check auth:

```bash
weibot auth toutiao
```

4. Save an article draft:

```bash
weibot sync article.md -p toutiao
```

5. Directly publish an article:

```bash
weibot sync article.md -p toutiao --direct
```

The adapter fills the article publish page, avoids the AI assistant drawer, selects no-cover mode when needed, clicks the two-step preview/publish flow, and verifies a real submit success response before reporting success.

## Notes

- Never ask for account passwords. The user logs in directly inside their own browser session.
- Direct publishing was verified against Toutiao Creator Center on 2026-06-25: the article appeared in Works Management as `已发布`.
- If the Creator Center page changes, selectors may need adjustment because the public web editor is not a stable API.
