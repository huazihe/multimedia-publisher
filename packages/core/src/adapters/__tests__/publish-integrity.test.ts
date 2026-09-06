import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runInNewContext } from 'node:vm'
import { WeixinAdapter } from '../platforms/weixin'
import { WoshipmAdapter } from '../platforms/woshipm'
import { ChinaVisionAdapter, QiehaoAdapter } from '../platforms/browser-form'
import { prepareArticleForPlatform } from '../prepare'
import type { RuntimeInterface } from '../../runtime/interface'
import type { Article, PublishOptions } from '../../index'

const browser = vi.hoisted(() => ({ connect: vi.fn() }))
vi.mock('../../lib/cdp', () => ({ connectCdpPage: browser.connect, delay: vi.fn(), resolveEnvPort: () => 9333 }))

const article: Article = { title: '回归测试', markdown: '完整正文', html: '<p>完整正文</p>' }
const image = 'data:image/png;base64,cG5n'
const source = 'https://images.example.com/a.png?token=IMAGE-SECRET'
const hosted = 'https://mmbiz.qpic.cn/mmbiz_png/verified/0?wx_fmt=png'
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
const authHtml = "data: { t: 'AUTH-SECRET' }, ticket: 'TICKET-SECRET', user_name: 'mock-id', nick_name: '测试', time: '1'"

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); browser.connect.mockReset() })

async function weixinSetup(imageReply?: () => Response | Promise<Response>, uploadReply?: () => Response) {
  const fetch = vi.fn(async (url: string) => {
    if (url === 'https://mp.weixin.qq.com/') return new Response(authHtml)
    if (url.includes('/cgi-bin/operate_appmsg?')) return json({ appMsgId: '123', base_resp: { ret: 0 } })
    if (url.includes('/cgi-bin/filetransfer?')) return uploadReply?.() || json({ base_resp: { err_msg: 'ok', ret: 0 }, cdn_url: hosted })
    if (url === image || url.startsWith('https://images.example.com/') || url.startsWith('https://evil.example.com/')) {
      return imageReply?.() || new Response(new Blob(['png'], { type: 'image/png' }))
    }
    throw new Error('Unexpected mock fetch')
  })
  vi.stubGlobal('fetch', fetch)
  const adapter = new WeixinAdapter()
  await adapter.init({ fetch } as unknown as RuntimeInterface)
  return { adapter, fetch }
}

