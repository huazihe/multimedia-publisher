/**
 * Markdown to Draft.js 杞崲
 * 鐢ㄤ簬璞嗙摚绛変娇鐢?Draft.js 缂栬緫鍣ㄧ殑骞冲彴
 *
 */

// @ts-ignore - markdown-draft-js 娌℃湁绫诲瀷瀹氫箟
import { markdownToDraft as mdToDraft } from 'markdown-draft-js'
import { Remarkable } from 'remarkable'

/**
 * 鍥剧墖鏁版嵁鎺ュ彛 - 璞嗙摚闇€瑕佸畬鏁寸殑鍥剧墖淇℃伅
 */
export interface DoubanImageData {
  id: string
  url: string
  thumb: string
  width?: number
  height?: number
  file_name?: string
  file_size?: number
}

/**
 * 璞嗙摚鍥剧墖 Block 瑙ｆ瀽鍣?- 澶勭悊 ![]() 鏍煎紡鐨勫浘鐗? */
const ImageRegexp = /^!\[([^\]]*)]\s*\(([^)"]+)( "([^)"]+)")?\)/

const imageBlockPlugin = (remarkable: Remarkable) => {
  // @ts-ignore - remarkable types incomplete
  remarkable.block.ruler.before('paragraph', 'image', (state: any, startLine: number, endLine: number, silent: boolean) => {
    const pos = state.bMarks[startLine] + state.tShift[startLine]
    const max = state.eMarks[startLine]

    if (pos >= max) return false
    if (!state.src) return false
    if (state.src[pos] !== '!') return false

    const match = ImageRegexp.exec(state.src.slice(pos))
    if (!match) return false

    if (!silent) {
      state.tokens.push({
        type: 'image_open',
        src: match[2],
        alt: match[1],
        lines: [startLine, state.line],
        level: state.level
      })
      state.tokens.push({
        type: 'image_close',
        level: state.level
      })
    }

    state.line = startLine + 1
    return true
  })
}

/**
 * 灏?Markdown 杞崲涓?Draft.js 鏍煎紡 (璞嗙摚涓撶敤)
 * @param markdown Markdown 鍐呭
 * @param imageDataMap 鍥剧墖 URL 鍒板畬鏁存暟鎹殑鏄犲皠
 * @returns Draft.js JSON 瀛楃涓? */
export function markdownToDraft(markdown: string, imageDataMap: Map<string, DoubanImageData> = new Map()): string {
  // 淇濊瘉鍥剧墖鎹㈣
  const processedMarkdown = markdown.split('\n').map(line => {
    const imageBlocks = line.split('![]')
    return imageBlocks.length > 1 ? imageBlocks.join('\n![]') : line
  }).join('\n')

  let keyCounter = 0
  const generateUniqueKey = () => keyCounter++

  const draftState = mdToDraft(processedMarkdown, {
    remarkablePlugins: [imageBlockPlugin],
    blockTypes: {
      image_open: function (item: any) {
        const key = generateUniqueKey()
        const blockEntities: Record<number, any> = {}

        // 瑙ｆ瀽 ?# 鏍煎紡鑾峰彇鍘熷 URL 鍜?ID
        const sourcePair = item.src ? item.src.split('?#') : ['', '']
        const rawSrc = sourcePair[0]
        const sourceId = sourcePair[1] || ''

        // 浠?imageDataMap 鑾峰彇瀹屾暣鍥剧墖鏁版嵁
        const imgData = imageDataMap.get(item.src) || imageDataMap.get(rawSrc)

        const imageTemplate = imgData ? {
          id: imgData.id,
          src: imgData.url,
          thumb: imgData.thumb,
          url: imgData.url,
          width: imgData.width,
          height: imgData.height,
          file_name: imgData.file_name,
          file_size: imgData.file_size,
        } : {
          id: sourceId,
          src: rawSrc,
          thumb: rawSrc,
          url: rawSrc,
        }

        blockEntities[key] = {
          type: 'IMAGE',
          mutability: 'IMMUTABLE',
          data: imageTemplate,
        }

        return {
          type: 'atomic',
          blockEntities: blockEntities,
          inlineStyleRanges: [],
          entityRanges: [{ offset: 0, length: 1, key: key }],
          text: ' ',
        }
      }
    },
    blockEntities: {
      image: function (item: any) {
        const sourcePair = item.src ? item.src.split('?#') : ['', '']
        const rawSrc = sourcePair[0]
        const sourceId = sourcePair[1] || ''

        // 浠?imageDataMap 鑾峰彇瀹屾暣鍥剧墖鏁版嵁
        const imgData = imageDataMap.get(item.src) || imageDataMap.get(rawSrc)

        if (imgData) {
          return {
            type: 'IMAGE',
            mutability: 'IMMUTABLE',
            data: {
              id: imgData.id,
              src: imgData.url,
              thumb: imgData.thumb,
              url: imgData.url,
              width: imgData.width,
              height: imgData.height,
            }
          }
        }

        return {
          type: 'IMAGE',
          mutability: 'IMMUTABLE',
          data: {
            id: sourceId,
            src: rawSrc,
            thumb: rawSrc,
            url: rawSrc,
          }
        }
      }
    }
  })

  // 灏?block.blockEntities 鍚堝苟鍒伴《灞?entityMap (鍙傝€?mtd.js)
  if (draftState.blocks) {
    for (const block of draftState.blocks) {
      if (block.blockEntities) {
        Object.assign(draftState.entityMap, block.blockEntities)
        delete block.blockEntities
      }
    }
  }

  return JSON.stringify(draftState)
}
