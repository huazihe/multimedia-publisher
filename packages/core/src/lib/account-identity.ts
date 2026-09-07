export interface AccountIdentity {
  username?: string
  userId?: string
  avatar?: string
}

export function buildAccountIdentityScript(): string {
  return `(() => {
    const badText = /登录|扫码|验证码|创作者中心|创作中心|首页|发布|内容管理|数据|消息|通知|设置|退出|帮助|全部|作品|粉丝|收益|草稿|搜索|素材|任务|账号管理|平台|小红书|抖音|头条|今日头条|CREATOR/i;
    const nameTerms = ['nickname', 'nick_name', 'screen_name', 'screenname', 'user_name', 'username', 'display_name', 'displayname', 'account_name', 'accountname', 'media_name', 'medianame', 'author_name', 'authorname', 'creator_name', 'creatorname', 'shop_name', 'shopname', 'name'];
    const idTerms = ['user_id', 'userid', 'uid', 'sec_uid', 'secuid', 'unique_id', 'uniqueid', 'author_id', 'authorid', 'media_id', 'mediaid', 'account_id', 'accountid', 'creator_id', 'creatorid', 'douyin_id', 'douyinid', 'x_user_id'];
    const avatarTerms = ['avatar', 'head', 'icon', 'logo', 'image', 'picture'];
    const names = [];
    const ids = [];
    const avatars = [];
    const seen = new WeakSet();

    function clean(value) {
      return String(value || '')
        .replace(/[\\u0000-\\u001f\\u007f]/g, ' ')
        .replace(/\\s+/g, ' ')
        .trim();
    }

    function hasTerm(key, terms) {
      const lower = String(key || '').toLowerCase().replace(/[^a-z0-9_]/g, '');
      return terms.some(term => lower === term || lower.includes(term));
    }

    function plausibleName(value) {
      const text = clean(value);
      if (!text || text.length < 2 || text.length > 40) return '';
      if (/^(undefined|null|true|false|nan)$/i.test(text)) return '';
      if (/^https?:\\/\\//i.test(text) || /[{}<>]/.test(text)) return '';
      if (/^[\\d\\s:_.,@\\-+]+$/.test(text)) return '';
      if (badText.test(text)) return '';
      return text;
    }

    function plausibleId(value) {
      const text = clean(value);
      if (!text || text.length < 3 || text.length > 80) return '';
      if (/^(undefined|null|true|false|nan)$/i.test(text)) return '';
      if (/^https?:\\/\\//i.test(text) || /[{}<>\\s]/.test(text)) return '';
      if (badText.test(text)) return '';
      return text;
    }

    function pushName(value, score) {
      const text = plausibleName(value);
      if (text) names.push({ value: text, score });
    }

    function pushId(value, score) {
      const text = plausibleId(value);
      if (text) ids.push({ value: text, score });
    }

    function pushAvatar(value, score) {
      const text = clean(value);
      if (/^https?:\\/\\//i.test(text) || /^data:image\\//i.test(text)) {
        avatars.push({ value: text, score });
      }
    }

    function tryJson(value) {
      const text = clean(value);
      if (!/^[{[]/.test(text)) return null;
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    }

    function visit(value, key = '', depth = 0) {
      if (value == null || depth > 6) return;
      const keyText = String(key || '');
      if (typeof value === 'string' || typeof value === 'number') {
        if (hasTerm(keyText, avatarTerms)) pushAvatar(value, 80 - depth);
        if (hasTerm(keyText, idTerms)) pushId(value, 80 - depth);
        if (hasTerm(keyText, nameTerms)) pushName(value, 90 - depth);
        const parsed = typeof value === 'string' ? tryJson(value) : null;
        if (parsed) visit(parsed, keyText, depth + 1);
        return;
      }
      if (typeof value !== 'object') return;
      if (seen.has(value)) return;
      seen.add(value);
      if (Array.isArray(value)) {
        for (const item of value.slice(0, 80)) visit(item, keyText, depth + 1);
        return;
      }
      for (const [childKey, childValue] of Object.entries(value).slice(0, 160)) {
        visit(childValue, childKey, depth + 1);
      }
    }

    function readStorage(storage) {
      try {
        for (let i = 0; i < storage.length; i++) {
          const key = storage.key(i) || '';
          const value = storage.getItem(key) || '';
          if (/user|account|author|creator|profile|media|login|session|xhs|douyin|toutiao|passport|store|persist/i.test(key)) {
            visit(value, key, 0);
          }
        }
      } catch {}
    }

    readStorage(window.localStorage);
    readStorage(window.sessionStorage);

    try {
      for (const part of document.cookie.split(';')) {
        const index = part.indexOf('=');
        const key = decodeURIComponent((index >= 0 ? part.slice(0, index) : part).trim());
        const value = decodeURIComponent(index >= 0 ? part.slice(index + 1).trim() : '');
        if (hasTerm(key, idTerms)) pushId(value, 70);
        if (hasTerm(key, nameTerms)) pushName(value, 70);
      }
    } catch {}

    try {
      for (const key of Object.keys(window).filter(key => /user|account|author|creator|profile|media|login|passport|douyin|xhs|toutiao/i.test(key)).slice(0, 80)) {
        try {
          visit(window[key], key, 0);
        } catch {}
      }
    } catch {}

    function visible(el) {
      if (!(el instanceof HTMLElement)) return false;
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    }

    for (const el of Array.from(document.querySelectorAll('[data-user-name], [data-username], [data-nickname], [data-account], [data-user-id], [data-uid]'))) {
      for (const attr of ['data-user-name', 'data-username', 'data-nickname', 'data-account']) pushName(el.getAttribute(attr), 85);
      for (const attr of ['data-user-id', 'data-uid']) pushId(el.getAttribute(attr), 85);
    }

    const domSelectors = [
      '[class*="avatar"] img',
      '[class*="user"] [class*="name"]',
      '[class*="account"] [class*="name"]',
      '[class*="profile"] [class*="name"]',
      '[class*="nickname"]',
      '[class*="media"] [class*="name"]',
      '[id*="user"]',
      '[id*="account"]',
      '[id*="profile"]'
    ];

    for (const el of Array.from(document.querySelectorAll(domSelectors.join(','))).filter(visible).slice(0, 80)) {
      const hint = [
        el.id || '',
        typeof el.className === 'string' ? el.className : '',
        el.getAttribute('aria-label') || '',
        el.getAttribute('title') || '',
        el.getAttribute('alt') || ''
      ].join(' ');
      if (el instanceof HTMLImageElement) {
        pushAvatar(el.currentSrc || el.src, 65);
        pushName(el.alt || el.title, 45);
      } else {
        if (hasTerm(hint, idTerms)) pushId(el.textContent, 50);
        pushName(el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent, 55);
      }
    }

    function pick(candidates) {
      const best = new Map();
      for (const candidate of candidates) {
        const existing = best.get(candidate.value);
        if (!existing || existing.score < candidate.score) best.set(candidate.value, candidate);
      }
      return [...best.values()].sort((a, b) => b.score - a.score)[0]?.value || '';
    }

    const username = pick(names);
    const userId = pick(ids);
    const avatar = pick(avatars);
    return {
      username: username || undefined,
      userId: userId || undefined,
      avatar: avatar || undefined,
    };
  })()`
}
