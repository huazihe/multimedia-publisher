import { BaseAdapter } from '../base'
import type { Article, AuthResult, PlatformMeta, SyncResult } from '../../types'
import type { PublishOptions } from '../types'

// Observed on the official site and web.js / tougao.js v4.6.13 (2026-09-06).
// The submission form sends external document links for editorial review;
// it does not expose an article draft-saving contract. See docs/uisdc-integration.md.
export const UISDC_URLS = {
  homepage: 'https://www.uisdc.com/',
  login: 'https://www.uisdc.com/#login',
  submission: 'https://www.uisdc.com/contribution?type=post',
  history: 'https://www.uisdc.com/history',
  auth: 'https://www.uisdc.com/api/v1/user/mine',
  articles: 'https://www.uisdc.com/archives',
  icon: 'https://www.uisdc.com/favicon-32x32.ico',
} as const

// Exact hosts applicable to the observed auth URL, not proof of a live
// account's Set-Cookie attributes. Leading dots are normalized below.
export const UISDC_COOKIE_DOMAINS = ['uisdc.com', 'www.uisdc.com'] as const

export class UisdcAdapter extends BaseAdapter {
  readonly integrationMode = 'manual-only' as const

  readonly meta: PlatformMeta = {
    id: 'uisdc',
    name: '优设',
    icon: UISDC_URLS.icon,
    homepage: UISDC_URLS.homepage,
    // Capabilities describe implemented automation, not the website's features.
    capabilities: [],
  }

  async checkAuth(): Promise<AuthResult> {
    try {
      const cookies = await this.runtime.cookies.get('uisdc.com')
      const authPath = new URL(UISDC_URLS.auth).pathname
      const cookie = cookies.find(item => {
        const domain = item.domain.replace(/^\./, '').toLowerCase()
        const path = item.path || '/'
        return item.name === 'uisdcjwt'
          && UISDC_COOKIE_DOMAINS.some(host => host === domain)
          && (path === authPath || authPath.startsWith(path.endsWith('/') ? path : path + '/'))
          && (item.expirationDate === undefined || item.expirationDate <= 0
            || item.expirationDate > Date.now() / 1000)
          && /^[A-Za-z0-9._~\-]{1,16384}$/.test(item.value)
      })
      if (!cookie) {
        return {
          isAuthenticated: false,
          error: '无法验证优设登录：未取得可用的 uisdcjwt Cookie；网页可能仅在 localStorage 保存登录凭证，请在官网确认。',
        }
      }

      // This is the GET used by the official frontend. Never infer identity
      // from the editable currentUser cookie, or forward credentials on redirect.
      const response = await this.runtime.fetch(UISDC_URLS.auth, {
        method: 'GET',
        credentials: 'include',
        redirect: 'error',
        headers: { Authorization: `Bearer ${cookie.value}` },
      })
      if (response.status === 401 || response.status === 403) {
        return { isAuthenticated: false, error: '优设身份接口拒绝了当前凭证，请在官网重新确认登录。' }
      }
      if (!response.ok) throw new Error('Unverified identity response')
      const body = await response.json() as { code?: unknown; data?: { id?: unknown; nickname?: unknown } } | null
      const id = body?.data?.id
      const userId = typeof id === 'number' && Number.isSafeInteger(id) ? String(id) : id
      if (body?.code || typeof userId !== 'string' || !/^[1-9]\d*$/.test(userId)) {
        throw new Error('Missing current identity')
      }
      return {
        isAuthenticated: true,
        userId,
        ...(typeof body?.data?.nickname === 'string' && body.data.nickname
          ? { username: body.data.nickname } : {}),
      }
    } catch {
      // Keep credentials, response bodies and runtime errors out of UI/logs.
      return { isAuthenticated: false, error: '无法验证优设登录：未取得可信的当前用户响应，请在官网确认。' }
    }
  }

  async publish(_article: Article, _options?: PublishOptions): Promise<SyncResult> {
    // Reject every mode before auth checks, uploads, browser access or requests.
    return this.createResult(false, {
      error: '优设当前仅支持手工投稿（manual-only），不支持自动保存草稿或自动发布。',
      message: `请在 ${UISDC_URLS.submission} 手工填写文章/文档及配图网盘链接、联系微信并提交审核；本次未上传、未创建草稿、未投稿。`,
    })
  }

  async uploadImage(_file: Blob, _filename?: string): Promise<string> {
    throw new Error('优设当前仅支持手工投稿（manual-only），不支持自动上传图片。')
  }
}
