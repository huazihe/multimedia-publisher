import { describe, expect, it } from 'vitest'
import type { Article } from '../../types'
import { prepareArticleForPlatform } from '../prepare'
import { parseHTML } from 'linkedom'

const article: Article = {
  title: '验收常见误区',
  markdown: [
    '# 验收常见误区',
    '',
    '[外链](https://example.com)',
    '',
    '[微信链接](https://mp.weixin.qq.com/s/example)',
    '',
    '*强调内容*',
    '',
    '![图](https://img.example.com/a.png)',
  ].join('\n'),
  html: [
    '<h1>验收常见误区</h1>',
    '<p><a href="https://example.com">外链</a></p>',
    '<p><a href="https://mp.weixin.qq.com/s/example">微信链接</a></p>',
    '<p><em>强调内容</em></p>',
    '<img src="https://img.example.com/a.png" alt="图">',
  ].join(''),
}

describe('prepareArticleForPlatform', () => {
  it('fits woshipm images in preview and delivery HTML without changing source pixels or order', () => {
    const input:Article={title:'图文',markdown:'',html:'<p>前文</p><p><img src="https://example.com/large.png" alt="原图" width="1672" height="941" style="max-width:none!important;min-width:1672px;height:941px"></p><p>中间正文</p><img src="https://example.com/small.png" width="160"><p>后文</p>'}
    const before=input.html
    const result=prepareArticleForPlatform(input,'woshipm')
    expect(result.article.html).toBe(result.content)
    expect(result.htmlPreview).toBe(result.content)
    const imgs=[...parseHTML(result.content).document.querySelectorAll('img')]
    expect(imgs.map(i=>i.getAttribute('src'))).toEqual(['https://example.com/large.png','https://example.com/small.png'])
    for(const img of imgs){expect(img.style.getPropertyValue('max-width')).toBe('100%');expect(img.style.getPropertyValue('height')).toBe('auto');expect(img.style.getPropertyValue('min-width')).toBe('0')}
    expect(imgs[1].getAttribute('width')).toBe('160')
    expect(imgs[0].getAttribute('alt')).toBe('原图')
    expect(input.html).toBe(before)
    expect(result.content).toContain('中间正文')
    expect(prepareArticleForPlatform(article,'weixin').content).not.toContain('margin-left:auto')
  })
  it('keeps HTML but removes external hrefs for WeChat', () => {
    const result = prepareArticleForPlatform(article, 'weixin')

    expect(result.platform).toBe('weixin')
    expect(result.title).toBe(article.title)
    expect(result.format).toBe('html')
    expect(result.content).not.toContain('https://example.com')
    expect(result.content).toContain('外链')
    expect(result.content).toContain('https://mp.weixin.qq.com/s/example')
    expect(result.article.html).toBe(result.content)
  })

  it('checks protocol-relative links against WeChat keep domains', () => {
    const protocolRelativeArticle: Article = {
      title: '协议相对链接',
      markdown: '',
      html: [
        '<p><a href="//evil.example.com/path">外部链接文字</a></p>',
        '<p><a href="//mp.weixin.qq.com/s/allowed">微信白名单链接</a></p>',
      ].join(''),
    }

    const result = prepareArticleForPlatform(protocolRelativeArticle, 'weixin')

    expect(result.content).not.toContain('//evil.example.com/path')
    expect(result.content).toContain('外部链接文字')
    expect(result.content).toContain('//mp.weixin.qq.com/s/allowed')
  })

  it('returns prepared Markdown for Juejin', () => {
    const result = prepareArticleForPlatform(article, 'juejin')

    expect(result.format).toBe('markdown')
    expect(result.content).toContain('[外链](https://example.com)')
    expect(result.article.markdown).toBe(result.content)
    expect(result.imageCount).toBe(1)
    expect(result.htmlPreview).toContain('<h1>验收常见误区</h1>')
  })

  it('returns adapter-ready Markdown for zip downloads', () => {
    const result = prepareArticleForPlatform(article, 'zip-download')

    expect(result.format).toBe('markdown')
    expect(result.content).toBe(result.article.markdown)
    expect(result.content).not.toContain('<h1>')
    expect(result.htmlPreview).toContain('<h1>验收常见误区</h1>')
  })

  it('returns plain text and the nine-image limit for Xiaohongshu', () => {
    const result = prepareArticleForPlatform(article, 'xiaohongshu')

    expect(result.format).toBe('text')
    expect(result.content).toContain('验收常见误区')
    expect(result.content).toContain('外链')
    expect(result.content).toContain('强调内容')
    expect(result.content).not.toContain('*强调内容*')
    expect(result.content).not.toMatch(/<h1>|\[外链\]|!\[图\]|https:\/\/example\.com/)
    expect(result.limits.maxImages).toBe(9)
    expect(result.article.markdown).toBe(result.content)
    expect(result.htmlPreview).not.toContain('<img')
  })

  it('preserves literal identifiers and code while removing parenthesized image URLs', () => {
    const literalArticle: Article = {
      title: '纯文本保真',
      markdown: [
        'foo_bar_baz',
        '',
        '`<T>`',
        '',
        '![图](https://img.example.com/image_(1).png)',
        '',
        '**加粗正文**',
        '',
        '```ts',
        '  const values: Array<T> = foo_bar_baz',
        '```',
      ].join('\n'),
    }

    const result = prepareArticleForPlatform(literalArticle, 'xiaohongshu')

    expect(result.content).toBe([
      'foo_bar_baz',
      '',
      '<T>',
      '',
      '加粗正文',
      '',
      '  const values: Array<T> = foo_bar_baz',
    ].join('\n'))
    expect(result.imageCount).toBe(1)
  })

  it('removes executable HTML from prepared content and preview', () => {
    const unsafeArticle: Article = {
      title: '安全测试',
      markdown: '',
      html: [
        '<script>alert(1)</script>',
        '<p onclick="alert(2)">正文</p>',
        '<a href="javascript:alert(3)" onmouseover="alert(4)">危险链接</a>',
        '<iframe src="https://example.com/embed"></iframe>',
      ].join(''),
    }

    const result = prepareArticleForPlatform(unsafeArticle, 'weibo')

    for (const output of [result.content, result.htmlPreview, result.article.html || '']) {
      expect(output).not.toMatch(/<script|<iframe|\son\w+\s*=|javascript:/i)
      expect(output).toContain('正文')
      expect(output).toContain('危险链接')
    }
  })

  it('removes meta refresh and sanitizes nested template content', () => {
    const templatedArticle: Article = {
      title: '模板安全测试',
      markdown: '',
      html: [
        '<meta HTTP-EQUIV=" refresh " content="0;url=https://evil.example.com">',
        '<template>',
        '<script>alert(1)</script>',
        '<p onclick="alert(2)">模板正文</p>',
        '<a href="javascript:alert(3)" onmouseover="alert(4)">模板链接</a>',
        '<template><p onfocus="alert(5)">嵌套模板正文</p></template>',
        '</template>',
        '<p>可见正文</p>',
      ].join(''),
    }

    const result = prepareArticleForPlatform(templatedArticle, 'weibo')

    for (const output of [result.content, result.htmlPreview, result.article.html || '']) {
      expect(output).toContain('<template>')
      expect(output).toContain('模板正文')
      expect(output).toContain('嵌套模板正文')
      expect(output).toContain('可见正文')
      expect(output).not.toMatch(/http-equiv=["']?\s*refresh|<script|\son\w+\s*=|javascript:/i)
    }
  })

  it('removes external link resources regardless of rel tokens or casing', () => {
    const linkedArticle: Article = {
      title: '外部样式安全测试',
      markdown: '',
      html: [
        '<link rel="stylesheet preload" href="https://evil.example.com/multi.css">',
        '<link REL="PreLoad StyleSheet" HREF="https://evil.example.com/mixed.css">',
        '<link rel="preload" href="https://evil.example.com/resource.js">',
        '<p>安全正文</p>',
      ].join(''),
    }

    const result = prepareArticleForPlatform(linkedArticle, 'weibo')

    for (const output of [result.content, result.htmlPreview, result.article.html || '']) {
      expect(output).toContain('安全正文')
      expect(output).not.toMatch(/<link\b|evil\.example\.com/i)
    }
  })

  it('applies configured structural and attribute cleanup rules', () => {
    const structuralArticle: Article = {
      title: '结构清理',
      markdown: '',
      html: [
        '<!--内部注释-->',
        '<mpprofile>特殊卡片</mpprofile>',
        '<section class="content">',
        '<p data-track="1">正文</p>',
        '<p><br></p>',
        '<img src="https://img.example.com/placeholder.svg"',
        ' data-src="https://img.example.com/lazy.png"',
        ' srcset="https://img.example.com/lazy@2x.png 2x" sizes="100vw">',
        '</section>',
      ].join(''),
    }

    const result = prepareArticleForPlatform(structuralArticle, 'zhihu')

    expect(result.content).toContain('<div class="content">')
    expect(result.content).toContain('src="https://img.example.com/lazy.png"')
    expect(result.content).not.toMatch(/<!--|mpprofile|特殊卡片|<section|data-|srcset|sizes|\.svg|<p><br>/i)
  })

  it('always removes images without a usable src', () => {
    const emptyImageArticle: Article = {
      title: '空图片清理',
      markdown: '',
      html: [
        '<p>正文</p>',
        '<img>',
        '<img src="">',
        '<img src="   ">',
        '<img src="https://img.example.com/valid.png">',
      ].join(''),
    }

    const result = prepareArticleForPlatform(emptyImageArticle, 'weibo')

    expect(result.content.match(/<img\b/g) || []).toHaveLength(1)
    expect(result.content).toContain('src="https://img.example.com/valid.png"')
    expect(result.imageCount).toBe(1)
  })

  it('throws a clear error for an unknown platform', () => {
    expect(() => prepareArticleForPlatform(article, 'missing-platform'))
      .toThrow('平台不存在: missing-platform')
  })
})
