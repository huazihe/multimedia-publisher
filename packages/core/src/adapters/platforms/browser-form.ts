import { CodeAdapter } from '../code-adapter'
import type { Article, AuthResult, Cookie, PlatformMeta, SyncResult } from '../../types'
import type { PublishOptions } from '../types'
import { connectCdpPage, delay, resolveEnvPort, type CdpClient } from '../../lib/cdp'
import { buildAccountIdentityScript, type AccountIdentity } from '../../lib/account-identity'
import { parseHTML } from 'linkedom'
import { markdownToHtml } from '../../lib/turndown'

interface CdpCookie {
  name: string
  domain: string
}

interface FillResult {
  ok: boolean
  error?: string
  url?: string
  titleFilled?: boolean
  contentFilled?: boolean
  submitHint?: string
}

interface DraftSaveResult {
  ok: boolean
  error?: string
  url?: string
  postId?: string
  message?: string
}

interface BrowserFormPlatformConfig {
  id: string
  name: string
  icon: string
  homepage: string
  loginUrl: string
  publishUrl: string
  domains: string[]
  envNames: string[]
  preferredHost: string
  titleSelectors?: string[]
  summarySelectors?: string[]
  editorSelectors?: string[]
}

const COMMON_TITLE_SELECTORS = [
  'input[name="subject"]',
  'input[name="title"]',
  'input[name="article_title"]',
  'input[name="post_title"]',
  'input[id="subject"]',
  'input[id="title"]',
  'input[placeholder*="标题"]',
  'textarea[placeholder*="标题"]',
  'textarea[name="title"]',
  'input[placeholder*="鏍囬"]',
  'textarea[placeholder*="鏍囬"]',
  '[contenteditable="true"][placeholder*="标题"]',
  '[contenteditable="true"][data-placeholder*="标题"]',
  '[contenteditable="true"][placeholder*="鏍囬"]',
]

const COMMON_EDITOR_SELECTORS = [
  'textarea[name="message"]',
  'textarea[name="content"]',
  'textarea[name="article"]',
  'textarea[name="body"]',
  'textarea[id="message"]',
  'textarea[id="content"]',
  '#e_textarea',
  '#editor',
  '.editor',
  '.edui-body-container',
  '.ql-editor',
  '.ProseMirror',
  '.bytemd-editor textarea',
  '.vditor-ir',
  '.vditor-wysiwyg',
  '.w-e-text-container [contenteditable="true"]',
  'textarea[placeholder*="正文"]',
  'textarea[placeholder*="内容"]',
  'textarea[placeholder*="请输入内容"]',
  '[contenteditable="true"]',
]