describe('Weixin image integrity and draft-only contracts', () => {
  it.each([
    () => new Response('denied', { status: 403 }),
    () => { throw new Error('NETWORK-SECRET AUTH-SECRET ' + source) },
  ])('blocks a draft when an image cannot be downloaded and redacts errors/logs', async imageReply => {
    const { adapter, fetch } = await weixinSetup(imageReply)
    const result = await adapter.publish({ ...article, html: `<img src="${source}">` })
    expect(result.success).toBe(false)
    expect(fetch.mock.calls.some(([url]) => url.includes('/operate_appmsg?'))).toBe(false)
    expect(result.error).toMatch(/第 1 张图片|图片.*失败/)
    const output = JSON.stringify({ result, log: vi.mocked(console.log).mock.calls, error: vi.mocked(console.error).mock.calls })
    expect(output).not.toMatch(/IMAGE-SECRET|NETWORK-SECRET|AUTH-SECRET|TICKET-SECRET/)
  })

  it.each([
    () => json({ base_resp: { ret: 1, err_msg: 'UPLOAD-SECRET' } }),
    () => json({ base_resp: { ret: 0, err_msg: 'ok' }, cdn_url: hosted }, 500),
    () => json({ base_resp: { ret: 0, err_msg: 'ok' }, cdn_url: 'https://evil.example.com/?mmbiz.qpic.cn' }),
    () => new Response('UPLOAD-SECRET invalid JSON'),
  ])('blocks a draft when image upload lacks a valid receipt', async uploadReply => {
    const { adapter, fetch } = await weixinSetup(undefined, uploadReply)
    const result = await adapter.publish({ ...article, html: `<img src='${image}'>` })
    expect(result.success).toBe(false)
    expect(fetch.mock.calls.some(([url]) => url.includes('/operate_appmsg?'))).toBe(false)
    expect(JSON.stringify({ result, log: vi.mocked(console.log).mock.calls })).not.toContain('UPLOAD-SECRET')
  })

  it.each(['<img src=/uploads/a.png>', '<img>', '<img src="">', '<img src="file:///tmp/private.png">'])('does not let an unprocessed image through: %s', async badImage => {
    const { adapter, fetch } = await weixinSetup()
    const result = await adapter.publish({ ...article, html: `<img src='${image}'>${badImage}` })
    expect(result.success).toBe(false)
    expect(fetch.mock.calls.some(([url]) => url.includes('/filetransfer?') || url.includes('/operate_appmsg?'))).toBe(false)
  })

  it('also enforces strict images for a WeChat-source article', async () => {
    const { adapter, fetch } = await weixinSetup(() => new Response('', { status: 404 }))
    const result = await adapter.publish({ ...article, source: { platform: 'weixin', url: 'https://mp.weixin.qq.com/s/example' }, html: `<img src="${source}">` })
    expect(result.success).toBe(false)
    expect(fetch.mock.calls.some(([url]) => url.includes('/operate_appmsg?'))).toBe(false)
  })

  it('does not send credentials to image downloads or upload downloaded login HTML', async () => {
    const { adapter, fetch } = await weixinSetup(() => new Response('<html>login</html>', { headers: { 'Content-Type': 'text/html' } }))
    const result = await adapter.publish({ ...article, html: `<img src="${source}">` })
    expect(result.success).toBe(false)
    expect(fetch).toHaveBeenCalledWith(source, { credentials: 'omit', redirect: 'error' })
    expect(fetch.mock.calls.some(([url]) => url.includes('/filetransfer?') || url.includes('/operate_appmsg?'))).toBe(false)
  })

  it('preserves hosted images and handles lazy data-src without treating a lookalike host as hosted', async () => {
    const { adapter, fetch } = await weixinSetup(() => new Response('', { status: 403 }))
    const result = await adapter.publish({ ...article, html: `<img src="${hosted}"><img data-src="https://evil.example.com/?mmbiz.qpic.cn" src="${hosted}">` })
    expect(result.success).toBe(false)
    expect(fetch.mock.calls.some(([url]) => url === 'https://evil.example.com/?mmbiz.qpic.cn')).toBe(true)
    expect(fetch.mock.calls.some(([url]) => url.includes('/operate_appmsg?'))).toBe(false)
  })

  it('returns uncertain after a draft request loses its response without retrying', async () => {
    const { adapter, fetch } = await weixinSetup()
    await adapter.checkAuth()
    fetch.mockRejectedValueOnce(new Error('AUTH-SECRET connection lost after saving'))
    const result = await adapter.publish(article)
    expect(result).toMatchObject({ success: false, uncertain: true, postUrl: 'https://mp.weixin.qq.com' })
    expect(result.message).toContain('不要重复提交')
    expect(result.error).not.toContain('AUTH-SECRET')
    expect(fetch.mock.calls.filter(([url]) => url.includes('/operate_appmsg?'))).toHaveLength(1)
  })

  it('preserves alt text, uploads repeated images once and strips alternate local sources', async () => {
    const { adapter, fetch } = await weixinSetup()
    const result = await adapter.publish({ ...article, html: `<picture><source srcset="/uploads/wrong.png"><img src='${image}' alt="图示"></picture><img src=${image} srcset="/uploads/wrong.png 2x">` })
    expect(result.success).toBe(true)
    expect(fetch.mock.calls.filter(([url]) => url.includes('/filetransfer?'))).toHaveLength(1)
    const call = fetch.mock.calls.find(([url]) => url.includes('/operate_appmsg?'))!
    const body = ((fetch.mock.calls as unknown as Array<[string, RequestInit]>).find(([url]) => url === call[0])![1].body as URLSearchParams).get('content0') || ''
    expect(body).toContain('alt="图示"')
    expect(body).not.toMatch(/data:image|\/uploads\/|srcset|<source/)
  })

  it.each(['weixin', 'woshipm'])('rejects %s direct mode before any side effect', async id => {
    for (const options of [{ publishMode: 'direct', draftOnly: true }, { draftOnly: false }] as PublishOptions[]) {
      const fetch = vi.fn()
      const adapter = id === 'weixin' ? new WeixinAdapter() : new WoshipmAdapter()
      const add = vi.fn()
      await adapter.init({ fetch, headerRules: { add, remove: vi.fn() } } as unknown as RuntimeInterface)
      const result = await adapter.publish(article, options)
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/不支持|仅支持|只支持/)
      expect(fetch).not.toHaveBeenCalled()
      expect(add).not.toHaveBeenCalled()
    }
  })
})

