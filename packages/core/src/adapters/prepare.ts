import { parseHTML } from 'linkedom'
import { htmlToMarkdown, markdownToHtml } from '../lib/turndown'
import type { Article, PlatformMeta } from '../types'
import { createDefaultAdapterEntries } from './defaults'
import { DEFAULT_PREPROCESS_CONFIG, type PreprocessConfig } from './types'

export type PreparedFormat = 'html' | 'markdown' | 'text'

export interface PlatformPreparedArticle {
  platform: string
  title: string
  format: PreparedFormat
  content: string
  htmlPreview: string
  imageCount: number
  warnings: string[]
  limits: {
    maxImages?: number
    maxTitleLength?: number
  }
  article: Article
}

const TEXT_PLATFORM_IDS = new Set([
  'douyin',
  'toutiao',
  'xiaohongshu',
  'douban',
  'qiehao',
  'china-vision',
  'bjx-club',
  'elecfans',
  'eet-china',
  'eeworld',
  'ca800',
  'b2b168',
  'app17',
  'huangye88',
  '51sole',
])

const PLATFORM_LIMITS: Record<string, PlatformPreparedArticle['limits']> = {
  douyin: { maxTitleLength: 30 },
  xiaohongshu: { maxImages: 9, maxTitleLength: 38 },
}

const SPECIAL_TAG_NAMES = [
  'mpvoice',
  'mpprofile',
  'qqmusic',
  'mpcps',
  'mpvideo',
  'mpvideosnap',
  'mp-common-profile',
  'mp-miniprogram',
  'mp-weapp',
  'mp-poi',
]

const URL_ATTRIBUTE_NAMES = new Set([
  'action',
  'background',
  'cite',
  'data',
  'formaction',
  'href',
  'poster',
  'src',
  'xlink:href',
])

const PLAIN_TEXT_BLOCK_TAGS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DIV', 'DL', 'DT', 'DD',
  'FIGCAPTION', 'FIGURE', 'FOOTER', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION', 'TABLE',
  'TBODY', 'TFOOT', 'THEAD', 'TR', 'UL',
])

const PLAIN_TEXT_IGNORED_TAGS = new Set(['IMG', 'SOURCE', 'TEMPLATE'])

interface ParsedFragment {
  document: Document
  root: HTMLElement
}

function parseFragment(html: string): ParsedFragment {
  const document = parseHTML('<!doctype html><html><head></head><body></body></html>').document
  const root = document.createElement('div')
  root.innerHTML = html
  return { document, root }
}

function removeElements(root: ParentNode, selector: string): void {
  for (const element of Array.from(root.querySelectorAll(selector))) {
    element.remove()
  }
}

function removeMetaRefresh(root: ParentNode): void {
  for (const meta of Array.from(root.querySelectorAll('meta'))) {
    const httpEquiv = Array.from(meta.attributes)
      .find(attribute => attribute.name.toLowerCase() === 'http-equiv')
      ?.value
    if (httpEquiv?.trim().toLowerCase() === 'refresh') {
      meta.remove()
    }
  }
}

function removeComments(node: Node): void {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 8) {
      child.parentNode?.removeChild(child)
    } else {
      removeComments(child)
    }
  }
}

function normalizedProtocolValue(value: string): string {
  return value.replace(/[\u0000-\u0020\u007f-\u009f]/g, '').toLowerCase()
}

function isUnsafeUrl(value: string, attributeName: string): boolean {
  const normalized = normalizedProtocolValue(value)
  if (/^(?:javascript|vbscript):/.test(normalized)) return true
  if (!normalized.startsWith('data:')) return false

  return !(
    (attributeName === 'src' || attributeName === 'poster')
    && /^data:image\/(?:avif|gif|jpe?g|png|webp);base64,/i.test(value.trim())
  )
}

