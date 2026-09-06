import { afterEach, describe, expect, it, vi } from 'vitest'
import { WoshipmAdapter } from '../platforms/woshipm'
import type { RuntimeInterface } from '../../runtime/interface'
import { parseHTML } from 'linkedom'

const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN7kAAAAASUVORK5CYII='
const hosted = 'https://image.woshipm.com/test.png'
const uploadEndpoint = 'https://www.woshipm.com/tensorflow/upyun/upload'
const draftEndpoint = 'https://www.woshipm.com/wp-admin/admin-ajax.php'
const imageResponse = () => new Response(new Blob(['png'], { type: 'image/png' }), { status: 200 })
const jsonResponse = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })

class ExposedWoshipm extends WoshipmAdapter {
  transfer(src: string) { return this.uploadImageByUrl(src) }
}
async function adapterWith(fetch: ReturnType<typeof vi.fn>) {
  const adapter = new ExposedWoshipm()
  await adapter.init({ fetch } as unknown as RuntimeInterface)
  return adapter
}
afterEach(() => vi.restoreAllMocks())

describe('woshipm image transfer must fail closed', () => {
  it.each(['/uploads/table-images/local.png', '../private.png', '//evil.invalid/a.png', 'file:///etc/passwd', 'javascript:alert(1)', 'http://127.0.0.1/a.png', 'http://localhost/a.png', 'https://u:secret@evil.invalid/x.png', 'data:text/html;base64,PHNjcmlwdD4='])('rejects invalid/local source before fetch: %s', async src => {
    const fetch = vi.fn()
    const adapter = await adapterWith(fetch)
    await expect(adapter.transfer(src)).rejects.toThrow(/来源无效|尚未内嵌/)
    const result = await adapter.publish({ title: '测试', html: `<p>内容</p><img src='${src}'>` }, { draftOnly: true })
    expect(result.success).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
    expect(result.error).not.toContain('secret')
  })

  it('rejects unquoted/empty local images and validates every source before any transfer', async () => {
    for (const img of ['<img src=/uploads/x.png>', '<img>', '<img src="">']) {
      const fetch = vi.fn()
      const adapter = await adapterWith(fetch)
      const result = await adapter.publish({ title: '测试', html: `<img src="${image}">${img}` })
      expect(result.success).toBe(false)
      expect(result.error).toContain('第 2 张图片')
      expect(fetch).not.toHaveBeenCalled()
    }
  })

  it('throws on download failure with a short source reference and HTTP status', async () => {
    const src = 'https://example.com/image.png?token=very-secret'
    const fetch = vi.fn().mockResolvedValue(new Response('', { status: 403 }))
    const adapter = await adapterWith(fetch)
    await expect(adapter.transfer(src)).rejects.toThrow(/下载失败.*HTTP 403.*image-[a-f0-9]{8}/)
    const result = await adapter.publish({ title: '失败', html: `<img src="${src}">` })
    expect(result.success).toBe(false)
    expect(result.error).toContain('第 1 张图片')
    expect(result.error).not.toContain('very-secret')
    expect(fetch.mock.calls.every(([url]) => url !== draftEndpoint)).toBe(true)
  })

  it('does not log signed URLs, raw runtime errors or long data URIs on image failure', async () => {
    const logs = ['debug', 'info', 'warn', 'error', 'log'].map(method => vi.spyOn(console, method as 'log').mockImplementation(() => {}))
    const longData = 'data:image/png;base64,' + 'AAAA'.repeat(20000)
    const fetch = vi.fn().mockRejectedValue(new Error(`jltoken=secret-cookie; ${longData}`))
    const adapter = await adapterWith(fetch)
    const result = await adapter.publish({ title: '失败', html: `<img src="${longData}">` })
    const output = JSON.stringify({ result, logs: logs.flatMap(log => log.mock.calls) })
    expect(result.success).toBe(false)
    expect(output).not.toContain('secret-cookie')
    expect(output).not.toContain('data:image/')
    expect(output.length).toBeLessThan(2000)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it.each([
    [jsonResponse({ error: 'Bearer SECRET-UPLOAD-KEY' }), /上传响应校验/],
    [jsonResponse({ data: [{ url: hosted }] }, 500), /HTTP 500/],
    [new Response('SECRET invalid JSON', { status: 200 }), /上传失败/],
    [jsonResponse({ data: [{ url: '/uploads/not-uploaded.png' }] }), /上传响应校验/],
    [jsonResponse({ data: [{ url: 'https://evil.invalid/woshipm.com/a.png' }] }), /上传响应校验/],
    [jsonResponse(null), /上传响应校验/],
  ])('does not create a draft after an invalid upload response', async (response, message) => {
    const fetch = vi.fn().mockResolvedValueOnce(imageResponse()).mockResolvedValueOnce(response)
    const adapter = await adapterWith(fetch)
    const result = await adapter.publish({ title: '失败', html: `<img src="${image}">` })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(message as RegExp)
    expect(result.error).not.toContain('SECRET')
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch.mock.calls[1][0]).toBe(uploadEndpoint)
    expect(fetch.mock.calls.some(([url]) => url === draftEndpoint)).toBe(false)
  })

  it('rejects non-images instead of uploading downloaded HTML', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('<html>login</html>', { headers: { 'Content-Type': 'text/html' } }))
    const adapter = await adapterWith(fetch)
    await expect(adapter.transfer('https://example.com/a.png')).rejects.toThrow(/格式或大小/)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('uploads embedded PNG once, preserves alt text, removes alternate sources and posts only the hosted image', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(imageResponse())
      .mockResolvedValueOnce(jsonResponse({ data: [{ url: hosted }] }))
      .mockResolvedValueOnce(jsonResponse({ post_id: 123 }))
    const adapter = await adapterWith(fetch)
    const article = Object.freeze({ title: '成功', html: `<picture><source srcset="/uploads/alternate.png"><img src='${image}' alt="图表"></picture><img src="${image}" srcset="/uploads/local.png 2x" data-src="/uploads/local.png">` })
    const original = article.html
    const progress = vi.fn()
    const result = await adapter.publish(article, { draftOnly: true, onImageProgress: progress })
    expect(result.success).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(fetch.mock.calls[0][1]).toEqual({ credentials: 'omit' })
    expect(fetch.mock.calls[2][0]).toBe(draftEndpoint)
    const body = fetch.mock.calls[2][1].body as URLSearchParams
    const content = body.get('post_content') || ''
    const doc = parseHTML(content).document
    expect(Array.from(doc.querySelectorAll('img')).map(img => img.getAttribute('src'))).toEqual([hosted, hosted])
    expect(doc.querySelector('img')?.getAttribute('alt')).toBe('图表')
    expect(content).not.toMatch(/data:image|\/uploads\/|srcset|<source|data-src/)
    expect(article.html).toBe(original)
    expect(progress).toHaveBeenLastCalledWith(2, 2)
  })

  it('checks exact platform host names rather than matching woshipm text anywhere in a URL', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response('', { status: 404 }))
    const adapter = await adapterWith(fetch)
    const result = await adapter.publish({ title: '伪域名', html: '<img src="https://evil.invalid/?image.woshipm.com">' })
    expect(result.success).toBe(false)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][0]).toBe('https://evil.invalid/?image.woshipm.com')
  })

  it('allows already-hosted platform images without reuploading', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ post_id: 123 }))
    const adapter = await adapterWith(fetch)
    const result = await adapter.publish({ title: '已托管图片', html: `<img src="${hosted}">` })
    expect(result.success).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][0]).toBe(draftEndpoint)
  })
})

