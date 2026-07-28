---
name: weibot-xiaohongshu
description: "Publish Xiaohongshu image-text posts through the WEIBOT standalone Node runtime and a logged-in Chrome CDP session. Use when the user asks to sync, directly publish, prepare, save, or check auth for Xiaohongshu without the legacy browser plugin."
---

# WEIBOT Xiaohongshu

Platform ID: `xiaohongshu`.

## Runtime Model

Xiaohongshu requires an interactive creator-center browser session and image uploads for image-text posts. This skill uses the standalone WEIBOT Node runtime plus a logged-in Chrome/Edge DevTools session. It does not use the old Chrome extension.

## Workflow

1. Open the Xiaohongshu login browser:

```bash
node packages/cli/dist/index.js --runtime node login xiaohongshu
```

2. Log in to Xiaohongshu Creator Center in that browser, then finish the login export from the dashboard or CLI.
3. Check auth:

```bash
node packages/cli/dist/index.js --runtime node auth xiaohongshu
```

4. Directly publish an image-text post:

```bash
node packages/cli/dist/index.js --runtime node sync article.md -p xiaohongshu --direct
```

The adapter uploads images from the article cover, Markdown images, or HTML images, fills the title and body, removes Markdown image syntax from the body text, scrolls the Xiaohongshu publish page, and clicks the real bottom publish component (`xhs-publish-btn`) with Chrome CDP mouse events.

5. Prepare the page for manual review instead of direct publish:

```bash
node packages/cli/dist/index.js --runtime node sync article.md -p xiaohongshu
```

## Notes

- Xiaohongshu image-text publishing requires at least one image. Add a cover image or include images in the article body.
- The direct-publish implementation lives in `packages/core/src/adapters/platforms/xiaohongshu.ts`.
- Verified behavior: the test post entered Xiaohongshu note management as `审核中`.
- Never ask for account passwords. The user logs in directly inside their own browser session.
