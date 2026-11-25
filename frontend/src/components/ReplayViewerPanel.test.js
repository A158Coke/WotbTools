// @vitest-environment happy-dom
// 统一回放面板：2D/3D 两个 pane 都挂载、面板内切换；事件流默认隐藏（v-show 保持挂载），
// 由头部「显示事件信息」开关恢复；`--pb-viewer-reserve` 只预留面板头部。
import { defineComponent, h, nextTick, onMounted } from 'vue'
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
    show_event_details: '显示事件信息',
  } } },
})

const mountPanel = (props = {}, slots = {}) => mount(ReplayViewerPanel, {
  props: { mode: '2d', ...props },
  slots: {
    'viewer-2d': '<div data-test="pane-2d">2D</div>',
    'viewer-3d': '<div data-test="pane-3d">3D</div>',
    events: '<div data-test="pane-events">events</div>',
    ...slots,
  },
  global: { plugins: [i18n] },
})

const PaneProbe = defineComponent({
  props: { showEventMarkers: { type: Boolean, default: false } },
  setup(props) {
    return () => h('div', {
      'data-test': 'pane-probe',
      'data-show-event-markers': String(props.showEventMarkers),
    })
  },
})

function eventsButton(wrapper) {
  return wrapper.get('[data-testid="viewer-events-toggle"]')
}

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

  it('事件流默认隐藏，开关恢复显示；再次关闭', async () => {
    const wrapper = mountPanel()
    const section = wrapper.get('[data-testid="ws-events"]')
    expect(eventsButton(wrapper).attributes('role')).toBe('switch')
    expect(eventsButton(wrapper).attributes('aria-checked')).toBe('false')
    expect(section.element.style.display).toBe('none')
    // 仅 v-show：事件流 slot 仍挂载
    expect(wrapper.get('.viewer-events-body').find('[data-test="pane-events"]').exists()).toBe(true)

    await eventsButton(wrapper).trigger('click')
    expect(eventsButton(wrapper).attributes('aria-checked')).toBe('true')
    expect(wrapper.get('[data-testid="ws-events"]').element.style.display).toBe('')

    await eventsButton(wrapper).trigger('click')
    expect(eventsButton(wrapper).attributes('aria-checked')).toBe('false')
    expect(wrapper.get('[data-testid="ws-events"]').element.style.display).toBe('none')
  })

  it('窄屏默认同样隐藏', async () => {
    form.isPhone.value = true
    await nextTick()
    const wrapper = mountPanel()
    expect(eventsButton(wrapper).attributes('aria-checked')).toBe('false')
    expect(wrapper.get('[data-testid="ws-events"]').element.style.display).toBe('none')
  })

  it('eventsFocused 深链：初始打开、父级 true 后打开、用户关闭后不自动重开', async () => {
    const focused = mountPanel({ eventsFocused: true })
    expect(eventsButton(focused).attributes('aria-checked')).toBe('true')
    expect(focused.get('[data-testid="ws-events"]').element.style.display).toBe('')

    const wrapper = mountPanel({ eventsFocused: false })
    expect(wrapper.get('[data-testid="ws-events"]').element.style.display).toBe('none')
    await wrapper.setProps({ eventsFocused: true })
    expect(eventsButton(wrapper).attributes('aria-checked')).toBe('true')
    expect(wrapper.get('[data-testid="ws-events"]').element.style.display).toBe('')

    // 用户主动关闭：父级仍为 true，不得被 watch 自动重开
    await eventsButton(wrapper).trigger('click')
    expect(wrapper.get('[data-testid="ws-events"]').element.style.display).toBe('none')
    await wrapper.setProps({ eventsFocused: true })
    expect(wrapper.get('[data-testid="ws-events"]').element.style.display).toBe('none')

    // 下一次真实的 false→true 再打开
    await wrapper.setProps({ eventsFocused: false })
    await wrapper.setProps({ eventsFocused: true })
    expect(wrapper.get('[data-testid="ws-events"]').element.style.display).toBe('')
  })

  it('2D/3D scoped slot 收到同一 showEventMarkers 状态', async () => {
    const wrapper = mountPanel({}, {
      'viewer-2d': (slotProps) => h(PaneProbe, { showEventMarkers: slotProps.showEventMarkers }),
      'viewer-3d': (slotProps) => h(PaneProbe, { showEventMarkers: slotProps.showEventMarkers }),
    })
    const readMarkers = () => wrapper.findAllComponents(PaneProbe).map((probe) => probe.props('showEventMarkers'))
    expect(readMarkers()).toEqual([false, false])
    expect(wrapper.findAll('[data-test="pane-probe"]').map((probe) => probe.attributes('data-show-event-markers'))).toEqual(['false', 'false'])

    await eventsButton(wrapper).trigger('click')
    expect(readMarkers()).toEqual([true, true])
    expect(wrapper.findAll('[data-test="pane-probe"]').map((probe) => probe.attributes('data-show-event-markers'))).toEqual(['true', 'true'])
  })

  it('开关反复切换不重新挂载事件流（v-show 保留筛选 / 分页状态）', async () => {
    let mounts = 0
    const EventsProbe = defineComponent({
      setup() {
        onMounted(() => { mounts += 1 })
        return () => h('div', { 'data-test': 'pane-events' }, 'events')
      },
    })
    const wrapper = mountPanel({}, { events: EventsProbe })
    expect(mounts).toBe(1)
    await eventsButton(wrapper).trigger('click')
    await eventsButton(wrapper).trigger('click')
    await eventsButton(wrapper).trigger('click')
    expect(mounts).toBe(1)
    expect(wrapper.find('[data-test="pane-events"]').exists()).toBe(true)
  })

  it('--pb-viewer-reserve 只含面板头部（事件流高度不回缩窗口）；窄屏归零', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      const height = this.classList?.contains('viewer-head') ? 40
        : this.classList?.contains('viewer-events') ? 200 : 0
      return { height, width: 0, top: 0, left: 0, right: 0, bottom: height, x: 0, y: 0, toJSON: () => ({}) }
    })
    const wrapper = mountPanel({ eventsFocused: true })
    await nextTick()
    const root = wrapper.get('[data-testid="ws-replay-viewer"]').element
    const reserve = root.style.getPropertyValue('--pb-viewer-reserve')
    expect(reserve).toMatch(/^\d+px$/)
    // 事件流开启且高 200px，但不进入预算：reserve 只有面板头
    expect(parseFloat(reserve)).toBeLessThan(120)

    // 窄屏不扣 pane 高度（保持现有地图最小尺寸），reserve 归零
    form.isPhone.value = true
    await nextTick()
    await nextTick()
    expect(root.style.getPropertyValue('--pb-viewer-reserve')).toBe('0px')
  })
})
