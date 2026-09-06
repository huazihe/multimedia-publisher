import chalk from 'chalk'
import { spawn } from 'node:child_process'
import fs from 'fs'
import juice from 'juice'
import ora from 'ora'
import path from 'path'
import { createRequire } from 'node:module'
import {
  adapterRegistry,
  createTurndownService,
  htmlToMarkdown,
  markdownToHtml,
  prepareArticleForPlatform,
  registerDefaultAdapters,
  TurndownService,
  type Article,
  type PlatformPreparedArticle,
  type SyncResult,
} from '@weibot/core'
import { createNodeRuntime } from '@weibot/core/runtime/node'

interface ParsedContent {
  title: string | null
  content: string
  format: 'markdown' | 'html'
  cover?: string
  summary?: string
}

export interface DirectRuntimeOptions {
  cookieFile?: string
  storageDir?: string
  downloadDir?: string
  timeout?: string | number
  userAgent?: string
  douyinCdpPort?: string
  toutiaoCdpPort?: string
  xiaohongshuCdpPort?: string
  qiehaoCdpPort?: string
}

interface DirectSyncOptions {
  platforms: string
  title?: string
  cover?: string
  dryRun?: boolean
  direct?: boolean
}

export interface DirectPreviewOptions {
  platform: string
  title?: string
  cover?: string
}

type DirectArticleOptions = Pick<DirectPreviewOptions, 'title' | 'cover'>

const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
}

interface BrowserSession {
  browserPath: string
  port: number
  userDataDir: string
}

interface BrowserCdpConfig {
  envName: string
  legacyEnvName?: string
  optionName?: keyof DirectRuntimeOptions
  defaultPort?: number
  startUrl: string
}

const DOUYIN_UPLOAD_URL = 'https://creator.douyin.com/creator-micro/content/upload?default-tab=5&enter_from=publish'
const DOUYIN_DEFAULT_CDP_PORT = 9333

const BROWSER_CDP_PLATFORMS: Record<string, BrowserCdpConfig> = {
  douyin: {
    envName: 'WEIBOT_DOUYIN_CDP_PORT',
    legacyEnvName: 'DOUYIN_CDP_PORT',
    optionName: 'douyinCdpPort',
    defaultPort: DOUYIN_DEFAULT_CDP_PORT,
    startUrl: DOUYIN_UPLOAD_URL,
  },
  toutiao: {
    envName: 'WEIBOT_TOUTIAO_CDP_PORT',
    legacyEnvName: 'TOUTIAO_CDP_PORT',
    optionName: 'toutiaoCdpPort',
    startUrl: 'https://mp.toutiao.com/profile_v4/graphic/publish',
  },
  xiaohongshu: {
    envName: 'WEIBOT_XIAOHONGSHU_CDP_PORT',
    legacyEnvName: 'XIAOHONGSHU_CDP_PORT',
    optionName: 'xiaohongshuCdpPort',
    startUrl: 'https://creator.xiaohongshu.com/publish/publish?source=official',
  },
  qiehao: {
    envName: 'WEIBOT_QIEHAO_CDP_PORT',
    legacyEnvName: 'QIEHAO_CDP_PORT',
    optionName: 'qiehaoCdpPort',
    startUrl: 'https://om.qq.com/main/creation/article',
  },
  douban: {
    envName: 'WEIBOT_DOUBAN_CDP_PORT',
    legacyEnvName: 'DOUBAN_CDP_PORT',
    startUrl: 'https://www.douban.com/topic/create?subtype=note',
  },
  'china-vision': {
    envName: 'WEIBOT_CHINA_VISION_CDP_PORT',
    legacyEnvName: 'CHINA_VISION_CDP_PORT',
    startUrl: 'https://www.china-vision.org/user-add-news.html',
  },
  'bjx-club': {
    envName: 'WEIBOT_BJX_CLUB_CDP_PORT',
    legacyEnvName: 'BJX_CLUB_CDP_PORT',
    startUrl: 'https://club.bjx.com.cn/forum.php?mod=post&action=newthread',
  },
  elecfans: {
    envName: 'WEIBOT_ELECFANS_CDP_PORT',
    legacyEnvName: 'ELECFANS_CDP_PORT',
    startUrl: 'https://www.elecfans.com/d/article/write',
  },
  'eet-china': {
    envName: 'WEIBOT_EET_CHINA_CDP_PORT',
    legacyEnvName: 'EET_CHINA_CDP_PORT',
    startUrl: 'https://www.eet-china.com/',
  },
  eeworld: {
    envName: 'WEIBOT_EEWORLD_CDP_PORT',
    legacyEnvName: 'EEWORLD_CDP_PORT',
    startUrl: 'http://bbs.eeworld.com.cn/forum.php?mod=post&action=newthread&fid=29',
  },
  ca800: {
    envName: 'WEIBOT_CA800_CDP_PORT',
    legacyEnvName: 'CA800_CDP_PORT',
    startUrl: 'http://www.ca800.com/c/Info/articleInfo.aspx',
  },
  b2b168: {
    envName: 'WEIBOT_B2B168_CDP_PORT',
    legacyEnvName: 'B2B168_CDP_PORT',
    startUrl: 'https://m.b2b168.com/index.aspx?pg=glNews&t=0',
  },
  app17: {
    envName: 'WEIBOT_APP17_CDP_PORT',
    legacyEnvName: 'APP17_CDP_PORT',
    startUrl: 'https://user.app17.com/user.aspx?article/articleedit',
  },
  huangye88: {
    envName: 'WEIBOT_HUANGYE88_CDP_PORT',
    legacyEnvName: 'HUANGYE88_CDP_PORT',
    startUrl: 'https://fabuxinxi.huangye88.com/',
  },
  '51sole': {
    envName: 'WEIBOT_51SOLE_CDP_PORT',
    legacyEnvName: 'SOLE51_CDP_PORT',
    startUrl: 'https://user.51sole.com/user/web/send_information.aspx',
  },
}

