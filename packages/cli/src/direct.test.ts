import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  adapterRegistry,
  type Article,
  type PlatformAdapter,
  type SyncResult,
} from '@weibot/core'
import type { Command } from 'commander'
import { describe, expect, it, vi } from 'vitest'
import { buildPlatformPreview, runDirectPreview, runDirectSync } from './direct'

const fixtureFile = fileURLToPath(new URL('../test/fixtures/article.md', import.meta.url))

describe('buildPlatformPreview', () => {
  it('returns Xiaohongshu text containing the article body', () => {
    const preview = buildPlatformPreview(fixtureFile, 'xiaohongshu', {})

    expect(preview.format).toBe('text')
    expect(preview.content).toContain('正文里保留这句用于预览断言')
    expect(preview.content).not.toContain('**跨平台准备**')
    expect(preview.article.markdown).toBe(preview.content)
  })

  it('returns Markdown for zip downloads', () => {
    const preview = buildPlatformPreview(fixtureFile, 'zip-download', {})

    expect(preview.format).toBe('markdown')
    expect(preview.content).toContain('## 核心观点')
    expect(preview.content).toContain('**跨平台准备**')
    expect(preview.article.markdown).toBe(preview.content)
  })

  it('rejects an unknown platform with a clear error', () => {
    expect(() => buildPlatformPreview(fixtureFile, 'unknown-platform', {}))
      .toThrow('平台不存在: unknown-platform')
  })
})

describe('runDirectPreview', () => {
  it('prints one parseable JSON object line without runtime side effects', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const readFileSpy = vi.spyOn(fs, 'readFileSync')
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('preview attempted network access')
    })

    try {
      await runDirectPreview(fixtureFile, {
        platform: 'xiaohongshu',
        title: '命令行覆盖标题',
      })

      expect(logSpy).toHaveBeenCalledTimes(1)
      expect(logSpy.mock.calls[0]).toHaveLength(1)

      const line = logSpy.mock.calls[0][0]
      expect(typeof line).toBe('string')
      expect((line as string).split(/\r?\n/)).toHaveLength(1)
      expect(JSON.parse(line as string)).toMatchObject({
        platform: 'xiaohongshu',
        title: '命令行覆盖标题',
        format: 'text',
      })
      expect(fetchSpy).not.toHaveBeenCalled()
      expect(readFileSpy).toHaveBeenCalledTimes(1)
      expect(readFileSpy.mock.calls[0][0]).toBe(fixtureFile)
    } finally {
      fetchSpy.mockRestore()
      readFileSpy.mockRestore()
      logSpy.mockRestore()
    }
  })
})

describe('runDirectSync', () => {
  it('publishes a separately prepared article for every platform', async () => {
    const publishedArticles = new Map<string, Article>()
    const createAdapter = (platform: string): PlatformAdapter => ({
      meta: {
        id: platform,
        name: platform,
        icon: '',
        homepage: '',
        capabilities: ['article', 'draft'],
      },
      async init() {},
      async checkAuth() {
        return { isAuthenticated: true }
      },
      async publish(article): Promise<SyncResult> {
        publishedArticles.set(platform, article)
        return {
          platform,
          success: true,
          draftOnly: true,
          timestamp: Date.now(),
        }
      },
    })
    const getSpy = vi.spyOn(adapterRegistry, 'get')
      .mockImplementation(async platform => createAdapter(platform))
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('sync preparation test attempted network access')
    })
    const previousPort = process.env.WEIBOT_XIAOHONGSHU_CDP_PORT
    const previousExitCode = process.exitCode

    try {
      await runDirectSync(
        fixtureFile,
        { platforms: 'xiaohongshu,zip-download' },
        { xiaohongshuCdpPort: '65535' }
      )

      expect(fetchSpy).not.toHaveBeenCalled()
      expect(publishedArticles.size).toBe(2)

      const xiaohongshuArticle = publishedArticles.get('xiaohongshu')
      const zipArticle = publishedArticles.get('zip-download')
      expect(xiaohongshuArticle?.markdown).toContain('正文里保留这句用于预览断言')
      expect(xiaohongshuArticle?.markdown).not.toContain('**跨平台准备**')
      expect(xiaohongshuArticle?.markdown).not.toContain('![远程示例图]')
      expect(zipArticle?.markdown).toContain('**跨平台准备**')
      expect(zipArticle?.markdown).toContain('![远程示例图]')
    } finally {
      if (previousPort === undefined) {
        delete process.env.WEIBOT_XIAOHONGSHU_CDP_PORT
      } else {
        process.env.WEIBOT_XIAOHONGSHU_CDP_PORT = previousPort
      }
      process.exitCode = previousExitCode
      fetchSpy.mockRestore()
      logSpy.mockRestore()
      getSpy.mockRestore()
    }
  })
})

describe('CLI preview command', () => {
  it('registers the file argument and required platform option', async () => {
    const previousArgv = process.argv
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    try {
      process.argv = ['node', 'weibot']
      const { program } = await import('./index') as { program?: Command }
      const previewCommand = program?.commands.find(command => command.name() === 'preview')

      expect(previewCommand).toBeDefined()
      expect(previewCommand?.registeredArguments.map(argument => ({
        name: argument.name(),
        required: argument.required,
      }))).toEqual([{ name: 'file', required: true }])

      const platformOption = previewCommand?.options.find(option => option.long === '--platform')
      expect(platformOption).toMatchObject({ short: '-p', mandatory: true, required: true })
      expect(previewCommand?.options.find(option => option.long === '--title'))
        .toMatchObject({ short: '-t', mandatory: false, required: true })
      expect(previewCommand?.options.find(option => option.long === '--cover'))
        .toMatchObject({ mandatory: false, required: true })
    } finally {
      process.argv = previousArgv
      writeSpy.mockRestore()
    }
  })
})
