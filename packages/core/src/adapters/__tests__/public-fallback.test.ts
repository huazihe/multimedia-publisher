import { describe, expect, it } from 'vitest'
import { XiaohongshuManualAdapter } from '../platforms/xiaohongshu-manual'

describe('public optional adapter fallback', () => {
  it('never authenticates, uploads, or publishes in either mode', async () => {
    const adapter = new XiaohongshuManualAdapter()
    expect(adapter.meta.capabilities).toEqual([])
    expect((await adapter.checkAuth()).isAuthenticated).toBe(false)
    for (const publishMode of ['draft', 'direct'] as const) {
      const result = await adapter.publish({title:'Public test',markdown:'Test'}, {publishMode})
      expect(result.success).toBe(false)
      expect(result.message).toContain('未上传')
    }
    await expect(adapter.uploadImage(new Blob(['test']), 'test.png')).rejects.toThrow('手工')
  })
})
