---
name: wechat-industry-forums
description: "Prepare article/forum posts for first-batch industrial and electronics platforms through the WEIBOT standalone Node runtime and a logged-in Chrome CDP session. Platforms: china-vision, cnaiplus, zhike, cechina, bjx-club, sensorexpert, elecfans, eet-china, eeworld."
---

# Wechat Industry Forums

Platform IDs:

- `china-vision` 涓浗鏈哄櫒瑙嗚缃?- `cnaiplus` AI涓浗缃?- `zhike` 鏅哄鍏ぞ
- `cechina` 鎺у埗宸ョ▼缃?- `bjx-club` 鍖楁瀬鏄熺ぞ鍖?- `sensorexpert` 浼犳劅鍣ㄤ笓瀹剁綉
- `elecfans` 鐢靛瓙鍙戠儳鍙?- `eet-china` 鐢靛瓙宸ョ▼涓撹緫
- `eeworld` 鐢靛瓙宸ョ▼涓栫晫

## Runtime Model

These platforms are handled as browser-form publishing targets. The user logs in inside a dedicated Chrome/Edge session. The adapter opens the posting or submission page, fills title and body, then leaves the final submit/publish action for human confirmation.

## Workflow

```bash
weibot login elecfans
weibot auth elecfans
weibot sync article.md -p elecfans
```

Replace `elecfans` with any platform ID above.

## Notes

- Do not ask for account passwords. The user logs in directly in their own browser session.
- Some sites require selecting a forum board, article category, captcha, or enterprise verification. First version fills the content and pauses for manual confirmation.
- If a platform changes its editor or posting URL, update the platform config in the browser-form adapter.