function sanitizeAttributes(root: ParentNode): void {
  for (const element of Array.from(root.querySelectorAll('*'))) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase()
      const value = attribute.value

      if (name.startsWith('on') || name === 'srcdoc') {
        element.removeAttribute(attribute.name)
        continue
      }

      if (URL_ATTRIBUTE_NAMES.has(name) && isUnsafeUrl(value, name)) {
        element.removeAttribute(attribute.name)
        continue
      }

      if (
        name === 'srcset'
        && /(?:^|,)\s*(?:javascript|vbscript|data:text\/html)\s*:/i.test(value)
      ) {
        element.removeAttribute(attribute.name)
        continue
      }

      if (
        name === 'style'
        && /(?:expression\s*\(|(?:javascript|vbscript|data:text\/html)\s*:)/i.test(value)
      ) {
        element.removeAttribute(attribute.name)
      }
    }
  }
}

function isSvgSource(src: string): boolean {
  return /^data:image\/svg\+xml/i.test(src.trim()) || /\.svg(?:[?#]|$)/i.test(src)
}

function processImages(root: ParentNode, config: PreprocessConfig): void {
  for (const image of Array.from(root.querySelectorAll('img'))) {
    if (config.processLazyImages) {
      const lazySource = [
        'data-src',
        'data-original',
        'data-lazy-src',
        'data-actualsrc',
        'data-url',
      ].map(name => image.getAttribute(name)?.trim()).find(Boolean)
      const currentSource = image.getAttribute('src')?.trim() || ''

      if (
        lazySource
        && (!currentSource || isSvgSource(currentSource))
        && !isUnsafeUrl(lazySource, 'src')
      ) {
        image.setAttribute('src', lazySource)
      }
    }

    const src = image.getAttribute('src')?.trim() || ''
    if (config.removeSvgImages && src && isSvgSource(src)) {
      image.remove()
      continue
    }

    if (!src) image.remove()
  }

  if (config.removeSvgImages) removeElements(root, 'svg')
}

function removeConfiguredAttributes(root: ParentNode, config: PreprocessConfig): void {
  for (const element of Array.from(root.querySelectorAll('*'))) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase()
      if (config.removeDataAttributes && name.startsWith('data-')) {
        element.removeAttribute(attribute.name)
      } else if (config.removeSrcset && name === 'srcset') {
        element.removeAttribute(attribute.name)
      } else if (config.removeSizes && name === 'sizes') {
        element.removeAttribute(attribute.name)
      }
    }
  }
}

function replaceElementTag(element: Element, tagName: string, document: Document): void {
  const replacement = document.createElement(tagName)
  for (const attribute of Array.from(element.attributes)) {
    replacement.setAttribute(attribute.name, attribute.value)
  }
  while (element.firstChild) replacement.appendChild(element.firstChild)
  element.replaceWith(replacement)
}

function convertSections(root: ParentNode, document: Document, config: PreprocessConfig): void {
  const targetTag = config.convertSectionToP
    ? 'p'
    : config.convertSectionToDiv
      ? 'div'
      : null
  if (!targetTag) return

  for (const section of Array.from(root.querySelectorAll('section'))) {
    replaceElementTag(section, targetTag, document)
  }
}

function unwrap(element: Element): void {
  const parent = element.parentNode
  if (!parent) return
  while (element.firstChild) parent.insertBefore(element.firstChild, element)
  parent.removeChild(element)
}

