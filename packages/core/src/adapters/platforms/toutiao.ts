import { CodeAdapter } from '../code-adapter'
import type { Article, AuthResult, PlatformMeta, SyncResult } from '../../types'
import type { PublishOptions } from '../types'
import { connectCdpPage, delay, resolveEnvPort, type CdpClient } from '../../lib/cdp'
import { buildAccountIdentityScript, type AccountIdentity } from '../../lib/account-identity'
import { parseMarkdownImages } from '../../lib/markdown-images'
import { createLogger } from '../../lib/logger'
import fs from 'fs'
import os from 'os'
import path from 'path'

const logger = createLogger('Toutiao')

const HOME_URL = 'https://mp.toutiao.com/profile_v4/manage/content/all'
const PUBLISH_URL = 'https://mp.toutiao.com/profile_v4/graphic/publish'

interface FillResult {
  ok: boolean
  error?: string
  url?: string
  titleFilled?: boolean
  contentFilled?: boolean
  draftClicked?: boolean
  publishedClicked?: boolean
  needsInsertText?: boolean
  editorX?: number
  editorY?: number
  clickX?: number
  clickY?: number
  message?: string
}

interface ToutiaoNetworkRecord {
  type: 'fetch' | 'xhr'
  url: string
  status?: number
  body?: string
  error?: string
  time?: number
}

interface PublishCheckResult {
  ok: boolean
  error?: string
  message?: string
  url?: string
}

interface FileChooserOpenedEvent {
  backendNodeId?: number
  nodeId?: number
}

type PointResult =
  | { ok: true; x: number; y: number }
  | { ok: false; error?: string }

interface CdpCookie {
  name: string
  domain: string
}

function domainMatches(cookieDomain: string, targetDomain: string): boolean {
  const cookie = cookieDomain.replace(/^\./, '').toLowerCase()
  const target = targetDomain.replace(/^\./, '').toLowerCase()
  return cookie === target || cookie.endsWith(`.${target}`)
}

function isToutiaoLoginCookie(cookie: CdpCookie): boolean {
  return domainMatches(cookie.domain, 'toutiao.com')
    && /toutiao_sso_user|sessionid|sid_guard|uid_tt|sso_uid_tt|passport_csrf_token/i.test(cookie.name)
}

function normalizeBody(article: Article): string {
  return (article.markdown || article.html || '')
    .replace(/^\s*#\s+.+\r?\n+/, '')
    .replace(/!\[[^\]]*]\([^)]+\)/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function collectImageSources(article: Article): string[] {
  const seen = new Set<string>()
  const sources: string[] = []
  const add = (src?: string) => {
    const value = src?.trim()
    if (!value || seen.has(value)) return
    if (!value.startsWith('http://') && !value.startsWith('https://') && !value.startsWith('data:')) return
    seen.add(value)
    sources.push(value)
  }

  add(article.cover)
  for (const match of parseMarkdownImages(article.markdown || '')) add(match.src)

  const html = article.html || ''
  const htmlImgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi
  let match
  while ((match = htmlImgRegex.exec(html)) !== null) add(match[1])

  return sources
}

function imageExtension(source: string, contentType?: string | null): string {
  if (contentType?.includes('png') || /^data:image\/png/i.test(source)) return '.png'
  if (contentType?.includes('webp') || /^data:image\/webp/i.test(source)) return '.webp'
  if (contentType?.includes('gif') || /^data:image\/gif/i.test(source)) return '.gif'
  if (contentType?.includes('jpeg') || contentType?.includes('jpg') || /^data:image\/jpe?g/i.test(source)) return '.jpg'
  return '.png'
}

async function writeTempImages(sources: string[]): Promise<string[]> {
  if (!sources.length) return []
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'weibot-toutiao-'))
  const files: string[] = []

  for (let index = 0; index < sources.length; index += 1) {
    const source = sources[index]
    let buffer: Buffer
    let contentType: string | null = null
    if (source.startsWith('data:')) {
      const match = source.match(/^data:([^;,]+);base64,(.+)$/)
      if (!match) continue
      contentType = match[1]
      buffer = Buffer.from(match[2], 'base64')
    } else {
      const response = await fetch(source)
      if (!response.ok) continue
      contentType = response.headers.get('content-type')
      buffer = Buffer.from(await response.arrayBuffer())
    }

    const filePath = path.join(dir, `image-${index + 1}${imageExtension(source, contentType)}`)
    await fs.promises.writeFile(filePath, buffer)
    files.push(filePath)
  }

  return files
}

function resolveCdpPort(): number | null {
  return resolveEnvPort(
    ['WEIBOT_TOUTIAO_CDP_PORT', 'TOUTIAO_CDP_PORT'],
    'Toutiao'
  )
}

export class ToutiaoAdapter extends CodeAdapter {
  readonly meta: PlatformMeta = {
    id: 'toutiao',
    name: '今日头条',
    icon: 'https://sf3-cdn-tos.douyinstatic.com/obj/eden-cn/pipieh7nupabozups/toutiao_web_pc/favicon.ico',
    homepage: 'https://mp.toutiao.com',
    capabilities: ['article', 'draft'],
  }

  readonly preprocessConfig = {
    outputFormat: 'markdown' as const,
  }