describe('woshipm ambiguous draft receipts require manual reconciliation', () => {
  it.each([
    ['connection lost after save', () => { throw new Error('connection lost after save') }],
    ['response body lost', () => ({ ok: true, status: 200, text: async () => { throw new Error('response body lost') } })],
    ['HTTP failure', () => jsonResponse({ post_id: 123 }, 500)],
    ['invalid JSON', () => new Response('<html>gateway error</html>')],
    ['missing draft id', () => jsonResponse({ success: true })],
    ['invalid draft id', () => jsonResponse({ post_id: '0' })],
    ['object draft id', () => jsonResponse({ post_id: { id: 123 } })],
    ['contradictory receipt', () => jsonResponse({ post_id: 123, success: false })],
  ])('marks %s uncertain with an inspection entry and no second request', async (_name, reply) => {
    const fetch = vi.fn().mockImplementation(reply)
    const adapter = await adapterWith(fetch)
    const result = await adapter.publish({ title: '草稿', html: '<p>完整正文</p>' }, { publishMode: 'draft' })
    expect(result).toMatchObject({ success: false, uncertain: true, postUrl: 'https://www.woshipm.com/writing' })
    expect(result.message).toMatch(/不要重复提交/)
    expect(result.draftOnly).toBeUndefined()
    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch.mock.calls[0][0]).toBe(draftEndpoint)
  })

  it('keeps a pre-create image failure definite and does not send a draft request', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('', { status: 403 }))
    const adapter = await adapterWith(fetch)
    const result = await adapter.publish({ title: '草稿', html: '<img src="https://images.example.com/a.png">' })
    expect(result.success).toBe(false)
    expect(result.uncertain).toBeUndefined()
    expect(fetch.mock.calls.some(([url]) => url === draftEndpoint)).toBe(false)
  })

  it.each([123, '123'])('preserves a valid draft receipt: %s', async post_id => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ post_id, success: true }))
    const adapter = await adapterWith(fetch)
    const result = await adapter.publish({ title: '草稿', html: '<p>完整正文</p>' })
    expect(result).toMatchObject({ success: true, postId: '123', draftOnly: true })
    expect(result.uncertain).toBeUndefined()
  })
})
