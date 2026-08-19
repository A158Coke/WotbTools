import {describe, expect, it} from 'vitest'
import MarkdownIt from 'markdown-it'
import {normalizeHeadings} from './markdownHeadingNormalize'

const md = new MarkdownIt({ html: false, linkify: true, breaks: true })

describe('normalizeHeadings', () => {
  it('inserts a space after hashes so `##一、` renders as real <h2>', () => {
    const html = md.render(normalizeHeadings('##一、战前预测\n正文'))
    expect(html).toContain('<h2>一、战前预测</h2>')
    expect(html).not.toContain('##')
  })

  it('handles 1-6 hashes without a space', () => {
    expect(md.render(normalizeHeadings('#Title'))).toContain('<h1>Title</h1>')
    expect(md.render(normalizeHeadings('######Deep'))).toContain('<h6>Deep</h6>')
  })

  it('does not touch already-correct `## 一、` headings', () => {
    expect(normalizeHeadings('## 一、正常标题')).toBe('## 一、正常标题')
    expect(md.render(normalizeHeadings('## 一、正常标题'))).toContain('<h2>一、正常标题</h2>')
  })

  it('keeps fenced code blocks untouched', () => {
    const input = '```\n## comment\n```\n\n##一、真标题'
    const normalized = normalizeHeadings(input)
    expect(normalized).toContain('## comment')
    const html = md.render(normalized)
    expect(html).toContain('## comment')
    expect(html).toContain('<h2>一、真标题</h2>')
  })

  it('toggles fences across multiple blocks', () => {
    const input = '```\n## a\n```\n##b\n```\n## c\n```\n##d'
    const html = md.render(normalizeHeadings(input))
    expect(html).toContain('## a')
    expect(html).toContain('## c')
    expect(html).toContain('<h2>b</h2>')
    expect(html).toContain('<h2>d</h2>')
  })
})
