import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  adapterRegistry,
  type Article,
  type PlatformAdapter,
  type PublishOptions,
  type SyncResult,
} from '@weibot/core'
import type { Command } from 'commander'
import { describe, expect, it, vi } from 'vitest'
import { buildPlatformPreview, runDirectPreview, runDirectSync } from './direct'

const sideEffectProbes = vi.hoisted(() => ({
  createNodeRuntime: vi.fn(),
  promiseWriteFile: vi.fn(),
  spawn: vi.fn(),
  writeFile: vi.fn(),
  writeFileSync: vi.fn(),
}))

vi.mock('@weibot/core/runtime/node', async () => {
  const actual = await vi.importActual<typeof import('@weibot/core/runtime/node')>(
    '@weibot/core/runtime/node'
  )
  sideEffectProbes.createNodeRuntime.mockImplementation(actual.createNodeRuntime)
  return {
    ...actual,
    createNodeRuntime: sideEffectProbes.createNodeRuntime,
  }
})

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process')
  return {
    ...actual,
    spawn: sideEffectProbes.spawn,
  }
})

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs')
  const defaultFs = (actual as typeof actual & { default?: typeof actual }).default || actual
  return {
    ...actual,
    writeFile: sideEffectProbes.writeFile,
    writeFileSync: sideEffectProbes.writeFileSync,
    default: {
      ...defaultFs,
      writeFile: sideEffectProbes.writeFile,
      writeFileSync: sideEffectProbes.writeFileSync,
    },
  }
})

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  return {
    ...actual,
    writeFile: sideEffectProbes.promiseWriteFile,
  }
})

const realFs = await vi.importActual<typeof import('node:fs')>('node:fs')

const fixtureFile = fileURLToPath(new URL('../test/fixtures/article.md', import.meta.url))
const cliRoot = fileURLToPath(new URL('..', import.meta.url))
const builtCliFile = path.join(cliRoot, 'dist/index.js')
const importSideEffectCounts = {
  createNodeRuntime: sideEffectProbes.createNodeRuntime.mock.calls.length,
  promiseWriteFile: sideEffectProbes.promiseWriteFile.mock.calls.length,
  spawn: sideEffectProbes.spawn.mock.calls.length,
  writeFile: sideEffectProbes.writeFile.mock.calls.length,
  writeFileSync: sideEffectProbes.writeFileSync.mock.calls.length,
}

function createTestAdapter(
  platform: string,
  publish: PlatformAdapter['publish']
): PlatformAdapter {
  return {
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
    publish,
  }
}

function runBuiltCli(args: string[]) {
  return spawnSync(process.execPath, [builtCliFile, ...args], {
    cwd: cliRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      FORCE_COLOR: '0',
    },
  })
}