async function browserSetup(qiehao = false, receipt?: unknown) {
  const url = qiehao ? 'https://om.qq.com/main/creation/article' : 'https://www.china-vision.org/user-add-news.html'
  const remoteFetch = vi.fn().mockResolvedValue(json(receipt ?? { code: 0, data: { articleId: 'q-123' } }))
  const client = {
    navigate: vi.fn().mockResolvedValue(undefined), close: vi.fn(), send: vi.fn().mockResolvedValue({}),
    evaluate: vi.fn(async (script: string) => {
      if (script.includes('/marticlepublish/omSave')) {
        return runInNewContext(script, { window: { OM_SiteInfo: { userInfo: { mediaId: 'mock' } } }, location: { href: url }, fetch: remoteFetch })
      }
      if (script === 'location.href') return url
      return { ok: true, titleFilled: true, contentFilled: true, url, submitHint: '发布' }
    }),
  }
  browser.connect.mockResolvedValue(client)
  const adapter = qiehao ? new QiehaoAdapter() : new ChinaVisionAdapter()
  await adapter.init({ type: 'node', cookies: { get: async () => [] } } as unknown as RuntimeInterface)
  return { adapter, client, remoteFetch, url }
}

describe('BrowserForm results require a verifiable receipt', () => {
  it.each(['draft', 'direct'] as const)('reports %s as uncertain after page fill / button click', async publishMode => {
    const { adapter, url } = await browserSetup()
    const result = await adapter.publish(article, { publishMode })
    expect(result).toMatchObject({ success: false, uncertain: true, postUrl: url })
    expect(result.postId).toBeUndefined()
    expect(result.draftOnly).toBeUndefined()
    expect(result.message).toMatch(/核查|检查|确认/)
  })

  it('requires an article id alongside the qiehao API success code', async () => {
    const { adapter, remoteFetch } = await browserSetup(true, { code: 0, data: {} })
    expect(await adapter.publish(article, { publishMode: 'draft' })).toMatchObject({ success: false, uncertain: true })
    expect(remoteFetch).toHaveBeenCalledOnce()
  })

  it('keeps a confirmed qiehao draft receipt successful', async () => {
    const { adapter } = await browserSetup(true)
    expect(await adapter.publish(article, { publishMode: 'draft' })).toMatchObject({ success: true, postId: 'q-123', draftOnly: true })
  })

  it.each([
    { title: 'HTML image', html: '<p>正文</p><img src=/uploads/chart.png>' },
    { title: 'lazy image', html: '<p>正文</p><img data-src="https://images.example.com/chart.png">' },
    { title: 'Markdown image', markdown: '正文\n\n![图](https://images.example.com/chart.png)' },
    { title: 'reference image', markdown: '正文\n\n![图][chart]\n\n[chart]: https://images.example.com/chart.png' },
    { title: 'cover', markdown: '正文', cover: image },
    { title: 'prepared text with original HTML image', markdown: '正文', html: '<p>正文</p><img src="https://images.example.com/chart.png">' },
  ] as Article[])('rejects qiehao $title before any browser or remote operation', async input => {
    const { adapter, remoteFetch, client } = await browserSetup(true)
    for (const options of [undefined, { publishMode: 'draft' }, { publishMode: 'direct' }, { draftOnly: false }] as (PublishOptions | undefined)[]) {
      const result = await adapter.publish(input, options)
      expect(result.success).toBe(false)
      expect(result.uncertain).toBeUndefined()
      expect(result.draftOnly).toBeUndefined()
    }
    expect(browser.connect).not.toHaveBeenCalled()
    expect(client.evaluate).not.toHaveBeenCalled()
    expect(remoteFetch).not.toHaveBeenCalled()
  })

  it('blocks the actual qiehao preparation path that retains image HTML but emits text', async () => {
    const { adapter, remoteFetch } = await browserSetup(true)
    const prepared = prepareArticleForPlatform({ title: '图文', html: '<p>正文</p><img src="https://images.example.com/chart.png">' }, 'qiehao')
    expect(prepared.imageCount).toBe(1)
    expect(prepared.format).toBe('text')
    const result = await adapter.publish(prepared.article, { publishMode: 'draft' })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/图片|带图/)
    expect(browser.connect).not.toHaveBeenCalled()
    expect(remoteFetch).not.toHaveBeenCalled()
  })

  it('does not mistake escaped HTML or Markdown code examples for qiehao images', async () => {
    const { adapter, remoteFetch } = await browserSetup(true)
    const result = await adapter.publish({
      title: '代码示例',
      html: '<p>正文</p><code>&lt;img src="example.png"&gt;</code>',
      markdown: '正文\n\n```md\n![图](example.png)\n```',
    }, { publishMode: 'draft' })
    expect(result).toMatchObject({ success: true, draftOnly: true })
    expect(remoteFetch).toHaveBeenCalledOnce()
  })

  it('does not repeat a potentially mutating fill after a transport error', async () => {
    const { adapter, client, url } = await browserSetup()
    client.evaluate.mockRejectedValue(new Error('CDP disconnected after input'))
    const result = await adapter.publish(article, { publishMode: 'draft' })
    expect(result).toMatchObject({ success: false, uncertain: true, postUrl: url })
    expect(client.evaluate).toHaveBeenCalledOnce()
  })
})
