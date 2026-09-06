import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  JianshuAdapter, JIANSHU_URLS, JIANSHU_DOMAINS,
  NeteaseAdapter, NETEASE_URLS, NETEASE_DOMAINS,
} from '../platforms'
import { createDefaultAdapterEntries, registerDefaultAdapters } from '../defaults'
import { adapterRegistry } from '../registry'
import type { RuntimeInterface } from '../../runtime/interface'
import type { Article } from '../../types'
import type { PublishOptions } from '../types'

const platforms = [
  {
    Adapter: JianshuAdapter, id: 'jianshu', name: '简书', urls: JIANSHU_URLS,
    domains: JIANSHU_DOMAINS,
    homepage: 'https://www.jianshu.com/', login: 'https://www.jianshu.com/sign_in',
    editor: 'https://www.jianshu.com/writer#/',
    iconHash: 'bf209460fc1c17bfd3e2b84c8e758bc11ca3e570fd411c3bbd84149b97453b99',
  },
  {
    Adapter: NeteaseAdapter, id: 'netease', name: '网易号', urls: NETEASE_URLS,
    domains: NETEASE_DOMAINS,
    homepage: 'https://mp.163.com/', login: 'https://mp.163.com/login.html',
    editor: 'https://mp.163.com/index.html',
    iconHash: '1b6e27e18e92400f312f44c089b6a766bc9a4b027c9576faac714bd2af41475b',
  },
]

const article: Article = Object.freeze({
  title: '本地边界测试', markdown: '正文',
  html: '<p>正文</p><img src="https://example.com/image.png">',
  cover: 'https://example.com/cover.png',
})

function forbiddenRuntime() {
  const access = vi.fn(() => { throw new Error('Unexpected runtime access') })
  return { runtime: new Proxy({} as RuntimeInterface, { get: access }), access }
}

describe.each(platforms)('$name manual integration (no live account activity)', platform => {
  it('exports official entry points and registers exactly one adapter with no automation capabilities', () => {
    const entries = createDefaultAdapterEntries()
    const matches = entries.filter(entry => entry.meta.id === platform.id)
    expect(matches).toHaveLength(1)
    const instance = matches[0].factory({} as RuntimeInterface)
    expect(instance).toBeInstanceOf(platform.Adapter)
    expect(new platform.Adapter().integrationMode).toBe('manual-only')
    expect(matches[0].meta).toEqual({
      id: platform.id, name: platform.name,
      homepage: platform.homepage, icon: platform.urls.icon, capabilities: [],
    })
    expect(platform.urls.homepage).toBe(platform.homepage)
    expect(platform.urls.login).toBe(platform.login)
    expect(platform.urls.editor).toBe(platform.editor)
    for (const url of [platform.homepage, platform.login, platform.editor]) {
      expect(platform.domains as readonly string[]).toContain(new URL(url).hostname)
    }
    expect(new Set(entries.map(entry => entry.meta.id)).size).toBe(entries.length)
  })

  it('can be obtained through the initialized registry without touching the runtime', async () => {
    const { runtime, access } = forbiddenRuntime()
    registerDefaultAdapters(runtime)
    const adapter = await adapterRegistry.get(platform.id)
    expect(adapter).toBeInstanceOf(platform.Adapter)
    expect((await adapter!.publish(article)).success).toBe(false)
    expect(access).not.toHaveBeenCalled()
  })

  it('returns unverified auth, without reading cookies, network responses or browser state', async () => {
    const { runtime, access } = forbiddenRuntime()
    const adapter = new platform.Adapter()
    await adapter.init(runtime)
    const auth = await adapter.checkAuth()
    expect(auth).toEqual({ isAuthenticated: false, error: expect.stringContaining('无法验证') })
    expect(auth.error).toContain(platform.login)
    expect(access).not.toHaveBeenCalled()
  })

  const modes: Array<PublishOptions | undefined> = [
    undefined, {}, { draftOnly: true }, { draftOnly: false },
    { publishMode: 'draft' }, { publishMode: 'direct' },
    { publishMode: 'direct', draftOnly: true }, { publishMode: 'draft', draftOnly: false },
    { publishMode: 'direct', draftOnly: false }, { publishMode: 'draft', draftOnly: true },
  ]
  it.each(modes)('refuses publishing before all runtime access, in mode %j', async options => {
    const { runtime, access } = forbiddenRuntime()
    const adapter = new platform.Adapter()
    await adapter.init(runtime)
    const progress = vi.fn()
    const result = await adapter.publish(article, options ? { ...options, onImageProgress: progress } : undefined)
    expect(result).toEqual({
      platform: platform.id, success: false, timestamp: expect.any(Number),
      error: expect.stringContaining('manual-only'), message: expect.stringContaining(platform.editor),
    })
    expect(result.message).toContain('未上传、未创建草稿、未发布')
    expect(progress).not.toHaveBeenCalled()
    expect(access).not.toHaveBeenCalled()
  })

  it('does not depend on initialization to refuse uploads, auth or publishing', async () => {
    const adapter = new platform.Adapter()
    expect((await adapter.checkAuth()).isAuthenticated).toBe(false)
    expect((await adapter.publish(article)).success).toBe(false)
    await expect(adapter.uploadImage(new Blob(['image']), 'image.png')).rejects.toThrow('manual-only')
  })

  it('rejects an explicit upload without reading the runtime', async () => {
    const { runtime, access } = forbiddenRuntime()
    const adapter = new platform.Adapter()
    await adapter.init(runtime)
    await expect(adapter.uploadImage(new Blob(['image']), 'image.png')).rejects.toThrow('manual-only')
    expect(access).not.toHaveBeenCalled()
  })

  it('keeps the downloaded official icon bytes intact', () => {
    const icon = readFileSync(new URL(`../../../../../publisher-dashboard/public/assets/platform-icons/${platform.id}.png`, import.meta.url))
    expect(icon.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    expect(createHash('sha256').update(icon).digest('hex')).toBe(platform.iconHash)
  })
})

it('retains existing industrial/B2B adapters and prior integrations for compatibility', () => {
  const ids = createDefaultAdapterEntries().map(entry => entry.meta.id)
  for (const id of [
    'china-vision', 'bjx-club', 'elecfans', 'eet-china', 'eeworld', 'ca800',
    'b2b168', 'app17', 'huangye88', '51sole', 'qiehao', 'uisdc', 'sspai',
  ]) expect(ids).toContain(id)
})