function resolveBrowserSessionFile(platform: string, options: DirectRuntimeOptions): string {
  const userDataDir = options.storageDir
    ? path.resolve(options.storageDir, 'browser', platform)
    : path.resolve('.weibot-login', platform)
  return path.join(userDataDir, 'session.json')
}

function readBrowserSession(platform: string, options: DirectRuntimeOptions): BrowserSession | null {
  const sessionFile = resolveBrowserSessionFile(platform, options)
  if (!fs.existsSync(sessionFile)) return null
  return JSON.parse(fs.readFileSync(sessionFile, 'utf-8').replace(/^\uFEFF/, '')) as BrowserSession
}

async function isCdpAlive(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`)
    return response.ok
  } catch {
    return false
  }
}

async function waitForCdp(port: number, label: string, timeoutMs = 30000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await isCdpAlive(port)) return
    await new Promise(resolve => setTimeout(resolve, 400))
  }
  throw new Error(`Timed out waiting for ${label} login browser on port ${port}.`)
}

async function ensureBrowserCdpSession(
  platform: string,
  options: DirectRuntimeOptions,
  required: boolean
): Promise<void> {
  const config = BROWSER_CDP_PLATFORMS[platform]
  if (!config) return

  const explicitPort = config.optionName ? options[config.optionName] : undefined
  if (explicitPort) {
    process.env[config.envName] = String(explicitPort)
    return
  }

  if (process.env[config.envName] || (config.legacyEnvName && process.env[config.legacyEnvName])) return

  const session = readBrowserSession(platform, options)
  if (!session) {
    if (config.defaultPort && await isCdpAlive(config.defaultPort)) {
      process.env[config.envName] = String(config.defaultPort)
      return
    }
    if (!required) return
    throw new Error(`${platform} login session not found. Run: weibot login ${platform}`)
  }

  if (!await isCdpAlive(session.port)) {
    const child = spawn(session.browserPath, [
      `--remote-debugging-port=${session.port}`,
      `--user-data-dir=${session.userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      config.startUrl,
    ], {
      detached: true,
      stdio: 'ignore',
    })
    child.unref()
    await waitForCdp(session.port, platform)
  }

  process.env[config.envName] = String(session.port)
}

