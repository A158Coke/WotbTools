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
    const md = wrapper.find('.markdown-content')
    expect(md.exists()).toBe(true)
    expect(md.text()).toContain('League Rating V6')
  })

  it('返回按钮跳转回回放解析视图', async () => {
    const { wrapper, navigate } = mountPage()
    await wrapper.find('[data-testid="docs-back-btn"]').trigger('click')
    expect(navigate).toHaveBeenCalledWith('replay')
  })
})
