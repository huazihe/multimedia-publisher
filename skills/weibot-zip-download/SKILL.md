---
name: wechat-zip-download
description: "Export Markdown/HTML articles as a local ZIP package through the WEIBOT standalone Node runtime. Use when the user asks to package an article and its images locally without any platform login or legacy browser plugin."
---

# Wechat ZIP Download

Platform ID: `zip-download`.

## Workflow

1. Use `weibot`.
2. No Cookie file is required.
3. Optionally pass `--download-dir <dir>` or set `WEIBOT_DOWNLOAD_DIR`.
4. Export the article as a ZIP containing Markdown and images.

## Commands

```bash
weibot sync article.md -p zip-download
weibot --download-dir ./exports sync article.html -p zip-download -t "Article Title"
```

Do not require the legacy browser plugin or any platform credentials.
