/**
 * Turndown HTML鈫扢arkdown 杞崲宸ュ叿
 *
 * 鍩轰簬 turndown 搴擄紝娣诲姞琛ㄦ牸鍜屼唬鐮佸潡鎵╁睍瑙勫垯
 *
 * 鏋舵瀯璇存槑:
 * - htmlToMarkdownNative: 浣跨敤鍘熺敓 DOM锛岄€傜敤浜?Content Script锛堟帹鑽愶級
 * - htmlToMarkdown: 浣跨敤姝ｅ垯杞崲锛岄€傜敤浜?Service Worker锛堝洖閫€鏂规锛? */

import TurndownService from 'turndown'
import { createLogger } from './logger'

const logger = createLogger('Turndown')

// ============ 婧愬钩鍙伴摼鎺ユ竻鐞嗚鍒?============

/** 闇€瑕佸幓闄ょ殑绔欏唴閾炬帴鍩熷悕锛堝幓鎺?<a> 鍙繚鐣欐枃鏈級 */
export const SOURCE_LINK_REMOVE_DOMAINS = [
  'zhida.zhihu.com',
]

/** 璺宠浆涓浆瑙勫垯锛歞omain 鈫?鐪熷疄 URL 鎵€鍦ㄧ殑 query 鍙傛暟鍚?*/
export const SOURCE_LINK_REDIRECT_RULES: Array<{ domain: string; param: string }> = [
  { domain: 'link.zhihu.com', param: 'target' },
]

// ============ HTML 瀹炰綋瑙ｇ爜宸ュ叿 ============

/**
 * Decode HTML entities used in extracted code blocks.
 */
function decodeHtmlEntities(text: string): string {
  let result = text

  // Unwrap repeatedly encoded ampersands such as &amp;lt;.
  for (let i = 0; i < 3; i++) {
    const prev = result
    result = result.replace(/&amp;/g, '&')
    if (prev === result) break
  }

  // 2. 瑙ｇ爜鍗佸叚杩涘埗瀹炰綋 &#xNN; 鎴?&#XNN;
  result = result.replace(/&#[xX]([0-9a-fA-F]+);/g, (_, hex) => {
    return String.fromCharCode(parseInt(hex, 16))
  })

  // 3. 瑙ｇ爜鍗佽繘鍒跺疄浣?&#NN;
  result = result.replace(/&#(\d+);/g, (_, dec) => {
    return String.fromCharCode(parseInt(dec, 10))
  })

  // 4. 瑙ｇ爜甯哥敤鍛藉悕瀹炰綋
  const namedEntities: Record<string, string> = {
    '&lt;': '<',
    '&gt;': '>',
    '&amp;': '&',
    '&quot;': '"',
    '&apos;': "'",
    '&#039;': "'",
    '&nbsp;': ' ',
    '&ndash;': '\u2013',
    '&mdash;': '\u2014',
    '&lsquo;': '\u2018',
    '&rsquo;': '\u2019',
    '&ldquo;': '\u201C',
    '&rdquo;': '\u201D',
    '&copy;': '\u00A9',
    '&reg;': '\u00AE',
    '&trade;': '\u2122',
    '&hellip;': '\u2026',
  }

  for (const [entity, char] of Object.entries(namedEntities)) {
    result = result.split(entity).join(char)
  }

  return result
}

/**
 * 宸茬煡鐨?HTML 鏍囩鐧藉悕鍗曪紙鍙兘鍑虹幇鍦ㄤ唬鐮佸潡涓殑鏍煎紡鍖栨爣绛撅級
 * 鍙Щ闄よ繖浜涙爣绛撅紝閬垮厤璇垹浠ｇ爜涓殑娉涘瀷璇硶濡?List<String>
 */
const KNOWN_HTML_TAGS = [
  // 鏂囨湰鏍煎紡鍖?  'span', 'em', 'strong', 'b', 'i', 'u', 's', 'strike', 'del', 'ins', 'mark',
  'sub', 'sup', 'small', 'big', 'font', 'a',
  // 浠ｇ爜鐩稿叧
  'code', 'pre', 'kbd', 'samp', 'var', 'tt',
  // 鍧楃骇鍏冪礌
  'div', 'p', 'section', 'article', 'header', 'footer', 'aside', 'nav',
  'main', 'figure', 'figcaption', 'blockquote', 'address',
  // 鍒楄〃
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  // 琛ㄦ牸
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
  // 鎹㈣/鍒嗛殧
  'br', 'hr', 'wbr',
  // 鍏朵粬
  'abbr', 'acronym', 'cite', 'dfn', 'q', 'time', 'ruby', 'rt', 'rp',
  'bdi', 'bdo', 'data', 'meter', 'progress', 'output', 'details', 'summary',
  // 寰俊鐗规畩鏍囩
  'mpvoice', 'mpprofile', 'qqmusic', 'mpcps',
]

