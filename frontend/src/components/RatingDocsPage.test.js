// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { NAVIGATE_VIEW_KEY } from '../shared/navigation.js'
import RatingDocsPage from './RatingDocsPage.vue'

function mountPage() {
  const navigate = vi.fn()
  const wrapper = mount(RatingDocsPage, {
    global: {
      mocks: { $t: (key) => key },
      provide: { [NAVIGATE_VIEW_KEY]: navigate },
    },
  })
  return { wrapper, navigate }
}

describe('RatingDocsPage', () => {
  it('渲染 canonical Markdown 正文（League Rating V6）', () => {
    const { wrapper } = mountPage()
    expect(wrapper.find('.rating-docs-page').exists()).toBe(true)
    expect(wrapper.find('[data-testid="docs-back-btn"]').exists()).toBe(true)
    // 与历史 / 技术演进同一文档模板：有目录、正文在 .doc-body
    expect(wrapper.find('[data-testid="doc-toc"]').exists()).toBe(true)
    const md = wrapper.find('.doc-body')
    expect(md.exists()).toBe(true)
    // 分区主视觉取代了正文里的首个 H1：标题只出现一次，正文从导语开始。
    const hero = wrapper.find('[data-testid="showcase-hero"]')
    expect(hero.exists()).toBe(true)
    expect(hero.text()).toContain('League Rating V6')
    expect(md.text()).not.toContain('League Rating V6')
    expect(md.text()).toContain('Research Data Status')
    expect(md.text()).toContain('Team V6 Rating')
    expect(md.text()).toContain('(T + 475) / (N + 1)')
    expect(md.text()).not.toContain('Mandatory Scope-Risk Checkpoint')
    // CommonMark：源文件里的硬换行不再变成 <br>
    expect(md.find('br').exists()).toBe(false)
  })

  it('返回按钮跳转回回放解析视图', async () => {
    const { wrapper, navigate } = mountPage()
    await wrapper.find('[data-testid="docs-back-btn"]').trigger('click')
    expect(navigate).toHaveBeenCalledWith('replay')
  })
})
