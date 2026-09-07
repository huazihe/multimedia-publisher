/**
 * 豆瓣适配器
 */
import { CodeAdapter, type ImageUploadResult } from '../code-adapter'
import type { Article, AuthResult, Cookie, SyncResult, PlatformMeta } from '../../types'
import type { DoubanImageData } from '../../lib'
import type { PublishOptions } from '../types'
import { markdownToDraft } from '../../lib'
import { connectCdpPage, delay, resolveEnvPort, type CdpClient } from '../../lib/cdp'
import { buildAccountIdentityScript, type AccountIdentity } from '../../lib/account-identity'
import { createLogger } from '../../lib/logger'

const logger = createLogger('Douban')
const CREATE_URL = 'https://www.douban.com/topic/create?subtype=note'

interface DoubanFormData {
  note_id: string
  ck: string
}

interface DoubanPostParams {
  siteCookie: {
    value: string
  }
}

interface CdpCookie {
  name: string
  domain: string
}

interface FillResult {
  ok: boolean
  error?: string
  url?: string
}

function domainMatches(cookieDomain: string, targetDomain: string): boolean {
  const cookie = cookieDomain.replace(/^\./, '').toLowerCase()
  const target = targetDomain.replace(/^\./, '').toLowerCase()
  return cookie === target || cookie.endsWith(`.${target}`)
}

function isDoubanLoginCookie(cookie: CdpCookie): boolean {
  return domainMatches(cookie.domain, 'douban.com') && /^(dbcl2|ck)$/i.test(cookie.name)
}

export class DoubanAdapter extends CodeAdapter {
  readonly meta: PlatformMeta = {
    id: 'douban',
    name: '豆瓣',
    icon: 'https://www.douban.com/favicon.ico',
    homepage: CREATE_URL,
    capabilities: ['article', 'draft', 'image_upload'],
  }

  /** 预处理配置: 豆瓣使用 Markdown 格式 (转换为 Draft.js) */
  readonly preprocessConfig = {
    outputFormat: 'markdown' as const,
  }

  private username: string = ''
  private avatar: string = ''
  private formData: DoubanFormData | null = null
  private postParams: DoubanPostParams | null = null

  /** 豆瓣 API 需要的 Header 规则 */
  private readonly HEADER_RULES = [
    {
      urlFilter: '*://www.douban.com/*',
      headers: {
        'Origin': 'https://www.douban.com',
        'Referer': 'https://www.douban.com',
      },
      resourceTypes: ['xmlhttprequest'],
    },
  ]

  async checkAuth(): Promise<AuthResult> {
    const port = this.runtime.type === 'node' ? this.resolveCdpPort() : null
    if (port) {
      const cdpAuth = await this.checkAuthViaCdp(port)
      if (cdpAuth.isAuthenticated || cdpAuth.error) return cdpAuth
    }

    try {
      const response = await this.runtime.fetch(
        'https://www.douban.com/note/create',
        {
          method: 'GET',
          credentials: 'include',
        }
      )

      const html = await response.text()

      // 解析页面中的 JavaScript 变量
      const userNameMatch = html.match(/_USER_NAME\s*=\s*['"]([^'"]+)['"]/)
      const userAvatarMatch = html.match(/_USER_AVATAR\s*=\s*['"]([^'"]+)['"]/)
      const noteIdMatch = html.match(/name="note_id"\s+value="(\d+)"/)
      const ckMatch = html.match(/name="ck"\s+value="([^"]+)"/)

      // 解析 _POST_PARAMS
      const postParamsMatch = html.match(/_POST_PARAMS\s*=\s*(\{[\s\S]*?\});/)

      if (!userNameMatch || !noteIdMatch || !ckMatch) {
        const loginByCookieAfterFetch = (await this.runtime.cookies.get('douban.com').catch(() => []))
          .some(cookie => isDoubanLoginCookie(cookie) && cookie.name === 'dbcl2')
        return {
          isAuthenticated: false,
          error: loginByCookieAfterFetch
            ? '豆瓣 Cookie 已导出，但没有拿到写日记页 ck/note_id。请在“平台登录”里打开豆瓣写日记页，确认能看到编辑器后再点完成登录。'
            : '请先登录豆瓣',
        }
      }

      this.username = userNameMatch[1]
      this.avatar = userAvatarMatch ? userAvatarMatch[1] : ''
      this.formData = {
        note_id: noteIdMatch[1],
        ck: ckMatch[1],
      }

      // 解析 _POST_PARAMS 获取 upload_auth_token
      if (postParamsMatch) {
        try {
          // 简化解析，只提取 siteCookie.value
          const siteCookieMatch = postParamsMatch[1].match(/siteCookie[^}]*value\s*:\s*['"]([^'"]+)['"]/)
          if (siteCookieMatch) {
            this.postParams = {
              siteCookie: { value: siteCookieMatch[1] }
            }
          }
        } catch (e) {
          logger.warn('Failed to parse _POST_PARAMS:', e)
        }
      }

