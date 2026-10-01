// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import MarkdownDocPage from './MarkdownDocPage.vue'

const SOURCE = `# 项目历史

## 2026-06-23 — 开始

正文一

## 2026-06-24 — 继续

正文二 <script>alert(1)</script>
`

describe('MarkdownDocPage（审计 PG-14：长文档目录）', () => {
  it('二级标题生成目录，标题带锚点，链接指向锚点', () => {
    const wrapper = mount(MarkdownDocPage, { props: { source: SOURCE }, global: { mocks: { $t: key => key } } })
    const links = wrapper.findAll('[data-testid="doc-toc"] a')
    expect(links.map(a => a.text())).toEqual(['2026-06-23 — 开始', '2026-06-24 — 继续'])
    expect(links.map(a => a.attributes('href'))).toEqual(['#section-1', '#section-2'])
    expect(wrapper.find('h2#section-1').exists()).toBe(true)
    expect(wrapper.find('h2#section-2').exists()).toBe(true)
    // 窄屏的折叠目录与桌面目录同源
    expect(wrapper.findAll('[data-testid="doc-toc-compact"] a')).toHaveLength(2)
  })

  it('不渲染原始 HTML（markdown html:false + DOMPurify）', () => {
    const wrapper = mount(MarkdownDocPage, { props: { source: SOURCE }, global: { mocks: { $t: key => key } } })
    expect(wrapper.find('script').exists()).toBe(false)
  })

  it('只有一个章节时不显示目录', () => {
    const wrapper = mount(MarkdownDocPage, { props: { source: '# T\n\n## Only\n\ntext' }, global: { mocks: { $t: key => key } } })
    expect(wrapper.find('[data-testid="doc-toc"]').exists()).toBe(false)
  })
})
