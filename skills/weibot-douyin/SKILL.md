---
name: weibot-douyin
description: "Publish Markdown/HTML articles directly to Douyin Creator Center through the WEIBOT standalone Node runtime and a logged-in Chrome CDP session. Use when the user asks to sync, directly publish, save drafts, or check auth for Douyin without the legacy browser plugin."
---

# WEIBOT Douyin

Platform ID: `douyin`.

## Runtime Model

Douyin requires browser-side security signing for Creator Center APIs. This skill uses the standalone WEIBOT Node runtime plus a logged-in Chrome/Edge DevTools session. It does not use the old Chrome extension.

## Workflow

1. Open the Douyin login browser:

```bash
node packages/cli/dist/index.js --runtime node login douyin
```

2. Log in to Douyin Creator Center in that browser. The CLI stores the browser session and keeps it available for later syncs.
3. Check auth:

```bash
node packages/cli/dist/index.js --runtime node auth douyin
```

4. Directly publish an article:

```bash
node packages/cli/dist/index.js --runtime node sync article.md -p douyin --direct
```

The adapter opens Douyin Creator Center's article page, fills the title/summary/body, extracts the first available image from `cover`, Markdown images, or HTML images as the required cover, uploads it through Chrome CDP, and clicks the real publish button with mouse events. Direct publish is the current verified path.

5. Save a draft instead of direct publish:

```bash
node packages/cli/dist/index.js --runtime node sync article.md -p douyin
```

## Notes

- Direct article publishing requires a cover image. Use front matter `cover`, or include at least one image in the Markdown/HTML body.
- The direct-publish implementation lives in `packages/core/src/adapters/platforms/douyin.ts`.
- Verified behavior: title/body/cover are filled, cover upload completes, and Douyin publish request returns success.
- Never ask for account passwords. The user logs in directly inside their own browser session.
