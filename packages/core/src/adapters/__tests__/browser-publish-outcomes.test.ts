import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { runInNewContext } from 'node:vm'
import fs from 'node:fs'
import path from 'node:path'
import { DouyinAdapter } from '../platforms/douyin'
import type { RuntimeInterface } from '../../runtime/interface'

const browser = vi.hoisted(() => ({ connect: vi.fn() }))
const hasPrivateXhs = !fs.readFileSync(new URL('../platforms/xiaohongshu.ts', import.meta.url), 'utf8').includes('PUBLIC_MANUAL_FALLBACK')
let XiaohongshuAdapter: typeof import('../platforms/xiaohongshu').XiaohongshuAdapter
beforeAll(async () => {
  // This private adapter may be a symlink to the shared checkout. Mock its real
  // CDP dependency, so tests never connect to either checkout's live browser.
  const adapterFile = fs.realpathSync(new URL('../platforms/xiaohongshu.ts', import.meta.url))
  const cdpFile = path.resolve(path.dirname(adapterFile), '../../lib/cdp.ts')
  vi.doMock(cdpFile, () => ({ connectCdpPage: browser.connect, delay: vi.fn(), resolveEnvPort: () => 9333 }))
  XiaohongshuAdapter = (await import('../platforms/xiaohongshu')).XiaohongshuAdapter
})
vi.mock('node:fs/promises', async importOriginal => ({
  ...await importOriginal<typeof import('node:fs/promises')>(),
  mkdtemp: async () => '/tmp/mock-xhs-test',
  writeFile: async () => undefined,
}))

const article = { title: '回归标题', markdown: '正文'.repeat(100), cover: 'data:image/png;base64,cG5n' }
const xhsUrl = 'https://creator.xiaohongshu.com/publish/publish?source=official'
const douyinUrl = 'https://creator.douyin.com/creator-micro/content/post/article?default-tab=5&enter_from=publish_page&media_type=article&type=new'
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new Blob(['png'], { type: 'image/png' }))))
  vi.spyOn(fs.promises, 'writeFile').mockResolvedValue(undefined)
  vi.spyOn(fs.promises, 'unlink').mockResolvedValue(undefined)
  vi.stubEnv('WEIBOT_DOUYIN_CDP_PORT', '9333')
})
afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); browser.connect.mockReset()
})

async function xhsSetup(imageCount = 1) {
  const client = {
    navigate: vi.fn().mockResolvedValue(undefined), close: vi.fn(), setFileInputFiles: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue({ cookies: [{ name: 'web_session', domain: '.xiaohongshu.com' }] }),
    evaluate: vi.fn(async (script: string) => {
      if (script === 'location.href') return xhsUrl
      if (script.includes('const dialogs =')) return { url: xhsUrl, text: '', dialogs: [] }
      if (script.includes('submitHint:')) return { ok: true, url: xhsUrl, x: 500, y: 500, disabled: false }
      if (script.includes('const imageCount =')) return { ok: true, url: xhsUrl, imageCount }
      if (script.includes('return Boolean(tab)')) return true
      return {}
    }),
  }
  browser.connect.mockResolvedValue(client)
  const adapter = new XiaohongshuAdapter()
  await adapter.init({ type: 'node' } as RuntimeInterface)
  return { adapter, client }
}