function withMarkdownFixture<T>(markdown: string, callback: (filePath: string) => T): T {
  const tempDir = realFs.mkdtempSync(path.join(os.tmpdir(), 'weibot-cli-front-matter-'))
  const filePath = path.join(tempDir, 'article.md')
  try {
    realFs.writeFileSync(filePath, markdown, 'utf8')
    return callback(filePath)
  } finally {
    realFs.rmSync(tempDir, { recursive: true, force: true })
  }
}

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

  it('decodes a JSON front matter title exactly in the CLI preview', () => {
    const title = '标题\n# 注入 [x](https://example.com)'
    const markdown = [
      '---',
      'title: "兼容显示标题"',
      `publisher-title-json-v1: ${JSON.stringify(title)}`,
      '---',
      '',
      '# 标题 &#35; 注入 &#91;x&#93;&#40;https&#58;&#47;&#47;example&#46;com&#41;',
      '',
      '正文',
    ].join('\n')

    withMarkdownFixture(markdown, filePath => {
      const preview = buildPlatformPreview(filePath, 'zip-download', {})

      expect(preview.title).toBe(title)
      expect(preview.article.title).toBe(title)
    })
  })

  it('reversibly decodes quotes, colons, newlines, hashes, and backslashes in JSON titles', () => {
    const title = '引号 "双引号": 路径\\值\n# 哈希'
    const encodedTitle = JSON.stringify(title)
    const markdown = `---\ntitle: ${encodedTitle}\npublisher-title-json-v1: ${encodedTitle}\n---\n\n正文\n`

    withMarkdownFixture(markdown, filePath => {
      expect(buildPlatformPreview(filePath, 'zip-download', {}).title).toBe(title)
    })
  })

  it.each([
    ['title: 旧式未加引号标题', '旧式未加引号标题'],
    ["title: '旧式单引号标题'", '旧式单引号标题'],
    ['title: "旧式双引号标题"', '旧式双引号标题'],
    [String.raw`title: C:\temp`, String.raw`C:\temp`],
    [String.raw`title: "literal\nsequence"`, String.raw`literal\nsequence`],
    [String.raw`title: "escaped\\path and \"quote\""`, String.raw`escaped\\path and \"quote\"`],
    ['title: "unterminated', '"unterminated'],
    ["title: \"mismatched'", "\"mismatched'"],
  ])('keeps backward compatibility with %s', (titleLine, expectedTitle) => {
    const markdown = `---\n${titleLine}\n---\n\n正文\n`

    withMarkdownFixture(markdown, filePath => {
      expect(buildPlatformPreview(filePath, 'zip-download', {}).title).toBe(expectedTitle)
    })
  })

  it.each([
    ['U+2028', '\u2028', '\\u2028'],
    ['U+2029', '\u2029', '\\u2029'],
  ])('decodes %s from the versioned title marker', (_name, separator, escaped) => {
    const title = `Before${separator}After`
    const encodedTitle = JSON.stringify(title).replace(separator, escaped)
    const markdown = [
      '---',
      'title: "Compatibility display"',
      `publisher-title-json-v1: ${encodedTitle}`,
      '---',
      '',
      '# Compatibility display',
      '',
      '正文',
    ].join('\n')

    withMarkdownFixture(markdown, filePath => {
      expect(buildPlatformPreview(filePath, 'zip-download', {}).title).toBe(title)
    })
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
  it('keeps dry-run isolated from runtime, adapters, network, child processes, and file writes', async () => {
    expect(importSideEffectCounts).toEqual({
      createNodeRuntime: 0,
      promiseWriteFile: 0,
      spawn: 0,
      writeFile: 0,
      writeFileSync: 0,
    })
    const callsBeforeDryRun = {
      createNodeRuntime: sideEffectProbes.createNodeRuntime.mock.calls.length,
      promiseWriteFile: sideEffectProbes.promiseWriteFile.mock.calls.length,
      spawn: sideEffectProbes.spawn.mock.calls.length,
      writeFile: sideEffectProbes.writeFile.mock.calls.length,
      writeFileSync: sideEffectProbes.writeFileSync.mock.calls.length,
    }

    const publishSpy = vi.fn(async (): Promise<SyncResult> => ({
      platform: 'xiaohongshu',
      success: true,
      draftOnly: true,
      timestamp: Date.now(),
    }))
    const getSpy = vi.spyOn(adapterRegistry, 'get').mockResolvedValue(
      createTestAdapter('xiaohongshu', publishSpy)
    )
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('dry-run attempted network access')
    })

    try {
      await runDirectSync(
        fixtureFile,
        { platforms: 'xiaohongshu', dryRun: true },
        {}
      )

      expect(getSpy).not.toHaveBeenCalled()
      expect(publishSpy).not.toHaveBeenCalled()
      expect(fetchSpy).not.toHaveBeenCalled()
      expect(sideEffectProbes.createNodeRuntime).toHaveBeenCalledTimes(
        callsBeforeDryRun.createNodeRuntime
      )
      expect(sideEffectProbes.spawn).toHaveBeenCalledTimes(callsBeforeDryRun.spawn)
      expect(sideEffectProbes.writeFileSync).toHaveBeenCalledTimes(
        callsBeforeDryRun.writeFileSync
      )
      expect(sideEffectProbes.writeFile).toHaveBeenCalledTimes(callsBeforeDryRun.writeFile)
      expect(sideEffectProbes.promiseWriteFile).toHaveBeenCalledTimes(
        callsBeforeDryRun.promiseWriteFile
      )
    } finally {
      fetchSpy.mockRestore()
      logSpy.mockRestore()
      getSpy.mockRestore()
    }
  })

  it('publishes a separately prepared article for every platform', async () => {
    const publishedArticles = new Map<string, Article>()
    const getSpy = vi.spyOn(adapterRegistry, 'get')
      .mockImplementation(async platform =>
        createTestAdapter(
          platform,
          async (article): Promise<SyncResult> => {
            publishedArticles.set(platform, article)
            return {
              platform,
              success: true,
              draftOnly: true,
              timestamp: Date.now(),
            }
          }
        )
      )
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

  it('uses draft-only draft mode publish options by default', async () => {
    const publishSpy = vi.fn(async (
      _article: Article,
      _options?: PublishOptions
    ): Promise<SyncResult> => ({
      platform: 'juejin',
      success: true,
      draftOnly: true,
      timestamp: Date.now(),
    }))
    const getSpy = vi.spyOn(adapterRegistry, 'get').mockResolvedValue(
      createTestAdapter('juejin', publishSpy)
    )
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const previousExitCode = process.exitCode

    try {
      process.exitCode = undefined
      await runDirectSync(fixtureFile, { platforms: 'juejin' }, {})

      expect(publishSpy).toHaveBeenCalledTimes(1)
      expect(publishSpy.mock.calls[0][1]).toEqual({
        draftOnly: true,
        publishMode: 'draft',
      })
      expect(process.exitCode).toBeUndefined()
    } finally {
      process.exitCode = previousExitCode
      stderrSpy.mockRestore()
      logSpy.mockRestore()
      getSpy.mockRestore()
    }
  })

  it('uses direct mode and downgrades a successful draft-only adapter result', async () => {
    const publishSpy = vi.fn(async (
      _article: Article,
      _options?: PublishOptions
    ): Promise<SyncResult> => ({
      platform: 'juejin',
      success: true,
      draftOnly: true,
      message: 'adapter only saved a draft',
      timestamp: Date.now(),
    }))
    const getSpy = vi.spyOn(adapterRegistry, 'get').mockResolvedValue(
      createTestAdapter('juejin', publishSpy)
    )
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const previousExitCode = process.exitCode

    try {
      process.exitCode = undefined
      await runDirectSync(fixtureFile, { platforms: 'juejin', direct: true }, {})

      expect(publishSpy).toHaveBeenCalledTimes(1)
      expect(publishSpy.mock.calls[0][1]).toEqual({
        draftOnly: true,
        publishMode: 'direct',
      })
      expect(process.exitCode).toBe(1)
      expect(logSpy.mock.calls.flat().join(' ')).toContain('[FAIL]')
      expect(logSpy.mock.calls.flat().join(' ')).toContain('adapter only saved a draft')
    } finally {
      process.exitCode = previousExitCode
      stderrSpy.mockRestore()
      logSpy.mockRestore()
      getSpy.mockRestore()
    }
  })

  it('keeps a successful direct result when the adapter confirms publication', async () => {
    const publishSpy = vi.fn(async (
      _article: Article,
      _options?: PublishOptions
    ): Promise<SyncResult> => ({
      platform: 'juejin',
      success: true,
      draftOnly: false,
      timestamp: Date.now(),
    }))
    const getSpy = vi.spyOn(adapterRegistry, 'get').mockResolvedValue(
      createTestAdapter('juejin', publishSpy)
    )
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const previousExitCode = process.exitCode

    try {
      process.exitCode = undefined
      await runDirectSync(fixtureFile, { platforms: 'juejin', direct: true }, {})

      expect(publishSpy).toHaveBeenCalledTimes(1)
      expect(publishSpy.mock.calls[0][1]).toEqual({
        draftOnly: true,
        publishMode: 'direct',
      })
      expect(process.exitCode).toBeUndefined()
      expect(logSpy.mock.calls.flat().join(' ')).toContain('[OK]')
    } finally {
      process.exitCode = previousExitCode
      stderrSpy.mockRestore()
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

describe('built CLI preview process', () => {
  it('prints one JSON object line and exits successfully', () => {
    const result = runBuiltCli(['preview', fixtureFile, '-p', 'xiaohongshu'])

    expect(result.error).toBeUndefined()
    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')

    const lines = result.stdout.trimEnd().split(/\r?\n/)
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0])).toMatchObject({
      platform: 'xiaohongshu',
      format: 'text',
    })
  })

  it('reports an unknown platform on stderr and exits non-zero', () => {
    const result = runBuiltCli(['preview', fixtureFile, '-p', 'unknown-platform'])

    expect(result.error).toBeUndefined()
    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr.trim()).toBe('平台不存在: unknown-platform')
  })

  it('reports a missing input file on stderr and exits non-zero', () => {
    const missingFile = path.join(cliRoot, 'test/fixtures/missing-article.md')
    const result = runBuiltCli(['preview', missingFile, '-p', 'xiaohongshu'])

    expect(result.error).toBeUndefined()
    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('ENOENT')
    expect(result.stderr).toContain(missingFile)
  })

  it('requires the platform option before running preview', () => {
    const result = runBuiltCli(['preview', fixtureFile])

    expect(result.error).toBeUndefined()
    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain(
      "error: required option '-p, --platform <platform>' not specified"
    )
  })
})
