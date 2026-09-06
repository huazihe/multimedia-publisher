import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { buildPlatformPreview } from './direct'

const require = createRequire(import.meta.url)
const repo = fileURLToPath(new URL('../../../', import.meta.url))
const { listLayoutTemplates, renderLayoutTemplate } = require(path.join(repo, 'publisher-dashboard/layout-templates.js'))
const { parseHTML } = createRequire(path.join(repo, 'packages/core/package.json'))('linkedom')
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'weibot-template-regression-'))
afterAll(() => fs.rmSync(directory, { recursive: true, force: true }))
const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2T9sAAAAASUVORK5CYII='
const title = '多平台排版验收：图文混排效果如何'
const summary = '从业务需求到企业应用，讨论落地过程。'
const body = `<h2>先理解实际问题</h2><p>第一段原文：保留数字 20/28 和原来的论证顺序。</p>
  <img alt="首图" src="${pixel}"><p>中间段落，继续展开原文的业务判断与实施边界。</p>
  <img alt="中图" src="${pixel}"><h2>把结果交给使用者</h2><p>最后一段原文，不重新改写。</p><img alt="尾图" src="${pixel}">`
const templates: { filename: string }[] = listLayoutTemplates()

function fragment(html: string) {
  return parseHTML(`<!doctype html><html><head></head><body>${html}</body></html>`).document
}

function signature(root: any) {
  let text = ''
  const images: { alt: string; offset: number }[] = []
  const visit = (node: any) => {
    if (node.nodeType === 3) text += node.textContent.replace(/\s+/g, '')
    if (node.localName === 'img') images.push({ alt: node.getAttribute('alt'), offset: text.length })
    for (const child of node.childNodes || []) visit(child)
  }
  visit(root)
  return { text, images, headings: [...root.querySelectorAll('h2,h3,h4,h5,h6')].map(node => node.textContent) }
}

function generate(filename: string, headline = title) {
  const html = renderLayoutTemplate(filename, { title: headline, summary, body, accountName: '', accountDescription: '' })
  const file = path.join(directory, filename)
  fs.writeFileSync(file, html)
  return { html, prepared: buildPlatformPreview(file, 'weixin', { title: headline }) }
}

describe('all WeChat template conversions', () => {
  it.each(templates)('$filename retains its title, article text, headings and image positions after preparation', ({ filename }) => {
    const { html, prepared } = generate(filename)
    const source = parseHTML(html).document
    const output = fragment(prepared.content)
    const titleNode = source.querySelector('[data-wechat-slot="title"]')
    expect(titleNode.closest('svg')).toBeNull()
    expect(titleNode.textContent).toBe(title)
    // Ignore wrappers: image positions are offsets in the unchanged text stream.
    expect(signature(output.body)).toEqual(signature(fragment(`<h1>${title}</h1><p>${summary}</p>${body}`).body))
    expect(output.querySelectorAll('img').length).toBe(3)
    expect(prepared.imageCount).toBe(1) // The API counts unique sources; the fixture repeats one image.
    expect(output.querySelector('style,link,script,svg')).toBeNull()
  })
})