describe.skipIf(!hasPrivateXhs)('Xiaohongshu optional private implementation: no confirmed cloud draft or publication receipt', () => {
  it('rejects excess images and overlong titles before upload, without truncation',async()=>{
    const {adapter}=await xhsSetup();
    const tooMany={...article,cover:undefined,markdown:'正文\n\n'+Array.from({length:10},(_,i)=>`![图](https://example.com/${i}.png)`).join('\n')};
    expect(await adapter.publish(tooMany,{publishMode:'direct'})).toMatchObject({success:false,error:expect.stringContaining('9张')});
    expect(await adapter.publish({...article,title:'长'.repeat(39)},{publishMode:'direct'})).toMatchObject({success:false,error:expect.stringContaining('未自动截断')});
    expect(browser.connect).not.toHaveBeenCalled();
  })
  it.each(['draft', 'direct'] as const)('reports %s as uncertain with no fabricated post id', async publishMode => {
    const { adapter, client } = await xhsSetup()
    const result = await adapter.publish(article, { publishMode })
    expect(result.error).not.toMatch(/CDP_PORT|runtime/)
    expect(result).toMatchObject({ success: false, uncertain: true, postUrl: xhsUrl })
    expect(result.postId).toBeUndefined()
    expect(result.draftOnly).toBeUndefined()
    expect(result.message).toContain('不要重复提交')
    if (publishMode === 'direct') expect(client.send.mock.calls.filter(([method]) => method === 'Input.dispatchMouseEvent')).toHaveLength(3)
    else expect(client.send.mock.calls.some(([method]) => method === 'Input.dispatchMouseEvent')).toBe(false)
  })

  it('marks an upload transport failure uncertain without clicking publish or retrying', async () => {
    const { adapter, client } = await xhsSetup()
    client.setFileInputFiles.mockRejectedValue(new Error('CDP disconnected after upload'))
    expect(await adapter.publish(article, { publishMode: 'direct' })).toMatchObject({ success: false, uncertain: true, postUrl: xhsUrl })
    expect(client.setFileInputFiles).toHaveBeenCalledOnce()
    expect(client.send.mock.calls.some(([method]) => method === 'Input.dispatchMouseEvent')).toBe(false)
  })

  it('rejects missing input as a definite failure without browser interaction', async () => {
    const { adapter } = await xhsSetup()
    const result = await adapter.publish({ title: '标题', markdown: '' })
    expect(result.success).toBe(false)
    expect(result.uncertain).toBeUndefined()
    expect(browser.connect).not.toHaveBeenCalled()
  })

  it('does not click publish when the image count is incomplete', async () => {
    const { adapter, client } = await xhsSetup(0)
    const result = await adapter.publish(article, { publishMode: 'direct' })
    expect(result).toMatchObject({ success: false, uncertain: true })
    expect(result.error).toContain('全部图片')
    expect(client.send.mock.calls.some(([method]) => method === 'Input.dispatchMouseEvent')).toBe(false)
    expect(adapter.meta.capabilities).not.toContain('draft')
  })
})

async function douyinSetup(options: { read?: (draft: Record<string, unknown>) => unknown; saveStatus?: number; disconnected?: boolean; uploadPending?: boolean } = {}) {
  let stored: Record<string, unknown> = {}
  const remoteFetch = vi.fn(async (_url: string, init: RequestInit) => {
    const request = JSON.parse(String(init.body)).item.common.draft
    if (request.req_type === 3) return json(options.read ? options.read(stored) : { status_code: 0, draft: stored })
    stored = request
    if (options.disconnected) throw new Error('Connection lost after draft write')
    return json({ status_code: 0 }, options.saveStatus || 200)
  })
  const client = {
    close: vi.fn(), waitForEvent: vi.fn().mockResolvedValue({ backendNodeId: 1 }),
    send: vi.fn(async (method: string, params?: { expression?: string }) => {
      if (method !== 'Runtime.evaluate') return {}
      const script = params?.expression || ''
      let value: unknown
      if (script.includes('fetch(')) value = await runInNewContext(script, { fetch: remoteFetch })
      else if (script.startsWith('Boolean(')) value = true
      else if (script.includes('const modal =')) value = false
      else if (script.includes('const uploading =')) value = { uploading: !!options.uploadPending, hasImageHint: !options.uploadPending, text: '' }
      else if (script.includes('const toastText =')) value = { url: douyinUrl, toastText: '' }
      else value = { ok: true, url: douyinUrl, titleFilled: true, summaryFilled: true, bodyFilled: true, coverUploaded: true, x: 500, y: 500 }
      return { result: { value } }
    }),
  }
  const adapter = new DouyinAdapter()
  // The connection is the external boundary; publish/saveDraft and their page
  // scripts still run, with API calls evaluated against the mock backend above.
  vi.spyOn(adapter as unknown as { connect: () => Promise<unknown> }, 'connect').mockResolvedValue(client)
  await adapter.init({ type: 'node' } as RuntimeInterface)
  return { adapter, client, remoteFetch }
}

