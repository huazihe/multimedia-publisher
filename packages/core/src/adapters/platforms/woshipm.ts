/**
 * 人人都是产品经理 (woshipm.com) 适配器
 */
import { CodeAdapter, type ImageUploadResult } from '../code-adapter'
import type { Article, AuthResult, SyncResult, PlatformMeta } from '../../types'
import type { PublishOptions } from '../types'
import { createLogger } from '../../lib/logger'
import { parseHTML } from 'linkedom'

const logger = createLogger('Woshipm')

// A stable, short source reference is enough to locate a failed image without
// logging signed URL parameters, userinfo, API errors, or a complete data URI.
function imageReference(src: string): string {
  let hash = 2166136261
  for (let i = 0; i < src.length; i++) hash = Math.imul(hash ^ src.charCodeAt(i), 16777619)
  return `image-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

class WoshipmImageError extends Error {
  constructor(readonly stage: string, readonly status?: number) {
    super(`图片${stage}失败${status === undefined ? '' : `（HTTP ${status}）`}`)
  }
}

function remoteImageURL(src: string): URL | null {
  try {
    const url = new URL(src)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null
    if (url.hostname === 'localhost' || url.hostname.endsWith('.localhost') || url.hostname.endsWith('.local') ||
        /^(?:0|10|127)\.|^169\.254\.|^192\.168\.|^172\.(?:1[6-9]|2\d|3[01])\./.test(url.hostname) ||
        url.hostname.startsWith('[')) return null
    return url
  } catch { return null }
}

function isHostedImage(src: string): boolean {
  const url = remoteImageURL(src)
  return !!url && (url.hostname === 'woshipm.com' || url.hostname.endsWith('.woshipm.com'))
}

function validateImageSource(src: string): void {
  const valid = src.length <= 20 * 1024 * 1024 && (remoteImageURL(src) ||
    /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/i.test(src))
  if (!valid) throw new Error(`图片来源无效或尚未内嵌（${imageReference(src)}）；本地 /uploads/ 或相对图片必须先转为 data URI`)
}

export class WoshipmAdapter extends CodeAdapter {
  readonly meta: PlatformMeta = {
    id: 'woshipm',
    name: '人人都是产品经理',
    icon: 'https://www.woshipm.com/favicon.ico',
    homepage: 'https://www.woshipm.com',
    capabilities: ['article', 'draft', 'image_upload'],
  }

  /** 预处理配置: 人人都是产品经理使用 HTML 格式 */
  readonly preprocessConfig = {
    outputFormat: 'html' as const,
    removeEmptyLines: true,
  }

  private jltoken: string = ''

  /** 人人都是产品经理 API 需要的 Header 规则 */
  private readonly HEADER_RULES = [
    {
      urlFilter: '*://woshipm.com/wp-admin/admin-ajax.php*',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
      resourceTypes: ['xmlhttprequest'],
    },
    {
      urlFilter: '*://woshipm.com/api2/*',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
      resourceTypes: ['xmlhttprequest'],
    },
    {
      urlFilter: '*://woshipm.com/tensorflow/upyun/upload*',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
      resourceTypes: ['xmlhttprequest'],
    },
  ]

  async checkAuth(): Promise<AuthResult> {
    try {
      // 1. 先获取用户页面以获取 uid
      const pageResponse = await this.runtime.fetch('https://www.woshipm.com/writing', {
        method: 'GET',
        credentials: 'include',
      })

      const pageText = await pageResponse.text()

      // 从页面提取 jltoken: "jltoken":"xxx"
      const jltokenMatch = pageText.match(/"jltoken"\s*:\s*"([^"]+)"/)
      if (jltokenMatch) {
        this.jltoken = jltokenMatch[1]
        logger.debug('Found jltoken')
      }

      // 从页面提取 uid: var userSettings = {"url":"\/","uid":"1585",...}
      const uidMatch = pageText.match(/var\s+userSettings\s*=\s*\{[^}]*"uid"\s*:\s*"(\d+)"/)
      if (!uidMatch) {
        return { isAuthenticated: false }
      }

      const uid = uidMatch[1]

      // 写作页能返回 uid/jltoken 已经说明当前浏览器会话是登录态。
      // profile API 偶发很慢，登录检查不再等待它，避免导出后误报或卡住。
      return {
        isAuthenticated: true,
        userId: uid,
        username: `UID ${uid}`,
      }
    } catch (error) {
      logger.debug('checkAuth: not logged in -', error)
      return { isAuthenticated: false, error: (error as Error).message }
    }
  }

  async publish(article: Article, options?: PublishOptions): Promise<SyncResult> {
    if (options?.publishMode === 'direct' || options?.draftOnly === false) {
      return this.createResult(false, { error: '人人都是产品经理仅支持保存草稿，不支持自动公开发布；请在平台后台人工确认。' })
    }
    let createAttempted = false
    return this.withHeaderRules(this.HEADER_RULES, async () => {
      logger.info('Starting publish...')

      // 1. 使用预处理好的 HTML（Content Script 已处理代码块、图片、特殊标签等）
      // 人人都是产品经理使用 HTML 格式
      let content = article.html || ''

      // 2. 处理图片
      content = await this.processImagesStrict(content, options?.onImageProgress)

      // 4. 创建草稿
      createAttempted = true
      const createResponse = await this.runtime.fetch(
        'https://www.woshipm.com/wp-admin/admin-ajax.php',
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-Requested-With': 'XMLHttpRequest',
          },
          body: new URLSearchParams({
            action: 'add_draft',
            post_title: article.title,
            post_content: content,
          }),
        }
      )

      // 检查响应状态和内容
      const responseText = await createResponse.text()
      logger.debug('Create draft response status:', createResponse.status)

      if (!createResponse.ok) {
        throw new Error(`创建草稿请求失败: HTTP ${createResponse.status}`)
      }

      let createData: { post_id?: unknown; url?: string; success?: boolean } | null
      try {
        createData = JSON.parse(responseText)
      } catch {
        throw new Error('创建草稿响应不是有效 JSON')
      }

      const draftId = typeof createData?.post_id === 'string'
        || (typeof createData?.post_id === 'number' && Number.isSafeInteger(createData.post_id))
        ? String(createData.post_id) : ''
      if (!/^[1-9]\d*$/.test(draftId) || createData?.success === false) {
        throw new Error('创建草稿未返回有效回执')
      }

      const draftUrl = createData?.url || `https://www.woshipm.com/writing?pid=${draftId}`

      logger.debug('Draft created:', draftId)

      return this.createResult(true, {
        postId: draftId,
        postUrl: draftUrl,
        draftOnly: true,
      })
    }).catch((error) => this.createResult(false, {
      error: createAttempted ? '人人都是产品经理草稿请求未取得可靠回执。' : (error as Error).message,
      ...(createAttempted ? {
        uncertain: true,
        postUrl: 'https://www.woshipm.com/writing',
        message: '草稿请求已发出，平台可能已保存；请先到人人都是产品经理写作后台检查草稿，核对结果前不要重复提交。',
      } : {}),
    }))
  }

  /**
   * 通过 Blob 上传图片（覆盖基类方法）
   */
  async uploadImage(file: Blob, filename?: string): Promise<string> {
    try {
      return await this.uploadImageBinaryInternal(file, filename || 'image.png')
    } catch (error) {
      throw new Error(error instanceof WoshipmImageError ? error.message : '图片上传失败（binary）')
    }
  }

  /** The shared processor deliberately continues on errors; woshipm must abort. */
  private async processImagesStrict(content: string, onProgress?: (current: number, total: number) => void): Promise<string> {
    const { document } = parseHTML(content)
    const images = Array.from(document.querySelectorAll('img'))
    if (!images.length) return content
    // Validate ALL sources before the first transfer, including unquoted/single
    // quoted attributes. Relative images must never reach a remote draft.
    for (let i = 0; i < images.length; i++) {
      try { validateImageSource(images[i].getAttribute('src') || '') } catch (error) {
        throw new Error(`第 ${i + 1} 张图片：${(error as Error).message}`)
      }
    }
    const uploaded = new Map<string, string>()
    for (let i = 0; i < images.length; i++) {
      const img = images[i]
      const src = img.getAttribute('src') || ''
      // Remove alternative browser-loading paths; only a verified src survives.
      img.removeAttribute('srcset')
      img.removeAttribute('sizes')
      img.removeAttribute('data-src')
      img.removeAttribute('data-original')
      if (!isHostedImage(src)) {
        let url = uploaded.get(src)
        if (!url) {
          try { url = (await this.uploadImageByUrl(src)).url } catch (error) {
            throw new Error(`第 ${i + 1} 张图片：${(error as Error).message}`)
          }
          uploaded.set(src, url)
        }
        img.setAttribute('src', url)
      }
      onProgress?.(i + 1, images.length)
    }
    // <picture> sources can override img.src even after successful uploading.
    for (const source of Array.from(document.querySelectorAll('picture source'))) source.remove()
    return document.toString()
  }

  /**
   * 通过 URL 上传图片
   */
  protected async uploadImageByUrl(src: string): Promise<ImageUploadResult> {
    validateImageSource(src)
    let stage = '下载'
    try {
      // 1. 下载图片（使用 runtime.fetch 以支持跨域）
      const imageResponse = await this.runtime.fetch(src, {
        credentials: 'omit',
      })
      if (!imageResponse.ok) {
        throw new WoshipmImageError(stage, imageResponse.status)
      }

      const blob = await imageResponse.blob()
      if (!blob.size || blob.size > 15 * 1024 * 1024 || !/^image\/(?:png|jpeg|gif|webp)(?:;|$)/i.test(blob.type)) {
        throw new WoshipmImageError('格式或大小校验')
      }

      // 2. 上传到 woshipm
      stage = '上传'
      const url = await this.uploadImageBinaryInternal(blob, `${imageReference(src)}.${blob.type.split('/')[1].split(';')[0]}`)
      return { url }
    } catch (error) {
      const detail = error instanceof WoshipmImageError ? error.message : `图片${stage}失败`
      // Do not attach the raw cause: runtime/server exceptions may include secrets.
      throw new Error(`${detail}（${imageReference(src)}）；已中止本次草稿/发布`)
    }
  }

  /**
   * 上传图片 (二进制方式) - 内部使用
   */
  private async uploadImageBinaryInternal(file: Blob, filename: string): Promise<string> {
    const formData = new FormData()
    formData.append('action', 'wpuf_insert_image')
    formData.append('name', filename)
    formData.append('files', file, filename)

    const headers: Record<string, string> = {
      'Origin': 'https://www.woshipm.com',
      'Referer': 'https://www.woshipm.com/writing',
    }
    if (this.jltoken) {
      headers['jlstar'] = `Bearer ${this.jltoken}`
    }

    const response = await this.runtime.fetch('https://www.woshipm.com/tensorflow/upyun/upload', {
      method: 'POST',
      credentials: 'include',
      headers,
      body: formData,
    })

    if (!response.ok) throw new WoshipmImageError('上传', response.status)

    const data = await response.json() as {
      data?: Array<{ url?: string }>
      error?: string
    }

    if (typeof data?.data?.[0]?.url === 'string' && isHostedImage(data.data[0].url)) {
      logger.debug('Image upload completed')
      return data.data[0].url
    }

    throw new WoshipmImageError('上传响应校验')
  }
}
