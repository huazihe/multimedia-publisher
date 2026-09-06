import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseHTML } from 'linkedom'
import { SspaiAdapter, SSPAI_URLS } from '../platforms/sspai'
import { createDefaultAdapterEntries } from '../defaults'
import { prepareArticleForPlatform } from '../prepare'
import type { RuntimeInterface } from '../../runtime/interface'
import type { Article, Cookie } from '../../types'

const API = 'https://sspai.com/api/v1'
const authUrl = `${API}/user/info/get`
const addUrl = `${API}/matrix/editor/article/add`
const readUrl = `${API}/matrix/editor/article/single/info/get?id=123`
const signingUrl = `${API}/matrix/editor/attachment/upload/token/get?cname=`
const qiniuUrl = 'https://upload.qiniup.com/'
const cdn = 'https://cdnfile.sspai.com/'
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN7kAAAAASUVORK5CYII='
const article: Article = { title: '少数派适配测试', markdown: '正文内容', html: '<p>正文内容</p>' }
const cookies: Cookie[] = [{ name: 'sspai_jwt_token', value: 'mock-login-secret', domain: 'sspai.com', path: '/' }]
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })
const ok = (data: unknown) => json({ error: 0, data })

async function setup(overrides: Record<string, Response | (() => Response)> = {}, cookieList = cookies) {
  let payload: Record<string, unknown> = {}
  const fetch = vi.fn(async (url: string, options?: RequestInit) => {
    if (url === addUrl && options?.body) payload = JSON.parse(String(options.body))
    const override = overrides[url] || (url.startsWith(signingUrl) ? overrides[signingUrl] : undefined)
    if (override) return typeof override === 'function' ? override() : override
    if (url === authUrl) return ok({ id: 9, nickname: '测试用户' })
    if (url.startsWith(signingUrl)) return ok({ id: 55, key: '2026/09/mock-image.png', token: 'mock-upload-secret' })
    if (url === qiniuUrl) return json({ key: '2026/09/mock-image.png', hash: 'mock-hash' })
    if (url === addUrl) return ok({ id: 123 })
    if (url === readUrl) return ok({ id: 123, ...payload })
    if (url === image || url.startsWith('https://images.example.com/') || url.startsWith(cdn)) {
      return new Response(new Blob(['mock-image-bytes'], { type: 'image/png' }))
    }
    throw new Error('Unexpected request')
  })
  const getCookies = vi.fn().mockResolvedValue(cookieList)
  const adapter = new SspaiAdapter()
  await adapter.init({ fetch, cookies: { get: getCookies } } as unknown as RuntimeInterface)
  return { adapter, fetch, getCookies, payload: () => payload }
}

afterEach(() => vi.restoreAllMocks())