describe('Douyin distinguishes a read-back draft from an unconfirmed click', () => {
  it('rejects overlong titles without silently truncating them',async()=>{
    const {adapter,client}=await douyinSetup();
    expect(await adapter.publish({...article,title:'长'.repeat(31)},{publishMode:'direct'})).toMatchObject({success:false,error:expect.stringContaining('未自动截断')});
    expect(client.send).not.toHaveBeenCalled();
  })
  it.each(['draft','direct'] as const)('rejects inline images before browser interaction in %s mode', async publishMode => {
    const {adapter,client,remoteFetch}=await douyinSetup();
    const result=await adapter.publish({...article,markdown:'正文\n\n![图](https://example.com/a.png)'},{publishMode});
    expect(result).toMatchObject({success:false});expect(result.uncertain).toBeUndefined();expect(result.error).toContain('内嵌图片');
    expect(client.send).not.toHaveBeenCalled();expect(remoteFetch).not.toHaveBeenCalled();
  })
  it('rejects a draft cover rather than silently dropping it', async()=>{
    const {adapter,remoteFetch}=await douyinSetup();
    expect(await adapter.publish(article,{publishMode:'draft'})).toMatchObject({success:false,error:expect.stringContaining('封面')});
    expect(remoteFetch).not.toHaveBeenCalled();
  })
  it('does not call a button click a published article, even without visible errors', async () => {
    vi.useFakeTimers()
    const { adapter, client } = await douyinSetup()
    const pending = adapter.publish(article, { publishMode: 'direct' })
    await vi.runAllTimersAsync()
    const result = await pending
    expect(client.send.mock.calls.some(([method]) => method === 'Input.dispatchMouseEvent')).toBe(true)
    expect(result).toMatchObject({ success: false, uncertain: true, postUrl: douyinUrl })
    expect(result.postId).toBeUndefined()
    expect(result.draftOnly).toBeUndefined()
    expect(result.message).toContain('不要重复提交')
  })

  it('confirms a text draft only after reading back this request and the complete body', async () => {
    const { adapter, remoteFetch } = await douyinSetup()
    const result = await adapter.publish({ ...article, cover: undefined }, { publishMode: 'draft' })
    expect(result).toMatchObject({ success: true, draftOnly: true })
    expect(result.postId).toMatch(/^codex\d+$/)
    expect(result.uncertain).toBeUndefined()
    expect(remoteFetch).toHaveBeenCalledTimes(2)
  })

  it('does not reach the final publish button if the cover upload never settles', async () => {
    vi.useFakeTimers()
    const { adapter, client } = await douyinSetup({ uploadPending: true })
    const pending = adapter.publish(article, { publishMode: 'direct' })
    await vi.runAllTimersAsync()
    expect(await pending).toMatchObject({ success: false, uncertain: true })
    expect(client.send.mock.calls.some(([, params]) => params?.expression?.includes('没有找到抖音文章底部'))).toBe(false)
  })

  it.each([
    (draft: Record<string, unknown>) => ({ status_code: 0, draft: { ...draft, creation_id: 'previous-draft' } }),
    (draft: Record<string, unknown>) => ({ status_code: 0, draft: { ...draft, long_article: String(draft.long_article).slice(0, 80) } }),
    (draft: Record<string, unknown>) => ({ status_code: 0, draft: { ...draft, title: '别的标题' } }),
    () => ({ status_code: 0 }),
    () => ({ status_code: 1, status_msg: 'server failure' }),
  ])('does not accept a stale, truncated or missing draft: %#', async read => {
    const { adapter, remoteFetch } = await douyinSetup({ read })
    expect(await adapter.publish({ ...article, cover: undefined }, { publishMode: 'draft' })).toMatchObject({ success: false, uncertain: true })
    expect(remoteFetch).toHaveBeenCalledTimes(2)
  })

  it.each([{ saveStatus: 500 }, { disconnected: true }])('does not retry ambiguous draft writes: %j', async options => {
    const { adapter, remoteFetch } = await douyinSetup(options)
    const result = await adapter.publish({ ...article, cover: undefined }, { publishMode: 'draft' })
    expect(result).toMatchObject({ success: false, uncertain: true })
    expect(result.message).toContain('不要重复提交')
    expect(remoteFetch).toHaveBeenCalledOnce()
  })
})
