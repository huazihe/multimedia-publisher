import { ManualArticleAdapter } from './manual-base'
import type { PlatformMeta } from '../../types'

// Official homepage links, verified by public HTTP on 2026-09-06.
// See docs/general-article-platforms.md for evidence and verification limits.
export const JIANSHU_URLS = {
  homepage: 'https://www.jianshu.com/',
  login: 'https://www.jianshu.com/sign_in',
  editor: 'https://www.jianshu.com/writer#/',
  icon: 'https://cdn2.jianshu.io/assets/apple-touch-icons/152-bf209460fc1c17bfd3e2b84c8e758bc11ca3e570fd411c3bbd84149b97453b99.png',
} as const

// Site domains for catalog consumers; not a verified session-cookie contract.
export const JIANSHU_DOMAINS = ['jianshu.com', 'www.jianshu.com'] as const

export class JianshuAdapter extends ManualArticleAdapter {
  protected readonly manualURLs = JIANSHU_URLS

  readonly meta: PlatformMeta = {
    id: 'jianshu',
    name: '简书',
    homepage: JIANSHU_URLS.homepage,
    icon: JIANSHU_URLS.icon,
    capabilities: [],
  }
}