      logger.debug('Auth info:', {
        username: this.username,
        noteId: this.formData.note_id,
        hasPostParams: !!this.postParams,
      })

      return {
        isAuthenticated: true,
        userId: this.username,
        username: this.username,
        avatar: this.avatar,
      }
    } catch (error) {
      logger.debug('checkAuth: not logged in -', error)
      return { isAuthenticated: false, error: (error as Error).message }
    }
  }

  private async checkAuthViaCdp(port: number): Promise<AuthResult> {
    let client: CdpClient | null = null
    try {
      client = await connectCdpPage(port, CREATE_URL, 'douban.com')
      await this.hydrateRuntimeCookies(client)
      await client.navigate(CREATE_URL, 30000)
      await delay(2500)

      await client.send('Network.enable').catch(() => undefined)
      const cookieResult = await client.send<{ cookies?: CdpCookie[] }>('Network.getAllCookies')
        .catch(() => client!.send<{ cookies?: CdpCookie[] }>('Storage.getCookies'))
        .catch(() => ({ cookies: [] }))
      const hasLoginCookie = (cookieResult.cookies || []).some(cookie => isDoubanLoginCookie(cookie))

      const state = await client.evaluate<{ url: string; username: string; hasEditor: boolean; hasPassword: boolean; text: string }>(`(() => {
        const visible = el => {
          if (!(el instanceof HTMLElement)) return false;
          const style = getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          return style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            (rect.width > 0 && rect.height > 0 || el.getAttribute('contenteditable') === 'true');
        };
        const text = document.body?.innerText || '';
        const hasPassword = Array.from(document.querySelectorAll('input[type="password"]')).some(visible);
        const editable = Array.from(document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]'))
          .filter(visible);
        const titleLike = Array.from(document.querySelectorAll('input, textarea, [contenteditable="true"], [role="textbox"]'))
          .some(el => visible(el) && /标题|title|正文|内容|content|editor|body/i.test([
            el.getAttribute('placeholder'),
            el.getAttribute('aria-label'),
            el.id,
            el.className
          ].filter(Boolean).join(' ')));
        const username = String(window._USER_NAME || document.querySelector('[data-user-name]')?.getAttribute('data-user-name') || '');
        return {
          url: location.href,
          username,
          hasEditor: !hasPassword && (editable.length > 0 || titleLike),
          hasPassword,
          text: text.slice(0, 1200),
        };
      })()`, 10000)

      if (/accounts\.douban\.com|login|passport/i.test(state.url) || state.hasPassword) {
        return { isAuthenticated: false, error: '豆瓣写日记页仍在登录页，请在平台登录窗口完成登录后再点完成登录。' }
      }
      if (state.hasEditor) {
        const identity = await this.readAccountIdentity(client)
        return {
          isAuthenticated: true,
          username: state.username || identity.username || identity.userId || undefined,
          userId: identity.userId,
          avatar: identity.avatar,
        }
      }
      return {
        isAuthenticated: false,
        error: hasLoginCookie
          ? '豆瓣 Cookie 已存在，但写日记页没有出现编辑器。请打开豆瓣写日记页，确认可编辑后再检查。'
          : '豆瓣 CDP 浏览器会话未登录。',
      }
    } catch (error) {
      return { isAuthenticated: false, error: (error as Error).message }
    } finally {
      client?.close()
    }
  }

  private async hydrateRuntimeCookies(client: CdpClient): Promise<void> {
    await client.send('Network.enable').catch(() => undefined)
    const now = Math.floor(Date.now() / 1000)
    const cookies = await this.runtime.cookies.get('douban.com').catch(() => [] as Cookie[])
    const seen = new Set<string>()
    for (const cookie of cookies) {
      if (!cookie.name || cookie.value == null) continue
      if (cookie.expirationDate && cookie.expirationDate <= now) continue
      const key = `${cookie.domain}|${cookie.path || '/'}|${cookie.name}`
      if (seen.has(key)) continue
      seen.add(key)
      const domain = (cookie.domain || 'douban.com').replace(/^\./, '')
      const path = cookie.path || '/'
      await client.send('Network.setCookie', {
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain || domain,
        path,
        secure: Boolean(cookie.secure),
        httpOnly: Boolean(cookie.httpOnly),
        expires: cookie.expirationDate,
        url: `${cookie.secure ? 'https' : 'https'}://${domain}${path.startsWith('/') ? path : `/${path}`}`,
      }).catch(() => undefined)
    }
  }

  private async readAccountIdentity(client: CdpClient): Promise<AccountIdentity> {
    return client.evaluate<AccountIdentity>(buildAccountIdentityScript(), 8000)
      .catch(() => ({}))
  }

  async publish(article: Article, options?: PublishOptions): Promise<SyncResult> {
    if (this.runtime.type === 'node') {
      const port = this.resolveCdpPort()
      if (port) return this.publishViaCdp(port, article)
    }

    return this.withHeaderRules(this.HEADER_RULES, async () => {
      logger.info('Starting publish...')

      // 1. 确保已登录
      if (!this.formData) {
        const auth = await this.checkAuth()
        if (!auth.isAuthenticated) {
          throw new Error('请先登录豆瓣')
        }
      }
      if (!this.formData?.note_id || !this.formData.ck) {
        throw new Error('豆瓣已切换到新版写作页。请在“平台登录”里重新登录豆瓣后再发布。')
      }

      // Use pre-processed markdown content directly
      let content = article.markdown || ''

      // Process images - collect full image data
      const imageDataMap = new Map<string, DoubanImageData>()
      content = await this.processImages(
        content,
        async (src) => {
          const result = await this.uploadImageWithFullData(src)
          // 保存完整图片数据，用 newUrl 作为 key
          imageDataMap.set(result.url, result.imageData)
          return result
        },
        {
          skipPatterns: ['doubanio.com', 'douban.com'],
          onProgress: options?.onImageProgress,
        }
      )

      // Markdown to Draft.js format (pass in image data)
      const draftContent = markdownToDraft(content, imageDataMap)

      // 6. 保存草稿
      const response = await this.runtime.fetch(
        'https://www.douban.com/j/note/autosave',
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            is_rich: '1',
            note_id: this.formData!.note_id,
            note_title: article.title,
            note_text: draftContent,
            introduction: '',
            note_privacy: 'P',
            cannot_reply: '',
            author_tags: '',
            accept_donation: '',
            donation_notice: '',
            is_original: '',
            ck: this.formData!.ck,
          }),
        }
      )

      const res = await response.json() as { url?: string; r?: number }
      logger.debug('Save response:', res)

      // 豆瓣草稿只能在 /note/create 页面查看
      const draftUrl = 'https://www.douban.com/note/create'

      return this.createResult(true, {
        postId: this.formData!.note_id,
        postUrl: draftUrl,
        draftOnly: options?.draftOnly ?? true,
      })
    }).catch((error) => this.createResult(false, {
      error: (error as Error).message,
    }))
  }

  private resolveCdpPort(): number | null {
    return resolveEnvPort(['CREATOR_DOUBAN_CDP_PORT', 'DOUBAN_CDP_PORT'], 'Douban')
  }

  private normalizeBody(article: Article): string {
    return (article.markdown || article.html || '')
      .replace(/^#\s+.+\r?\n+/, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
      .replace(/<[^>]+>/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }

  private async publishViaCdp(port: number, article: Article): Promise<SyncResult> {
    const title = article.title.trim()
    const body = this.normalizeBody(article)
    if (!title || !body) {
      return this.createResult(false, { error: '文章标题或正文为空。' })
    }

    let client: CdpClient | null = null
    try {
      client = await connectCdpPage(port, CREATE_URL, 'douban.com')
      await this.hydrateRuntimeCookies(client)
      await client.navigate(CREATE_URL, 30000)
      await delay(5000)

      const result = await this.fillNewEditor(client, title, body)
      if (!result.ok) throw new Error(result.error || '豆瓣新版写作页填充失败')

      return this.createResult(true, {
        postId: title,
        postUrl: result.url || CREATE_URL,
        draftOnly: true,
        message: '已在豆瓣写作页填入标题和正文，请在浏览器中人工确认发布。',
      })
    } catch (error) {
      return this.createResult(false, { error: (error as Error).message })
    } finally {
      client?.close()
    }
  }

  private async fillNewEditor(client: CdpClient, title: string, body: string): Promise<FillResult> {
    await client.waitForExpression(`(() => {
      const text = document.body?.innerText || '';
      if (/加载中/.test(text) && !document.querySelector('input, textarea, [contenteditable="true"], [role="textbox"]')) return false;
      return Boolean(document.querySelector('input, textarea, [contenteditable="true"], [role="textbox"]'));
    })()`, 20000).catch(() => undefined)

    const prepare = await client.evaluate<FillResult>(`(async () => {
      const title = ${JSON.stringify(title)};
      const body = ${JSON.stringify(body)};

      function visible(el) {
        if (!(el instanceof HTMLElement)) return false;
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          (rect.width > 0 && rect.height > 0 || el.getAttribute('contenteditable') === 'true');
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
        try {
          const doc = el.ownerDocument;
          doc.execCommand('selectAll', false);
          if (doc.execCommand('insertText', false, value)) {
            el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
            return;
          }
        } catch {}
        el.innerHTML = value
          .split(/\\n{2,}/)
          .map(part => '<p>' + part.replace(/[&<>]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char])).replace(/\\n/g, '<br>') + '</p>')
          .join('');
        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }

      function textOf(el) {
        if (!el) return '';
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.value || '';
        return el.innerText || el.textContent || '';
      }

      const loading = /加载中/.test(document.body?.innerText || '');
      const controls = Array.from(document.querySelectorAll('input, textarea, [contenteditable="true"], [role="textbox"]')).filter(visible);
      if (!controls.length) {
        return {
          ok: false,
          url: location.href,
          error: loading
            ? '豆瓣新版写作页一直停在“加载中”。请在平台登录里重新登录豆瓣，确认写日记页可以正常打开后再发布。'
            : '没有找到豆瓣新版写作页输入框。'
        };
      }

      const titleInput = controls.find(el => /标题|title/i.test((el.getAttribute('placeholder') || '') + ' ' + (el.getAttribute('aria-label') || '') + ' ' + el.id + ' ' + el.className))
        || controls.find(el => el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)
        || controls[0];
      if (!titleInput) return { ok: false, url: location.href, error: '没有找到豆瓣标题输入框。' };

      if (titleInput instanceof HTMLInputElement || titleInput instanceof HTMLTextAreaElement) setNativeValue(titleInput, title);
      else fillEditable(titleInput, title);

      const explicitEditor = document.querySelector('.DRE-inputor[contenteditable="true"], [contenteditable="true"][role="textbox"]');
      const editors = controls
        .filter(el => el !== titleInput)
        .map(el => {
          const rect = el.getBoundingClientRect();
          const hint = ((el.getAttribute('placeholder') || '') + ' ' + (el.getAttribute('aria-label') || '') + ' ' + el.id + ' ' + el.className).toLowerCase();
          let score = rect.width * rect.height / 10000;
          if (el.getAttribute('contenteditable') === 'true' || el.getAttribute('role') === 'textbox') score += 50;
          if (/正文|内容|content|editor|body/.test(hint)) score += 40;
          if (el instanceof HTMLTextAreaElement) score += 20;
          return { el, score };
        })
        .sort((a, b) => b.score - a.score);
      const editor = explicitEditor || editors[0]?.el;
      if (!editor) return { ok: false, url: location.href, error: '没有找到豆瓣正文编辑器。', };

      if (editor instanceof HTMLElement) {
        editor.scrollIntoView({ block: 'center', inline: 'nearest' });
        editor.focus();
      }

      await new Promise(resolve => setTimeout(resolve, 700));

      const expected = '';
      const actual = textOf(editor).replace(/\\s+/g, '');
      const pageActual = (document.body?.innerText || '').replace(/\\s+/g, '');
      if (expected && !actual.includes(expected) && !pageActual.includes(expected)) {
        return { ok: false, url: location.href, error: '豆瓣正文没有成功写入编辑器。' };
      }

      return { ok: true, url: location.href };
    })()`, 20000)

    if (!prepare.ok) return prepare

    const focusResult = await client.evaluate<FillResult>(`(() => {
      const editor = document.querySelector('.DRE-inputor[contenteditable="true"], [contenteditable="true"][role="textbox"], [contenteditable="true"]');
      if (!(editor instanceof HTMLElement)) {
        return { ok: false, url: location.href, error: '没有找到豆瓣正文编辑器。' };
      }
      editor.scrollIntoView({ block: 'center', inline: 'nearest' });
      editor.focus();
      const selection = window.getSelection();
      if (selection) {
        const range = document.createRange();
        range.selectNodeContents(editor);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      document.execCommand('delete', false);
      editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
      return { ok: true, url: location.href };
    })()`, 20000)
    if (!focusResult.ok) return focusResult

    await client.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'a',
      code: 'KeyA',
      windowsVirtualKeyCode: 65,
      nativeVirtualKeyCode: 65,
      modifiers: 2,
    })
    await client.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'a',
      code: 'KeyA',
      windowsVirtualKeyCode: 65,
      nativeVirtualKeyCode: 65,
      modifiers: 2,
    })
    await client.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Backspace',
      code: 'Backspace',
      windowsVirtualKeyCode: 8,
      nativeVirtualKeyCode: 8,
    })
    await client.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Backspace',
      code: 'Backspace',
      windowsVirtualKeyCode: 8,
      nativeVirtualKeyCode: 8,
    })
    await delay(500)

    await client.insertText(body, 30000)
    await client.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Tab',
      code: 'Tab',
      windowsVirtualKeyCode: 9,
      nativeVirtualKeyCode: 9,
    }).catch(() => undefined)
    await client.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Tab',
      code: 'Tab',
      windowsVirtualKeyCode: 9,
      nativeVirtualKeyCode: 9,
    }).catch(() => undefined)
    await delay(1000)
    await client.evaluate(`(() => {
      const saveButton = document.querySelector('.DRE-topic-editor-draft-save, [title="保存草稿"]');
      if (saveButton instanceof HTMLElement) saveButton.click();
      return true;
    })()`, 10000).catch(() => undefined)
    await delay(8000)

    return client.evaluate<FillResult>(`(() => {
      const body = ${JSON.stringify(body)};
      const editor = document.querySelector('.DRE-inputor[contenteditable="true"], [contenteditable="true"][role="textbox"], [contenteditable="true"]');
      const expected = body.replace(/\\s+/g, '').slice(0, 20);
      const actual = ((editor && (editor.innerText || editor.textContent)) || '').replace(/\\s+/g, '');
      const pageActual = (document.body?.innerText || '').replace(/\\s+/g, '');
      if (expected && !actual.includes(expected) && !pageActual.includes(expected)) {
        return { ok: false, url: location.href, error: '豆瓣正文没有成功写入编辑器。' };
      }
      return { ok: true, url: location.href };
    })()`, 20000)
  }

  /**
   * 上传图片并返回完整数据
   */
  private async uploadImageWithFullData(src: string): Promise<ImageUploadResult & { imageData: DoubanImageData }> {
    if (!this.formData || !this.postParams) {
      throw new Error('未获取上传凭证')
    }

    // 1. 下载图片
    const imageResponse = await fetch(src)
    if (!imageResponse.ok) {
      throw new Error('图片下载失败: ' + src)
    }
    const imageBlob = await imageResponse.blob()

    // 2. 上传到豆瓣
    const formData = new FormData()
    formData.append('note_id', this.formData.note_id)
    formData.append('image_file', imageBlob, 'image.jpg')
    formData.append('ck', this.formData.ck)
    formData.append('upload_auth_token', this.postParams.siteCookie.value)

    const uploadResponse = await this.runtime.fetch(
      'https://www.douban.com/j/note/add_photo',
      {
        method: 'POST',
        credentials: 'include',
        body: formData,
      }
    )

    const res = await uploadResponse.json() as {
      photo?: {
        id: string
        url: string
        thumb: string
        width: number
        height: number
        file_name: string
        file_size: number
      }
    }

    logger.debug('Image upload response:', res)

    if (!res.photo?.url) {
      throw new Error('图片上传失败')
    }

    const photo = res.photo

    // 返回带完整图片数据
    return {
      url: photo.url,
      imageData: {
        id: photo.id,
        url: photo.url,
        thumb: photo.thumb,
        width: photo.width,
        height: photo.height,
        file_name: photo.file_name,
        file_size: photo.file_size,
      }
    }
  }
}
