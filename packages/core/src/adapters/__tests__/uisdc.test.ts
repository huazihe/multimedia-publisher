import { describe, expect, it, vi } from 'vitest'
import { UisdcAdapter, UISDC_URLS } from '../platforms'
import { createDefaultAdapterEntries } from '../defaults'
import type { RuntimeInterface } from '../../runtime/interface'
import type { Article, Cookie } from '../../types'
import type { PublishOptions } from '../types'

const article: Article = Object.freeze({
  title: '优设本地测试',
  html: '<p>正文</p><img src="https://example.com/image.png">',
  cover: 'https://example.com/cover.png',
})
const cookie: Cookie = { name: 'uisdcjwt', value: 'mock.jwt.secret', domain: '.uisdc.com', path: '/' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

async function setup(response = json({ data: { id: 123, nickname: '测试作者' } }), cookies: Cookie[] = [cookie]) {
  const fetch = vi.fn().mockResolvedValue(response)
  const getCookies = vi.fn().mockResolvedValue(cookies)
  const adapter = new UisdcAdapter()
  await adapter.init({ fetch, cookies: { get: getCookies } } as unknown as RuntimeInterface)
  return { adapter, fetch, getCookies }
}

describe('UISDC manual integration (mock only; no live account writes)', () => {
  it('registers one manual-only adapter between Xiaohongshu and Douyin and preserves SSPAI', () => {
    const entries = createDefaultAdapterEntries()
    const ids = entries.map(entry => entry.meta.id)
    const index = ids.indexOf('uisdc')
    expect(ids.filter(id => id === 'uisdc')).toHaveLength(1)
    expect(ids.slice(index - 1, index + 2)).toEqual(['xiaohongshu', 'uisdc', 'douyin'])
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain('sspai')
    expect(entries[index].factory({} as RuntimeInterface)).toBeInstanceOf(UisdcAdapter)
    expect(new UisdcAdapter().integrationMode).toBe('manual-only')
    expect(entries[index].meta).toEqual({
      id: 'uisdc', name: '优设', homepage: 'https://www.uisdc.com/',
      icon: 'https://www.uisdc.com/favicon-32x32.ico', capabilities: [],
    })
    expect(UISDC_URLS.login).toBe('https://www.uisdc.com/#login')
    expect(UISDC_URLS.submission).toBe('https://www.uisdc.com/contribution?type=post')
  })

  const modes: Array<PublishOptions | undefined> = [
    undefined, {}, { draftOnly: true }, { draftOnly: false },
    { publishMode: 'draft' }, { publishMode: 'direct' },
    { publishMode: 'direct', draftOnly: true }, { publishMode: 'draft', draftOnly: false },
  ]
  it.each(modes)('rejects every publish mode without touching any runtime capability: %j', async options => {
    const access = vi.fn(() => { throw new Error('Unexpected runtime access') })
    const adapter = new UisdcAdapter()
    await adapter.init(new Proxy({} as RuntimeInterface, { get: access }))
    const progress = vi.fn()
    const result = await adapter.publish(article, options ? { ...options, onImageProgress: progress } : undefined)
    expect(result).toMatchObject({ platform: 'uisdc', success: false, timestamp: expect.any(Number) })
    expect(result.error).toContain('manual-only')
    expect(result.message).toContain(UISDC_URLS.submission)
    expect(result.postId).toBeUndefined()
    expect(result.postUrl).toBeUndefined()
    expect(result.draftOnly).toBeUndefined()
    expect(result.uncertain).toBeUndefined()
    expect(progress).not.toHaveBeenCalled()
    expect(access).not.toHaveBeenCalled()
  })

  it('rejects image upload before using the runtime or claiming an uploaded URL', async () => {
    const access = vi.fn(() => { throw new Error('Unexpected runtime access') })
    const adapter = new UisdcAdapter()
    await adapter.init(new Proxy({} as RuntimeInterface, { get: access }))
    await expect(adapter.uploadImage(new Blob(['local image'], { type: 'image/png' }))).rejects.toThrow('manual-only')
    expect(access).not.toHaveBeenCalled()
  })

  it('checks identity only through the observed read-only endpoint', async () => {
    const { adapter, fetch, getCookies } = await setup()
    expect(await adapter.checkAuth()).toEqual({ isAuthenticated: true, userId: '123', username: '测试作者' })
    expect(getCookies).toHaveBeenCalledOnce()
    expect(getCookies).toHaveBeenCalledWith('uisdc.com')
    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledWith(UISDC_URLS.auth, {
      method: 'GET', credentials: 'include', redirect: 'error',
      headers: { Authorization: 'Bearer mock.jwt.secret' },
    })
  })

  it.each(['uisdc.com', '.uisdc.com', 'www.uisdc.com', '.www.uisdc.com'])('accepts an exact applicable cookie host: %s', async domain => {
    const { adapter } = await setup(undefined, [{ ...cookie, domain }])
    expect((await adapter.checkAuth()).isAuthenticated).toBe(true)
  })

  it.each([
    [],
    [{ ...cookie, name: 'currentUser', value: encodeURIComponent(JSON.stringify({ id: 123 })) }],
    [{ ...cookie, domain: 'eviluisdc.com' }],
    [{ ...cookie, domain: 'uisdc.com.evil.com' }],
    [{ ...cookie, domain: 'assets.uisdc.com' }],
    [{ ...cookie, expirationDate: 1 }],
    [{ ...cookie, expirationDate: Number.NaN }],
    [{ ...cookie, path: '/other' }],
    [{ ...cookie, path: '/api/v1/user/min' }],
    [{ ...cookie, value: '' }],
    [{ ...cookie, value: 'mock.jwt.secret\r\nX-Injected: true' }],
  ].map(cookies => ({ cookies })))('does not authenticate from missing or invalid credentials: %#', async ({ cookies }) => {
    const { adapter, fetch } = await setup(undefined, cookies)
    const result = await adapter.checkAuth()
    expect(result.isAuthenticated).toBe(false)
    expect(result.error).toContain('无法验证')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('supports session cookies and valid path boundaries', async () => {
    const { adapter } = await setup(undefined, [{ ...cookie, expirationDate: -1, path: '/api/v1/user' }])
    expect((await adapter.checkAuth()).isAuthenticated).toBe(true)
  })

  it.each([
    () => json({ code: 'rest_forbidden', data: { status: 401 } }, 401),
    () => json({ data: { id: 123 } }, 403),
    () => json({ data: { id: 123 } }, 500),
    () => json({ code: 'rest_forbidden', data: { id: 123 } }),
    () => json({ data: { id: 0 } }),
    () => json({ data: { id: -1 } }),
    () => json({ data: { id: 'not-an-id' } }),
    () => json({ data: { id: 1.5 } }),
    () => json({ data: { id: true } }),
    () => json({ id: 123 }),
    () => json(null),
    () => new Response('<html>登录</html>'),
    () => new Response(null, { status: 302, headers: { Location: 'https://example.com/' } }),
  ])('does not report login on a failed or malformed identity response: %#', async makeResponse => {
    const { adapter, fetch } = await setup(makeResponse())
    const result = await adapter.checkAuth()
    expect(result.isAuthenticated).toBe(false)
    expect(result.error).toBeTruthy()
    expect(result.userId).toBeUndefined()
    expect(result.username).toBeUndefined()
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('does not expose credential values or raw runtime failures', async () => {
    const { adapter, fetch, getCookies } = await setup()
    fetch.mockRejectedValue(new Error('Bearer mock.jwt.secret'))
    expect(JSON.stringify(await adapter.checkAuth())).not.toContain('mock.jwt.secret')
    getCookies.mockRejectedValue(new Error('cookie mock.jwt.secret'))
    expect(await adapter.checkAuth()).toMatchObject({ isAuthenticated: false, error: expect.stringContaining('无法验证') })
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('still refuses to publish after a successful identity check', async () => {
    const { adapter, fetch, getCookies } = await setup()
    expect((await adapter.checkAuth()).isAuthenticated).toBe(true)
    fetch.mockClear()
    getCookies.mockClear()
    expect((await adapter.publish(article)).success).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
    expect(getCookies).not.toHaveBeenCalled()
  })
})
