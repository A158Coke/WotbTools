// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import MarkdownContent from './MarkdownContent.vue'

function render(content) {
  return mount(MarkdownContent, {
    props: { content }
  })
}

describe('MarkdownContent semantic rendering', () => {
  it('renders heading without raw markdown syntax', () => {
    const wrapper = render('# Summary')
    expect(wrapper.text()).toBe('Summary')
    expect(wrapper.text()).not.toContain('#')
  })

  it('renders bold text', () => {
    const wrapper = render('**bold**')
    expect(wrapper.text()).toBe('bold')
    expect(wrapper.text()).not.toContain('**')
  })

  it('renders unordered list', () => {
    const wrapper = render('- item 1\n- item 2')
    expect(wrapper.text()).toContain('item 1')
    expect(wrapper.text()).toContain('item 2')
    expect(wrapper.text()).not.toContain('- ')
  })

  it('renders ordered list', () => {
    const wrapper = render('1. first\n2. second')
    expect(wrapper.text()).toContain('first')
    expect(wrapper.text()).toContain('second')
    expect(wrapper.text()).not.toContain('1. ')
  })

  it('renders link with target and rel', () => {
    const wrapper = render('[test](https://example.com)')
    const link = wrapper.find('a')
    expect(link.exists()).toBe(true)
    expect(link.attributes('href')).toBe('https://example.com')
    expect(link.attributes('target')).toBe('_blank')
    expect(link.attributes('rel')).toBe('noopener noreferrer')
  })

  it('renders blockquote without >', () => {
    const wrapper = render('> quote')
    expect(wrapper.text()).toContain('quote')
    expect(wrapper.text()).not.toContain('>')
  })

  it('renders inline code', () => {
    const wrapper = render('text `code` here')
    expect(wrapper.text()).toContain('code')
    expect(wrapper.text()).not.toContain('`')
  })

  it('renders horizontal rule', () => {
    const wrapper = render('before\n\n---\n\nafter')
    expect(wrapper.text()).toContain('before')
    expect(wrapper.text()).toContain('after')
    expect(wrapper.text()).not.toContain('---')
  })
})

describe('MarkdownContent XSS safety', () => {
  it('removes script tags', () => {
    const wrapper = render('<script>alert(1)</script>')
    expect(wrapper.find('script').exists()).toBe(false)
    // Raw HTML is escaped by markdown-it when html=false
    expect(wrapper.html()).toContain('&lt;script&gt;')
  })

  it('removes img and onerror attribute', () => {
    const wrapper = render('<img src=x onerror="alert(1)">')
    expect(wrapper.find('img').exists()).toBe(false)
  })

  it('removes javascript: URL when html allowed', () => {
    // With html: false, raw HTML is escaped, so no javascript: link is rendered
    const wrapper = render('<a href="javascript:alert(1)">click</a>')
    expect(wrapper.find('a').exists()).toBe(false)
  })

  it('removes iframe', () => {
    const wrapper = render('<iframe src="https://evil.com"></iframe>')
    expect(wrapper.find('iframe').exists()).toBe(false)
  })
})

describe('MarkdownContent edge cases', () => {
  it('handles null content', () => {
    const wrapper = mount(MarkdownContent, { props: { content: null } })
    expect(wrapper.text()).toBe('')
  })

  it('handles undefined content', () => {
    const wrapper = mount(MarkdownContent, { props: { content: undefined } })
    expect(wrapper.text()).toBe('')
  })

  it('handles empty string', () => {
    const wrapper = render('')
    expect(wrapper.text()).toBe('')
  })
})