async function prepareDirectRuntime(
  options: DirectRuntimeOptions,
  platforms: string[],
  requiredBrowserSession = true
): Promise<void> {
  for (const platform of platforms) {
    if (BROWSER_CDP_PLATFORMS[platform]) {
      await ensureBrowserCdpSession(platform, options, requiredBrowserSession)
    }
  }
  initDirectRuntime(options)
}

function initDirectRuntime(options: DirectRuntimeOptions): void {
  for (const config of Object.values(BROWSER_CDP_PLATFORMS)) {
    const explicitPort = config.optionName ? options[config.optionName] : undefined
    if (explicitPort) process.env[config.envName] = String(explicitPort)
  }

  const timeout = options.timeout ? Number(options.timeout) : undefined
  const runtime = createNodeRuntime({
    cookieFile: options.cookieFile,
    storageDir: options.storageDir,
    downloadDir: options.downloadDir,
    timeout,
    userAgent: options.userAgent,
  })
  registerDefaultAdapters(runtime)
}

function parseFileContent(filePath: string): ParsedContent {
  const content = fs.readFileSync(filePath, 'utf-8')
  const ext = path.extname(filePath).toLowerCase()

  if (ext === '.md' || ext === '.markdown') return parseMarkdown(content)
  if (ext === '.html' || ext === '.htm') return parseHtml(content, filePath)

  return {
    title: path.basename(filePath, ext),
    content,
    format: 'markdown',
  }
}