  async checkAuth(): Promise<AuthResult> {
    if (this.runtime.type !== 'node') {
      return {
        isAuthenticated: false,
        error: '今日头条独立发布需要 Node runtime 和 Chrome CDP。',
      }
    }

    const port = resolveCdpPort()
    if (port) return this.checkAuthViaCdp(port)

    const runtimeCookies = await this.runtime.cookies.get('toutiao.com').catch(() => [])
    if (runtimeCookies.some(isToutiaoLoginCookie)) {
      return { isAuthenticated: true }
    }

    return {
      isAuthenticated: false,
      error: '请先运行 weibot login toutiao，或设置 WEIBOT_TOUTIAO_CDP_PORT。',
    }
  }

  async publish(article: Article, options?: PublishOptions): Promise<SyncResult> {
    if (this.runtime.type !== 'node') {
      return this.createResult(false, {
        error: '今日头条独立发布需要 Node runtime 和登录浏览器会话。',
      })
    }

    const port = resolveCdpPort()
    if (!port) {
      return this.createResult(false, {
        error: '请先运行 weibot login toutiao，或设置 WEIBOT_TOUTIAO_CDP_PORT。',
      })
    }

    const title = article.title.trim()
    const body = normalizeBody(article)
    const imageSources = collectImageSources(article)
    if (!title || !body) {
      return this.createResult(false, { error: '文章标题或正文为空。' })
    }

    let client: CdpClient | null = null
    let tempImagePaths: string[] = []
    try {
      tempImagePaths = await writeTempImages(imageSources.slice(0, 1))
      client = await connectCdpPage(port, PUBLISH_URL, 'mp.toutiao.com')
      await client.navigate(PUBLISH_URL, 30000)
      await delay(2000)

      const auth = await this.readPageLoginState(client)
      if (!auth.isAuthenticated) {
        throw new Error(auth.error || '今日头条登录态无效，请重新登录。')
      }

      const directMode = options?.publishMode === 'direct'
      const result = await this.fillAndSubmit(client, title, body, directMode, tempImagePaths)
      if (!result.ok) throw new Error(result.error || (directMode ? '今日头条直接发布失败' : '保存今日头条草稿失败'))

      logger.info(`${directMode ? 'Publish submitted' : 'Draft prepared'}: ${title}`)
      return this.createResult(true, {
        postId: title,
        postUrl: result.url || PUBLISH_URL,
        draftOnly: !directMode,
        message: directMode
          ? (result.message || '今日头条已提交发布。')
          : '已在今日头条发布页保存草稿，请在头条号后台确认后发布。',
      })
    } catch (error) {
      return this.createResult(false, {
        error: (error as Error).message,
      })
    } finally {
      client?.close()
      await Promise.all(tempImagePaths.map(file => fs.promises.unlink(file).catch(() => undefined)))
    }
  }

  private async checkAuthViaCdp(port: number): Promise<AuthResult> {
    let client: CdpClient | null = null
    try {
      client = await connectCdpPage(port, HOME_URL, 'mp.toutiao.com')
      await client.navigate(HOME_URL, 30000).catch(() => undefined)
      return this.readPageLoginState(client)
    } catch (error) {
      return { isAuthenticated: false, error: (error as Error).message }
    } finally {
      client?.close()
    }
  }

  private async hasCdpLoginCookie(client: CdpClient): Promise<boolean> {
    await client.send('Network.enable').catch(() => undefined)
    const cookies = await client.send<{ cookies?: CdpCookie[] }>('Network.getAllCookies')
      .catch(() => client.send<{ cookies?: CdpCookie[] }>('Storage.getCookies'))
      .catch(() => ({ cookies: [] }))
    return (cookies.cookies || []).some(isToutiaoLoginCookie)
  }

  private async readPageLoginState(client: CdpClient): Promise<AuthResult> {
    const hasCdpCookie = await this.hasCdpLoginCookie(client)

    const runtimeCookies = await this.runtime.cookies.get('toutiao.com').catch(() => [])
    const hasRuntimeCookie = runtimeCookies.some(isToutiaoLoginCookie)

    const state = await client.evaluate<{ url: string; text: string }>(`(() => ({
      url: location.href,
      text: document.body?.innerText?.slice(0, 2000) || ''
    }))()`, 5000).catch(() => ({ url: '', text: '' }))

    if (hasCdpCookie || hasRuntimeCookie || /mp\.toutiao\.com\/profile_v4\/(?:manage|graphic|article|content|home)/i.test(state.url)) {
      const identity = await this.readAccountIdentity(client)
      return {
        isAuthenticated: true,
        username: identity.username || identity.userId,
        userId: identity.userId,
        avatar: identity.avatar,
      }
    }

    if (/login|sso/.test(state.url) || /登录|扫码登录|验证码/.test(state.text.slice(0, 500))) {
      return { isAuthenticated: false, error: '当前头条号浏览器会话未登录。' }
    }

    return { isAuthenticated: false, error: '没有读取到今日头条登录 Cookie，请在平台登录里重新登录今日头条。' }
  }

  private async readAccountIdentity(client: CdpClient): Promise<AccountIdentity> {
    return client.evaluate<AccountIdentity>(buildAccountIdentityScript(), 8000)
      .catch(() => ({}))
  }

