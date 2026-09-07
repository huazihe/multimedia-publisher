import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  adapterRegistry,
  markdownToHtml,
  type Article,
  type PlatformAdapter,
  type PublishOptions,
  type SyncResult,
} from '@creator-workbench/core'
import type { Command } from 'commander'
import { describe, expect, it, vi } from 'vitest'
import { buildPlatformPreview, printResults, runDirectPreview, runDirectSync } from './direct'
import { listLoginPlatforms } from './login'

const sideEffectProbes = vi.hoisted(() => ({
  createNodeRuntime: vi.fn(),
  promiseWriteFile: vi.fn(),
  readFileSync: vi.fn(),
  spawn: vi.fn(),
  writeFile: vi.fn(),
  writeFileSync: vi.fn(),
}))

vi.mock('@creator-workbench/core/runtime/node', async () => {
  const actual = await vi.importActual<typeof import('@creator-workbench/core/runtime/node')>(
    '@creator-workbench/core/runtime/node'
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
  sideEffectProbes.readFileSync.mockImplementation(defaultFs.readFileSync)
  return {
    ...actual,
    readFileSync: sideEffectProbes.readFileSync,
    writeFile: sideEffectProbes.writeFile,
    writeFileSync: sideEffectProbes.writeFileSync,
    default: {
      ...defaultFs,
      readFileSync: sideEffectProbes.readFileSync,
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

it('registers working login command configurations for Uisdc and Sspai',()=>{
  expect(listLoginPlatforms()).toContain('uisdc');expect(listLoginPlatforms()).toContain('sspai');
})

it('prints uncertain outcomes separately even if an adapter also reports success', () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  try {
    printResults([
      { platform: 'xiaohongshu', success: true, uncertain: true, postUrl: 'https://creator.xiaohongshu.com/publish/publish', error: '未得到发布回执，请勿重复提交', timestamp: 0 },
      { platform: 'weixin', success: true, draftOnly: true, timestamp: 0 },
      { platform: 'sspai', success: false, error: '未登录', timestamp: 0 },
    ])
    const output = log.mock.calls.map(args => args.join(' ')).join('\n').replace(/\u001b\[[0-9;]*m/g, '')
    expect(output).toContain('[UNCERTAIN] xiaohongshu')
    expect(output).toContain('https://creator.xiaohongshu.com/publish/publish')
    expect(output).not.toContain('[OK] xiaohongshu')
    expect(output).toContain('1 成功, 1 失败, 1 待核对')
  } finally { log.mockRestore() }
})

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
  const tempDir = realFs.mkdtempSync(path.join(os.tmpdir(), 'creator-cli-front-matter-'))
  const filePath = path.join(tempDir, 'article.md')
  try {
    realFs.writeFileSync(filePath, markdown, 'utf8')
    return callback(filePath)
  } finally {
    realFs.rmSync(tempDir, { recursive: true, force: true })
  }
}

function withHtmlFixture<T>(html: string, callback: (filePath: string, directory: string) => T): T {
  const directory = realFs.mkdtempSync(path.join(os.tmpdir(), 'creator-cli-css-'))
  const filePath = path.join(directory, 'article.html')
  try {
    realFs.writeFileSync(filePath, html, 'utf8')
    return callback(filePath, directory)
  } finally {
    realFs.rmSync(directory, { recursive: true, force: true })
  }
}

describe('rendered local image references', () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2T9sAAAAASUVORK5CYII=', 'base64')
  const dataUri = `data:image/png;base64,${png.toString('base64')}`
  const readCount = (filename: string) => sideEffectProbes.readFileSync.mock.calls
    .filter(([target]) => String(target) === filename).length
  const run = (source: (outside: string) => string, extension: 'md' | 'html',
    check: (preview: ReturnType<typeof buildPlatformPreview>, outside: string, file: string) => void,
    platform = 'weixin') => {
    const directory = realFs.mkdtempSync(path.join(os.tmpdir(), 'creator-cli-image-references-'))
    try {
      const articleDirectory = path.join(directory, 'article')
      realFs.mkdirSync(articleDirectory)
      const outside = path.join(directory, 'outside.png')
      realFs.writeFileSync(outside, png)
      const file = path.join(articleDirectory, `input.${extension}`)
      realFs.writeFileSync(file, source(outside))
      sideEffectProbes.readFileSync.mockClear()
      const preview = buildPlatformPreview(file, platform, { title: '图片引用回归' })
      check(preview, outside, file)
    } finally { realFs.rmSync(directory, { recursive: true, force: true }) }
  }

  it.each([
    ['backtick fenced', (src: string) => `\`\`\`html\n<img src="${src}">\n![示例](${src})\n\`\`\``],
    ['tilde fenced', (src: string) => `~~~~\n<img src="${src}">\n![示例](${src})\n~~~~`],
    ['indented', (src: string) => `    <img src="${src}">\n    ![示例](${src})`],
    ['indented after front matter', (src: string) => `---\ntitle: Code\n---\n    <img src="${src}">`],
    ['tab-indented', (src: string) => `\t<img src="${src}">`],
    ['inline', (src: string) => `示例 \`<img src="${src}">\` 和 \`![示例](${src})\``],
    ['nested fence', (src: string) => `> \`\`\`html\n> <img src="${src}">\n> \`\`\``],
    ['escaped image syntax', (src: string) => `\\![示例](${src})`],
    ['HTML comment', (src: string) => `<!-- <img src="${src}"> ![示例](${src}) -->\n\n正文`],
    ['HTML template', (src: string) => `<template><div><template><img src="${src}"></template><img src="${src}"></div></template>\n\n正文`],
    ['raw text elements', (src: string) => `<textarea><img src="${src}"></textarea><xmp><img src="${src}"></xmp><noscript><img src="${src}"></noscript>`],
    ['literal HTML code container', (src: string) => `<pre><code><img src="${src}"></code></pre>`],
  ] as const)('%s code or inert content performs zero reads of an existing outside image', (_label, source) => {
    run(source, 'md', (preview, outside) => {
      expect(readCount(outside)).toBe(0)
      expect(preview.content).not.toContain(dataUri)
    })
  })

  it('keeps workbench-exported fenced code literal with zero reads', () => {
    run(outside => `\`\`\`\n<img src="${outside}">\n\`\`\``, 'md', (preview, outside) => {
      expect(readCount(outside)).toBe(0)
      expect(preview.content).toContain(`&lt;img src="${outside}"&gt;`)
      expect(preview.article.markdown).toContain(`<img src="${outside}">`)
      expect(preview.content).not.toContain(dataUri)
    })
  })

  it('the built CLI also performs zero image reads for a code-only article', () => {
    run(outside => `\`\`\`html\n<img src="${outside}">\n\`\`\``, 'md', (_preview, outside, file) => {
      const probe = `
        const fs = require('node:fs');
        const outside = ${JSON.stringify(outside)};
        const read = fs.readFileSync; let reads = 0;
        fs.readFileSync = function(target, ...args) {
          if (String(target) === outside) reads++;
          return read.call(this, target, ...args);
        };
        process.on('exit', () => process.stderr.write('IMAGE_READ_COUNT=' + reads));
      `
      const probeFile = path.join(path.dirname(file), 'image-read-probe.cjs')
      realFs.writeFileSync(probeFile, probe)
      const result = spawnSync(process.execPath, ['--require', probeFile, builtCliFile, 'preview', file,
        '-p', 'weixin', '-t', '代码样例'], { encoding: 'utf8' })
      expect(result.status, result.stderr).toBe(0)
      expect(result.stderr).toContain('IMAGE_READ_COUNT=0')
      expect(JSON.parse(result.stdout).content).toContain(`&lt;img src="${outside}"&gt;`)
    })
  })

  it('preserves literal HTML, backticks and blank lines in Markdown output and its preview', () => {
    run(outside => `~~~~html\n<img src="${outside}">\n\n\n\`\`\`\n![示例](${outside})\n~~~~\n\n行内 \`<img src="${outside}">\``, 'md', (preview, outside) => {
      expect(readCount(outside)).toBe(0)
      const code = `<img src="${outside}">\n\n\n\`\`\`\n![示例](${outside})`
      expect(preview.format).toBe('markdown')
      expect(preview.content).toContain(code)
      expect(preview.content).toContain(`\`<img src="${outside}">\``)
      const rendered = markdownToHtml(preview.content)
      expect(rendered).toContain(`&lt;img src=&quot;${outside}&quot;&gt;`)
      expect(rendered).not.toMatch(/<img\b/)
      expect(preview.htmlPreview).not.toMatch(/<img\b/)
    }, 'zip-download')
  })

  it('keeps escaped HTML code intact and does not read templates or raw-text examples in HTML files', () => {
    run(outside => `<html><body><pre><code>&lt;img src="${outside}"&gt;</code></pre>
      <code>![示例](${outside})</code><!-- <img src="${outside}"> -->
      <template><img src="${outside}"></template><textarea><img src="${outside}"></textarea></body></html>`, 'html', (preview, outside) => {
      expect(readCount(outside)).toBe(0)
      expect(preview.content).toContain(`&lt;img src="${outside}"&gt;`)
      expect(preview.content).toContain(`![示例](${outside})`)
      expect(preview.content).not.toContain(dataUri)
    })
  })

  it('hydrates each real node after an identical code reference, reads once and leaves code unchanged', () => {
    run(outside => `\`\`\`html\n<img src="${outside}">\n![示例](${outside})\n\`\`\`\n\n![真实图片](${outside} "说明")\n\n<img alt="第二张" src="${outside}">`, 'md', (preview, outside) => {
      expect(readCount(outside)).toBe(1)
      expect(preview.content).toContain(`&lt;img src="${outside}"&gt;`)
      expect(preview.content).toContain(`![示例](${outside})`)
      expect((preview.content.match(/<img\b[^>]*\bsrc="data:image\/png;base64,/g) || []).length).toBe(2)
      expect(preview.content).toContain('alt="真实图片"')
      expect(preview.content).toContain('title="说明"')
    })
  })

  it.each([
    ['plain.png', (src: string) => `![](${src})`, '', undefined],
    ['括号(第一(张)).png', (src: string) => `![括号图](${src} "中文说明")`, '括号图', '中文说明'],
    ['中文 空格图.png', (src: string) => `![含空格](<${src}> '单引号说明')`, '含空格', '单引号说明'],
    ['带[括号].png', (src: string) => `![替代\\]文字](<${src}> (圆括号说明))`, '替代]文字', '圆括号说明'],
    ['引用图.png', (src: string) => `![引用图][asset]\n\n[asset]: <${src}> "引用说明"`, '引用图', '引用说明'],
  ] as const)('hydrates Markdown image syntax for %s with alt and optional title intact', (name, markdown, alt, title) => {
    run(outside => {
      const filename = path.join(path.dirname(outside), 'article', name)
      realFs.writeFileSync(filename, png)
      return markdown(name)
    }, 'md', (preview, outside) => {
      expect(readCount(outside)).toBe(0)
      expect(readCount(path.join(path.dirname(outside), 'article', name))).toBe(1)
      expect(preview.content).toContain(`src="${dataUri}"`)
      expect(preview.content).toContain(`alt="${alt}"`)
      if (title) expect(preview.content).toContain(`title="${title}"`)
    })
  })

  it('decodes HTML attribute entities and percent-encoded Unicode paths without touching earlier code text', () => {
    const filename = '中文 & 空格(一).png'
    run(outside => {
      realFs.writeFileSync(path.join(path.dirname(outside), 'article', filename), png)
      return `<html><body><code>&lt;img src="中文 &amp; 空格(一).png"&gt;</code>
        <img title="A &amp; B" src="中文 &#38; 空格(一).png" alt="甲 &quot;乙&quot;">
        <img src="${encodeURIComponent(filename)}" alt="编码路径"></body></html>`
    }, 'html', (preview, outside) => {
      expect(readCount(outside)).toBe(0)
      expect(readCount(path.join(path.dirname(outside), 'article', filename))).toBe(1)
      expect((preview.content.match(/<img\b[^>]*\bsrc="data:image\/png;base64,/g) || []).length).toBe(2)
      expect(preview.content).toContain('中文 &amp; 空格(一).png')
      expect(preview.content).toMatch(/title="A (?:&amp;|&) B"/)
      expect(preview.content).toContain('alt="甲 &quot;乙&quot;"')
    })
  })

  it('retains the uploads path mapping and skips network or inline image sources', () => {
    run(outside => {
      const uploadDirectory = path.join(path.dirname(outside), 'uploads')
      realFs.mkdirSync(uploadDirectory)
      realFs.writeFileSync(path.join(uploadDirectory, '图片.png'), png)
      return `![上传](/uploads/图片.png)\n\n![重复](uploads/图片.png)\n\n<img src="https://example.test/image.png"><img src="//example.test/image.png"><img src="${dataUri}">`
    }, 'md', (preview, outside) => {
      expect(readCount(outside)).toBe(0)
      expect(readCount(path.join(path.dirname(outside), 'uploads', '图片.png'))).toBe(1)
      expect((preview.content.match(/<img\b[^>]*\bsrc="data:image\/png;base64,/g) || []).length).toBe(3)
    })
  })
})

describe('HTML CSS preparation', () => {
  it('inlines head and body CSS with cascade, inheritance and image order intact', () => {
    withHtmlFixture(`<!doctype html><html><head><title>保留样式</title><style>
      body { color:#123456; font-family:serif } .title { font-size:20px; color:red }
      body > article h1.title { color:#654321 !important; line-height:1.6 }
    </style></head><body><article><h1 class="title" style="color:blue">保留样式</h1>
      <p>前文</p><img src="data:image/png;base64,AAAA"><p>后文</p>
      <style>p { font-size:17px }</style></article></body></html>`, file => {
      const result = buildPlatformPreview(file, 'weixin', {})
      expect(result.content).toMatch(/font-size:\s*20px/)
      expect(result.content).toMatch(/color:\s*#654321\s*!important/)
      expect(result.content).toMatch(/color:\s*#123456/)
      expect(result.content).toMatch(/font-size:\s*17px/)
      expect(result.content).toMatch(/前文[\s\S]*<img[\s\S]*后文/)
      expect(result.content).not.toMatch(/<(?:head|style|link|body)\b/i)
    })
  })

  it('loads only contained local CSS, regardless of attribute order, without interpreting CSS as HTML', () => {
    withHtmlFixture(`<html><head><link href="./theme.css?v=1" rel="STYLESHEET"></head>
      <body><h1>本地样式</h1><p>正文</p></body></html>`, (file, directory) => {
      realFs.writeFileSync(path.join(directory, 'theme.css'), `h1{font-size:23px;color:#123456}
        p{font-family:"</style><img src='https://evil.invalid/leak' onerror='alert(1)'>"}`)
      const result = buildPlatformPreview(file, 'weixin', {})
      expect(result.content).toMatch(/font-size:\s*23px/)
      expect(result.content).not.toMatch(/<img|evil\.invalid|onerror|<style/i)
    })
  })

  it('does not load remote, absolute, traversal, encoded traversal or symlink stylesheets', () => {
    withHtmlFixture('<html><head></head><body><h1>安全标题</h1></body></html>', (file, directory) => {
      const articleDirectory = path.join(directory, 'article')
      realFs.mkdirSync(articleDirectory)
      const outsideCss = path.join(directory, 'outside.css')
      realFs.writeFileSync(outsideCss, 'h1{font-size:99px;color:#badbad}')
      realFs.symlinkSync(outsideCss, path.join(articleDirectory, 'alias.css'))
      const references = ['https://evil.invalid/x.css', 'http://evil.invalid/x.css', '//evil.invalid/x.css',
        'file://' + outsideCss, outsideCss, '../outside.css', '%2e%2e%2foutside.css', 'alias.css',
        'data:text/css,h1{color:red}', 'missing.css', 'x.txt', '..\\outside.css']
      const input = path.join(articleDirectory, 'input.html')
      realFs.writeFileSync(input, `<html><head>${references.map(href => `<link rel="stylesheet" href="${href}">`).join('')}
        <style>h1{font-size:21px}</style></head><body><h1>安全标题</h1></body></html>`)
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('CSS attempted network') })
      try {
        const result = buildPlatformPreview(input, 'weixin', {})
        expect(result.content).toMatch(/font-size:\s*21px/)
        expect(result.content).not.toMatch(/badbad|99px|<link|evil\.invalid/i)
        expect(fetchSpy).not.toHaveBeenCalled()
      } finally { fetchSpy.mockRestore() }
    })
  })

  it.each([
    'background:url(https://evil.invalid/leak)',
    String.raw`background:u\72l(https://evil.invalid/leak)`,
    'background:u/**/rl(https://evil.invalid/leak)',
    'background:image-set("https://evil.invalid/leak" 1x)',
    'background:-webkit-image-set("https://evil.invalid/leak" 1x)',
    'width:expression(alert(1))',
    String.raw`width:expre\73sion(alert(1))`,
    'behavior:url(x.htc);-moz-binding:url(x.xml)',
    '--payload:url(https://evil.invalid/leak);background:var(--payload)',
    'content:"changed body"',
  ])('filters unsafe CSS declarations before and after inlining: %s', declaration => {
    withHtmlFixture(`<html><head><style>@import "https://evil.invalid/import.css";
      @font-face{font-family:Evil;src:url(https://evil.invalid/font)}
      h1{font-size:20px;${declaration}}
      @media(max-width:400px){h1{background:url(https://evil.invalid/media)}}
      h1::before{content:"injected text"}
      </style></head><body><h1 style='color:#123456;${declaration.replace(/'/g, '&#39;')}'>安全标题</h1>
      <p style='background:u&#114;l(https://evil.invalid/entity);font-size:16px'>保留正文</p></body></html>`, file => {
      const result = buildPlatformPreview(file, 'weixin', {})
      expect(result.content).toMatch(/font-size:\s*20px/)
      expect(result.content).toMatch(/color:\s*#123456/)
      expect(result.content).toMatch(/font-size:\s*16px/)
      expect(result.content).toContain('保留正文')
      expect(result.content).not.toMatch(/evil\.invalid|expression|behavior|-moz-binding|@import|changed body|injected text|url\(/i)
    })
  })

  it('handles an HTML fragment without losing safe inline presentation', () => {
    withHtmlFixture('<style>h1{font-size:26px}</style><h1>片段</h1><p style="color:#345678">正文</p>', file => {
      const result = buildPlatformPreview(file, 'weixin', {})
      expect(result.content).toMatch(/font-size:\s*26px/)
      expect(result.content).toMatch(/color:\s*#345678/)
      expect(result.content).toContain('正文')
    })
  })

  it('inlines the template phone breakpoint and variables while filtering resources inside media rules', () => {
    withHtmlFixture(`<html><head><style>:root{--ink:#123456}h1{font-size:28px;color:var(--ink)}
      @media (max-width:480px){h1{font-size:20px;background:url(https://evil.invalid/mobile)}}
      @media (min-width:800px){h1{font-size:60px}}
      @media print{h1{font-size:80px}}
      </style></head><body><article data-wechat-template-root="true"><h1>手机标题</h1><p>正文</p></article></body></html>`, file => {
      const result = buildPlatformPreview(file, 'weixin', {})
      expect(result.content).toMatch(/font-size:\s*20px/)
      expect(result.content).toMatch(/color:\s*#123456/)
      expect(result.content).not.toMatch(/28px|60px|80px|url\(|evil\.invalid|@media/)
    })
  })
})

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
    ['title: "unterminated', 'unterminated'],
    ['title: trailing"', 'trailing'],
    ["title: \"mismatched'", 'mismatched'],
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
    const previousPort = process.env.CREATOR_XIAOHONGSHU_CDP_PORT
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
        delete process.env.CREATOR_XIAOHONGSHU_CDP_PORT
      } else {
        process.env.CREATOR_XIAOHONGSHU_CDP_PORT = previousPort
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
      process.argv = ['node', 'creator']
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