/**
 * 浠?HTML 涓畨鍏ㄦ彁鍙栦唬鐮佹枃鏈? *
 * 绛栫暐锛? * 1. 鍏堢敤鍗犱綅绗︿繚鎶?HTML 瀹炰綋缂栫爜鐨?< > 锛堝 &lt; &gt;锛? * 2. 鍙Щ闄ゅ凡鐭ョ殑 HTML 鏍囩锛堢櫧鍚嶅崟锛夛紝淇濈暀浠ｇ爜涓殑娉涘瀷璇硶
 * 3. 鎭㈠鍗犱綅绗﹀苟瑙ｇ爜鎵€鏈?HTML 瀹炰綋
 */
function extractCodeText(html: string): string {
  const LT_PLACEHOLDER = '\x00__CODE_LT__\x00'
  const GT_PLACEHOLDER = '\x00__CODE_GT__\x00'

  let text = html

  // 1. 淇濇姢鎵€鏈夎〃绀?< > 鐨?HTML 瀹炰綋锛堝畠浠槸浠ｇ爜鍐呭锛屼笉鏄爣绛撅級
  // 鍛藉悕瀹炰綋
  text = text.replace(/&lt;/gi, LT_PLACEHOLDER)
  text = text.replace(/&gt;/gi, GT_PLACEHOLDER)
  // 鍗佽繘鍒跺疄浣?&#60; &#62;
  text = text.replace(/&#0*60;/gi, LT_PLACEHOLDER)
  text = text.replace(/&#0*62;/gi, GT_PLACEHOLDER)
  // 鍗佸叚杩涘埗瀹炰綋 &#x3C; &#x3E;
  text = text.replace(/&#x0*3[cC];/gi, LT_PLACEHOLDER)
  text = text.replace(/&#x0*3[eE];/gi, GT_PLACEHOLDER)

  // Remove known HTML tags while preserving code-like generics.
  const tagPattern = KNOWN_HTML_TAGS.join('|')
  // 鍖归厤寮€鏍囩: <tagname ...> 鎴栬嚜闂悎 <tagname ... />
  text = text.replace(new RegExp(`<(${tagPattern})\\b[^>]*\\/?>`, 'gi'), '')
  // 鍖归厤闂爣绛? </tagname>
  text = text.replace(new RegExp(`<\\/(${tagPattern})>`, 'gi'), '')

  // 3. 鎭㈠鍗犱綅绗︿负瀹為檯鐨?< > 瀛楃
  text = text.replace(new RegExp(LT_PLACEHOLDER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '<')
  text = text.replace(new RegExp(GT_PLACEHOLDER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '>')

  // 4. 瑙ｇ爜鍓╀綑鐨?HTML 瀹炰綋
  text = decodeHtmlEntities(text)

  return text
}

/**
 * 淇浠ｇ爜鍧椾腑鏈浆涔夌殑 < 瀛楃
 * 鍦?DOM 瑙ｆ瀽涔嬪墠璋冪敤锛岄槻姝㈡祻瑙堝櫒灏?< 璇涓烘爣绛惧紑濮嬭€屾埅鏂唴瀹? *
 * 绛栫暐锛氬湪 <pre> 鍜?<code> 鏍囩鍐咃紝灏嗙湅璧锋潵涓嶅儚 HTML 鏍囩鐨?< 杞箟涓?&lt;
 */
export function fixUnescapedLtInCode(html: string): string {
  // Process <pre>...</pre> blocks.
  let result = html.replace(/<pre([^>]*)>([\s\S]*?)<\/pre>/gi, (_match, attrs, content) => {
    const fixedContent = escapeNonTagLt(content)
    return `<pre${attrs}>${fixedContent}</pre>`
  })

  // Process standalone <code>...</code> blocks.
  result = result.replace(/<code([^>]*)>([\s\S]*?)<\/code>/gi, (_match, attrs, content) => {
    const fixedContent = escapeNonTagLt(content)
    return `<code${attrs}>${fixedContent}</code>`
  })

  return result
}

/**
 * 杞箟涓嶆槸 HTML 鏍囩鐨?< 瀛楃
 * HTML 鏍囩鐨勭壒寰侊細< 鍚庣揣璺熷瓧姣嶆垨 /
 */
function escapeNonTagLt(content: string): string {
  // 鍖归厤 < 鍚庨潰涓嶆槸瀛楁瘝銆? 鎴?! 鐨勬儏鍐碉紙涓嶆槸鏈夋晥鏍囩寮€濮嬶級
  // 渚嬪锛? 5, < =, <=, < b (绌烘牸鍚庡瓧姣?
  return content.replace(/<(?![a-zA-Z\/!])/g, '&lt;')
}

/**
 * 浠?HTML 浠ｇ爜鍧椾腑鎻愬彇绾枃鏈紙鏇村畨鍏ㄧ殑鏂瑰紡锛? * 鍏堝鐞嗘崲琛屾爣绛撅紝鍐嶆彁鍙栨枃鏈? * @exported 渚涘叾浠栨ā鍧椾娇鐢? */
export function extractCodeFromHtml(html: string): string {
  let text = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/?code[^>]*>/gi, '')

  text = extractCodeText(text)

  return text.trim()
}

/**
 * 杞崲閫夐」
 */
export interface TurndownOptions {
  /** 鏍囬鏍峰紡: setext (===) 鎴?atx (#) */
  headingStyle?: 'setext' | 'atx'
  /** 姘村钩绾挎牱寮?*/
  hr?: string
  /** 绮椾綋鍒嗛殧绗?*/
  bulletListMarker?: '-' | '+' | '*'
  /** 浠ｇ爜鍧楁牱寮?*/
  codeBlockStyle?: 'indented' | 'fenced'
  /** 浠ｇ爜鍧楀洿鏍忕鍙?*/
  fence?: '```' | '~~~'
  /** 寮鸿皟鍒嗛殧绗?*/
  emDelimiter?: '_' | '*'
  /** 绮椾綋鍒嗛殧绗?*/
  strongDelimiter?: '__' | '**'
  /** 閾炬帴鏍峰紡 */
  linkStyle?: 'inlined' | 'referenced'
  /** 閾炬帴寮曠敤鏍峰紡 */
  linkReferenceStyle?: 'full' | 'collapsed' | 'shortcut'
}

/**
 * 瑙勮寖鍖栧崟鍏冩牸鍐呭
 * markdown 琛ㄦ牸瑕佹眰姣忚鍗曞厓鏍煎湪鍚屼竴琛岋紝涓?`|` 闇€杞箟
 * - 鍘婚灏剧┖鐧? * - 杞箟绠￠亾绗? * - 鎹㈣ 鈫?<br>锛堜繚鐣欒瑙夋崲琛岋紱CSDN/鏍囧噯 markdown 娓叉煋鍣ㄥ湪琛ㄦ牸鍗曞厓鏍煎唴鏀寔 <br>锛? * - 鍚堝苟澶氫綑绌虹櫧
 */
function normalizeCellContent(content: string): string {
  let result = content.replace(/^\s+|\s+$/g, '')
  result = result.replace(/\|/g, '\\|')
  result = result.replace(/\s*\r?\n\s*/g, '<br>')
  result = result.replace(/[ \t]{2,}/g, ' ')
  return result
}

/**
 * 琛ㄦ牸鍗曞厓鏍煎鐞? */
function cell(content: string, node: Element): string {
  const normalized = normalizeCellContent(content)
  const parent = node.parentNode as Element | null
  if (!parent) {
    return '| ' + normalized + ' |'
  }
  const siblings = parent.querySelectorAll('th, td')
  const index = Array.from(siblings).indexOf(node)
  const prefix = index === 0 ? '| ' : ' '
  return prefix + normalized + ' |'
}

/**
 * 鑾峰彇琛ㄦ牸鐨勭涓€琛岋紙鍏煎 linkedom锛屼笉渚濊禆 table.rows锛? */
function getFirstRow(table: Element): Element | null {
  // linkedom 娌℃湁 table.rows锛岀洿鎺ユ煡璇?tr
  const tr = table.querySelector('tr')
  return tr
}

/**
 * 鍒ゆ柇鏄惁涓鸿〃澶磋
 */
function isHeadingRow(tr: Element): boolean {
  const parentNode = tr.parentNode as Element | null
  if (!parentNode) return false

  // 鑾峰彇鎵€鏈夊厓绱犲瓙鑺傜偣锛坱h/td锛夛紝鎺掗櫎鏂囨湰鑺傜偣
  const cells = tr.querySelectorAll('th, td')

  return (
    parentNode.nodeName === 'THEAD' ||
    (
      parentNode.firstChild === tr &&
      (parentNode.nodeName === 'TABLE' || isFirstTbody(parentNode)) &&
      cells.length > 0 &&
      Array.from(cells).every((n: Element) => n.nodeName === 'TH')
    )
  )
}

/**
 * 鍒ゆ柇鏄惁涓虹涓€涓?tbody
 */
function isFirstTbody(element: Element): boolean {
  const previousSibling = element.previousSibling as Element | null

  return (
    element.nodeName === 'TBODY' && (
      !previousSibling ||
      (
        previousSibling.nodeName === 'THEAD' &&
        /^\s*$/i.test(previousSibling.textContent || '')
      )
    )
  )
}

/**
 * 娣诲姞琛ㄦ牸鍜屼唬鐮佸潡鎵╁睍瑙勫垯
 */
function addExtensionRules(turndownService: TurndownService): void {
  // Pass through figure content.
  turndownService.addRule('figure', {
    filter: 'figure',
    replacement: function(content) {
      return content
    }
  })

  // figcaption 鍏冪礌 - 杞负鏂滀綋鏂囨湰
  turndownService.addRule('figcaption', {
    filter: 'figcaption',
    replacement: function(content) {
      return content ? '\n*' + content.trim() + '*\n' : ''
    }
  })

  // Table cells.
  turndownService.addRule('tableCell', {
    filter: ['th', 'td'],
    replacement: function(content, node) {
      return cell(content, node as Element)
    }
  })

  // Table rows.
  turndownService.addRule('tableRow', {
    filter: 'tr',
    replacement: function(content, node) {
      const tr = node as Element
      let borderCells = ''
      const alignMap: Record<string, string> = { left: ':--', right: '--:', center: ':-:' }

      if (isHeadingRow(tr)) {
        const cells = tr.querySelectorAll('th, td')
        cells.forEach((child) => {
          let border = '---'
          const align = (child.getAttribute?.('align') || '').toLowerCase()

          if (align && alignMap[align]) {
            border = alignMap[align]
          }

          borderCells += cell(border, child)
        })
      }
      return '\n' + content + (borderCells ? '\n' + borderCells : '')
    }
  })

  // 琛ㄦ牸
  turndownService.addRule('table', {
    filter: function(node) {
      try {
        if (node.nodeName !== 'TABLE') return false
        const table = node as Element
        const firstRow = getFirstRow(table)
        if (!firstRow) return false
        return isHeadingRow(firstRow)
      } catch (err) {
        logger.error('Table filter error:', err)
        return false
      }
    },
    replacement: function(content) {
      // 纭繚娌℃湁绌鸿
      content = content.replace(/\n\n/g, '\n')
      return '\n\n' + content + '\n\n'
    }
  })

  // 琛ㄦ牸鍖烘
  turndownService.addRule('tableSection', {
    filter: ['thead', 'tbody', 'tfoot'],
    replacement: function(content) {
      return content
    }
  })

  // Code blocks.
  turndownService.addRule('preCode', {
    filter: ['pre'],
    replacement: function(_content, node) {
      const pre = node as HTMLPreElement

      // 灏濊瘯鑾峰彇璇█锛堝绉嶆潵婧愶級
      let language = ''
      const dataLang = pre.getAttribute('data-lang')
      if (dataLang) {
        language = dataLang
      }
      // 2. 浠?code 鐨?class 鑾峰彇
      if (!language) {
        const code = pre.querySelector('code')
        if (code) {
          const className = code.className || ''
          const langMatch = className.match(/language-(\w+)/)
          if (langMatch) {
            language = langMatch[1]
          }
        }
      }
      // 3. 浠?pre 鐨?class 鑾峰彇
      if (!language) {
        const preClassName = pre.className || ''
        const preLangMatch = preClassName.match(/language-(\w+)/)
        if (preLangMatch) {
          language = preLangMatch[1]
        }
      }
      // 4. 榛樿浣跨敤 bash
      if (!language) {
        language = 'bash'
      }

      const codeElements = pre.querySelectorAll('code')
      let text: string
      if (codeElements.length > 1) {
        // 澶氫釜 code 鏍囩锛屾彁鍙栨瘡涓殑鏂囨湰骞剁敤鎹㈣杩炴帴
        const lines: string[] = []
        codeElements.forEach((codeEl) => {
          lines.push(codeEl.innerText || codeEl.textContent || '')
        })
        text = lines.join('\n')
      } else {
        text = pre.innerText || ''
      }

      // 娓呯悊鏂囨湰
      text = text
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/^\n+/, '')
        .replace(/\n+$/, '')

      if (!text.trim()) {
        return ''
      }

      // 娓呯悊璇█鏍囪瘑锛堝彧淇濈暀瀛楁瘝鏁板瓧鍜屽父瑙佸瓧绗︼級
      language = language.replace(/[^a-zA-Z0-9+#._-]/g, '').toLowerCase()

      // 妫€娴嬪唴瀹逛腑鏈€闀跨殑杩炵画鍙嶅紩鍙凤紝浣跨敤鏇村鍙嶅紩鍙峰寘瑁?      // 渚嬪鍐呭鏈?``` 鍒欑敤 ````锛屽唴瀹规湁 ```` 鍒欑敤 `````
      let fence = '```'
      const backtickMatches = text.match(/`+/g)
      if (backtickMatches) {
        const maxBackticks = Math.max(...backtickMatches.map(m => m.length))
        if (maxBackticks >= 3) {
          fence = '`'.repeat(maxBackticks + 1)
        }
      }

      return '\n' + fence + language + '\n' + text + '\n' + fence + '\n'
    }
  })

  // 婧愬钩鍙伴摼鎺ユ竻鐞嗭紙绔欏唴閾炬帴鍘婚櫎銆佽烦杞腑杞繕鍘燂級
  turndownService.addRule('sourcePlatformLinks', {
    filter: function(node) {
      if (node.nodeName !== 'A') return false
      const href = (node as Element).getAttribute('href') || ''
      return SOURCE_LINK_REMOVE_DOMAINS.some(d => href.includes(d))
        || SOURCE_LINK_REDIRECT_RULES.some(r => href.includes(r.domain))
    },
    replacement: function(content, node) {
      const href = (node as Element).getAttribute('href') || ''
      if (SOURCE_LINK_REMOVE_DOMAINS.some(d => href.includes(d))) {
        return content
      }
      const rule = SOURCE_LINK_REDIRECT_RULES.find(r => href.includes(r.domain))
      if (rule) {
        try {
          const url = new URL(href)
          const real = url.searchParams.get(rule.param)
          if (real) return '[' + content + '](' + real + ')'
        } catch {}
      }
      return '[' + content + '](' + href + ')'
    }
  })

  // Keep tables without a heading row as HTML.
  turndownService.keep(function(node) {
    try {
      if (node.nodeName !== 'TABLE') return false
      const table = node as Element
      const firstRow = getFirstRow(table)
      if (!firstRow) return true
      return !isHeadingRow(firstRow)
    } catch (err) {
      logger.error('Table keep filter error:', err)
      return false
    }
  })
}

/**
 * 鍒涘缓閰嶇疆濂界殑 Turndown 瀹炰緥
 */
export function createTurndownService(options: TurndownOptions = {}): TurndownService {
  const turndownService = new TurndownService({
    headingStyle: options.headingStyle || 'atx',
    hr: options.hr || '---',
    bulletListMarker: options.bulletListMarker || '-',
    codeBlockStyle: options.codeBlockStyle || 'fenced',
    fence: options.fence || '```',
    emDelimiter: options.emDelimiter || '*',
    strongDelimiter: options.strongDelimiter || '**',
    linkStyle: options.linkStyle || 'inlined',
    linkReferenceStyle: options.linkReferenceStyle || 'full',
  })

  // 娣诲姞鎵╁睍瑙勫垯
  addExtensionRules(turndownService)

  return turndownService
}

/**
 * HTML 杞?Markdown
 * 浣跨敤 linkedom 瑙ｆ瀽 HTML锛屽吋瀹?Service Worker 鐜
 * 濡傛灉 turndown 澶辫触锛屼娇鐢ㄧ畝鍗曟鍒欒浆鎹綔涓哄洖閫€
 */
export function htmlToMarkdown(html: string, _options: TurndownOptions = {}): string {
  // linkedom + turndown has compatibility issues in Service Worker environments
  // Use regex-based conversion instead for reliability
  return htmlToMarkdownSimple(html)
}

/**
 * 浠?className 鎻愬彇缂栫▼璇█
 */
function extractLangFromClass(className: string): string {
  if (!className) return ''

  const patterns = [
    /language-(\w+)/i,           // language-javascript
    /lang-(\w+)/i,               // lang-js
    /\bhljs\s+(\w+)/i,           // hljs javascript
    /\b(javascript|typescript|python|java|cpp|c|csharp|go|rust|ruby|php|swift|kotlin|scala|sql|html|css|json|xml|yaml|markdown|bash|shell|powershell)\b/i,
  ]

  for (const pattern of patterns) {
    const match = className.match(pattern)
    if (match) {
      return match[1].toLowerCase()
    }
  }

  return ''
}

/**
 * 绠€鍗曠殑姝ｅ垯 HTML 鈫?Markdown 杞崲 (鍥為€€鏂规)
 * 澧炲己鐗堬細鏀寔琛ㄦ牸杞崲銆佷唬鐮佸潡璇█璇嗗埆銆丩aTeX 鍏紡
 */
function htmlToMarkdownSimple(html: string): string {
  let md = html

  // ============ 棰勫鐞嗭細绉婚櫎寰俊浠ｇ爜鍧楄鍙?============
  // 蹇呴』鍦ㄥ垪琛ㄨ浆鎹箣鍓嶆墽琛岋紝鍚﹀垯 <li> 浼氳杞垚 "- "
  // 鏀寔 class="code-snippet__line-index" 鍜?class='code-snippet__line-index'
  md = md.replace(
    /<ul[^>]*class=["'][^"']*code-snippet__line-index[^"']*["'][^>]*>[\s\S]*?<\/ul>/gi,
    ''
  )

  md = convertTables(md)

  // 鏍囬
  md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n')
  md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n')
  md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n')
  md = md.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '\n#### $1\n')
  md = md.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, '\n##### $1\n')
  md = md.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, '\n###### $1\n')

  md = md.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**')
  md = md.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*')

  // 閾炬帴
  md = md.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')

  // 鍥剧墖
  md = md.replace(/<img[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*\/?>/gi, '![$2]($1)')
  md = md.replace(/<img[^>]*src="([^"]*)"[^>]*\/?>/gi, '![]($1)')

  md = md.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (match, content) => {
    let language = ''

    // 浠?pre 鏍囩鎻愬彇璇█
    const preLangMatch = match.match(/<pre[^>]*data-lang(?:uage)?=["'](\w+)["']/)
    const preClassMatch = match.match(/<pre[^>]*class="([^"]*)"/)
    if (preLangMatch) {
      language = preLangMatch[1]
    } else if (preClassMatch) {
      language = extractLangFromClass(preClassMatch[1])
    }

    // 浠?code 鏍囩鎻愬彇璇█
    const codeLangMatch = content.match(/<code[^>]*data-lang(?:uage)?=["'](\w+)["']/)
    const codeClassMatch = content.match(/<code[^>]*class="([^"]*)"/)
    if (!language) {
      if (codeLangMatch) {
        language = codeLangMatch[1]
      } else if (codeClassMatch) {
        language = extractLangFromClass(codeClassMatch[1])
      }
    }

    const text = extractCodeFromHtml(content)

    return '\n```' + language + '\n' + text + '\n```\n'
  })

  // 琛屽唴浠ｇ爜
  md = md.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`')

  // 鍒楄〃
  md = md.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, '$1\n')
  md = md.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, '$1\n')
  md = md.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n')

  md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '\n$1\n')
  md = md.replace(/<br\s*\/?>/gi, '\n')
  md = md.replace(/<hr\s*\/?>/gi, '\n---\n')

  md = md.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, content) => {
    return '\n' + content.trim().split('\n').map((line: string) => '> ' + line).join('\n') + '\n'
  })

  // LaTeX 鍏紡 - 鍧楃骇 (mode=display)
  // 娉ㄦ剰锛?$ 鍦ㄦ浛鎹㈠瓧绗︿覆涓渶瑕佸啓鎴?$$$$ 鎵嶈兘杈撳嚭 $$
  md = md.replace(/<script[^>]*type=["']math\/tex[^"']*display[^"']*["'][^>]*>([\s\S]*?)<\/script>/gi, '\n$$$$\n$1\n$$$$\n')
  // LaTeX 鍏紡 - 琛屽唴
  md = md.replace(/<script[^>]*type=["']math\/tex["'][^>]*>([\s\S]*?)<\/script>/gi, ' $$$$$1$$$$ ')

  // 绉婚櫎鍏朵粬鏍囩
  md = md.replace(/<\/?[^>]+(>|$)/g, '')

  // 瑙ｇ爜 HTML 瀹炰綋
  md = md.replace(/&amp;/g, '&')
  md = md.replace(/&lt;/g, '<')
  md = md.replace(/&gt;/g, '>')
  md = md.replace(/&quot;/g, '"')
  md = md.replace(/&#039;/g, "'")
  md = md.replace(/&nbsp;/g, ' ')

  // 娓呯悊澶氫綑绌鸿
  md = md.replace(/\n{3,}/g, '\n\n')
  md = md.trim()

  return md
}

/**
 * 灏?HTML 琛ㄦ牸杞崲涓?Markdown 琛ㄦ牸
 */
function convertTables(html: string): string {
  html = html.replace(/<figure[^>]*>([\s\S]*?)<\/figure>/gi, (match, figureContent) => {
    if (/<table[^>]*>/i.test(figureContent)) {
      // 鎻愬彇琛ㄦ牸閮ㄥ垎锛屼繚鐣?figcaption
      const tableMatch = figureContent.match(/<table[^>]*>([\s\S]*?)<\/table>/i)
      const captionMatch = figureContent.match(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i)

      if (tableMatch) {
        let result = tableMatch[0] // 杩斿洖琛ㄦ牸閮ㄥ垎
        if (captionMatch) {
          // 娣诲姞 caption 浣滀负鏂滀綋
          const caption = captionMatch[1].replace(/<[^>]+>/g, '').trim()
          if (caption) {
            result += '\n*' + caption + '*\n'
          }
        }
        return result
      }
    }
    return match // 闈炶〃鏍?figure 淇濇寔鍘熸牱
  })

  // 鍖归厤鏁翠釜琛ㄦ牸
  return html.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_, tableContent) => {
    const hasTheadMatch = tableContent.match(/<thead[^>]*>([\s\S]*?)<\/thead>/i)
    const rows: string[][] = []
    const alignments: string[][] = [] // 瀛樺偍姣忚姣忎釜鍗曞厓鏍肩殑瀵归綈鏂瑰紡
    let headerRowIndex = -1

    // 鎻愬彇鎵€鏈夎
    const rowMatches = tableContent.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || []

    for (let i = 0; i < rowMatches.length; i++) {
      const rowContent = rowMatches[i]
      const cells: string[] = []
      const rowAligns: string[] = []

      const cellMatches = rowContent.match(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi) || []
      const isHeaderRow = cellMatches.length > 0 && cellMatches.every((c: string) => c.startsWith('<th'))

      for (const cellMatch of cellMatches) {
        const fullMatch = cellMatch.match(/<t[hd]([^>]*)>([\s\S]*?)<\/t[hd]>/i)
        if (fullMatch) {
          const attrs = fullMatch[1]
          const rawContent = fullMatch[2]

          // 鎻愬彇瀵归綈鏂瑰紡
          const alignMatch = attrs.match(/align=["']?(left|center|right)["']?/i) ||
                            attrs.match(/style=["'][^"']*text-align:\s*(left|center|right)/i)
          const align = alignMatch ? alignMatch[1].toLowerCase() : ''
          rowAligns.push(align)

          // 娓呯悊鍐呭
          let content = rawContent
            .replace(/<br\s*\/?>/gi, ' ')
            .replace(/<[^>]+>/g, '')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/\s+/g, ' ')
            .trim()

          content = content.replace(/\|/g, '\\|')
          cells.push(content)
        }
      }

      if (cells.length > 0) {
        rows.push(cells)
        alignments.push(rowAligns)
        if (hasTheadMatch && rowContent.indexOf('<th') !== -1) {
          headerRowIndex = i
        } else if (i === 0 && isHeaderRow) {
          headerRowIndex = 0
        }
      }
    }

    if (rows.length === 0) {
      return ''
    }

    if (headerRowIndex === -1) {
      headerRowIndex = 0
    }

    // 杞崲涓?Markdown
    const mdRows: string[] = []
    const colCount = Math.max(...rows.map(r => r.length))

    // 鑾峰彇琛ㄥご琛岀殑瀵归綈淇℃伅
    const headerAligns = alignments[headerRowIndex] || []

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      // 濉厖缂哄け鐨勫崟鍏冩牸
      while (row.length < colCount) {
        row.push('')
      }

      mdRows.push('| ' + row.join(' | ') + ' |')

      // 鍦ㄨ〃澶磋涔嬪悗娣诲姞鍒嗛殧琛岋紙甯﹀榻愪俊鎭級
      if (i === headerRowIndex) {
        const separators = []
        for (let j = 0; j < colCount; j++) {
          const align = headerAligns[j] || ''
          if (align === 'left') {
            separators.push(':---')
          } else if (align === 'center') {
            separators.push(':---:')
          } else if (align === 'right') {
            separators.push('---:')
          } else {
            separators.push('---')
          }
        }
        mdRows.push('| ' + separators.join(' | ') + ' |')
      }
    }

    return '\n\n' + mdRows.join('\n') + '\n\n'
  })
}

/**
 * 榛樿鐨?Turndown 瀹炰緥锛堝彲澶嶇敤锛? */
let defaultService: TurndownService | null = null

/**
 * 鑾峰彇榛樿 Turndown 瀹炰緥
 */
export function getDefaultTurndownService(): TurndownService {
  if (!defaultService) {
    defaultService = createTurndownService()
  }
  return defaultService
}

export { TurndownService }

/**
 * HTML 杞?Markdown锛堜娇鐢ㄥ師鐢?DOM锛? * 閫傜敤浜?Content Script / 椤甸潰鐜锛屽埄鐢ㄦ祻瑙堝櫒鍘熺敓 DOM
 * 姣?linkedom 鍏煎鎬ф洿濂斤紝杞崲璐ㄩ噺鏇撮珮
 */
export function htmlToMarkdownNative(html: string, options: TurndownOptions = {}): string {
  if (typeof document === 'undefined') {
    logger.warn('No native DOM, falling back to regex conversion')
    return htmlToMarkdownSimple(html)
  }

  try {
    const turndownService = new TurndownService({
      headingStyle: options.headingStyle || 'atx',
      hr: options.hr || '---',
      bulletListMarker: options.bulletListMarker || '-',
      codeBlockStyle: options.codeBlockStyle || 'fenced',
      fence: options.fence || '```',
      emDelimiter: options.emDelimiter || '*',
      strongDelimiter: options.strongDelimiter || '**',
      linkStyle: options.linkStyle || 'inlined',
      linkReferenceStyle: options.linkReferenceStyle || 'full',
    })

    // 娣诲姞鎵╁睍瑙勫垯
    addExtensionRules(turndownService)

    // 浣跨敤鍘熺敓 DOM 瑙ｆ瀽 HTML
    const container = document.createElement('div')
    container.innerHTML = html

    // 棰勫鐞嗭細绉婚櫎寰俊浠ｇ爜鍧楄鍙峰厓绱狅紙蹇呴』鍦?turndown 涔嬪墠锛?
    const codeLineIndexes = container.querySelectorAll<Element>("ul.code-snippet__line-index, ul[class*=\"code-snippet__line-index\"]")
    Array.from(codeLineIndexes).forEach((el: Element) => el.remove())

    return turndownService.turndown(container)
  } catch (err) {
    logger.error('Native DOM conversion failed:', err)
    return htmlToMarkdownSimple(html)
  }
}

// ============ Markdown 鈫?HTML ============

import { marked } from 'marked'

/**
 * Markdown 杞?HTML
 */
export function markdownToHtml(markdown: string): string {
  return marked.parse(markdown, { async: false }) as string
}

/**
 * HTML 鏍囧噯鍖? * 閫氳繃 HTML 鈫?Markdown 鈫?HTML 寰€杩旇浆鎹紝娓呯悊鎵€鏈夊浣欑粨鏋? */
export function normalizeHtml(html: string, options: TurndownOptions = {}): string {
  const markdown = htmlToMarkdown(html, options)
  return markdownToHtml(markdown)
}