  private async fillAndSubmit(client: CdpClient, title: string, body: string, directMode: boolean, imagePaths: string[]): Promise<FillResult> {
    await client.waitForExpression(`(() => {
      const visible = (el) => {
        if (!(el instanceof HTMLElement)) return false;
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };
      const hasTitle = Array.from(document.querySelectorAll('input, textarea')).some(el =>
        visible(el) && /标题|请输入文章标题|请输入标题|填写标题/.test((el.getAttribute('placeholder') || '') + (el.getAttribute('aria-label') || ''))
      );
      const hasEditor = Array.from(document.querySelectorAll('.ProseMirror[contenteditable="true"], .ProseMirror, [contenteditable="true"], .DraftEditor-root')).some(el => {
        if (!visible(el)) return false;
        const rect = el.getBoundingClientRect();
        return rect.width >= 300 && rect.height >= 100;
      });
      return hasTitle && hasEditor;
    })()`, 30000)

    const prepareResult = await client.evaluate<FillResult>(`(() => {
      const title = ${JSON.stringify(title)};
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

      function focusEditable(el) {
        el.scrollIntoView({ block: 'center', inline: 'nearest' });
        el.focus();
        const range = document.createRange();
        range.selectNodeContents(el);
        const selection = window.getSelection();
        if (selection) {
          selection.removeAllRanges();
          selection.addRange(range);
        }
      }

      function textHint(el) {
        const own = [
          el.getAttribute('placeholder') || '',
          el.getAttribute('aria-label') || '',
          typeof el.className === 'string' ? el.className : '',
          el.textContent || ''
        ].join(' ');
        const parent = el.parentElement
          ? [
              el.parentElement.getAttribute('aria-label') || '',
              typeof el.parentElement.className === 'string' ? el.parentElement.className : '',
              el.parentElement.textContent || ''
            ].join(' ')
          : '';
        return (own + ' ' + parent).slice(0, 1200);
      }

      function findMainEditor(excluded) {
        const candidates = Array.from(document.querySelectorAll('.ProseMirror[contenteditable="true"], .ProseMirror, [contenteditable="true"], .DraftEditor-root'))
          .filter(el => {
            if (!visible(el) || el === excluded) return false;
            if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return false;
            const rect = el.getBoundingClientRect();
            if (rect.width < 300 || rect.height < 100) return false;
            const hint = textHint(el);
            const looksLikeAssistant = /创作助手|AI助手|智能助手|对话|请输入你的问题|问我|帮你写/.test(hint) && rect.width < 520;
            return !looksLikeAssistant;
          })
          .map(el => {
            const rect = el.getBoundingClientRect();
            const hint = textHint(el);
            let score = rect.width * rect.height / 10000;
            if (el.classList.contains('ProseMirror')) score += 100;
            if (el.getAttribute('contenteditable') === 'true') score += 40;
            if (/正文|内容|请输入正文/.test(hint)) score += 30;
            if (rect.left < window.innerWidth * 0.7) score += 10;
            if (/创作助手|AI助手|智能助手|对话/.test(hint)) score -= 80;
            return { el, score };
          })
          .sort((a, b) => b.score - a.score);
        return candidates[0]?.el || null;
      }

      const controls = Array.from(document.querySelectorAll('input, textarea')).filter(visible);
      const titleInput = controls.find(el => /标题|请输入文章标题|请输入标题|填写标题/.test((el.getAttribute('placeholder') || '') + (el.getAttribute('aria-label') || '')))
        || controls.find(el => el.tagName === 'TEXTAREA')
        || controls[0];
      if (!titleInput) return { ok: false, error: '没有找到今日头条标题输入框', url: location.href };
      setNativeValue(titleInput, title);

      const contentEditor = findMainEditor(titleInput);
      if (!contentEditor) return { ok: false, error: '没有找到今日头条正文编辑器', url: location.href, titleFilled: true };

      if (contentEditor instanceof HTMLTextAreaElement || contentEditor instanceof HTMLInputElement) {
        setNativeValue(contentEditor, body);
        return {
          ok: true,
          url: location.href,
          titleFilled: true,
          contentFilled: true,
          needsInsertText: false
        };
      } else {
        focusEditable(contentEditor);
        const rect = contentEditor.getBoundingClientRect();
        const editorX = Math.round(rect.left + Math.min(Math.max(rect.width * 0.12, 40), Math.max(rect.width - 24, 40)));
        const editorY = Math.round(rect.top + Math.min(Math.max(rect.height * 0.12, 40), Math.max(rect.height - 24, 40)));
        let inserted = false;
        try {
          inserted = document.execCommand('insertText', false, body);
        } catch {}
        contentEditor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: body }));
        contentEditor.dispatchEvent(new Event('change', { bubbles: true }));
        const actual = (contentEditor.innerText || contentEditor.textContent || '').replace(/\\s+/g, '');
        const expected = body.replace(/\\s+/g, '').slice(0, 20);
        if (inserted && (!expected || actual.includes(expected))) {
          return {
            ok: true,
            url: location.href,
            titleFilled: true,
            contentFilled: true,
            needsInsertText: false,
            editorX,
            editorY
          };
        }
        return {
          ok: true,
          url: location.href,
          titleFilled: true,
          contentFilled: false,
          needsInsertText: true,
          editorX,
          editorY
        };
      }
    })()`, 20000)

    if (!prepareResult.ok) return prepareResult
    if (prepareResult.needsInsertText) {
      if (typeof prepareResult.editorX === 'number' && typeof prepareResult.editorY === 'number') {
        await this.clickPagePoint(client, prepareResult.editorX, prepareResult.editorY).catch(() => undefined)
        await delay(300)
      }
      await client.send('Input.insertText', { text: body }, 20000)
      await delay(1000)
    }

    if (imagePaths.length) {
      const uploaded = await this.uploadImageViaToolbar(client, imagePaths[0])
      if (!uploaded) {
        return {
          ok: false,
          error: '今日头条没有成功上传正文配图，请检查图片格式或头条号发布页是否改版。',
          url: await client.evaluate<string>('location.href').catch(() => PUBLISH_URL),
          titleFilled: true,
          contentFilled: true,
        }
      }
    }

    const result = await client.evaluate<FillResult>(`(() => {
      const body = ${JSON.stringify(body)};
      const directMode = ${JSON.stringify(directMode)};
      function visible(el) {
        if (!(el instanceof HTMLElement)) return false;
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      }
      const expected = body.replace(/\\s+/g, '').slice(0, 20);
      function textHint(el) {
        return [
          el.getAttribute('placeholder') || '',
          el.getAttribute('aria-label') || '',
          typeof el.className === 'string' ? el.className : '',
          el.textContent || '',
          el.parentElement?.textContent || ''
        ].join(' ').slice(0, 1200);
      }
      const editors = Array.from(document.querySelectorAll('.ProseMirror[contenteditable="true"], .ProseMirror, [contenteditable="true"], .DraftEditor-root'))
        .filter(el => {
          if (!visible(el)) return false;
          if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return false;
          const rect = el.getBoundingClientRect();
          return rect.width >= 300 && rect.height >= 100;
        })
        .map(el => {
          const rect = el.getBoundingClientRect();
          const hint = textHint(el);
          let score = rect.width * rect.height / 10000;
          if (el.classList.contains('ProseMirror')) score += 100;
          if (el.getAttribute('contenteditable') === 'true') score += 40;
          if (/正文|内容|请输入正文/.test(hint)) score += 30;
          if (/创作助手|AI助手|智能助手|对话/.test(hint)) score -= 80;
          return { el, score };
        })
        .sort((a, b) => b.score - a.score);
      const contentEditor = editors[0]?.el || null;
      const actual = contentEditor
        ? ((contentEditor instanceof HTMLTextAreaElement || contentEditor instanceof HTMLInputElement) ? contentEditor.value : (contentEditor.innerText || contentEditor.textContent || ''))
        : '';
      if (expected && !actual.replace(/\\s+/g, '').includes(expected)) {
        return {
          ok: false,
          error: '今日头条正文没有成功写入编辑器，请重试或检查头条号发布页是否改版。',
          url: location.href,
          titleFilled: true,
          contentFilled: false
        };
      }

      const clickable = Array.from(document.querySelectorAll('button, [role="button"], a, span, div')).filter(visible);
      if (directMode) {
        const publishButton = clickable
          .filter(el => (el.textContent || '').replace(/\\s+/g, '').trim() === '预览并发布')
          .map(el => el.closest('button, [role="button"], a') || el)
          .find(visible);
        if (!publishButton) {
          return {
            ok: false,
            error: '已填入标题和正文，但没有找到今日头条“预览并发布”按钮。请检查头条号发布页是否改版，或是否还需要选择封面/声明。',
            url: location.href,
            titleFilled: true,
            contentFilled: true
          };
        }
        publishButton.scrollIntoView({ block: 'center', inline: 'center' });
        const rect = publishButton.getBoundingClientRect();
        return {
          ok: true,
          url: location.href,
          titleFilled: true,
          contentFilled: true,
          publishedClicked: false,
          clickX: Math.round(rect.left + rect.width / 2),
          clickY: Math.round(rect.top + rect.height / 2)
        };
      }

      const draftButton = clickable.find(el => /保存草稿|存草稿|草稿/.test((el.textContent || '').trim()));
      if (draftButton) {
        draftButton.click();
        return {
          ok: true,
          url: location.href,
          titleFilled: true,
          contentFilled: true,
          draftClicked: true
        };
      }

      if (/草稿将自动保存|自动保存|保存中|已保存/.test(document.body.innerText || '')) {
        return {
          ok: true,
          url: location.href,
          titleFilled: true,
          contentFilled: true,
          draftClicked: false
        };
      }

      {
        return {
          ok: false,
          error: '已填入标题和正文，但没有找到“保存草稿”按钮，也没有检测到自动保存提示。请检查头条号发布页是否改版。',
          url: location.href,
          titleFilled: true,
          contentFilled: true
        };
      }
    })()`, 20000)

    if (!result.ok) return result
    if (directMode) {
      if (typeof result.clickX !== 'number' || typeof result.clickY !== 'number') {
        return {
          ...result,
          ok: false,
          error: '今日头条发布按钮坐标读取失败。'
        }
      }

      await this.installPublishRecorder(client)
      await this.hideAssistantDrawer(client)
      if (imagePaths.length) await this.selectCoverMode(client, '单图')
      else await this.selectCoverMode(client, '无封面')

      const target: PointResult = await this.findPublishButtonPoint(client).catch(() => ({
        ok: true as const,
        x: result.clickX as number,
        y: result.clickY as number,
      }))
      if (!target.ok) {
        return {
          ...result,
          ok: false,
          error: target.error || '今日头条“预览并发布”按钮不可点击。'
        }
      }

      await this.clickPagePoint(client, target.x, target.y)
      await delay(1200)
      await this.clickConfirmPublishIfNeeded(client)

      const publishCheck = await this.waitForPublishResult(client)
      if (!publishCheck.ok) {
        return {
          ...result,
          ok: false,
          url: publishCheck.url || result.url,
          error: publishCheck.error || '没有捕获到今日头条发布成功响应。'
        }
      }

      await delay(1500)
      const finalUrl = await client.evaluate<string>('location.href').catch(() => publishCheck.url || result.url || HOME_URL)
      return {
        ...result,
        ok: true,
        url: finalUrl.includes('/profile_v4/graphic/publish') ? HOME_URL : finalUrl,
        publishedClicked: true,
        message: publishCheck.message || '今日头条已提交发布。'
      }
    }

    await delay(3000)
    return {
      ...result,
      url: await client.evaluate<string>('location.href').catch(() => result.url || PUBLISH_URL),
    }
  }

