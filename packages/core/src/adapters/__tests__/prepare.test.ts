import { describe, expect, it } from 'vitest'
import type { Article } from '../../types'
import { prepareArticleForPlatform } from '../prepare'

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