function isRelativeOrFragmentLink(href: string): boolean {
  return /^(?:#|\/(?!\/)|\.\/|\.\.\/|\?)/.test(href.trim())
}

function isKeptDomain(href: string, domains: string[]): boolean {
  if (isRelativeOrFragmentLink(href)) return true
  try {
    const hostname = new URL(href, 'https://relative.invalid').hostname.toLowerCase()
    return domains.some(domain => {
      const normalizedDomain = domain.trim().replace(/^\./, '').toLowerCase()
      return hostname === normalizedDomain || hostname.endsWith(`.${normalizedDomain}`)
    })
  } catch {
    return false
  }
}

function removeExternalLinks(root: ParentNode, config: PreprocessConfig): void {
  if (!config.removeLinks) return
  const keepDomains = config.keepLinkDomains || []

  for (const link of Array.from(root.querySelectorAll('a'))) {
    const href = link.getAttribute('href') || ''
    if (keepDomains.length > 0 && href && isKeptDomain(href, keepDomains)) continue
    unwrap(link)
  }
}

function removeSpecialTags(root: ParentNode, config: PreprocessConfig): void {
  if (!config.removeSpecialTags) return

  for (const element of Array.from(root.querySelectorAll(SPECIAL_TAG_NAMES.join(',')))) {
    const parent = element.parentElement
    if (
      config.removeSpecialTagsWithParent
      && parent
      && parent !== root
      && !['BODY', 'HTML'].includes(parent.tagName)
    ) {
      parent.remove()
    } else {
      element.remove()
    }
  }
}

function removeTrailingBreaks(root: ParentNode): void {
  for (const block of Array.from(root.querySelectorAll('p,div,section,li,blockquote'))) {
    while (block.lastElementChild?.tagName === 'BR') {
      block.lastElementChild.remove()
    }
  }
}

function unwrapConfiguredContainers(root: ParentNode, config: PreprocessConfig): void {
  if (config.unwrapNestedFigures) {
    for (const figure of Array.from(root.querySelectorAll('figure figure'))) unwrap(figure)
  }

  if (config.unwrapSingleChildSpans) {
    for (const span of Array.from(root.querySelectorAll('span > span:only-child'))) unwrap(span)
  }

  if (config.flattenNestedBold) {
    for (const bold of Array.from(root.querySelectorAll('b b,strong strong,b strong,strong b'))) {
      unwrap(bold)
    }
  }

  if (config.unwrapSingleChildContainers) {
    const containers = Array.from(root.querySelectorAll('div,section')).reverse()
    for (const container of containers) {
      const nonWhitespaceText = Array.from(container.childNodes)
        .filter(node => node.nodeType === 3)
        .some(node => Boolean(node.textContent?.trim()))
      if (container.attributes.length === 0 && container.children.length === 1 && !nonWhitespaceText) {
        unwrap(container)
      }
    }
  }
}

function processCodeBlocks(root: ParentNode, config: PreprocessConfig): void {
  if (!config.processCodeBlocks) return
  removeElements(root, 'ul.code-snippet__line-index,ul[class*="code-snippet__line-index"]')
}

function isVisuallyEmpty(element: Element): boolean {
  const text = (element.textContent || '').replace(/[\s\u00a0\u200b]/g, '')
  if (text) return false
  return !element.querySelector('img,video,audio,canvas,table,pre,code,hr')
}

function removeEmptyElements(root: ParentNode, config: PreprocessConfig): void {
  const selectors = new Set<string>()
  if (config.removeEmptyElements) {
    for (const selector of [
      'p', 'div', 'section', 'span', 'blockquote', 'figure', 'figcaption',
      'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    ]) selectors.add(selector)
  }
  if (config.removeEmptyLines) selectors.add('p')
  if (config.removeEmptyDivs) selectors.add('div')
  if (config.removeNestedEmptyContainers) {
    selectors.add('div')
    selectors.add('section')
  }
  if (selectors.size === 0) return

  let removed = true
  while (removed) {
    removed = false
    const elements = Array.from(root.querySelectorAll(Array.from(selectors).join(','))).reverse()
    for (const element of elements) {
      if (!element.parentNode || !isVisuallyEmpty(element)) continue
      element.remove()
      removed = true
    }
  }
}

function bodyContent(root: HTMLElement, config: PreprocessConfig): string {
  const body = root.querySelector('html > body')
  if (!body) return root.innerHTML

  const styles = config.keepStyles
    ? Array.from(root.querySelectorAll('html > head style')).map(style => style.outerHTML).join('')
    : ''
  return styles + body.innerHTML
}

function sanitizeRoot(root: ParentNode, document: Document, config: PreprocessConfig): void {
  for (const template of Array.from(root.querySelectorAll('template'))) {
    const container = document.createElement('div')
    container.innerHTML = template.innerHTML
    sanitizeRoot(container, document, config)
    template.innerHTML = container.innerHTML
  }

  removeElements(root, 'script,object,embed,base,link')
  removeMetaRefresh(root)
  if (!config.keepStyles) removeElements(root, 'style')
  if (config.removeIframes) removeElements(root, 'iframe')
  if (config.removeComments) removeComments(root)

  sanitizeAttributes(root)
  removeSpecialTags(root, config)
  processCodeBlocks(root, config)
  processImages(root, config)
  removeConfiguredAttributes(root, config)
  convertSections(root, document, config)
  removeExternalLinks(root, config)
  if (config.removeTrailingBr) removeTrailingBreaks(root)
  unwrapConfiguredContainers(root, config)
  removeEmptyElements(root, config)
}

function sanitizeHtml(html: string, config: PreprocessConfig): string {
  const { document, root } = parseFragment(html)
  sanitizeRoot(root, document, config)

  const result = bodyContent(root, config).trim()
  return config.compactHtml ? result.replace(/>\s+</g, '><') : result
}

function plainTextFromNode(node: Node): string {
  if (node.nodeType === 3) return node.textContent || ''
  if (node.nodeType !== 1 && node.nodeType !== 11) return ''

  const element = node.nodeType === 1 ? node as Element : null
  const tagName = element?.tagName || ''
  if (PLAIN_TEXT_IGNORED_TAGS.has(tagName)) return ''
  if (tagName === 'BR') return '\n'

  const content = Array.from(node.childNodes).map(plainTextFromNode).join('')
  if (tagName === 'TD' || tagName === 'TH') return `${content}\t`
  return PLAIN_TEXT_BLOCK_TAGS.has(tagName) ? `\n\n${content}\n\n` : content
}

function htmlToPlainText(html: string): string {
  const { root } = parseFragment(html)
  return Array.from(root.childNodes)
    .map(plainTextFromNode)
    .join('')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] || character)
}

function textToHtml(text: string): string {
  if (!text) return ''
  return text
    .split(/\n{2,}/)
    .map(paragraph => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('')
}

function countImages(html: string, cover?: string): number {
  const { root } = parseFragment(html)
  const sources = new Set<string>()
  if (cover?.trim()) sources.add(cover.trim())
  for (const image of Array.from(root.querySelectorAll('img'))) {
    const src = image.getAttribute('src')?.trim()
    if (src) sources.add(src)
  }
  return sources.size
}

function buildWarnings(
  title: string,
  imageCount: number,
  limits: PlatformPreparedArticle['limits']
): string[] {
  const warnings: string[] = []
  if (limits.maxTitleLength && Array.from(title).length > limits.maxTitleLength) {
    warnings.push(`标题超过平台上限 ${limits.maxTitleLength} 字`)
  }
  if (limits.maxImages && imageCount > limits.maxImages) {
    warnings.push(`图片数量超过平台上限 ${limits.maxImages} 张`)
  }
  return warnings
}

function previewHtml(
  format: PreparedFormat,
  content: string,
  html: string,
  config: PreprocessConfig
): string {
  if (format === 'html') return html
  if (format === 'text') return textToHtml(content)
  return sanitizeHtml(markdownToHtml(content), config)
}

function resolveFormat(platform: PlatformMeta, config: PreprocessConfig): PreparedFormat {
  if (TEXT_PLATFORM_IDS.has(platform.id)) return 'text'
  if (platform.id === 'zip-download') return 'markdown'
  return config.outputFormat
}

export function prepareArticleForPlatform(
  article: Article,
  platformId: string
): PlatformPreparedArticle {
  const entry = createDefaultAdapterEntries().find(item => item.meta.id === platformId)
  if (!entry) throw new Error(`平台不存在: ${platformId}`)

  const config: PreprocessConfig = {
    ...DEFAULT_PREPROCESS_CONFIG,
    ...(entry.preprocessConfig || {}),
  }
  const format = resolveFormat(entry.meta, config)
  const canonicalHtml = article.html?.trim()
    ? article.html
    : markdownToHtml(article.markdown || '')
  const html = sanitizeHtml(canonicalHtml, config)
  const markdown = htmlToMarkdown(html)
  const content = format === 'html'
    ? html
    : format === 'markdown'
      ? markdown
      : htmlToPlainText(html)
  const imageCount = countImages(html, article.cover)
  const limits = { ...(PLATFORM_LIMITS[platformId] || {}) }

  return {
    platform: entry.meta.id,
    title: article.title,
    format,
    content,
    htmlPreview: previewHtml(format, content, html, config),
    imageCount,
    warnings: buildWarnings(article.title, imageCount, limits),
    limits,
    article: {
      ...article,
      html,
      markdown: format === 'text' ? content : markdown,
    },
  }
}