  private async clickPagePoint(client: CdpClient, x: number, y: number): Promise<void> {
    await client.send('Page.bringToFront').catch(() => undefined)
    await client.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x,
      y,
      button: 'none',
      buttons: 0,
    }).catch(() => undefined)
    await client.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button: 'left',
      buttons: 1,
      clickCount: 1,
    })
    await client.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x,
      y,
      button: 'left',
      buttons: 0,
      clickCount: 1,
    })
  }

  private async hideAssistantDrawer(client: CdpClient): Promise<void> {
    await client.evaluate<void>(`(() => {
      const selectors = [
        '.ai-assistant-drawer',
        '.byte-drawer-wrapper.ai-assistant-drawer',
        '.ai-assistant-panel-in-drawer'
      ];
      for (const selector of selectors) {
        document.querySelectorAll(selector).forEach(el => {
          if (!(el instanceof HTMLElement)) return;
          el.style.pointerEvents = 'none';
          el.style.visibility = 'hidden';
        });
      }
    })()`, 5000).catch(() => undefined)
    await delay(300)
  }

  private async findPublishButtonPoint(client: CdpClient): Promise<PointResult> {
    return client.evaluate<PointResult>(`(() => {
      function visible(el) {
        if (!(el instanceof HTMLElement)) return false;
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      }
      const button = Array.from(document.querySelectorAll('button, [role="button"], a, span, div'))
        .filter(visible)
        .filter(el => (el.textContent || '').replace(/\\s+/g, '').trim() === '预览并发布')
        .map(el => el.closest('button, [role="button"], a') || el)
        .find(visible);
      if (!button) return { ok: false, error: '没有找到“预览并发布”按钮' };
      button.scrollIntoView({ block: 'center', inline: 'center' });
      const rect = button.getBoundingClientRect();
      return {
        ok: true,
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2)
      };
    })()`, 10000)
  }

  private async clickConfirmPublishIfNeeded(client: CdpClient): Promise<void> {
    const target = await client.evaluate<PointResult>(`(() => {
      function visible(el) {
        if (!(el instanceof HTMLElement)) return false;
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      }
      const candidates = Array.from(document.querySelectorAll('button, [role="button"], a'))
        .filter(visible)
        .filter(el => /^(确认发布|立即发布|发布)$/.test((el.textContent || '').replace(/\\s+/g, '').trim()))
        .map(el => {
          const rect = el.getBoundingClientRect();
          const className = typeof el.className === 'string' ? el.className : '';
          let score = 0;
          if (/primary|publish-btn-last/.test(className)) score += 50;
          if (el.closest('[class*="modal"], [class*="Modal"], [class*="dialog"], [class*="Dialog"], .byte-modal')) score += 40;
          if (rect.bottom > window.innerHeight * 0.45) score += 10;
          if (el.getAttribute('disabled') !== null || el.getAttribute('aria-disabled') === 'true') score -= 100;
          return { el, rect, score };
        })
        .sort((a, b) => b.score - a.score);
      const item = candidates[0];
      if (!item) return { ok: false };
      item.el.scrollIntoView({ block: 'center', inline: 'center' });
      const rect = item.el.getBoundingClientRect();
      return { ok: true, x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
    })()`, 5000).catch(() => ({ ok: false as const }))

    if (target.ok && typeof target.x === 'number' && typeof target.y === 'number') {
      await this.clickPagePoint(client, target.x, target.y).catch(() => undefined)
      await delay(1200)
    }
  }

  private async uploadImageViaToolbar(client: CdpClient, imagePath: string): Promise<boolean> {
    await client.send('Page.setInterceptFileChooserDialog', { enabled: true }).catch(() => undefined)
    await client.evaluate<void>(`(() => {
      const toolbar = document.querySelector('.syl-toolbar, [class*="toolbar"]');
      if (toolbar instanceof HTMLElement) {
        toolbar.scrollIntoView({ block: 'center', inline: 'center' });
      } else {
        window.scrollTo({ top: 0, behavior: 'instant' });
      }
    })()`, 5000).catch(() => undefined)
    await delay(500)

    const target = await client.evaluate<PointResult>(`(() => {
      function visible(el) {
        if (!(el instanceof HTMLElement)) return false;
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      }

      const items = Array.from(document.querySelectorAll('button, [role="button"], a, span, div'))
        .map(el => {
          const rect = el.getBoundingClientRect();
          const text = (el.textContent || el.getAttribute('aria-label') || '').replace(/\\s+/g, '').trim();
          const className = String(el.className || '');
          let score = 0;
          if (!visible(el)) score -= 100;
          if (/syl-toolbar-tool/.test(className)) score += 40;
          if (/\\bimage\\b/.test(className)) score += 80;
          if (/图片|插入图片|上传图片/.test(text)) score += 80;
          if (rect.top < 180 && rect.left > 200 && rect.left < window.innerWidth * 0.75) score += 20;
          return { el, rect, score, text, className };
        })
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score);

      const item = items[0];
      if (!item) return { ok: false, error: '没有找到头条正文图片按钮' };
      item.el.scrollIntoView({ block: 'center', inline: 'center' });
      const rect = item.el.getBoundingClientRect();
      return { ok: true, x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
    })()`, 10000).catch(error => ({ ok: false as const, error: (error as Error).message }))

    if (!target.ok || typeof target.x !== 'number' || typeof target.y !== 'number') {
      await client.send('Page.setInterceptFileChooserDialog', { enabled: false }).catch(() => undefined)
      return false
    }

    const chooserPromise = client.waitForEvent<FileChooserOpenedEvent>('Page.fileChooserOpened', 10000)
      .catch(() => null)
    await this.clickPagePoint(client, target.x, target.y)
    const chooser = await chooserPromise
    if (!chooser) await delay(800)
    const fileInputNodeId = chooser?.nodeId || await this.findFileInputNodeId(client).catch(() => null)
    if (!chooser?.backendNodeId && !fileInputNodeId) {
      await client.send('Page.setInterceptFileChooserDialog', { enabled: false }).catch(() => undefined)
      return this.hasUploadedImage(client).catch(() => false)
    }

    const fileParams: Record<string, unknown> = { files: [imagePath] }
    if (chooser?.backendNodeId) fileParams.backendNodeId = chooser.backendNodeId
    else fileParams.nodeId = fileInputNodeId
    await client.send('DOM.setFileInputFiles', fileParams, 30000)
    await client.send('Page.setInterceptFileChooserDialog', { enabled: false }).catch(() => undefined)
    await delay(2500)
    await this.waitForImageUploadSettled(client).catch(() => undefined)
    await this.confirmImageUploadDrawer(client).catch(() => undefined)
    await delay(2000)
    return this.hasUploadedImage(client).catch(() => true)
  }

  private async confirmImageUploadDrawer(client: CdpClient): Promise<void> {
    const target = await client.evaluate<PointResult>(`(() => {
      function visible(el) {
        if (!(el instanceof HTMLElement)) return false;
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      }
      const drawer = Array.from(document.querySelectorAll('.byte-drawer, .byte-drawer-wrapper, [class*="drawer"], [class*="Drawer"]'))
        .filter(visible)
        .find(el => /上传图片|已上传/.test(el.textContent || ''));
      const root = drawer || document.body;
      const buttons = Array.from(root.querySelectorAll('button, [role="button"], a, span, div'))
        .filter(visible)
        .map(el => {
          const text = (el.textContent || el.getAttribute('aria-label') || '').replace(/\\s+/g, '').trim();
          const target = el.closest('button, [role="button"], a') || el;
          const rect = target.getBoundingClientRect();
          let score = 0;
          if (text === '确定') score += 100;
          if (text === '保存') score += 30;
          if (rect.bottom > window.innerHeight * 0.6) score += 20;
          return { el: target, rect, text, score };
        })
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score);
      const item = buttons[0];
      if (!item) return { ok: false };
      item.el.scrollIntoView({ block: 'center', inline: 'center' });
      const rect = item.el.getBoundingClientRect();
      return { ok: true, x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
    })()`, 10000).catch(() => ({ ok: false as const }))

    if (target.ok && typeof target.x === 'number' && typeof target.y === 'number') {
      await this.clickPagePoint(client, target.x, target.y)
    }
  }

  private async findFileInputNodeId(client: CdpClient): Promise<number | null> {
    await client.evaluate<void>(`(() => {
      function visible(el) {
        if (!(el instanceof HTMLElement)) return false;
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      }
      document.querySelectorAll('input[data-weibot-toutiao-upload]').forEach(el => {
        el.removeAttribute('data-weibot-toutiao-upload');
      });
      const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
      const target = inputs
        .map(el => {
          const rect = el.getBoundingClientRect();
          let score = 0;
          if (visible(el)) score += 100;
          if (/image/i.test(el.accept || '')) score += 40;
          score += Math.min(rect.width * rect.height / 1000, 50);
          return { el, score };
        })
        .sort((a, b) => b.score - a.score)[0]?.el;
      target?.setAttribute('data-weibot-toutiao-upload', 'true');
    })()`, 5000).catch(() => undefined)

    const root = await client.send<{ root?: { nodeId?: number } }>('DOM.getDocument', {
      depth: -1,
      pierce: true,
    })
    const rootNodeId = root.root?.nodeId
    if (!rootNodeId) return null

    const result = await client.send<{ nodeIds?: number[] }>('DOM.querySelectorAll', {
      nodeId: rootNodeId,
      selector: 'input[data-weibot-toutiao-upload="true"]',
    })
    const nodeIds = result.nodeIds || []
    if (nodeIds.length) return nodeIds[0]

    const fallback = await client.send<{ nodeIds?: number[] }>('DOM.querySelectorAll', {
      nodeId: rootNodeId,
      selector: 'input[type="file"]',
    })
    const fallbackNodeIds = fallback.nodeIds || []
    return fallbackNodeIds.length ? fallbackNodeIds[0] : null
  }

  private async hasUploadedImage(client: CdpClient): Promise<boolean> {
    return client.evaluate<boolean>(`(() => {
      function visible(el) {
        if (!(el instanceof HTMLElement)) return false;
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      }
      const editor = Array.from(document.querySelectorAll('.ProseMirror[contenteditable="true"], .ProseMirror, [contenteditable="true"], .DraftEditor-root'))
        .filter(visible)
        .find(el => {
          const rect = el.getBoundingClientRect();
          const className = String(el.className || '');
          return rect.width >= 300 && rect.height >= 100 && !/assistant|ai/i.test(className);
        });
      const root = editor || document.body;
      return Array.from(root.querySelectorAll('img, canvas, [style*="background-image"]'))
        .filter(visible)
        .some(el => {
          const rect = el.getBoundingClientRect();
          return rect.width >= 40 && rect.height >= 40;
        });
    })()`, 10000)
  }

  private async waitForImageUploadSettled(client: CdpClient): Promise<void> {
    const start = Date.now()
    while (Date.now() - start < 20000) {
      const state = await client.evaluate<{ uploading: boolean; hasImage: boolean }>(`(() => {
        function visible(el) {
          if (!(el instanceof HTMLElement)) return false;
          const style = getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        }
        const text = (document.body?.innerText || '').replace(/\\s+/g, ' ');
        const uploading = /(上传中|处理中|加载中|正在上传)/.test(text);
        const hasImage = Array.from(document.querySelectorAll('.ProseMirror img, [contenteditable="true"] img, canvas, [style*="background-image"]'))
          .filter(visible)
          .some(el => {
            const rect = el.getBoundingClientRect();
            return rect.width >= 40 && rect.height >= 40;
          });
        return { uploading, hasImage };
      })()`, 10000).catch(() => ({ uploading: false, hasImage: false }))

      if (!state.uploading && state.hasImage) return
      await delay(600)
    }
  }

  private async selectCoverMode(client: CdpClient, mode: '单图' | '无封面'): Promise<void> {
    const target = await client.evaluate<PointResult>(`(() => {
      const mode = ${JSON.stringify(mode)};
      function visible(el) {
        if (!(el instanceof HTMLElement)) return false;
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      }
      const item = Array.from(document.querySelectorAll('label, span, div, button, [role="radio"], [role="button"]'))
        .filter(visible)
        .map(el => {
          const text = (el.textContent || '').replace(/\\s+/g, '').trim();
          const target = el.closest('label, button, [role="radio"], [role="button"]') || el;
          const rect = target.getBoundingClientRect();
          let score = 0;
          if (text === mode) score += 100;
          if (/cover|radio|checkbox/i.test(String(target.className || ''))) score += 10;
          return { el: target, rect, text, score };
        })
        .filter(item => item.text === mode)
        .sort((a, b) => b.score - a.score)[0];
      if (!item) return { ok: false };
      item.el.scrollIntoView({ block: 'center', inline: 'center' });
      const rect = item.el.getBoundingClientRect();
      return { ok: true, x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
    })()`, 5000).catch(() => ({ ok: false as const }))

    if (target.ok && typeof target.x === 'number' && typeof target.y === 'number') {
      await this.clickPagePoint(client, target.x, target.y).catch(() => undefined)
      await delay(500)
    }
  }

  private async installPublishRecorder(client: CdpClient): Promise<void> {
    await client.evaluate<void>(`(() => {
      window.__weibotToutiaoNetwork = [];
      if (window.__weibotToutiaoRecorderInstalled) return;
      window.__weibotToutiaoRecorderInstalled = true;
      const shouldRecord = (url) => /\\/mp\\/agw\\/article\\/(publish|edit)|\\/article\\/publish|\\/graphic\\/publish/i.test(String(url || ''));
      const pushRecord = (record) => {
        try {
          window.__weibotToutiaoNetwork.push({
            ...record,
            body: typeof record.body === 'string' ? record.body.slice(0, 4000) : record.body,
            time: Date.now()
          });
        } catch {}
      };

      const originalFetch = window.fetch;
      window.fetch = async function(input, init) {
        const url = typeof input === 'string' ? input : input?.url;
        const response = await originalFetch.apply(this, arguments);
        if (shouldRecord(url)) {
          response.clone().text()
            .then(body => pushRecord({ type: 'fetch', url, status: response.status, body }))
            .catch(error => pushRecord({ type: 'fetch', url, status: response.status, error: String(error?.message || error) }));
        }
        return response;
      };

      const originalOpen = XMLHttpRequest.prototype.open;
      const originalSend = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function(method, url) {
        this.__weibotToutiaoUrl = url;
        return originalOpen.apply(this, arguments);
      };
      XMLHttpRequest.prototype.send = function() {
        const xhr = this;
        const url = xhr.__weibotToutiaoUrl;
        if (shouldRecord(url)) {
          xhr.addEventListener('loadend', () => {
            pushRecord({
              type: 'xhr',
              url,
              status: xhr.status,
              body: xhr.responseText || ''
            });
          });
        }
        return originalSend.apply(this, arguments);
      };
    })()`, 10000).catch(() => undefined)
  }

  private async waitForPublishResult(client: CdpClient): Promise<PublishCheckResult> {
    const deadline = Date.now() + 15000
    let lastCheck: PublishCheckResult | null = null
    while (Date.now() < deadline) {
      lastCheck = await this.readPublishResult(client).catch(error => ({
        ok: false,
        error: (error as Error).message,
      }))
      if (lastCheck.ok || lastCheck.error) return lastCheck
      await this.clickConfirmPublishIfNeeded(client).catch(() => undefined)
      await delay(800)
    }
    return lastCheck || { ok: false, error: '没有捕获到今日头条发布接口响应。' }
  }

  private async readPublishResult(client: CdpClient): Promise<PublishCheckResult> {
    const state = await client.evaluate<{
      url: string
      text: string
      records: ToutiaoNetworkRecord[]
    }>(`(() => ({
      url: location.href,
      text: (document.body?.innerText || '').replace(/\\s+/g, ' ').slice(-2500),
      records: Array.isArray(window.__weibotToutiaoNetwork) ? window.__weibotToutiaoNetwork.slice(-20) : []
    }))()`, 5000)

    const publishRecords = state.records.filter(record => /article\/publish|graphic\/publish/i.test(record.url || ''))
    const latest = publishRecords[publishRecords.length - 1]
    if (latest) {
      const parsed = this.parsePublishBody(latest.body || '')
      if (latest.status && latest.status >= 400) {
        return {
          ok: false,
          url: state.url,
          error: parsed.error || `今日头条发布接口返回 HTTP ${latest.status}`,
        }
      }
      if (parsed.ok) {
        return {
          ok: true,
          url: state.url,
          message: parsed.message || '今日头条发布接口已返回成功。',
        }
      }
      if (parsed.error) {
        return {
          ok: false,
          url: state.url,
          error: parsed.error,
        }
      }
    }

    const validationMatch = state.text.match(/(请输入|请选择|请上传|不能为空|失败|错误|未通过|请.*封面|封面.*不能为空|封面.*失败|声明.*必填)[^。\\n ]{0,80}/)
    if (validationMatch) {
      return {
        ok: false,
        url: state.url,
        error: `今日头条页面校验拦截：${validationMatch[0]}`,
      }
    }

    if (/发布成功|提交成功|已发布|审核中/.test(state.text)) {
      return {
        ok: true,
        url: state.url,
        message: '今日头条页面显示已提交发布。',
      }
    }

    return { ok: false, url: state.url }
  }

  private parsePublishBody(body: string): PublishCheckResult {
    if (!body) return { ok: false }
    let data: unknown
    try {
      data = JSON.parse(body)
    } catch {
      if (/发布成功|提交成功|success/i.test(body)) return { ok: true, message: '今日头条发布接口已返回成功。' }
      if (/失败|错误|error|invalid/i.test(body)) return { ok: false, error: body.slice(0, 300) }
      return { ok: false }
    }

    const pick = (value: unknown, keys: string[]): unknown => {
      if (!value || typeof value !== 'object') return undefined
      const record = value as Record<string, unknown>
      for (const key of keys) {
        if (record[key] !== undefined) return record[key]
      }
      for (const item of Object.values(record)) {
        const found = pick(item, keys)
        if (found !== undefined) return found
      }
      return undefined
    }

    const code = pick(data, ['err_no', 'errno', 'errCode', 'err_code', 'code'])
    const success = pick(data, ['success'])
    const message = String(pick(data, ['message', 'msg', 'reason', 'errmsg', 'error_msg']) || '')

    if (/保存成功/.test(message)) {
      return { ok: false }
    }

    if (success === true || /发布成功|提交成功|已发布|审核中|success/i.test(message)) {
      return { ok: true, message: message || '今日头条发布接口已返回成功。' }
    }

    if ((typeof code === 'number' && code !== 0) || (typeof code === 'string' && code && code !== '0')) {
      return { ok: false, error: message || `今日头条发布接口返回 code=${code}` }
    }

    if (/失败|错误|error|invalid|未通过/i.test(message)) {
      return { ok: false, error: message }
    }

    return { ok: false }
  }
}
