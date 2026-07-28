import { CodeAdapter } from '../code-adapter'
import type { Article, AuthResult, PlatformMeta, SyncResult } from '../../types'
import type { PublishOptions } from '../types'
import { createLogger } from '../../lib/logger'
import { buildAccountIdentityScript, type AccountIdentity } from '../../lib/account-identity'
import fs from 'fs'
import os from 'os'
import path from 'path'

const logger = createLogger('Douyin')

const HOME_URL = 'https://creator.douyin.com/creator-micro/home'
const UPLOAD_URL = 'https://creator.douyin.com/creator-micro/content/upload?default-tab=5&enter_from=publish'
const ARTICLE_URL = 'https://creator.douyin.com/creator-micro/content/post/article?default-tab=5&enter_from=publish_page&media_type=article&type=new'
const DRAFT_API = 'https://creator.douyin.com/web/api/media/aweme/draft/?read_aid=2906'

interface CdpTarget {
  type?: string
  url?: string
  webSocketDebuggerUrl?: string
}

interface CdpMessage<T = unknown> {
  id?: number
  method?: string
  params?: unknown
  result?: T
  error?: {
    message?: string
  }
}

interface RuntimeEvaluateResult<T> {
  result?: {
    type?: string
    value?: T
    description?: string
  }
  exceptionDetails?: {
    text?: string
    exception?: {
      description?: string
    }
  }
}

interface DouyinDraftResponse {
  status_code?: number
  status_msg?: string
  draft?: {
    creation_id?: string
    title?: string
    long_article?: string
  }
}

interface DirectPublishResult {
  ok: boolean
  error?: string
  url?: string
  publishClicked?: boolean
  coverUploaded?: boolean
  titleFilled?: boolean
  summaryFilled?: boolean
  bodyFilled?: boolean
  message?: string
}

interface FileChooserOpenedEvent {
  nodeId?: number
  backendNodeId?: number
}

class CdpClient {
  private nextId = 0
  private pending = new Map<number, {
    resolve: (value: unknown) => void
    reject: (reason?: unknown) => void
    timeout: ReturnType<typeof setTimeout>
  }>()
  private listeners = new Map<string, Array<(params: unknown) => void>>()

  private constructor(private socket: WebSocket) {
    this.socket.addEventListener('message', event => {
      const message = JSON.parse(String(event.data)) as CdpMessage

      if (message.method) {
        for (const listener of this.listeners.get(message.method) || []) {
          listener(message.params)
        }
        return
      }

      if (!message.id) return
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      clearTimeout(pending.timeout)

      if (message.error) pending.reject(new Error(message.error.message || 'Chrome DevTools command failed'))
      else pending.resolve(message.result)
    })
  }

  static async connect(webSocketDebuggerUrl: string): Promise<CdpClient> {
    if (typeof WebSocket === 'undefined') {
      throw new Error('Current Node.js runtime does not expose WebSocket. Please use Node.js 22+ or run through the CLI bundle.')
    }

    const socket = new WebSocket(webSocketDebuggerUrl)
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timed out connecting to Chrome DevTools WebSocket.')), 10000)

      socket.addEventListener('open', () => {
        clearTimeout(timeout)
        resolve()
      }, { once: true })

      socket.addEventListener('error', () => {
        clearTimeout(timeout)
        reject(new Error('Failed to connect to Chrome DevTools WebSocket.'))
      }, { once: true })
    })

    return new CdpClient(socket)
  }

  send<T = unknown>(method: string, params?: Record<string, unknown>, timeoutMs = 15000): Promise<T> {
    const id = ++this.nextId

    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${method} timeout`))
      }, timeoutMs)

      this.pending.set(id, {
        resolve: value => resolve(value as T),
        reject,
        timeout,
      })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  waitForEvent<T = unknown>(method: string, timeoutMs = 15000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const onEvent = (params: unknown) => {
        clearTimeout(timeout)
        const next = (this.listeners.get(method) || []).filter(listener => listener !== onEvent)
        this.listeners.set(method, next)
        resolve(params as T)
      }
      const timeout = setTimeout(() => {
        const next = (this.listeners.get(method) || []).filter(listener => listener !== onEvent)
        this.listeners.set(method, next)
        reject(new Error(`${method} timeout`))
      }, timeoutMs)

      this.listeners.set(method, [...(this.listeners.get(method) || []), onEvent])
    })
  }

  close(): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout)
      pending.reject(new Error('Chrome DevTools WebSocket closed.'))
    }
    this.pending.clear()
    this.socket.close()
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function env(name: string): string | undefined {
  if (typeof process === 'undefined') return undefined
  return process.env[name]
}

function resolveCdpPort(): number | null {
  const raw = env('WEIBOT_DOUYIN_CDP_PORT') || env('DOUYIN_CDP_PORT') || env('WEIBOT_CDP_PORT')
  if (!raw) return null

  const port = Number(raw)
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Invalid Douyin CDP port: ${raw}`)
  }

  return port
}