// Opt in with an absolute path to an already installed Playwright module. No downloads.
const playwrightPath = process.env.WECHAT_QA_PLAYWRIGHT
it.skipIf(!playwrightPath)('renders all templates and prepared HTML at phone and desktop widths', async () => {
  const { chromium } = require(playwrightPath!)
  const browser = await chromium.launch({ headless: true,
    executablePath: process.env.WECHAT_QA_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  const requests: string[] = []
  const pageErrors: string[] = []
  const measurements: any[] = []
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' })
    await context.route('**/*', (route: any) => { requests.push(route.request().url()); return route.abort() })
    const page = await context.newPage()
    page.on('pageerror', (error: Error) => pageErrors.push(error.message))
    const measure = async (html: string, headline: string, width: number) => {
      await page.setViewportSize({ width, height: 844 })
      await page.setContent(html, { waitUntil: 'load' })
      await page.evaluate(() => Promise.all([...document.images].map(image => image.decode().catch(() => null))))
      return page.evaluate((text: string) => {
        const title = [...document.body.querySelectorAll('*')].filter(node => node.textContent === text).at(-1) as HTMLElement
        const style = getComputedStyle(title)
        const box = title.getBoundingClientRect()
        let visible = true
        for (let node: HTMLElement | null = title; node; node = node.parentElement) {
          const ancestor = getComputedStyle(node)
          if (+ancestor.opacity === 0 || ancestor.display === 'none' || ancestor.visibility !== 'visible') visible = false
        }
        return { viewport: innerWidth, documentWidth: document.documentElement.scrollWidth,
          title: { visible, width: box.width, height: box.height, size: style.fontSize, color: style.color,
            left: box.left, right: box.right, textFill: style.webkitTextFillColor },
          images: [...document.images].map(image => { const b = image.getBoundingClientRect();
            return { decoded: image.complete && image.naturalWidth > 0, width: b.width, height: b.height } }) }
      }, headline)
    }
    for (const { filename } of templates) {
      const { html, prepared } = generate(filename)
      const mobile = await measure(html, title, 390)
      for (const width of [320, 390, 800]) {
        for (const [phase, document] of [['template', html], ['prepared', prepared.htmlPreview]]) {
          const result = await measure(document, title, width)
          measurements.push({ filename, phase, ...result })
          const label = `${filename} ${phase} ${width}px`
          expect(result.documentWidth, label).toBeLessThanOrEqual(width)
          expect(result.title.visible, label).toBe(true)
          expect(result.title.width, label).toBeGreaterThan(100)
          expect(result.title.height, label).toBeLessThan(240)
          expect(result.title.left, label).toBeGreaterThanOrEqual(0)
          expect(result.title.right, label).toBeLessThanOrEqual(width)
          expect(result.images.every((image: any) => image.decoded && image.width > 0 && image.height > 0), label).toBe(true)
          if (phase === 'prepared') {
            expect(result.title.size, label).toBe(mobile.title.size)
            expect(result.title.color, label).toBe(mobile.title.color)
          }
          if (process.env.WECHAT_QA_OUTPUT && width === 390 && /^(?:style_(4|7|10|13)|template_style13|通用排版·基础样式)\.html$/.test(filename)) {
            fs.mkdirSync(process.env.WECHAT_QA_OUTPUT, { recursive: true })
            await page.screenshot({ path: path.join(process.env.WECHAT_QA_OUTPUT, `${filename}-${phase}.png`) })
          }
        }
      }
    }
    // A long mixed-script title must also wrap without pushing the page sideways.
    const longTitle = '多平台排版压力测试：较长标题如何显示？从结构检查到实际交付，CrossPlatformContentWorkbench如何保持图文混排效果'
    for (const filename of ['style_4.html', 'style_7.html', 'style_10.html', 'style_13.html', 'template_style13.html']) {
      const { html, prepared } = generate(filename, longTitle)
      for (const document of [html, prepared.htmlPreview]) {
        const result = await measure(document, longTitle, 320)
        expect(result.documentWidth, filename).toBeLessThanOrEqual(320)
        expect(result.title.visible, filename).toBe(true)
        expect(result.title.width, filename).toBeGreaterThan(100)
      }
    }
    expect(requests).toEqual([])
    expect(pageErrors).toEqual([])
  } finally {
    await browser.close()
    if (process.env.WECHAT_QA_OUTPUT) {
      fs.mkdirSync(process.env.WECHAT_QA_OUTPUT, { recursive: true })
      fs.writeFileSync(path.join(process.env.WECHAT_QA_OUTPUT, 'measurements.json'), JSON.stringify({ measurements, requests, pageErrors }, null, 2))
    }
  }
}, 120_000)
