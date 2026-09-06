import { ManualArticleAdapter } from './manual-base'
import type { PlatformMeta } from '../../types'

// Official public pages and their linked scripts, verified on 2026-09-06.
// The site's article deep link requires the current account's wemediaId.
// Expose the verified backend entry without inventing an account-specific URL.
export const NETEASE_URLS = {
  homepage: 'https://mp.163.com/',
  login: 'https://mp.163.com/login.html',
  editor: 'https://mp.163.com/index.html',
  icon: 'https://static.ws.126.net/163/f2e/news/yxybd_pc/resource/static/share-icon.png',
} as const

// Only the observed platform host; SSO/cookie scopes have not been verified.
export const NETEASE_DOMAINS = ['mp.163.com'] as const

export class NeteaseAdapter extends ManualArticleAdapter {
  protected readonly manualURLs = NETEASE_URLS

  readonly meta: PlatformMeta = {
    id: 'netease',
    name: '网易号',
    homepage: NETEASE_URLS.homepage,
    icon: NETEASE_URLS.icon,
    capabilities: [],
  }
}
