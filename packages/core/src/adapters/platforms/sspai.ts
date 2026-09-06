import { parseHTML } from 'linkedom'
import { CodeAdapter } from '../code-adapter'
import { markdownToHtml } from '../../lib/turndown'
import type { Article, AuthResult, PlatformMeta, SyncResult } from '../../types'
import type { PublishOptions } from '../types'

// Contracts observed in the public app.5546f32b.js / write.4ad2a805.js on
// 2026-09-05. These are website APIs, not a supported third-party public API.
export const SSPAI_URLS = {
  homepage: 'https://sspai.com',
  login: 'https://sspai.com/login',
  editor: 'https://sspai.com/write',
  drafts: 'https://sspai.com/my/post/draft',
  icon: 'https://cdn-static.sspai.com/favicon/sspai.ico',
} as const

const API = 'https://sspai.com/api/v1'
const CDN = 'https://cdnfile.sspai.com/'
const UPLOAD = 'https://upload.qiniup.com/'
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const IMAGE_TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif' }
type ApiData = Record<string, unknown>
interface UploadedImage { url: string; key: string; id: number }

class SspaiError extends Error {}

function positiveId(value: unknown): string | null {
  const id = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value
  return typeof id === 'string' && /^[1-9]\d*$/.test(id) ? id : null
}

function validateImageSource(src: string): void {
  if (/^data:image\/(?:png|jpeg|gif);base64,[A-Za-z0-9+/=\s]+$/i.test(src)) {
    if (src.length > MAX_IMAGE_BYTES * 1.4) throw new SspaiError('少数派图片超过 5 MB 限制。')
    return
  }
  try {
    const url = new URL(src)
    const host = url.hostname.toLowerCase()
    if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
      && host.includes('.') && !/^[\d.]+$/.test(host) && !host.includes(':')
      && !/(^|\.)(localhost|local|internal|test|invalid)$/.test(host)) return
  } catch { /* Invalid input is reported without signed URLs or local paths. */ }
  throw new SspaiError('少数派图片来源无效；请提供公开图片地址或内嵌 PNG、JPEG、GIF，先将本地图片内嵌。')
}

function safeKey(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
    && /^[A-Za-z0-9_./-]+$/.test(value) && !value.startsWith('/')
    && !value.split('/').some(part => !part || part === '.' || part === '..')
}

export class SspaiAdapter extends CodeAdapter {
  readonly meta: PlatformMeta = {
    id: 'sspai',
    name: '少数派',
    icon: SSPAI_URLS.icon,
    homepage: SSPAI_URLS.homepage,
    capabilities: ['article', 'draft', 'image_upload', 'cover'],
  }

  readonly preprocessConfig = { outputFormat: 'html' as const }

  private async token(): Promise<string> {
    const cookies = await this.runtime.cookies.get('sspai.com')
    const authPath = '/api/v1/user/info/get'
    if (cookies.some(item => item.name === 'sspai_cross_token' && item.value === 'logout'
      && item.domain.replace(/^\./, '').toLowerCase() === 'sspai.com')) {
      throw new SspaiError('少数派登录已失效，请重新登录。')
    }
    for (const name of ['sspai_jwt_token', 'sspai_cross_token']) {
      const cookie = cookies.find(item => item.name === name
        && item.domain.replace(/^\./, '').toLowerCase() === 'sspai.com'
        && (!item.path || item.path === authPath || authPath.startsWith(item.path + (item.path.endsWith('/') ? '' : '/')))
        && (!item.expirationDate || item.expirationDate <= 0 || item.expirationDate > Date.now() / 1000)
        && item.value && item.value !== 'logout' && !/[\r\n]/.test(item.value))
      if (cookie) return cookie.value
    }
    throw new SspaiError('请先在少数派登录，并同步当前会话的登录凭据。')
  }