function normalizeBody(article: Article): string {
  return (article.markdown || article.html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function domainMatches(cookieDomain: string, targetDomain: string): boolean {
  const cookie = cookieDomain.replace(/^\./, '').toLowerCase()
  const target = targetDomain.replace(/^\./, '').toLowerCase()
  return cookie === target || cookie.endsWith(`.${target}`)
}

function looksLikeLoginCookie(cookie: CdpCookie): boolean {
  return /auth|token|session|sid|uid|user|member|login|saltkey|lastactivity|passport/i.test(cookie.name)
}

abstract class BrowserFormAdapter extends CodeAdapter {
  readonly meta: PlatformMeta

  readonly preprocessConfig = {
    outputFormat: 'markdown' as const,
  }

  protected constructor(private config: BrowserFormPlatformConfig) {
    super()
    this.meta = {
      id: config.id,
      name: config.name,
      icon: config.icon,
      homepage: config.homepage,
      capabilities: config.id === 'qiehao' ? ['article', 'draft'] : ['article'],
    }
  }

  async checkAuth(): Promise<AuthResult> {
    if (this.runtime.type !== 'node') {
      return {
        isAuthenticated: false,
        error: `${this.config.name} 独立发布需要 Node runtime 和网页登录会话。`,
      }
    }

    const port = this.resolveCdpPort()
    if (!port) {
      return {
        isAuthenticated: false,
        error: `请先运行 weibot login ${this.config.id}，或在可视化面板完成 ${this.config.name} 登录。`,
      }
    }

    let client: CdpClient | null = null
    try {
      client = await connectCdpPage(port, this.config.publishUrl, this.config.preferredHost)
      await this.hydrateRuntimeCookies(client)
      await this.hasCdpLoginCookie(client)
      await client.navigate(this.config.publishUrl, 30000).catch(() => undefined)
      const state = await this.readPageState(client)
      if (this.isLoggedInPage(state.url, state.text, state.hasPublishForm)) {
        const identity = await this.readAccountIdentity(client)
        return {
          isAuthenticated: true,
          username: identity.username || identity.userId,
          userId: identity.userId,
          avatar: identity.avatar,
        }
      }

      return { isAuthenticated: false, error: `${this.config.name} 浏览器会话未登录。` }
    } catch (error) {
      return { isAuthenticated: false, error: (error as Error).message }
    } finally {
      client?.close()
    }
  }

  async publish(article: Article, options?: PublishOptions): Promise<SyncResult> {
    const directMode = options?.publishMode === 'direct' || options?.draftOnly === false
    if (this.config.id === 'qiehao' && directMode) {
      return this.createResult(false, { error: '企鹅号暂未实现直接发布接口；当前只支持保存草稿。' })
    }
    // Preparation may produce plain markdown while retaining images in HTML.
    // Until uploads are verified, reject the whole image-bearing article before CDP.
    if (this.config.id === 'qiehao' && (article.cover
      || [article.html || '', markdownToHtml(article.markdown || '')]
        .some(html => parseHTML(html).document.querySelector('img, picture')))) {
      return this.createResult(false, {
        error: '企鹅号当前只支持纯文字草稿，图片和封面上传尚未验证；已阻止带图内容提交，请先准备独立的纯文字版本。',
      })
    }
    if (this.runtime.type !== 'node') {
      return this.createResult(false, {
        error: `${this.config.name} 独立发布需要 Node runtime 和网页登录会话。`,
      })
    }

    const port = this.resolveCdpPort()
    if (!port) {
      return this.createResult(false, {
        error: `请先运行 weibot login ${this.config.id}，或在可视化面板完成 ${this.config.name} 登录。`,
      })
    }

    const title = article.title.trim()
    const body = normalizeBody(article)
    if (!title || !body) {
      return this.createResult(false, { error: '文章标题或正文为空。' })
    }

    let client: CdpClient | null = null
    let remoteTouched = false
    try {
      client = await connectCdpPage(port, this.config.publishUrl, this.config.preferredHost)
      await this.hydrateRuntimeCookies(client)
      await client.navigate(this.config.publishUrl, 30000)
      await delay(1200)

      if (this.config.id === 'huangye88') {
        const state = await this.readPageState(client)
        if (/fabuxinxi\.huangye88\.com/i.test(state.url) && /选择分类|搜索分类|手选分类/.test(state.text) && !state.hasPublishForm) {
          throw new Error('黄页88发布需要先选择行业分类，当前停留在分类选择页；请在登录浏览器中手动选择分类进入具体发布表单，或重新抓取分类后的黄页88发布接口。')
        }
      }

      // Editors may auto-save during input; a disconnect must never trigger an
      // automatic second fill or be interpreted as a clean, retryable failure.
      remoteTouched = true
      const result = await this.fillPublishPage(client, title, body)
      if (!result.ok) throw new Error(result.error || `${this.config.name} 发布页填充失败`)

      if (this.config.id === 'qiehao') {
        const draft = await this.saveQiehaoDraftDirect(client, title, body)
        if (!draft.ok || !draft.postId) {
          throw new Error(draft.error || `${this.config.name} draft save failed`)
        }

        return this.createResult(true, {
          postId: draft.postId,
          postUrl: draft.url || this.config.publishUrl,
          draftOnly: true,
          message: draft.message || `已保存到 ${this.config.name} 草稿箱`,
        })
      }

      if (directMode) {
        const submit = await this.clickDirectSubmit(client)
        if (!submit.ok) throw new Error(submit.error || `${this.config.name} 未找到直接发布按钮`)

        return this.createResult(false, {
          uncertain: true,
          postUrl: submit.url || result.url || this.config.publishUrl,
          error: `${this.config.name} 未获得可验证的公开发布回执。`,
          message: '已尝试点击提交，请先检查平台发布页及内容管理中的结果；可能需要分类、验证码或二次确认，核查前不要重复提交。',
        })
      }

      return this.createResult(false, {
        uncertain: true,
        postUrl: result.url || this.config.publishUrl,
        error: `${this.config.name} 仅填入发布页，尚未确认平台草稿保存。`,
        message: '请在平台发布页检查内容并人工保存或发布；编辑器可能已自动保存，核查前不要重复提交。',
      })
    } catch (error) {
      return this.createResult(false, {
        error: `${this.config.name} 操作未完成，请检查平台页面。`,
        postUrl: this.config.publishUrl,
        ...(remoteTouched ? { uncertain: true, message: '页面输入或提交已开始，但结果未获确认；请先检查平台草稿箱和内容管理，核查前不要重复提交。' } : {}),
      })
    } finally {
      client?.close()
    }
  }

  private resolveCdpPort(): number | null {
    return resolveEnvPort(this.config.envNames, this.config.name)
  }

  private cookieBelongsToPlatform(cookie: CdpCookie): boolean {
    return this.config.domains.some(domain => domainMatches(cookie.domain, domain))
  }

  private async hydrateRuntimeCookies(client: CdpClient): Promise<void> {
    await client.send('Network.enable').catch(() => undefined)
    const seen = new Set<string>()
    const now = Math.floor(Date.now() / 1000)
    const cookies: Cookie[] = []
    for (const domain of this.config.domains) {
      const bareDomain = domain.replace(/^\./, '')
      const domainCookies = await this.runtime.cookies.get(bareDomain).catch(() => [])
      for (const cookie of domainCookies) {
        const key = `${cookie.domain}|${cookie.path || '/'}|${cookie.name}`
        if (seen.has(key)) continue
        seen.add(key)
        cookies.push(cookie)
      }
    }

    for (const cookie of cookies) {
      if (!cookie.name || cookie.value == null) continue
      if (cookie.expirationDate && cookie.expirationDate <= now) continue
      const domain = (cookie.domain || this.config.preferredHost).replace(/^\./, '')
      const path = cookie.path || '/'
      const protocol = cookie.secure ? 'https' : this.config.publishUrl.startsWith('https:') ? 'https' : 'http'
      await client.send('Network.setCookie', {
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain || domain,
        path,
        secure: Boolean(cookie.secure),
        httpOnly: Boolean(cookie.httpOnly),
        expires: cookie.expirationDate,
        url: `${protocol}://${domain}${path.startsWith('/') ? path : `/${path}`}`,
      }).catch(() => undefined)
    }
  }

  private async hasCdpLoginCookie(client: CdpClient): Promise<boolean> {
    await client.send('Network.enable').catch(() => undefined)
    const result = await client.send<{ cookies?: CdpCookie[] }>('Network.getAllCookies')
      .catch(() => client.send<{ cookies?: CdpCookie[] }>('Storage.getCookies'))
      .catch(() => ({ cookies: [] }))

    return (result.cookies || []).some(cookie => this.cookieBelongsToPlatform(cookie) && looksLikeLoginCookie(cookie))
  }

  private async readAccountIdentity(client: CdpClient): Promise<AccountIdentity> {
    return client.evaluate<AccountIdentity>(buildAccountIdentityScript(), 8000)
      .catch(() => ({}))
  }

  private async readPageState(client: CdpClient): Promise<{ url: string; text: string; hasPublishForm: boolean }> {
    return client.evaluate<{ url: string; text: string; hasPublishForm: boolean }>(`(() => {
      const visible = el => {
        const view = el?.ownerDocument?.defaultView;
        if (!view || !(el instanceof view.HTMLElement)) return false;
        const style = view.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          (rect.width > 0 && rect.height > 0 || el.getAttribute('contenteditable') === 'true');
      };
      const hasTitle = Array.from(document.querySelectorAll('input, textarea, [contenteditable="true"]'))
        .some(el => visible(el) && /subject|title|标题|文章名称|鏍囬/i.test([el.name, el.id, el.placeholder, el.getAttribute('aria-label')].filter(Boolean).join(' ')));
      const hasEditor = Array.from(document.querySelectorAll('textarea, [contenteditable="true"], #editor, iframe'))
        .some(visible);
      const hasSubmit = Array.from(document.querySelectorAll('button, input[type="submit"], a, [role="button"]'))
        .some(el => visible(el) && /发表|发布|提交|保存|投稿|鍙戣〃|鍙戝竷|鎻愪氦|淇濆瓨|鍙戝笘|鎶曠/.test((el.value || el.textContent || '').trim()));
      return {
        url: location.href,
        text: document.body?.innerText?.slice(0, 3000) || '',
        hasPublishForm: hasTitle && hasEditor && hasSubmit
      };
    })()`, 5000).catch(() => ({ url: '', text: '', hasPublishForm: false }))
  }

  private isLoggedInPage(url: string, text: string, hasPublishForm: boolean): boolean {
    const visibleText = text.slice(0, 1200)
    if (/login|logging|signin|passport|member\.php/i.test(url)) return false
    if (hasPublishForm) return true
    if (/登录|注册|用户登录|账号登录|密码登录|短信登录|鐧诲綍|娉ㄥ唽|鐢ㄦ埛鐧诲綍|璐﹀彿鐧诲綍|瀵嗙爜鐧诲綍|鐭俊鐧诲綍|login|sign in/i.test(visibleText) &&
      !/退出|注销|个人中心|用户中心|会员中心|内容管理|我的主页|我的帖子|我的文章|草稿|账号设置|管理后台|后台管理|企业新闻发布或编辑|更多功能|閫€鍑簗娉ㄩ攢|涓汉涓績|鐢ㄦ埛涓績|浼氬憳涓績|鍐呭绠＄悊|鎴戠殑涓婚〉|鎴戠殑甯栧瓙|鎴戠殑鏂囩珷|鑽夌|璐﹀彿璁剧疆/i.test(visibleText)) {
      return false
    }
    return /退出|注销|个人中心|用户中心|会员中心|内容管理|我的主页|我的帖子|我的文章|草稿|账号设置|管理后台|后台管理|企业新闻发布或编辑|更多功能|閫€鍑簗娉ㄩ攢|涓汉涓績|鐢ㄦ埛涓績|浼氬憳涓績|鍐呭绠＄悊|鎴戠殑涓婚〉|鎴戠殑甯栧瓙|鎴戠殑鏂囩珷|鑽夌|璐﹀彿璁剧疆/i.test(visibleText)
  }

  private async fillPublishPage(client: CdpClient, title: string, body: string): Promise<FillResult> {
    const titleSelectors = [...(this.config.titleSelectors || []), ...COMMON_TITLE_SELECTORS]
    const summarySelectors = this.config.summarySelectors || []
    const editorSelectors = [...(this.config.editorSelectors || []), ...COMMON_EDITOR_SELECTORS]
    const summary = body
      .split(/\n{2,}/)[0]
      ?.replace(/\s+/g, ' ')
      .slice(0, 180) || title

    return client.evaluate<FillResult>(`(() => {
      const title = ${JSON.stringify(title)};
      const body = ${JSON.stringify(body)};
      const summary = ${JSON.stringify(summary)};
      const titleSelectors = ${JSON.stringify(titleSelectors)};
      const summarySelectors = ${JSON.stringify(summarySelectors)};
      const editorSelectors = ${JSON.stringify(editorSelectors)};

      function visible(el) {
        const view = el?.ownerDocument?.defaultView;
        if (!view || !(el instanceof view.HTMLElement)) return false;
        const style = view.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          (rect.width > 0 && rect.height > 0 || el.getAttribute('contenteditable') === 'true');
      }

      function sameOriginDocuments() {
        const docs = [document];
        for (const frame of Array.from(document.querySelectorAll('iframe'))) {
          try {
            if (frame.contentDocument) docs.push(frame.contentDocument);
          } catch {}
        }
        return docs;
      }

      function findBySelectors(selectors) {
        for (const doc of sameOriginDocuments()) {
          for (const selector of selectors) {
            const iframeBodyMatch = selector.match(/^(.+?)\\s+body([.#][\\w-]+)?$/);
            if (iframeBodyMatch && doc === document) {
              const frameSelector = iframeBodyMatch[1];
              const bodySelector = iframeBodyMatch[2] ? 'body' + iframeBodyMatch[2] : 'body';
              const iframe = Array.from(document.querySelectorAll(frameSelector))
                .find(frame => frame instanceof HTMLIFrameElement && frame.contentDocument);
              const body = iframe?.contentDocument?.querySelector(bodySelector);
              if (body && visible(body)) return body;
            }
            const match = Array.from(doc.querySelectorAll(selector)).find(visible);
            if (match instanceof HTMLIFrameElement && match.contentDocument?.body && visible(match.contentDocument.body)) {
              return match.contentDocument.body;
            }
            if (match) return match;
          }
        }
        return null;
      }

      function setNativeValue(el, value) {
        const prototype = Object.getPrototypeOf(el);
        const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
        if (descriptor && descriptor.set) descriptor.set.call(el, value);
        else el.value = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }

      function escapeHtml(value) {
        return value.replace(/[&<>]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char]));
      }

      function textToHtml(value) {
        return value
          .split(/\\n{2,}/)
          .map(part => '<p>' + escapeHtml(part).replace(/\\n/g, '<br>') + '</p>')
          .join('');
      }

      function fillEditable(el, value) {
        if (el.ckeditorInstance && typeof el.ckeditorInstance.setData === 'function') {
          el.ckeditorInstance.setData(textToHtml(value));
          el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return;
        }

        const doc = el.ownerDocument;
        el.focus();
        try {
          doc.execCommand('selectAll', false);
          const inserted = doc.execCommand('insertText', false, value);
          if (inserted && (el.innerText || el.textContent || '').includes(value.slice(0, 20))) {
            el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
            return;
          }
        } catch {}
        el.innerHTML = textToHtml(value);
        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }

      function readEditableText(el) {
        if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) return el.value || '';
        if (el.ckeditorInstance && typeof el.ckeditorInstance.getData === 'function') {
          const tmp = document.createElement('div');
          tmp.innerHTML = el.ckeditorInstance.getData() || '';
          return tmp.innerText || tmp.textContent || '';
        }
        return el.innerText || el.textContent || '';
      }

      const titleInput = findBySelectors(titleSelectors);
      if (!titleInput) {
        return { ok: false, error: 'Title input not found. Please confirm the publish page is open.', url: location.href };
      }

      if (titleInput instanceof HTMLInputElement || titleInput instanceof HTMLTextAreaElement) {
        setNativeValue(titleInput, title);
      } else {
        fillEditable(titleInput, title);
      }

      const summaryInput = summarySelectors.length ? findBySelectors(summarySelectors) : null;
      if (summaryInput) {
        if (summaryInput instanceof HTMLInputElement || summaryInput instanceof HTMLTextAreaElement) {
          setNativeValue(summaryInput, summary);
        } else {
          fillEditable(summaryInput, summary);
        }
      }

      let editor = findBySelectors(editorSelectors);
      if (!editor) {
        for (const doc of sameOriginDocuments()) {
          if (doc.body && doc !== document && visible(doc.body)) {
            editor = doc.body;
            break;
          }
        }
      }
      if (!editor) {
        return { ok: false, error: 'Content editor not found. Please confirm the publish page is open.', url: location.href, titleFilled: true };
      }

      if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
        setNativeValue(editor, body);
      } else {
        fillEditable(editor, body);
      }
      const expectedBody = body.replace(/\\s+/g, '').slice(0, 24);
      const actualBody = readEditableText(editor).replace(/\\s+/g, '');
      if (expectedBody && !actualBody.includes(expectedBody)) {
        return {
          ok: false,
          error: 'Content editor was found, but body text was not written successfully.',
          url: location.href,
          titleFilled: true,
          contentFilled: false
        };
      }

      const submit = Array.from(document.querySelectorAll('button, input[type="submit"], a, [role="button"]'))
        .filter(visible)
        .find(el => /发表|发布|提交|保存|投稿|鍙戣〃|鍙戝竷|鎻愪氦|淇濆瓨|鍙戝笘|鎶曠/.test((el.value || el.textContent || '').trim()));

      return {
        ok: true,
        url: location.href,
        titleFilled: true,
        contentFilled: true,
        submitHint: submit ? (submit.value || submit.textContent || '').trim() : ''
      };
    })()`, 30000)
  }

  private async clickDirectSubmit(client: CdpClient): Promise<FillResult> {
    const clicked = await client.evaluate<FillResult>(`(() => {
      function visible(el) {
        const view = el?.ownerDocument?.defaultView;
        if (!view || !(el instanceof view.HTMLElement)) return false;
        const style = view.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      }

      const controls = Array.from(document.querySelectorAll('button, input[type="submit"], input[type="button"], a, [role="button"]'))
        .filter(visible)
        .map(el => ({ el, text: (el.value || el.textContent || el.getAttribute('aria-label') || '').trim() }))
        .filter(item => item.text);
      const submit = controls.find(item =>
        /发表|发布|提交|投稿|发帖|发表文章|发布文章|提交审核/.test(item.text) &&
        !/保存|草稿|预览|取消|返回|重置/.test(item.text)
      );
      if (!submit) {
        return {
          ok: false,
          error: '没有找到直接发布按钮。请确认当前页面已经进入最终发布表单。',
          url: location.href
        };
      }
      submit.el.scrollIntoView({ block: 'center', inline: 'center' });
      submit.el.click();
      return {
        ok: true,
        url: location.href,
        titleFilled: true,
        contentFilled: true,
        submitHint: submit.text
      };
    })()`, 10000)

    if (!clicked.ok) return clicked
    await delay(2500)
    return {
      ...clicked,
      url: await client.evaluate<string>('location.href').catch(() => clicked.url || ''),
    }
  }

  private async saveQiehaoDraftDirect(client: CdpClient, title: string, body: string): Promise<DraftSaveResult> {
    return client.evaluate<DraftSaveResult>(`(async () => {
      const title = ${JSON.stringify(title)};
      const body = ${JSON.stringify(body)};
      const escapeHtml = value => String(value || '').replace(/[&<>]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char]));
      const content = body
        .split(/\\n{2,}/)
        .map(part => '<p>' + escapeHtml(part).replace(/\\n/g, '<br>') + '</p>')
        .join('') + '<div powered-by="ex-editor"></div>';
      const mediaId = window.OM_SiteInfo?.userInfo?.mediaId;
      if (!mediaId) return { ok: false, url: location.href, error: 'Qiehao login metadata missing: mediaId' };

      const payload = {
        title,
        title2: '',
        tag: '',
        video: '',
        cover_type: '1',
        imgurl_ext: '[]',
        category_id: '',
        content,
        orignal: 0,
        user_original: 0,
        music: '',
        activity: '',
        apply_olympic_flag: 0,
        apply_push_flag: 0,
        apply_reward_flag: 0,
        reward_flag: 0,
        survey_id: '',
        survey_name: '',
        imgurlsrc: null,
        om_activity_id: '',
        om_activity_name: '',
        activityInfo: '',
        commercialization_source: '',
        caimaiInfo: '',
        isHowto: '0',
        howtoInfo: '',
        daihuoInfo: '',
        novel: '',
        needpub: 1,
        event_id: '',
        event_name: '',
        activity_scene_id: 0,
        hotBreak: '',
        self_declare: '',
        resource_aigc_mark_info: '{}',
        parent_article_id: '',
        conclusion: '',
        summary: '',
        failedImage: [],
        adContentImgs: [],
        mediaId,
        type: 0,
        unmount: false,
        articleId: '',
      };

      const response = await fetch('/marticlepublish/omSave', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json;charset=UTF-8' },
        body: JSON.stringify(payload),
      });
      const text = await response.text();
      let json = null;
      try { json = JSON.parse(text); } catch {}
      const code = json?.response?.code ?? json?.code;
      const articleId = json?.data?.articleId || json?.data?.article_id || '';
      const validId = (typeof articleId === 'string' || typeof articleId === 'number') && /^[A-Za-z0-9_-]+$/.test(String(articleId)) && String(articleId) !== '0';
      if (response.ok && String(code) === '0' && validId) {
        return {
          ok: true,
          url: 'https://om.qq.com/main/management/articleManage',
          postId: String(articleId),
          message: '已收到企鹅号草稿保存回执，请到内容管理核对。',
        };
      }
      return {
        ok: false,
        url: location.href,
        error: '企鹅号未返回有效草稿保存回执，请先检查内容管理，避免重复提交。',
      };
    })()`, 30000)
  }
}

const INDUSTRY_FORUM_PLATFORMS: BrowserFormPlatformConfig[] = [
  {
    id: 'china-vision',
    name: '中国机器视觉网',
    icon: 'http://www.china-vision.org/favicon.ico',
    homepage: 'http://www.china-vision.org/',
    loginUrl: 'http://www.china-vision.org/',
    publishUrl: 'https://www.china-vision.org/user-add-news.html',
    domains: ['.china-vision.org'],
    envNames: ['WEIBOT_CHINA_VISION_CDP_PORT', 'CHINA_VISION_CDP_PORT'],
    preferredHost: 'china-vision.org',
    titleSelectors: ['input[name="title"]'],
    summarySelectors: ['textarea[name="summary"]'],
    editorSelectors: ['body.view[contenteditable="true"]', 'body[contenteditable="true"]'],
  },
  {
    id: 'bjx-club',
    name: '北极星社区',
    icon: 'https://club.bjx.com.cn/favicon.ico',
    homepage: 'https://club.bjx.com.cn/',
    loginUrl: 'https://club.bjx.com.cn/',
    publishUrl: 'https://club.bjx.com.cn/posts/add',
    domains: ['.bjx.com.cn'],
    envNames: ['WEIBOT_BJX_CLUB_CDP_PORT', 'BJX_CLUB_CDP_PORT'],
    preferredHost: 'club.bjx.com.cn',
    titleSelectors: ['input[name="subject"]'],
    editorSelectors: ['#editor'],
  },
  {
    id: 'elecfans',
    name: '电子发烧友',
    icon: 'https://www.elecfans.com/favicon.ico',
    homepage: 'https://www.elecfans.com/',
    loginUrl: 'https://bbs.elecfans.com/member.php?mod=logging&action=login',
    publishUrl: 'https://www.elecfans.com/d/article/write',
    domains: ['.elecfans.com'],
    envNames: ['WEIBOT_ELECFANS_CDP_PORT', 'ELECFANS_CDP_PORT'],
    preferredHost: 'elecfans.com',
    titleSelectors: [
      'input[placeholder*="标题"]',
      'textarea[placeholder*="标题"]',
      'input[name="title"]',
      '#title',
    ],
    editorSelectors: [
      '.bytemd-editor textarea',
      '.vditor-ir',
      '.vditor-wysiwyg',
      '.ql-editor',
      '.ProseMirror',
      '.w-e-text-container [contenteditable="true"]',
      'textarea[placeholder*="正文"]',
      'textarea[placeholder*="内容"]',
      'textarea[placeholder*="请输入内容"]',
      '[contenteditable="true"]',
    ],
  },
  {
    id: 'eet-china',
    name: '电子工程专辑',
    icon: 'https://www.eet-china.com/favicon.ico',
    homepage: 'https://www.eet-china.com/',
    loginUrl: 'https://www.eet-china.com/',
    publishUrl: 'https://mbb.eet-china.com/home.php?mod=spacecp&ac=blog',
    domains: ['.eet-china.com'],
    envNames: ['WEIBOT_EET_CHINA_CDP_PORT', 'EET_CHINA_CDP_PORT'],
    preferredHost: 'eet-china.com',
    titleSelectors: ['#subject', 'input[name="subject"]'],
    editorSelectors: [
      '#uchome-ifrHtmlEditor body',
      'iframe[name="uchome-ifrHtmlEditor"] body',
      'textarea[name="message"]',
      '#uchome-ttHtmlEditor',
    ],
  },
  {
    id: 'eeworld',
    name: '电子工程世界',
    icon: 'http://bbs.eeworld.com.cn/favicon.ico',
    homepage: 'http://bbs.eeworld.com.cn/',
    loginUrl: 'http://bbs.eeworld.com.cn/member.php?mod=logging&action=login',
    publishUrl: 'http://bbs.eeworld.com.cn/forum.php?mod=post&action=newthread&fid=29',
    domains: ['.eeworld.com.cn'],
    envNames: ['WEIBOT_EEWORLD_CDP_PORT', 'EEWORLD_CDP_PORT'],
    preferredHost: 'bbs.eeworld.com.cn',
    titleSelectors: ['input[name="subject"]', '#subject'],
    editorSelectors: ['body.cke_editable[contenteditable="true"]', 'body[contenteditable="true"]'],
  },
  {
    id: 'qiehao',
    name: '企鹅号',
    icon: 'https://om.qq.com/favicon.ico',
    homepage: 'https://om.qq.com/',
    loginUrl: 'https://om.qq.com/',
    publishUrl: 'https://om.qq.com/main/creation/article',
    domains: ['.qq.com', '.om.qq.com'],
    envNames: ['WEIBOT_QIEHAO_CDP_PORT', 'QIEHAO_CDP_PORT'],
    preferredHost: 'om.qq.com',
    titleSelectors: [
      'input[placeholder*="标题"]',
      'textarea[placeholder*="标题"]',
      '[contenteditable="true"][placeholder*="标题"]',
      '[contenteditable="true"][data-placeholder*="标题"]',
    ],
    editorSelectors: [
      '.ql-editor',
      '.ProseMirror',
      '[contenteditable="true"]',
      'textarea[placeholder*="正文"]',
      'textarea[placeholder*="内容"]',
    ],
  },
  {
    id: 'ca800',
    name: '中国自动化网',
    icon: 'http://www.ca800.com/favicon.ico',
    homepage: 'http://www.ca800.com/',
    loginUrl: 'http://www.ca800.com/common/login.aspx?gourl=http%3a%2f%2fwww.ca800.com%2fc%2fInfo%2farticleInfo.aspx',
    publishUrl: 'http://www.ca800.com/c/Info/articleInfo.aspx',
    domains: ['.ca800.com'],
    envNames: ['WEIBOT_CA800_CDP_PORT', 'CA800_CDP_PORT'],
    preferredHost: 'ca800.com',
    titleSelectors: ['#ctl00_body_txtTitle', 'input[name="ctl00$body$txtTitle"]'],
    summarySelectors: ['#ctl00_body_txtDescription', 'textarea[name="ctl00$body$txtDescription"]'],
    editorSelectors: [
      'iframe.ke-edit-iframe body',
      '.ke-edit-iframe',
      '#ctl00_body_txtContent',
      'textarea[name="ctl00$body$txtContent"]',
    ],
  },
  {
    id: 'b2b168',
    name: '八方资源网',
    icon: 'https://www.b2b168.com/favicon.ico',
    homepage: 'https://www.b2b168.com/',
    loginUrl: 'https://m.b2b168.com/',
    publishUrl: 'https://m.b2b168.com/index.aspx?pg=glNews&t=0',
    domains: ['.b2b168.com'],
    envNames: ['WEIBOT_B2B168_CDP_PORT', 'B2B168_CDP_PORT'],
    preferredHost: 'b2b168.com',
    titleSelectors: ['#Subject', 'input[name="Subject"]'],
    editorSelectors: [
      'iframe.ke-edit-iframe body',
      '.ke-edit-iframe',
      '#Content',
      'textarea[name="Content"]',
    ],
  },
  {
    id: 'app17',
    name: '阿仪网',
    icon: 'https://www.app17.com/favicon.ico',
    homepage: 'http://www.app17.com/',
    loginUrl: 'https://user.app17.com/user.aspx?index/index',
    publishUrl: 'https://user.app17.com/user.aspx?article/articleedit',
    domains: ['.app17.com'],
    envNames: ['WEIBOT_APP17_CDP_PORT', 'APP17_CDP_PORT'],
    preferredHost: 'app17.com',
    titleSelectors: ['#Title', 'input[name="Title"]'],
    editorSelectors: [
      '#ueditor_0 body.view',
      '#ueditor_0 body',
      'iframe[id^="ueditor_"] body.view',
      'iframe[id^="ueditor_"] body',
    ],
  },
  {
    id: 'huangye88',
    name: '黄页88网',
    icon: 'https://www.huangye88.com/favicon.ico',
    homepage: 'http://www.huangye88.com/',
    loginUrl: 'https://my.huangye88.com/',
    publishUrl: 'https://fabuxinxi.huangye88.com/',
    domains: ['.huangye88.com'],
    envNames: ['WEIBOT_HUANGYE88_CDP_PORT', 'HUANGYE88_CDP_PORT'],
    preferredHost: 'huangye88.com',
    titleSelectors: ['input[name="title"]', '#title', 'input[placeholder*="标题"]'],
    editorSelectors: ['textarea[name="content"]', '#content', '[contenteditable="true"]'],
  },
  {
    id: '51sole',
    name: '搜了网',
    icon: 'https://www.51sole.com/favicon.ico',
    homepage: 'http://www.51sole.com/',
    loginUrl: 'https://user.51sole.com/user/WebSiteInfo.aspx',
    publishUrl: 'https://user.51sole.com/user/web/send_information.aspx',
    domains: ['.51sole.com'],
    envNames: ['WEIBOT_51SOLE_CDP_PORT', 'SOLE51_CDP_PORT'],
    preferredHost: '51sole.com',
    titleSelectors: ['#txtTitle', 'input[name="txtTitle"]'],
    editorSelectors: [
      'iframe.ke-edit-iframe body',
      '.ke-edit-iframe',
      '#txtDescription',
      'textarea[name="txtDescription"]',
    ],
  },
]

export class ChinaVisionAdapter extends BrowserFormAdapter {
  constructor() {
    super(INDUSTRY_FORUM_PLATFORMS[0]!)
  }
}

export class BjxClubAdapter extends BrowserFormAdapter {
  constructor() {
    super(INDUSTRY_FORUM_PLATFORMS[1]!)
  }
}

export class ElecfansAdapter extends BrowserFormAdapter {
  constructor() {
    super(INDUSTRY_FORUM_PLATFORMS[2]!)
  }
}

export class EetChinaAdapter extends BrowserFormAdapter {
  constructor() {
    super(INDUSTRY_FORUM_PLATFORMS[3]!)
  }
}

export class EeworldAdapter extends BrowserFormAdapter {
  constructor() {
    super(INDUSTRY_FORUM_PLATFORMS[4]!)
  }
}

export class QiehaoAdapter extends BrowserFormAdapter {
  constructor() {
    super(INDUSTRY_FORUM_PLATFORMS[5]!)
  }
}

export class Ca800Adapter extends BrowserFormAdapter {
  constructor() {
    super(INDUSTRY_FORUM_PLATFORMS[6]!)
  }
}

export class B2b168Adapter extends BrowserFormAdapter {
  constructor() {
    super(INDUSTRY_FORUM_PLATFORMS[7]!)
  }
}

export class App17Adapter extends BrowserFormAdapter {
  constructor() {
    super(INDUSTRY_FORUM_PLATFORMS[8]!)
  }
}

export class Huangye88Adapter extends BrowserFormAdapter {
  constructor() {
    super(INDUSTRY_FORUM_PLATFORMS[9]!)
  }
}

export class Sole51Adapter extends BrowserFormAdapter {
  constructor() {
    super(INDUSTRY_FORUM_PLATFORMS[10]!)
  }
}
