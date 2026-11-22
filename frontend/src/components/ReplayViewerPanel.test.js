// @vitest-environment happy-dom
// 统一回放面板（2026-11-19）：2D/3D 两个 pane 都挂载、面板内切换；信息流始终展开、
// 展开后在面板下方自然延伸；`--pb-viewer-reserve` 只预留面板头部（窗口因此吃满视口）。
import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createI18n } from 'vue-i18n'
import { mount } from '@vue/test-utils'
import ReplayViewerPanel from './ReplayViewerPanel.vue'

const form = vi.hoisted(() => ({ isPhone: null }))
vi.mock('../composables/usePlaybackPhoneForm.ts', async () => {
  const { ref } = await import('vue')
  form.isPhone = ref(false)
  return { usePlaybackPhoneForm: () => ({ isPhone: form.isPhone }) }
})

const i18n = createI18n({
  legacy: false, locale: 'zh', missingWarn: false, fallbackWarn: false,
  messages: { zh: { workspace: {
    tab_replay: '回放', tab_3d: '3D 回放', tab_playback: '2D 回放', tab_events: '事件流',
  } } },
})

const mountPanel = (props = {}) => mount(ReplayViewerPanel, {
  props: { mode: '2d', ...props },
  slots: {
    'viewer-2d': '<div data-test="pane-2d">2D</div>',
    'viewer-3d': '<div data-test="pane-3d">3D</div>',
    events: '<div data-test="pane-events">events</div>',
  },
  global: { plugins: [i18n] },
})

beforeEach(() => { form.isPhone.value = false })
afterEach(() => { vi.restoreAllMocks() })

describe('ReplayViewerPanel 统一回放面板', () => {
  it('2D/3D 两个 pane 都挂载，仅 v-show 切换；模式切换只发事件（路由归工作台）', async () => {
    const wrapper = mountPanel({ mode: '2d' })
    // 两个 slot 内容始终存在（切模式不销毁、不重新解析）
    expect(wrapper.find('[data-test="pane-2d"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="pane-3d"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="ws-playback"]').element.style.display).toBe('')
    expect(wrapper.get('[data-testid="ws-3d"]').element.style.display).toBe('none')

    await wrapper.setProps({ mode: '3d' })
    expect(wrapper.get('[data-testid="ws-playback"]').element.style.display).toBe('none')
    expect(wrapper.get('[data-testid="ws-3d"]').element.style.display).toBe('')
    expect(wrapper.find('[data-test="pane-3d"]').exists()).toBe(true)

    await wrapper.get('[data-testid="viewer-mode-2d"]').trigger('click')
    expect(wrapper.emitted('update:mode')?.at(-1)).toEqual(['2d'])
    // 受控组件：父级回写 mode 后才轮到另一侧再发事件
    await wrapper.setProps({ mode: '2d' })
    await wrapper.get('[data-testid="viewer-mode-3d"]').trigger('click')
    expect(wrapper.emitted('update:mode')?.at(-1)).toEqual(['3d'])
  })

  it('信息流始终展开（面板下方自然流，无折叠按钮）', async () => {
    const wrapper = mountPanel()
    expect(wrapper.find('[data-testid="viewer-events-toggle"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="ws-events"]').element.style.display).toBe('')
    expect(wrapper.get('.viewer-events-body').find('[data-test="pane-events"]').exists()).toBe(true)

    // 窄屏同样展开：窗口高度不因信息流变化，列表在面板下方由页面滚动。
    form.isPhone.value = true
    await nextTick()
    const narrowWrapper = mountPanel()
    expect(narrowWrapper.find('[data-testid="viewer-events-toggle"]').exists()).toBe(false)
    expect(narrowWrapper.get('[data-testid="ws-events"]').element.style.display).toBe('')
  })

  it('--pb-viewer-reserve 只含面板头部（信息流展开不回缩窗口）；窄屏归零', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      const height = this.classList?.contains('viewer-head') ? 40
        : this.classList?.contains('viewer-events') ? 200 : 0
      return { height, width: 0, top: 0, left: 0, right: 0, bottom: height, x: 0, y: 0, toJSON: () => ({}) }
    })
    const wrapper = mountPanel()
    await nextTick()
    const root = wrapper.get('[data-testid="ws-replay-viewer"]').element
    const reserve = root.style.getPropertyValue('--pb-viewer-reserve')
    expect(reserve).toMatch(/^\d+px$/)
    // 信息流始终展开但不进入预算：reserve 只有面板头（远小于旧版的固定信息流高度）
    expect(parseFloat(reserve)).toBeLessThan(120)

    // 窄屏不扣 pane 高度（保持现有地图最小尺寸），reserve 归零
    form.isPhone.value = true
    await nextTick()
    await nextTick()
    expect(root.style.getPropertyValue('--pb-viewer-reserve')).toBe('0px')
  })
})