describe('SSPAI public frontend contract (mock only; no live account writes)', () => {
  it('registers one adapter and prepares HTML without claiming direct publishing', () => {
    const entries = createDefaultAdapterEntries()
    expect(entries.filter(entry => entry.meta.id === 'sspai')).toHaveLength(1)
    expect(new Set(entries.map(entry => entry.meta.id)).size).toBe(entries.length)
    expect(entries.find(entry => entry.meta.id === 'sspai')?.meta.capabilities).toEqual(['article', 'draft', 'image_upload', 'cover'])
    const prepared = prepareArticleForPlatform({ title: '格式', markdown: '**加粗**\n\n![图](https://images.example.com/a.png)' }, 'sspai')
    expect(prepared.format).toBe('html')
    expect(prepared.content).toContain('<strong>加粗</strong>')
    expect(prepared.content).toContain('https://images.example.com/a.png')
    expect(prepared.imageCount).toBe(1)
  })

  it('checks current identity through the observed read-only endpoint', async () => {
    const { adapter, fetch } = await setup()
    expect(await adapter.checkAuth()).toEqual({ isAuthenticated: true, userId: '9', username: '测试用户' })
    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledWith(authUrl, {
      method: 'GET', credentials: 'include', redirect: 'error', headers: { Authorization: 'Bearer mock-login-secret' },
    })
  })

  it.each([
    [],
    [{ ...cookies[0], domain: 'evilsspai.com' }],
    [{ ...cookies[0], domain: 'child.sspai.com' }],
    [{ ...cookies[0], expirationDate: 1 }],
    [{ ...cookies[0], value: 'logout' }],
    [{ ...cookies[0], value: 'secret\r\nX-Injected: true' }],
    [{ ...cookies[0], path: '/elsewhere' }],
  ].map(cookieList => ({ cookieList })))('does not authenticate from invalid cookie metadata alone: %#', async ({ cookieList }) => {
    const { adapter, fetch } = await setup({}, cookieList)
    expect((await adapter.checkAuth()).isAuthenticated).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('accepts the observed cross-domain token cookie with an exact SSPAI domain', async () => {
    const { adapter } = await setup({}, [{ ...cookies[0], name: 'sspai_cross_token', domain: '.sspai.com' }])
    expect((await adapter.checkAuth()).isAuthenticated).toBe(true)
  })

  it('honors the frontend cross-domain logout marker even if a JWT cookie remains', async () => {
    const { adapter, fetch } = await setup({}, [...cookies, { ...cookies[0], name: 'sspai_cross_token', value: 'logout' }])
    expect((await adapter.checkAuth()).isAuthenticated).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('allows a session cookie with a negative expiration timestamp', async () => {
    const { adapter } = await setup({}, [{ ...cookies[0], expirationDate: -1 }])
    expect((await adapter.checkAuth()).isAuthenticated).toBe(true)
  })

  it.each([
    json({ error: 3004, msg: '请登录', data: null }),
    json({ error: 0, data: { id: 0 } }),
    json({ error: 0, data: { id: 'not-an-id' } }),
    json({ data: { id: 9 } }),
    json({ error: 0, data: { id: 9 } }, 403),
    new Response('<html>login</html>'),
    json(null),
  ])('requires a successful current-user response, not just a cookie', async response => {
    const { adapter } = await setup({ [authUrl]: response })
    expect((await adapter.checkAuth()).isAuthenticated).toBe(false)
  })

  it.each([{ publishMode: 'direct' as const }, { draftOnly: false }, { publishMode: 'direct' as const, draftOnly: true }])('rejects direct mode before any network or cookie access: %j', async options => {
    const { adapter, fetch, getCookies } = await setup()
    const result = await adapter.publish(article, options)
    expect(result.success).toBe(false)
    expect(result.error).toContain('不支持自动公开发布')
    expect(result.postId).toBeUndefined()
    expect(fetch).not.toHaveBeenCalled()
    expect(getCookies).not.toHaveBeenCalled()
  })

  it('creates type 4 only, sends the observed body fields, and verifies the complete draft', async () => {
    const { adapter, fetch, payload } = await setup()
    const input = Object.freeze({ ...article, tags: ['产品'] })
    const result = await adapter.publish(input, { draftOnly: true })
    expect(result).toMatchObject({ success: true, platform: 'sspai', draftOnly: true, postId: '123', postUrl: `${SSPAI_URLS.editor}/123` })
    expect(payload()).toEqual({ type: 4, banner: '', banner_id: 0, title: article.title, title_last: article.title, body: article.html, body_last: article.html, allow_comment: true, tags: [], custom_tags: ['产品'], delete_status: false })
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([authUrl, addUrl, readUrl])
    expect(fetch.mock.calls[1][1]).toMatchObject({ method: 'POST', credentials: 'include', redirect: 'error' })
    expect(input.html).toBe(article.html)
  })

  it('supports a Markdown-only article', async () => {
    const { adapter, payload } = await setup()
    expect((await adapter.publish({ title: 'Markdown', markdown: '**原文**' })).success).toBe(true)
    expect(payload().body_last).toContain('<strong>原文</strong>')
  })

  it.each(['/uploads/a.png', '', '//images.example.com/a.png', 'file:///tmp/a.png', 'https://evil.com/?image=cdnfile.sspai.com', 'http://127.0.0.1/a.png', 'http://localhost/a.png', 'https://u:secret@images.example.com/a.png', 'data:text/html;base64,YQ=='])('fails before a draft on invalid or failed image input: %s', async src => {
    const { adapter, fetch } = await setup()
    const result = await adapter.publish({ ...article, html: `<img src="${src}">` })
    expect(result.success).toBe(false)
    expect(result.error).not.toContain('secret')
    expect(fetch.mock.calls.some(([url]) => url === addUrl)).toBe(false)
  })

  it('preflights every image and cover before transferring the first valid image', async () => {
    const { adapter, fetch, getCookies } = await setup()
    const result = await adapter.publish({ ...article, html: `<img src='${image}'><img src=/uploads/a.png>`, cover: '/uploads/cover.png' })
    expect(result.success).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
    expect(getCookies).not.toHaveBeenCalled()
  })

  it('transfers repeated images once, preserves alt, removes alternate sources and reuses the upload for cover', async () => {
    const { adapter, fetch, payload } = await setup()
    const progress = vi.fn()
    const result = await adapter.publish({ ...article, html: `<picture><source srcset="/uploads/a.png"><img src='${image}' alt="示意图" data-src="/uploads/b.png"></picture><img src="${image}" srcset="/uploads/c.png 2x">`, cover: image }, { onImageProgress: progress })
    expect(result.success).toBe(true)
    expect(fetch.mock.calls.filter(([url]) => url === qiniuUrl)).toHaveLength(1)
    const uploadOptions = fetch.mock.calls.find(([url]) => url === qiniuUrl)![1]!
    expect(uploadOptions).toMatchObject({ method: 'POST', credentials: 'omit', redirect: 'error' })
    expect(uploadOptions.headers).toBeUndefined()
    const form = uploadOptions.body as FormData
    expect([...form.keys()]).toEqual(['file', 'token', 'key'])
    expect(form.get('token')).toBe('mock-upload-secret')
    expect(form.get('key')).toBe('2026/09/mock-image.png')
    const signingCall = fetch.mock.calls.find(([url]) => url.startsWith(signingUrl))!
    expect(new URL(signingCall[0]).searchParams.get('cname')).toMatch(/^[a-f0-9-]+\.png$/)
    expect(signingCall[1]).toMatchObject({ method: 'GET', headers: { Authorization: 'Bearer mock-login-secret' } })
    expect(payload()).toMatchObject({ banner: '2026/09/mock-image.png', banner_id: 55 })
    const html = String(payload().body_last)
    expect(html).not.toMatch(/data:image|\/uploads\/|srcset|data-src|<source/)
    const doc = parseHTML(html).document
    expect(Array.from(doc.querySelectorAll('img')).map(img => img.getAttribute('src'))).toEqual([cdn + '2026/09/mock-image.png', cdn + '2026/09/mock-image.png'])
    expect(doc.querySelector('img')?.getAttribute('alt')).toBe('示意图')
    expect(progress).toHaveBeenLastCalledWith(2, 2)
  })

  it('keeps existing SSPAI body images without an unnecessary upload', async () => {
    const { adapter, fetch } = await setup()
    expect((await adapter.publish({ ...article, html: `<img src="${cdn}already-hosted.png">` })).success).toBe(true)
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([authUrl, addUrl, readUrl])
  })

  it('transfers an already-hosted cover to obtain a verified attachment id', async () => {
    const { adapter, fetch, payload } = await setup()
    expect((await adapter.publish({ ...article, cover: cdn + 'existing-cover.png' })).success).toBe(true)
    expect(fetch.mock.calls.filter(([url]) => url === qiniuUrl)).toHaveLength(1)
    expect(payload()).toMatchObject({ banner: '2026/09/mock-image.png', banner_id: 55 })
  })

  it.each([
    [signingUrl, ok({ token: 'mock-upload-secret', key: '../unsafe.png', id: 55 })],
    [signingUrl, ok({ token: 'mock-upload-secret', key: 'https://evil.com/a.png', id: 55 })],
    [signingUrl, ok({ token: 'mock-upload-secret', key: 'image.png' })],
    [qiniuUrl, json({ key: 'different.png' })],
    [qiniuUrl, json({ error: 'mock-upload-secret' }, 500)],
    [qiniuUrl, json({})],
    [qiniuUrl, new Response('mock-upload-secret invalid json')],
  ])('does not add a draft when image signing/upload is unverified: %#', async (url, response) => {
    const { adapter, fetch } = await setup({ [url as string]: response as Response })
    const result = await adapter.publish({ ...article, html: `<img src="${image}">` })
    expect(result.success).toBe(false)
    expect(fetch.mock.calls.some(([url]) => url === addUrl)).toBe(false)
    expect(JSON.stringify(result)).not.toContain('mock-upload-secret')
  })

  it.each([
    new Blob(['html'], { type: 'text/html' }),
    new Blob(['webp'], { type: 'image/webp' }),
    new Blob([], { type: 'image/png' }),
    new Blob([new Uint8Array(5 * 1024 * 1024 + 1)], { type: 'image/png' }),
  ])('rejects unsupported binary data before obtaining an upload token', async blob => {
    const { adapter, fetch } = await setup()
    await expect(adapter.uploadImage(blob)).rejects.toThrow(/PNG.*JPEG.*GIF/)
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([
    { id: 123, type: 4, title_last: article.title, body_last: '<p>截断</p>' },
    { id: 123, type: 1, title_last: article.title, body_last: article.html },
    { id: 124, type: 4, title_last: article.title, body_last: article.html },
    { id: 123, type: 4, title_last: '错误标题', body_last: article.html },
  ])('returns a recoverable failure when draft readback does not match: %#', async saved => {
    const { adapter, fetch } = await setup({ [readUrl]: ok(saved) })
    const result = await adapter.publish(article)
    expect(result).toMatchObject({ success: false, postId: '123', postUrl: `${SSPAI_URLS.editor}/123` })
    expect(result.message).toContain('避免重复创建')
    expect(fetch.mock.calls.filter(([url]) => url === addUrl)).toHaveLength(1)
  })

  it('does not claim a saved cover if the returned attachment differs', async () => {
    const { adapter } = await setup({ [readUrl]: ok({ id: 123, type: 4, title_last: article.title, body_last: article.html, banner: 'wrong.png', banner_id: 999 }) })
    expect((await adapter.publish({ ...article, cover: image })).success).toBe(false)
  })

  it('does not retry an ambiguous draft creation or expose raw credentials', async () => {
    const { adapter, fetch } = await setup({ [addUrl]: () => { throw new Error('Bearer mock-login-secret and mock-upload-secret') } })
    const result = await adapter.publish(article)
    expect(result.success).toBe(false)
    expect(result.postUrl).toBe(SSPAI_URLS.drafts)
    expect(result.message).toContain('避免重复创建')
    expect(fetch.mock.calls.filter(([url]) => url === addUrl)).toHaveLength(1)
    expect(JSON.stringify(result)).not.toMatch(/mock-login-secret|mock-upload-secret/)
  })
})