function parseMarkdown(content: string): ParsedContent {
  let title: string | null = null
  let body = content

  const yamlMatch = content.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/)
  if (yamlMatch) {
    title = parseFrontMatterTitle(yamlMatch[1])
    body = content.slice(yamlMatch[0].length)
  }

  if (!title) {
    const h1Match = body.match(/^#\s+(.+)$/m)
    if (h1Match) {
      title = h1Match[1].trim()
      body = body.replace(/^#\s+.+\n+/, '')
    }
  }

  // Leading indentation is Markdown syntax, including an indented image-code example.
  body = body.replace(/^(?:[ \t]*\r?\n)+|(?:\r?\n[ \t]*)+$/g, '')
  return {
    title,
    content: body.trim() ? body : content,
    format: 'markdown',
  }
}

function frontMatterFieldValue(frontMatter: string, fieldName: string): string | null {
  const prefix = `${fieldName}:`
  for (const line of frontMatter.split(/\r?\n/)) {
    if (line.startsWith(prefix)) return line.slice(prefix.length).trim()
  }
  return null
}

function parseFrontMatterTitle(frontMatter: string): string | null {
  const exactValue = frontMatterFieldValue(frontMatter, 'publisher-title-json-v1')
  if (exactValue !== null) {
    try {
      const decoded = JSON.parse(exactValue)
      if (typeof decoded === 'string') return decoded
    } catch {
      // Fall back to the backward-compatible title field when the marker is malformed.
    }
  }

  const value = frontMatterFieldValue(frontMatter, 'title')?.trim() || ''
  if (!value) return null

  const legacyTitle = value.match(/^["']?([\s\S]+?)["']?$/)
  return legacyTitle ? legacyTitle[1].trim() : value
}

// Reuse Juice's installed parsers so the CLI does not need another parser dependency.
const requireFromJuice = createRequire(createRequire(import.meta.url).resolve('juice'))
const { load: loadHtml } = requireFromJuice('cheerio')
const cssParser = requireFromJuice('mensch')

interface CssDeclaration { type: string; name: string; value: string }
interface CssRule { type: string; name?: string; rules?: CssRule[]; selectors?: string[]; declarations?: CssDeclaration[] }

function safeCss(css: string, inline = false, mobileTemplate = false): string {
  // Decode escapes before checking tokens (e.g. u\\72l / expre/**/ssion).
  const decoded = css.replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\\([\da-f]{1,6})\s?|\\([^\r\n])/gi, (_, hex: string, char: string) =>
      hex ? String.fromCodePoint(Math.min(parseInt(hex, 16), 0x10ffff)) : char)
  const safeFunctions = new Set([
    'rgb', 'rgba', 'hsl', 'hsla', 'hwb', 'lab', 'lch', 'oklab', 'oklch', 'color', 'color-mix',
    'linear-gradient', 'radial-gradient', 'conic-gradient', 'repeating-linear-gradient',
    'repeating-radial-gradient', 'calc', 'min', 'max', 'clamp', 'var', 'env',
    'translate', 'translatex', 'translatey', 'translate3d', 'scale', 'scalex', 'scaley',
    'rotate', 'skew', 'matrix', 'cubic-bezier', 'steps', 'repeat', 'minmax', 'fit-content',
  ])
  const allowed = (declaration: CssDeclaration) => {
    const { name, value } = declaration
    return declaration.type === 'property'
      && /^(?:--)?[a-z-][a-z\d-]*$/i.test(name)
      && !/^(?:behavior|-moz-binding|content)$/i.test(name)
      && !/[<>@{}\\\u0000-\u001f\u007f]/.test(value)
      && !/(?:javascript|vbscript)\s*:/i.test(value)
      && [...value.matchAll(/([\w-]+)\s*\(/g)].every(match => safeFunctions.has(match[1].toLowerCase()))
  }
  try {
    const ast = cssParser.parse(inline ? `x{${decoded}}` : decoded)
    const flatten = (rules: CssRule[]): CssRule[] => rules.flatMap(rule => {
      if (rule.type === 'rule' && rule.selectors?.every(selector => !/[<@{}]/.test(selector))) return [rule]
      // WeChat discards media queries. Generated templates use a 390px phone snapshot,
      // including their own small-screen overrides, rather than the desktop headline size.
      const width = rule.type === 'media' && rule.name?.match(/^(?:(?:only\s+)?(?:screen|all)\s+and\s+)?\(\s*(min|max)-width\s*:\s*([\d.]+)px\s*\)$/i)
      if (mobileTemplate && width && (width[1].toLowerCase() === 'max' ? 390 <= +width[2] : 390 >= +width[2])) {
        return flatten(rule.rules || [])
      }
      return []
    })
    const rules = flatten(ast.stylesheet.rules)
    // @import, font faces, animations and unsupported conditions are never preserved.
    for (const rule of rules) rule.declarations = (rule.declarations || []).filter(allowed)
    if (inline) return (rules[0]?.declarations || []).map(item => `${item.name}:${item.value}`).join(';')
    ast.stylesheet.rules = rules
    return cssParser.stringify(ast)
  } catch {
    return ''
  }
}

function localStylesheet(href: string, filePath: string, mobileTemplate: boolean): string {
  try {
    const reference = decodeURIComponent(href.trim().split(/[?#]/)[0])
    if (!reference || /[\u0000-\u0020\\]/.test(reference)
      || /^(?:[a-z][\w+.-]*:|\/)/i.test(reference) || path.extname(reference).toLowerCase() !== '.css') return ''
    const directory = fs.realpathSync(path.dirname(filePath))
    const target = fs.realpathSync(path.resolve(directory, reference))
    const relative = path.relative(directory, target)
    if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) return ''
    const stat = fs.statSync(target)
    if (!stat.isFile() || stat.size > 1024 * 1024) return ''
    return safeCss(fs.readFileSync(target, 'utf8'), false, mobileTemplate)
  } catch {
    return ''
  }
}

function inlineHtmlStyles(content: string, filePath: string): string {
  const $ = loadHtml(content)
  const mobileTemplate = $('[data-wechat-template-root="true"]').length > 0
  $('link').each((_: number, node: unknown) => {
    const link = $(node)
    const css = /(?:^|\s)stylesheet(?:\s|$)/i.test(link.attr('rel') || '')
      ? localStylesheet(link.attr('href') || '', filePath, mobileTemplate) : ''
    if (css && (!link.attr('media') || link.attr('media').toLowerCase() === 'all')) {
      link.replaceWith($('<style></style>').text(css))
    } else link.remove()
  })
  // Head nodes must not be able to inject body markup or fetch resources when serialized.
  $('script,base,iframe,object,embed,template,noscript,meta[http-equiv]').remove()
  $('style').each((_: number, node: unknown) => {
    const style = $(node)
    if (style.attr('media') && style.attr('media').toLowerCase() !== 'all') style.remove()
    else style.text(safeCss(style.text(), false, mobileTemplate))
  })
  const cleanInline = () => $('[style]').each((_: number, node: unknown) => {
    const element = $(node)
    element.attr('style', safeCss(element.attr('style') || '', true))
  })
  cleanInline()
  // Inline against the complete DOM: head styles and html/body selectors still exist here.
  juice.juiceDocument($, {
    removeStyleTags: true,
    preserveImportant: true,
    preserveMediaQueries: false,
    preserveFontFaces: false,
    preserveKeyFrames: false,
    preservePseudos: false,
    inlinePseudoElements: false,
    resolveCSSVariables: true,
    applyAttributesTableElements: false,
    applyWidthAttributes: false,
    applyHeightAttributes: false,
  })
  cleanInline()
  $('style,link').remove()
  let body = $('body').html() || ''
  // Keep inherited page presentation when the platform strips the document shell.
  for (const tag of ['body', 'html']) {
    const style = $(tag).attr('style')
    if (style) body = $('<section></section>').attr('style', style).html(body).toString()
  }
  return body.trim()
}

function parseHtml(content: string, filePath: string): ParsedContent {
  const titleMatch = content.match(/<title[^>]*>([^<]+)<\/title>/i)
  const h1Match = content.match(/<h1[^>]*>([^<]+)<\/h1>/i)
  let title = titleMatch?.[1]?.trim() || h1Match?.[1]?.trim() || null

  const ogImageMatch = content.match(/<meta\s[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["'][^>]*>/i)
    || content.match(/<meta\s[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["'][^>]*>/i)
  const descMatch = content.match(/<meta\s[^>]*name=["']description["'][^>]*content=["']([^"']+)["'][^>]*>/i)
    || content.match(/<meta\s[^>]*content=["']([^"']+)["'][^>]*name=["']description["'][^>]*>/i)
    || content.match(/<meta\s[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["'][^>]*>/i)

  const body = inlineHtmlStyles(content, filePath)

  if (!title) title = path.basename(filePath, path.extname(filePath))

  return {
    title,
    content: body,
    format: 'html',
    cover: ogImageMatch?.[1],
    summary: (descMatch?.[1] || descMatch?.[2] || '').trim() || undefined,
  }
}

function readImageAsDataUri(imagePath: string): string | null {
  if (!fs.existsSync(imagePath)) return null
  const ext = path.extname(imagePath).toLowerCase()
  const mimeType = MIME_TYPES[ext]
  if (!mimeType) return null
  return `data:${mimeType};base64,${fs.readFileSync(imagePath).toString('base64')}`
}

function resolveLocalImagePath(localPath: string, basePath: string): string {
  // Markdown renderers encode Unicode/spaces; HTML parsers already decode attribute entities.
  const reference = localPath.replace(/\\/g, '/').split(/[?#]/)[0]
  let normalized = reference
  try { normalized = decodeURIComponent(reference) } catch { /* Keep literal percent filenames. */ }

  if (normalized.startsWith('/uploads/')) {
    return path.resolve(basePath, '..', normalized.slice(1))
  }

  if (normalized.startsWith('uploads/')) {
    return path.resolve(basePath, '..', normalized)
  }

  if (path.isAbsolute(normalized)) return normalized
  return path.resolve(basePath, normalized)
}

function convertLocalImagesToDataUri(
  content: string,
  basePath: string,
  onMissingImage?: (localPath: string) => void
): string {
  // Only HTML enters this function. Markdown code/escapes are resolved by its renderer,
  // not by a regex scanning source text for image-looking strings.
  const $ = loadHtml(content, {}, false)
  const literals = new Set(['pre', 'code', 'template', 'noscript', 'script', 'style',
    'textarea', 'xmp', 'iframe', 'noembed', 'noframes', 'plaintext', 'svg', 'math'])
  const resolved = new Map<string, string | null>()
  let changed = false
  const visit = (node: { name?: string; children?: unknown[] }) => {
    // Do not use .parents('template'): parse5 puts template children in a detached fragment.
    if (node.name && literals.has(node.name.toLowerCase())) return
    if (node.name === 'img') {
      const image = $(node)
      const source = String(image.attr('src') || '').trim()
      if (!source || /[\u0000-\u001f\u007f]/.test(source)
        || /^(?:[a-z][\w+.-]*:|[\\/]{2}|[?#])/i.test(source)) return
      const absolutePath = resolveLocalImagePath(source, basePath)
      if (!resolved.has(absolutePath)) {
        const dataUri = readImageAsDataUri(absolutePath)
        resolved.set(absolutePath, dataUri)
        if (!dataUri) onMissingImage?.(source)
      }
      const dataUri = resolved.get(absolutePath)
      if (dataUri) {
        image.attr('src', dataUri)
        changed = true
      }
    }
    for (const child of node.children || []) visit(child as typeof node)
  }
  visit($.root().get(0))
  return changed ? $.html() : content
}

function resolveCover(cover: string | undefined, basePath: string): string | undefined {
  if (!cover || cover.startsWith('http') || cover.startsWith('data:')) return cover
  const absolutePath = resolveLocalImagePath(cover, basePath)
  const dataUri = readImageAsDataUri(absolutePath)
  if (!dataUri) throw new Error(`灏侀潰鍥炬枃浠朵笉瀛樺湪鎴栨牸寮忎笉鏀寔: ${absolutePath}`)
  return dataUri
}

function htmlToMarkdownPreservingCode(html: string): string {
  if (!/<(?:pre|code)\b/i.test(html)) return htmlToMarkdown(html)
  // The core regex fallback strips HTML-looking text after extracting a code block.
  // Use its existing DOM converter and preserve literal code with Turndown's code rules.
  const converter = createTurndownService()
  const codeConverter = new TurndownService({ codeBlockStyle: 'fenced' })
  converter.addRule('literalCode', {
    filter: ['pre', 'code'],
    replacement: (_content, node) => {
      const code = codeConverter.turndown((node as HTMLElement).outerHTML)
      return node.nodeName === 'PRE' ? `\n\n${code}\n\n` : code
    },
  })
  return converter.turndown(html)
}

function prepareDirectArticleForPlatform(article: Article, platform: string): PlatformPreparedArticle {
  const prepared = prepareArticleForPlatform(article, platform)
  if (prepared.format === 'text' || !/<(?:pre|code)\b/i.test(prepared.article.html || '')) return prepared
  const markdown = htmlToMarkdownPreservingCode(prepared.article.html || '')
  return {
    ...prepared,
    content: prepared.format === 'markdown' ? markdown : prepared.content,
    // This is already platform-sanitized HTML with the original code text intact.
    htmlPreview: prepared.format === 'markdown' ? prepared.article.html! : prepared.htmlPreview,
    article: { ...prepared.article, markdown },
  }
}

function buildArticle(
  filePath: string,
  options: DirectArticleOptions,
  onMissingImage?: (localPath: string) => void
): Article {
  const parsed = parseFileContent(filePath)
  const title = options.title || parsed.title
  if (!title) {
    throw new Error('鏃犳硶浠庢枃浠舵彁鍙栨爣棰橈紝璇蜂娇鐢?--title 鎸囧畾')
  }

  const basePath = path.dirname(filePath)
  const html = convertLocalImagesToDataUri(
    parsed.format === 'html' ? parsed.content : markdownToHtml(parsed.content),
    basePath,
    onMissingImage
  )
  const markdown = htmlToMarkdownPreservingCode(html)

  return {
    title,
    markdown,
    html,
    cover: resolveCover(options.cover || parsed.cover, basePath),
    summary: parsed.summary,
  }
}

export function buildPlatformPreview(
  file: string,
  platform: string,
  options: Pick<DirectPreviewOptions, 'title' | 'cover'> = {}
): PlatformPreparedArticle {
  const article = buildArticle(path.resolve(file), options)
  return prepareDirectArticleForPlatform(article, platform.trim().toLowerCase())
}

export async function runDirectPreview(
  file: string,
  options: DirectPreviewOptions
): Promise<void> {
  const preview = buildPlatformPreview(file, options.platform, options)
  console.log(JSON.stringify(preview))
}

export function printResults(results: SyncResult[]): void {
  console.log()
  console.log(chalk.bold('同步结果:'))
  console.log()

  for (const result of results) {
    if (result.uncertain) {
      console.log('  [UNCERTAIN]', chalk.bold(result.platform))
      if (result.postUrl) console.log(`    ${chalk.cyan(result.postUrl)}`)
      console.log(`    ${chalk.yellow(result.error || result.message || '结果待人工核对，请勿重复提交')}`)
    } else if (result.success) {
      console.log('  [OK]', chalk.bold(result.platform), result.draftOnly ? chalk.gray('(草稿)') : '')
      if (result.postUrl) console.log(`    ${chalk.cyan(result.postUrl)}`)
      if (result.message) console.log(`    ${chalk.gray(result.message)}`)
    } else {
      console.log('  [FAIL]', chalk.bold(result.platform))
      console.log(`    ${chalk.red(result.error || '未知错误')}`)
    }
  }

  const successCount = results.filter(result => result.success && !result.uncertain).length
  const uncertainCount = results.filter(result => result.uncertain).length
  const failedCount = results.length - successCount - uncertainCount
  console.log()
  console.log(`同步完成: ${chalk.green(`${successCount} 成功`)}, ${chalk.red(`${failedCount} 失败`)}, ${chalk.yellow(`${uncertainCount} 待核对`)}`)
}

export async function runDirectSync(
  file: string,
  options: DirectSyncOptions,
  runtimeOptions: DirectRuntimeOptions
): Promise<void> {
  const filePath = path.resolve(file)
  if (!fs.existsSync(filePath)) {
    console.error(chalk.red(`文件不存在: ${filePath}`))
    process.exit(1)
  }

  const platforms = options.platforms.split(',').map(platform => platform.trim().toLowerCase()).filter(Boolean)
  if (platforms.length === 0) {
    console.error(chalk.red('请选择至少一个平台'))
    process.exit(1)
  }

  const article = buildArticle(filePath, options, localPath => {
    console.log(chalk.yellow(`  璺宠繃鏈湴鍥剧墖: ${localPath}`))
  })
  const directMode = Boolean(options.direct)

  console.log()
  console.log(chalk.bold('同步信息:'))
  console.log(`  运行时: ${chalk.cyan('node')}`)
  console.log(`  文件: ${chalk.cyan(path.basename(filePath))}`)
  console.log(`  标题: ${chalk.cyan(article.title)}`)
  console.log(`  平台: ${chalk.cyan(platforms.join(', '))}`)
  console.log(`  模式: ${chalk.cyan(directMode ? '直接发布' : '保存草稿')}`)
  console.log(`  Cookie: ${chalk.cyan(runtimeOptions.cookieFile || process.env.WEIBOT_COOKIE_FILE || '(未指定)')}`)
  console.log()

  if (options.dryRun) {
    console.log(chalk.yellow('(dry-run 模式，不实际同步)'))
    console.log(chalk.gray((article.markdown || article.html || '').slice(0, 300)))
    return
  }

  await prepareDirectRuntime(runtimeOptions, platforms, true)

  const results: SyncResult[] = []
  for (const platform of platforms) {
    const adapter = await adapterRegistry.get(platform)
    if (!adapter) {
      results.push({
        platform,
        success: false,
        error: 'Platform not found',
        timestamp: Date.now(),
      })
      continue
    }

    const spinner = ora(`${directMode ? '发布到' : '同步到'} ${platform}...`).start()
    try {
      const prepared = prepareDirectArticleForPlatform(article, platform)
      const result = await adapter.publish(prepared.article, {
        draftOnly: true,
        publishMode: directMode ? 'direct' : 'draft',
      })
      const finalResult = directMode && result.success && platform !== 'zip-download' && result.draftOnly !== false
        ? {
            ...result,
            success: false,
            error: result.message || '该平台暂未实现直接发布；当前适配器只支持保存草稿或填入发布页待人工确认。',
          }
        : result
      results.push(finalResult)
      if (finalResult.uncertain) spinner.warn(`${platform} 结果待人工核对，请勿重复提交`)
      else if (finalResult.success) spinner.succeed(`${platform} ${directMode ? '已直接发布' : '已保存草稿'}`)
      else spinner.fail(`${platform} ${directMode ? '发布失败' : '同步失败'}`)
    } catch (error) {
      spinner.fail(`${platform} ${directMode ? '发布失败' : '同步失败'}`)
      results.push({
        platform,
        success: false,
        error: (error as Error).message,
        timestamp: Date.now(),
      })
    }
  }

  printResults(results)
  if (results.some(result => !result.success || result.uncertain)) process.exitCode = 1
}

export async function runDirectPlatforms(
  options: { auth?: boolean },
  runtimeOptions: DirectRuntimeOptions
): Promise<void> {
  await prepareDirectRuntime(runtimeOptions, [], false)
  const metas = adapterRegistry.getAllMeta()

  console.log()
  console.log(chalk.bold(`支持的平台 (${metas.length}):`))
  console.log()

  for (const meta of metas) {
    if (!options.auth) {
      console.log(`  ${chalk.cyan(meta.id.padEnd(15))} ${meta.name}`)
      continue
    }

    const adapter = await adapterRegistry.get(meta.id)
    const auth = adapter
      ? await adapter.checkAuth()
      : { isAuthenticated: false, error: 'Adapter not found' }
    const status = auth.isAuthenticated ? chalk.green('[已登录]') : chalk.red('[未登录]')
    const username = auth.username ? chalk.gray(`(${auth.username})`) : ''
    const error = !auth.isAuthenticated && auth.error ? chalk.gray(` - ${auth.error}`) : ''
    console.log(`  ${chalk.cyan(meta.id.padEnd(15))} ${meta.name.padEnd(10)} ${status} ${username}${error}`)
  }
  console.log()
}

export async function runDirectAuth(
  platform: string | undefined,
  runtimeOptions: DirectRuntimeOptions
): Promise<void> {
  await prepareDirectRuntime(runtimeOptions, platform ? [platform] : [], false)

  if (platform) {
    const adapter = await adapterRegistry.get(platform)
    if (!adapter) {
      console.error(chalk.red(`平台不存在: ${platform}`))
      process.exit(1)
    }

    const auth = await adapter.checkAuth()
    if (auth.isAuthenticated) {
      console.log(chalk.green(`${platform} 已登录`))
      if (auth.username) console.log(`  用户: ${chalk.cyan(auth.username)}`)
      return
    }

    console.log(chalk.red(`${platform} 未登录`))
    if (auth.error) console.log(`  错误: ${chalk.gray(auth.error)}`)
    process.exitCode = 1
    return
  }

  await runDirectPlatforms({ auth: true }, runtimeOptions)
}