  private async api(path: string, token: string, body?: ApiData): Promise<ApiData> {
    const response = await this.runtime.fetch(API + path, {
      method: body ? 'POST' : 'GET',
      credentials: 'include',
      redirect: 'error',
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    if (!response.ok) throw new SspaiError(`少数派请求失败（HTTP ${response.status}）。`)
    const result = await response.json() as { error?: unknown; data?: unknown } | null
    if (result?.error === 3004 || result?.error === 401) throw new SspaiError('少数派登录已失效，请重新登录。')
    if (result?.error !== 0 || !result.data || typeof result.data !== 'object' || Array.isArray(result.data)) {
      throw new SspaiError('少数派响应未通过校验。')
    }
    return result.data as ApiData
  }

  async checkAuth(): Promise<AuthResult> {
    try {
      const user = await this.api('/user/info/get', await this.token())
      const userId = positiveId(user.id)
      if (!userId) throw new SspaiError('少数派未返回有效的当前用户身份。')
      return {
        isAuthenticated: true,
        userId,
        ...(typeof user.nickname === 'string' && user.nickname ? { username: user.nickname } : {}),
      }
    } catch (error) {
      return { isAuthenticated: false, error: error instanceof SspaiError ? error.message : '少数派登录检查失败，请稍后重试。' }
    }
  }

  async publish(article: Article, options?: PublishOptions): Promise<SyncResult> {
    // Reject before auth, image transfer, or draft creation. Never turn a direct
    // request into a successful draft or use a filled editor as proof of publishing.
    if (options?.publishMode === 'direct' || options?.draftOnly === false) {
      return this.createResult(false, { error: '少数派暂不支持自动公开发布，请保存草稿后在少数派人工确认发布。' })
    }

    let postId: string | null = null
    let createAttempted = false
    try {
      const title = article.title.trim()
      const content = article.html?.trim() || markdownToHtml(article.markdown || '')
      const document = parseHTML('<html><body></body></html>').document
      const root = document.createElement('div')
      root.innerHTML = content
      const images = Array.from(root.querySelectorAll('img'))
      if (!title || (!root.textContent?.trim() && !images.length)) throw new SspaiError('少数派文章标题或正文为空。')
      const sources = images.map(image => image.getAttribute('src')?.trim() || '')
      if (article.cover) sources.push(article.cover.trim())
      // Validate all sources before any remote writes or credential lookup.
      for (const src of sources) validateImageSource(src)

      const token = await this.token()
      const user = await this.api('/user/info/get', token)
      if (!positiveId(user.id)) throw new SspaiError('少数派未返回有效的当前用户身份。')
      const transferred = new Map<string, UploadedImage>()
      const transfer = async (src: string): Promise<UploadedImage> => {
        const existing = transferred.get(src)
        if (existing) return existing
        const response = await this.runtime.fetch(src, { credentials: 'omit', redirect: 'error' })
        if (!response.ok) throw new SspaiError(`少数派图片下载失败（HTTP ${response.status}）。`)
        const uploaded = await this.uploadBinary(await response.blob(), token)
        transferred.set(src, uploaded)
        return uploaded
      }

      for (let index = 0; index < images.length; index++) {
        const src = sources[index]
        // An existing SSPAI image can stay in the body; a cover needs a verified
        // attachment id and is always transferred through the official flow.
        if (!src.startsWith(CDN)) images[index].setAttribute('src', (await transfer(src)).url)
        for (const attribute of Array.from(images[index].attributes)) {
          if (attribute.name.startsWith('data-') || ['srcset', 'sizes'].includes(attribute.name)) images[index].removeAttribute(attribute.name)
        }
        options?.onImageProgress?.(index + 1, images.length)
      }
      for (const source of Array.from(root.querySelectorAll('picture source'))) source.remove()
      const cover = article.cover ? await transfer(article.cover.trim()) : null
      const body = root.innerHTML
      const payload: ApiData = {
        type: 4,
        banner: cover?.key || '',
        banner_id: cover?.id || 0,
        title,
        title_last: title,
        body,
        body_last: body,
        allow_comment: true,
        tags: [],
        custom_tags: article.tags || [],
        delete_status: false,
      }
      createAttempted = true
      const created = await this.api('/matrix/editor/article/add', token, payload)
      postId = positiveId(created.id)
      if (!postId) throw new SspaiError('少数派新增响应缺少有效草稿 ID。')
      const saved = await this.api(`/matrix/editor/article/single/info/get?id=${postId}`, token)
      if (positiveId(saved.id) !== postId || saved.type !== 4
        || saved.title_last !== title || saved.body_last !== body
        || (cover && (saved.banner !== cover.key || saved.banner_id !== cover.id))) {
        throw new SspaiError('少数派草稿回读未匹配标题、正文、草稿状态或题图，不能确认完整保存。')
      }
      return this.createResult(true, {
        postId,
        postUrl: `${SSPAI_URLS.editor}/${postId}`,
        draftOnly: true,
        message: '已保存少数派草稿并回读核对；请在少数派检查排版、题图和发布通道后人工发布。',
      })
    } catch (error) {
      return this.createResult(false, {
        error: error instanceof SspaiError ? error.message : '少数派草稿处理失败。',
        ...(createAttempted ? {
          uncertain: true,
          ...(postId ? { postId } : {}),
          postUrl: postId ? `${SSPAI_URLS.editor}/${postId}` : SSPAI_URLS.drafts,
          message: '草稿请求可能已被平台接收；请先到少数派检查，避免重复创建。',
        } : {}),
      })
    }
  }

  async uploadImage(file: Blob, _filename?: string): Promise<string> {
    try {
      return (await this.uploadBinary(file, await this.token())).url
    } catch (error) {
      throw new Error(error instanceof SspaiError ? error.message : '少数派图片上传失败。')
    }
  }

  private async uploadBinary(file: Blob, token: string): Promise<UploadedImage> {
    const extension = IMAGE_TYPES[file.type.toLowerCase()]
    if (!extension || !file.size || file.size > MAX_IMAGE_BYTES) {
      throw new SspaiError('少数派图片须为 PNG、JPEG 或 GIF，且大小在 0–5 MB 之间。')
    }
    const filename = `${globalThis.crypto.randomUUID()}.${extension}`
    const signed = await this.api(`/matrix/editor/attachment/upload/token/get?cname=${encodeURIComponent(filename)}`, token)
    const id = positiveId(signed.id)
    if (typeof signed.token !== 'string' || !signed.token || !safeKey(signed.key) || !id || !Number.isSafeInteger(Number(id))) {
      throw new SspaiError('少数派图片上传凭证未通过校验。')
    }
    const form = new FormData()
    form.append('file', file, filename)
    form.append('token', signed.token)
    form.append('key', signed.key)
    // Qiniu only receives its upload token. SSPAI bearer/cookies stay at SSPAI.
    const response = await this.runtime.fetch(UPLOAD, { method: 'POST', credentials: 'omit', redirect: 'error', body: form })
    if (!response.ok) throw new SspaiError(`少数派图片上传失败（HTTP ${response.status}）。`)
    const uploaded = await response.json() as { key?: unknown } | null
    if (uploaded?.key !== signed.key) throw new SspaiError('少数派图片上传结果未返回匹配的图片标识。')
    return { key: signed.key, id: Number(id), url: CDN + signed.key }
  }
}
