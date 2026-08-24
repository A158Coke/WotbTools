// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import AiReviewPanel from './AiReviewPanel.vue'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: key => key, locale: { value: 'zh' } })
}))

vi.mock('../composables/useAuth.js', () => ({
  useAuth: () => ({
    tokenParsed: { value: { realm_access: { roles: ['wotbtools-user'] } } },
    token: () => 'test-token',
    ensureToken: vi.fn().mockResolvedValue(true),
    login: vi.fn(),
  })
}))

/** AI 复盘 Workspace 布局所有权：.ai-review-panel 是唯一 width owner，
 *  Action / Error / Streaming / Analysis Result 全部作为其子节点共享同一宽度契约。 */
describe('AiReviewPanel workspace layout ownership', () => {
  function mountPanel(file) {
    return mount(AiReviewPanel, {
      props: { file },
      global: {
        mocks: { $t: key => key },
        stubs: {
          AnalysisResultPanel: {
            props: ['result'],
            template: '<div class="result-stub">{{ result.analysis }}</div>'
          }
        }
      }
    })
  }

  it('.ai-review-panel 存在且包含 .ai-action-row（Action 与 Result 同属一个父容器）', () => {
    const wrapper = mountPanel({ name: 'a.wotbreplay' })
    const panel = wrapper.find('.ai-review-panel')
    expect(panel.exists()).toBe(true)
    expect(panel.find('.ai-action-row').exists()).toBe(true)
    expect(panel.find('.ai-action-row .lg').exists()).toBe(true)
  })

  it('Streaming 面板与 Analysis Result 都是 .ai-review-panel 的子节点（共享同一 width owner）', async () => {
    const wrapper = mountPanel({ name: 'a.wotbreplay' })
    const panel = wrapper.find('.ai-review-panel')

    // 流式状态：.streaming-panel 渲染在 .ai-review-panel 内部
    wrapper.vm.analyzing = true
    await nextTick()
    expect(panel.find('.streaming-panel').exists()).toBe(true)
    expect(wrapper.find('.streaming-panel').element.parentElement.classList.contains('ai-review-panel')).toBe(true)

    // 结果状态：AnalysisResultPanel 渲染在 .ai-review-panel 内部
    wrapper.vm.analyzing = false
    wrapper.vm.analysisResult = { analysis: '复盘正文' }
    await nextTick()
    expect(panel.find('.result-stub').exists()).toBe(true)
    expect(panel.find('.result-stub').text()).toContain('复盘正文')
    expect(wrapper.find('.result-stub').element.parentElement.classList.contains('ai-review-panel')).toBe(true)
  })

  it('未选择文件时显示空态提示（不渲染 AI 布局）', () => {
    const wrapper = mountPanel(null)
    expect(wrapper.find('.ws-note').exists()).toBe(true)
    expect(wrapper.find('.ai-action-row').exists()).toBe(false)
  })
})