function truncate(value: string, maxLength: number): string {
  return Array.from(value.trim()).slice(0, maxLength).join('')
}

function firstTextLine(content: string): string {
  return content
    .split(/\r?\n/)
    .map(line => line.replace(/^#+\s*/, '').trim())
    .find(Boolean) || ''
}

function normalizeBody(article: Article): string {
  return (article.markdown || article.html || '')
    .replace(/!\[[^\]]*]\([^)]+\)/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function firstImageSource(article: Article): string | null {
  if (article.cover) return article.cover

  const mdMatch = (article.markdown || '').match(/!\[[^\]]*]\(([^)]+)\)/)
  if (mdMatch?.[1]) return mdMatch[1].trim()

  const htmlMatch = (article.html || '').match(/<img[^>]+src=["']([^"']+)["'][^>]*>/i)
  if (htmlMatch?.[1]) return htmlMatch[1].trim()

  return null
}

function imageExtensionFromMime(mimeType: string): string {
  if (/jpe?g/i.test(mimeType)) return 'jpg'
  if (/png/i.test(mimeType)) return 'png'
  if (/webp/i.test(mimeType)) return 'webp'
  if (/gif/i.test(mimeType)) return 'gif'
  return 'png'
}

async function waitForJson<T>(url: string, timeoutMs = 15000): Promise<T> {
  const start = Date.now()
  let lastError: unknown

  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url)
      if (response.ok) return await response.json() as T
      lastError = new Error(`HTTP ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await delay(400)
  }

  throw new Error(`Timed out waiting for Chrome DevTools at ${url}: ${(lastError as Error | undefined)?.message || 'unknown error'}`)
}

async function getPageDebuggerUrl(port: number, targetUrl: string): Promise<string> {
  const targets = await waitForJson<CdpTarget[]>(`http://127.0.0.1:${port}/json/list`)
  const page = targets.find(target =>
    target.type === 'page'
    && target.webSocketDebuggerUrl
    && target.url?.includes('creator.douyin.com')
  ) || targets.find(target => target.type === 'page' && target.webSocketDebuggerUrl)

  if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl

  const created = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(targetUrl)}`, {
    method: 'PUT',
  })
  if (!created.ok) throw new Error(`Could not create Chrome page: HTTP ${created.status}`)

  const target = await created.json() as CdpTarget
  if (!target.webSocketDebuggerUrl) throw new Error('Chrome page did not expose a DevTools WebSocket URL.')
  return target.webSocketDebuggerUrl
}

export class DouyinAdapter extends CodeAdapter {
  readonly meta: PlatformMeta = {
    id: 'douyin',
    name: '抖音文章',
    icon: 'https://lf1-cdn-tos.bytegoofy.com/goofy/ies/douyin_web/public/favicon.ico',
    homepage: 'https://creator.douyin.com',
    capabilities: ['article', 'draft'],
  }

  readonly preprocessConfig = {
    outputFormat: 'markdown' as const,
  }

  async checkAuth(): Promise<AuthResult> {
    if (this.runtime.type !== 'node') {
      return {
        isAuthenticated: false,
        error: 'Douyin standalone publishing requires Node runtime with Chrome CDP.',
      }
    }

    const port = resolveCdpPort()
    if (!port) {
      return {
        isAuthenticated: false,
        error: 'Set --douyin-cdp-port or WEIBOT_DOUYIN_CDP_PORT to a logged-in Chrome DevTools port.',
      }
    }

    let client: CdpClient | null = null
    try {
      client = await this.connect(port, HOME_URL)
      await this.navigate(client, HOME_URL)
      await delay(1500)

      const state = await this.evaluate<{ url: string; text: string }>(client, `(() => ({
        url: location.href,
        text: document.body?.innerText?.slice(0, 2000) || ''
      }))()`)

      const loggedIn = state.url.includes('/creator-micro') && !/鐧诲綍|鎵爜鐧诲綍/.test(state.text.slice(0, 300))
      if (!loggedIn) {
        return { isAuthenticated: false, error: 'Douyin creator center is not logged in in the CDP browser.' }
      }
      const identity = await this.readAccountIdentity(client)
      return {
        isAuthenticated: true,
        username: identity.username || identity.userId,
        userId: identity.userId,
        avatar: identity.avatar,
      }
    } catch (error) {
      return { isAuthenticated: false, error: (error as Error).message }
    } finally {
      client?.close()
    }
  }

  async publish(article: Article, options?: PublishOptions): Promise<SyncResult> {
    if (this.runtime.type !== 'node') {
      return this.createResult(false, {
        error: 'Douyin standalone publishing requires Node runtime with Chrome CDP.',
      })
    }

    const port = resolveCdpPort()
    if (!port) {
      return this.createResult(false, {
        error: 'Set --douyin-cdp-port <port> or WEIBOT_DOUYIN_CDP_PORT before syncing to Douyin.',
      })
    }

    const title = truncate(article.title || 'Untitled', 30)
    const body = normalizeBody(article)
    if (!body) {
      return this.createResult(false, { error: 'Article content is empty.' })
    }
    const summary = truncate(article.summary || firstTextLine(body), 30)

    let client: CdpClient | null = null
    let tempCoverPath: string | null = null
    try {
      const directMode = options?.publishMode === 'direct'
      if (directMode) tempCoverPath = await this.prepareCoverImage(article)
      client = await this.connect(port, directMode ? ARTICLE_URL : UPLOAD_URL)
      if (directMode) {
        await this.navigate(client, ARTICLE_URL)
        const published = await this.publishDirect(client, title, summary, body, tempCoverPath)
        if (!published.ok) throw new Error(published.error || 'Douyin direct publish failed.')

        logger.info(`Publish submitted: ${title}`)
        return this.createResult(true, {
          postId: title,
          postUrl: published.url || ARTICLE_URL,
          draftOnly: false,
          message: published.message || '已自动点击抖音文章发布按钮；如平台要求封面、头图或二次确认，请检查抖音创作者中心页面。',
        })
      }

      await this.navigate(client, UPLOAD_URL)
      const draft = await this.saveDraft(client, title, summary, body)

      logger.info(`Draft saved: ${draft.draft?.creation_id || title}`)
      return this.createResult(true, {
        postId: draft.draft?.creation_id || title,
        postUrl: UPLOAD_URL,
        draftOnly: true,
        message: '已保存到抖音文章草稿，请在抖音创作者中心确认后发布。',
      })
    } catch (error) {
      return this.createResult(false, {
        error: (error as Error).message,
      })
    } finally {
      client?.close()
      if (tempCoverPath) fs.promises.unlink(tempCoverPath).catch(() => undefined)
    }
  }

  private async connect(port: number, targetUrl: string): Promise<CdpClient> {
    const debuggerUrl = await getPageDebuggerUrl(port, targetUrl)
    const client = await CdpClient.connect(debuggerUrl)
    await client.send('Runtime.enable').catch(() => undefined)
    await client.send('Page.enable').catch(() => undefined)
    await client.send('DOM.enable').catch(() => undefined)
    return client
  }

  private async navigate(client: CdpClient, url: string): Promise<void> {
    await client.send('Page.navigate', { url })
    await this.waitForExpression(client, `document.readyState === 'complete' || document.readyState === 'interactive'`, 30000)
  }

  private async readDraft(client: CdpClient): Promise<DouyinDraftResponse> {
    return this.evaluate<DouyinDraftResponse>(client, `fetch(${JSON.stringify(DRAFT_API)}, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item: { common: { draft: { req_type: 3 } } } })
    }).then(response => response.json())`)
  }

  private async saveDraft(client: CdpClient, title: string, summary: string, body: string): Promise<DouyinDraftResponse> {
    const saved = await this.evaluate<DouyinDraftResponse>(client, `(() => {
      const payload = {
        item: {
          common: {
            draft: {
              title: ${JSON.stringify(title)},
              description: ${JSON.stringify(summary)},
              long_article: ${JSON.stringify(body)},
              image_info: [],
              head_poster: '',
              text_extra: '[]',
              visibility_type: 0,
              timing: 0,
              creation_id: 'codex' + Date.now(),
              init_timestamp: Math.floor(Date.now() / 1000),
              req_type: 0
            }
          },
          cover: {}
        }
      };

      return fetch(${JSON.stringify(DRAFT_API)}, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).then(response => response.json());
    })()`)

    if (saved.status_code !== 0) {
      throw new Error(`Douyin draft save failed: ${saved.status_msg || saved.status_code || 'unknown error'}`)
    }

    const draft = await this.readDraft(client)
    const bodyProbe = body.slice(0, 80)
    if (
      draft.status_code !== 0
      || draft.draft?.title !== title
      || !(draft.draft.long_article || '').includes(bodyProbe)
    ) {
      throw new Error(`Douyin draft verification failed: ${draft.status_msg || draft.status_code || 'draft content did not match'}`)
    }

    return draft
  }

  private async prepareCoverImage(article: Article): Promise<string | null> {
    const source = firstImageSource(article)
    if (!source) return null

    if (source.startsWith('data:')) {
      const match = source.match(/^data:([^;,]+);base64,(.+)$/)
      if (!match) return null
      const ext = imageExtensionFromMime(match[1])
      const filePath = path.join(os.tmpdir(), `weibot-douyin-cover-${Date.now()}.${ext}`)
      await fs.promises.writeFile(filePath, Buffer.from(match[2], 'base64'))
      return filePath
    }

    if (/^https?:\/\//i.test(source)) {
      const response = await this.runtime.fetch(source, { credentials: 'omit' })
      if (!response.ok) return null
      const blob = await response.blob()
      const ext = imageExtensionFromMime(blob.type || response.headers.get('content-type') || '')
      const filePath = path.join(os.tmpdir(), `weibot-douyin-cover-${Date.now()}.${ext}`)
      await fs.promises.writeFile(filePath, Buffer.from(await blob.arrayBuffer()))
      return filePath
    }

    const localPath = path.resolve(source)
    return fs.existsSync(localPath) ? localPath : null
  }

  private async publishDirect(client: CdpClient, title: string, summary: string, body: string, coverImagePath: string | null): Promise<DirectPublishResult> {
    await this.waitForExpression(client, `(() => {
      const leftForm = document.querySelector('.content-left-F3wKrk') || document.body;
      const titleInput = document.querySelector('input[placeholder*="文章标题"]');
      const editor = Array.from(leftForm.querySelectorAll('div.tiptap.ProseMirror[role="textbox"], div.tiptap.ProseMirror'))
        .find(el => {
          const rect = el.getBoundingClientRect();
          return rect.width >= 300 && rect.height >= 120;
        });
      return Boolean(titleInput && editor);
    })()`, 45000, '没有找到抖音文章标题输入框或正文编辑器，请确认当前页面是抖音文章发布页。')

    const fillResult = await this.evaluate<DirectPublishResult>(client, `(() => {
      const title = ${JSON.stringify(title)};
      const summary = ${JSON.stringify(summary)};
      const body = ${JSON.stringify(body)};

      function visible(el) {
        if (!(el instanceof HTMLElement)) return false;
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      }

      function setNativeValue(el, value) {
        const prototype = Object.getPrototypeOf(el);
        const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
        if (descriptor && descriptor.set) descriptor.set.call(el, value);
        else el.value = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }

      function fillEditable(el, value) {
        el.scrollIntoView({ block: 'center', inline: 'nearest' });
        el.focus();
        const range = document.createRange();
        range.selectNodeContents(el);
        const selection = window.getSelection();
        if (selection) {
          selection.removeAllRanges();
          selection.addRange(range);
        }
        let inserted = false;
        try {
          inserted = document.execCommand('insertText', false, value);
        } catch {}
        if (!inserted || !(el.innerText || el.textContent || '').includes(value.slice(0, 20))) {
          el.innerHTML = value
            .split(/\\n{2,}/)
            .map(part => '<p>' + part.replace(/[&<>]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char])) + '</p>')
            .join('');
        }
        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }

      const titleInput = Array.from(document.querySelectorAll('input[placeholder*="文章标题"], input'))
        .filter(visible)
        .find(el => /文章标题/.test(el.getAttribute('placeholder') || ''));
      if (!titleInput) return { ok: false, error: '没有找到抖音文章标题输入框', url: location.href };
      setNativeValue(titleInput, title);

      const summaryInput = Array.from(document.querySelectorAll('input[placeholder*="摘要"], input[placeholder*="精彩"], input'))
        .filter(visible)
        .find(el => /摘要|精彩/.test(el.getAttribute('placeholder') || ''));
      if (summaryInput) setNativeValue(summaryInput, summary);

      const leftForm = document.querySelector('.content-left-F3wKrk') || document.body;
      const editor = Array.from(leftForm.querySelectorAll('div.tiptap.ProseMirror[role="textbox"], div.tiptap.ProseMirror'))
        .filter(visible)
        .find(el => {
          const rect = el.getBoundingClientRect();
          return rect.width >= 300 && rect.height >= 120;
        });
      if (!editor) return { ok: false, error: '没有找到抖音文章正文编辑器', url: location.href, titleFilled: true };
      fillEditable(editor, body);

      const actualBody = (editor.innerText || editor.textContent || '').replace(/\\s+/g, '');
      const expectedBody = body.replace(/\\s+/g, '').slice(0, 24);
      if (expectedBody && !actualBody.includes(expectedBody)) {
        return {
          ok: false,
          error: '抖音文章正文没有成功写入编辑器',
          url: location.href,
          titleFilled: true,
          summaryFilled: Boolean(summaryInput),
          bodyFilled: false
        };
      }

      return {
        ok: true,
        url: location.href,
        titleFilled: true,
        summaryFilled: Boolean(summaryInput),
        bodyFilled: true
      };
    })()`)

    if (!fillResult.ok) return fillResult
    await delay(1200)

    let coverUploaded = false
    if (!coverImagePath) {
      return {
        ...fillResult,
        ok: false,
        error: '抖音文章发布需要封面图。请使用 --cover 指定封面，或在正文中插入至少一张图片。',
        coverUploaded: false,
      }
    }

    if (coverImagePath) {
      await this.uploadImageViaChooser(client, '点击上传图片', coverImagePath, false).catch(() => false)
      coverUploaded = await this.uploadImageViaChooser(client, '点击上传封面图', coverImagePath, true)
      if (!coverUploaded) {
        return {
          ...fillResult,
          ok: false,
          error: '没有成功上传抖音封面图。请确认正文中有可用图片，或使用 --cover 指定封面图。',
          coverUploaded: false,
        }
      }
      await delay(1500)
    }

    const publishTarget = await this.evaluate<DirectPublishResult & { x?: number; y?: number }>(client, `(() => {
      function visible(el) {
        if (!(el instanceof HTMLElement)) return false;
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      }

      const leftForm = document.querySelector('.content-left-F3wKrk') || document.body;
      const button = Array.from(document.querySelectorAll('button, [role="button"]'))
        .filter(el => visible(el) && leftForm.contains(el))
        .find(el => (el.textContent || '').replace(/\\s+/g, '').trim() === '发布');
      if (!button) {
        return {
          ok: false,
          error: '没有找到抖音文章底部“发布”按钮',
          url: location.href,
          titleFilled: true,
          summaryFilled: ${JSON.stringify(fillResult.summaryFilled || false)},
          bodyFilled: true
        };
      }
      button.scrollIntoView({ block: 'center', inline: 'center' });
      const rect = button.getBoundingClientRect();
      return {
        ok: true,
        url: location.href,
        coverUploaded: ${JSON.stringify(coverUploaded)},
        titleFilled: true,
        summaryFilled: ${JSON.stringify(fillResult.summaryFilled || false)},
        bodyFilled: true,
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2)
      };
    })()`)

    if (!publishTarget.ok || typeof publishTarget.x !== 'number' || typeof publishTarget.y !== 'number') return publishTarget
    await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: publishTarget.x, y: publishTarget.y }).catch(() => undefined)
    await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: publishTarget.x, y: publishTarget.y, button: 'left', clickCount: 1 })
    await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: publishTarget.x, y: publishTarget.y, button: 'left', clickCount: 1 })
    const clickResult: DirectPublishResult = {
      ok: true,
      url: publishTarget.url,
      publishClicked: true,
      coverUploaded: publishTarget.coverUploaded,
      titleFilled: publishTarget.titleFilled,
      summaryFilled: publishTarget.summaryFilled,
      bodyFilled: publishTarget.bodyFilled,
    }
    await delay(3500)

    const after = await this.evaluate<{ url: string; toastText: string }>(client, `(() => {
      function visible(el) {
        if (!(el instanceof HTMLElement)) return false;
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      }
      const toastText = Array.from(document.querySelectorAll('.semi-toast, .semi-toast-content, .semi-notification, [class*="toast"], [class*="Toast"], [class*="message"], [class*="Message"]'))
        .filter(visible)
        .map(el => (el.textContent || '').replace(/\\s+/g, ' ').trim())
        .filter(Boolean)
        .join(' ');
      return { url: location.href, toastText };
    })()`).catch(() => ({ url: clickResult.url || ARTICLE_URL, toastText: '' }))

    const validationMatch = after.toastText.match(/(请上传|请选择|不能为空|必填|至少上传|封面|失败|错误)[^。\\n ]*/)
    if (validationMatch) {
      return {
        ...clickResult,
        ok: false,
        url: after.url,
        error: `抖音页面已点击发布，但被页面校验拦截：${validationMatch[0]}`,
      }
    }

    return {
      ...clickResult,
      url: after.url,
      message: after.url.includes('/content/post/article')
        ? '已点击抖音发布按钮，页面仍停留在编辑器；请查看是否需要二次确认。'
        : '已点击抖音发布按钮。',
    }
  }

  private async uploadImageViaChooser(
    client: CdpClient,
    label: string,
    imagePath: string,
    required: boolean
  ): Promise<boolean> {
    await client.send('Page.setInterceptFileChooserDialog', { enabled: true }).catch(() => undefined)
    type UploadTarget =
      | { ok: true; text: string; x: number; y: number }
      | { ok: false; error: string }
    const target = await this.evaluate<UploadTarget>(client, `(() => {
      const label = ${JSON.stringify(label)};
      function visible(el) {
        if (!(el instanceof HTMLElement)) return false;
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      }
      const leftForm = document.querySelector('.content-left-F3wKrk') || document.body;
      const items = Array.from(document.querySelectorAll('button, [role="button"], a, span, div'))
        .filter(el => visible(el) && leftForm.contains(el))
        .map(el => ({
          el,
          text: (el.textContent || el.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim(),
          isButton: el.matches('button, [role="button"], a'),
          area: el.getBoundingClientRect().width * el.getBoundingClientRect().height,
          rect: el.getBoundingClientRect()
        }))
        .filter(item => item.text && item.text.length <= 80);
      const exactMatches = items.filter(item => item.text === label);
      const containsMatches = items.filter(item => item.text.includes(label));
      const uploadMatches = [...exactMatches, ...containsMatches]
        .filter((item, index, list) => list.findIndex(other => other.el === item.el) === index)
        .sort((a, b) => {
          const buttonScore = Number(b.isButton) - Number(a.isButton);
          if (buttonScore) return buttonScore;
          return a.area - b.area;
        });
      const item = uploadMatches[0];
      if (!item) return { ok: false, error: 'upload button not found' };
      const target = item.isButton ? item.el : item.el.closest('button, [role="button"], a') || item.el;
      const rect = target.getBoundingClientRect();
      return {
        ok: true,
        text: item.text,
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2)
      };
    })()`).catch(error => ({ ok: false as const, error: (error as Error).message }))

    if (!target.ok) {
      await client.send('Page.setInterceptFileChooserDialog', { enabled: false }).catch(() => undefined)
      if (required) throw new Error(`${label}: ${target.error}`)
      return false
    }

    const eventPromise = client.waitForEvent<FileChooserOpenedEvent>('Page.fileChooserOpened', 10000)
      .catch(() => null)
    await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: target.x, y: target.y }).catch(() => undefined)
    await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: target.x, y: target.y, button: 'left', clickCount: 1 })
    await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: target.x, y: target.y, button: 'left', clickCount: 1 })

    const chooser = await eventPromise
    const fileInputNodeId = chooser?.nodeId || await this.findFileInputNodeId(client).catch(() => null)
    if (!chooser?.backendNodeId && !fileInputNodeId) {
      await client.send('Page.setInterceptFileChooserDialog', { enabled: false }).catch(() => undefined)
      if (await this.hasUploadedImage(client, label).catch(() => false)) return true
      if (required) throw new Error(`${label}: file chooser did not expose a file input node`)
      return false
    }

    const fileParams: Record<string, unknown> = { files: [imagePath] }
    if (chooser?.backendNodeId) fileParams.backendNodeId = chooser.backendNodeId
    else fileParams.nodeId = fileInputNodeId
    await client.send('DOM.setFileInputFiles', fileParams, 30000)
    await client.send('Page.setInterceptFileChooserDialog', { enabled: false }).catch(() => undefined)
    await delay(1500)
    await this.confirmImageUploadDialog(client).catch(() => undefined)
    await this.waitForImageUploadSettled(client, label).catch(() => undefined)
    return true
  }

  private async hasUploadedImage(client: CdpClient, label: string): Promise<boolean> {
    return this.evaluate<boolean>(client, `(() => {
      const label = ${JSON.stringify(label)};
      function visible(el) {
        if (!(el instanceof HTMLElement)) return false;
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      }

      const leftForm = document.querySelector('.content-left-F3wKrk') || document.body;
      const text = (leftForm.innerText || '').replace(/\\s+/g, ' ');
      const images = Array.from(leftForm.querySelectorAll('img, canvas, [style*="background-image"]'))
        .filter(visible)
        .filter(el => {
          const rect = el.getBoundingClientRect();
          return rect.width >= 20 && rect.height >= 20;
        });

      if (/封面/.test(label)) {
        return /(编辑封面|更换封面|同步头图为封面)/.test(text) && images.length > 0;
      }
      return /(点击替换图片|更换图片|AI换图)/.test(text) && images.length > 0;
    })()`)
  }

  private async findFileInputNodeId(client: CdpClient): Promise<number | null> {
    const root = await client.send<{ root?: { nodeId?: number } }>('DOM.getDocument', {
      depth: -1,
      pierce: true,
    })
    const rootNodeId = root.root?.nodeId
    if (!rootNodeId) return null

    const result = await client.send<{ nodeIds?: number[] }>('DOM.querySelectorAll', {
      nodeId: rootNodeId,
      selector: 'input[type="file"]',
    })
    const nodeIds = result.nodeIds || []
    return nodeIds.length ? nodeIds[nodeIds.length - 1] : null
  }

  private async confirmImageUploadDialog(client: CdpClient): Promise<void> {
    for (let index = 0; index < 4; index += 1) {
      const clicked = await this.evaluate<boolean>(client, `(() => {
        function visible(el) {
          if (!(el instanceof HTMLElement)) return false;
          const style = getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        }

        const modal = Array.from(document.querySelectorAll('[role="dialog"], .semi-modal, [class*="modal"], [class*="Modal"], [class*="crop"], [class*="Crop"]'))
          .filter(visible)
          .find(el => /(裁剪|封面|图片|上传|预览|确定|完成|保存)/.test(el.textContent || ''));
        if (!modal) return false;

        const buttons = Array.from(modal.querySelectorAll('button, [role="button"]'))
          .filter(visible)
          .map(el => ({
            el,
            text: (el.textContent || el.getAttribute('aria-label') || '').replace(/\\s+/g, '').trim()
          }))
          .filter(item => item.text);
        const target = buttons.find(item => /^(确定|完成|保存|应用)$/.test(item.text))
          || buttons.find(item => /(确定|完成|保存|应用)/.test(item.text));
        if (!target) return false;
        target.el.click();
        return true;
      })()`).catch(() => false)

      if (!clicked) return
      await delay(1200)
    }
  }

  private async waitForImageUploadSettled(client: CdpClient, label: string): Promise<void> {
    const start = Date.now()
    while (Date.now() - start < 20000) {
      const state = await this.evaluate<{ uploading: boolean; hasImageHint: boolean; text: string }>(client, `(() => {
        function visible(el) {
          if (!(el instanceof HTMLElement)) return false;
          const style = getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        }

        const text = (document.body?.innerText || '').replace(/\\s+/g, ' ');
        const uploading = /(上传中|处理中|加载中|正在上传)/.test(text);
        const leftForm = document.querySelector('.content-left-F3wKrk') || document.body;
        const imageLike = Array.from(leftForm.querySelectorAll('img, canvas, [style*="background-image"]'))
          .filter(visible)
          .some(el => {
            const rect = el.getBoundingClientRect();
            return rect.width >= 40 && rect.height >= 40;
          });
        const hasImageHint = imageLike || /(重新上传|更换图片|更换封面|删除图片|点击替换图片|编辑封面|同步头图为封面)/.test(text);
        return { uploading, hasImageHint, text: text.slice(0, 500) };
      })()`).catch(() => ({ uploading: false, hasImageHint: false, text: '' }))

      if (!state.uploading && state.hasImageHint) return
      await delay(600)
    }

    logger.warn(`${label}: image upload did not expose a stable preview before timeout.`)
  }

  private async readAccountIdentity(client: CdpClient): Promise<AccountIdentity> {
    return this.evaluate<AccountIdentity>(client, buildAccountIdentityScript())
      .catch(() => ({}))
  }

  private async waitForExpression(
    client: CdpClient,
    expression: string,
    timeoutMs: number,
    timeoutMessage?: string
  ): Promise<void> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      const result = await this.evaluate<boolean>(client, `Boolean(${expression})`)
      if (result) return
      await delay(400)
    }
    throw new Error(timeoutMessage || `Timed out waiting for Douyin page condition: ${expression}`)
  }

  private async evaluate<T>(client: CdpClient, expression: string): Promise<T> {
    const result = await client.send<RuntimeEvaluateResult<T>>('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })

    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Douyin page evaluation failed.')
    }

    return result.result?.value as T
  }
}
