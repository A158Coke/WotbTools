// @vitest-environment happy-dom
// 3D 视图的 WebGL 预检与加载状态（审计 3D-23）：AgentArmorView（装甲查看器）/ Scene3DStatus。
// 回放侧的 3D 面板（Replay3DPane）有独立测试文件。
// WebGL 通过 HTMLCanvasElement.prototype.getContext 模拟；three.js 场景内核整体 mock。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick, ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import Scene3DStatus from './Scene3DStatus.vue'

const viewer = vi.hoisted(() => ({ calls: [], retryResult: true }))
vi.mock('../scene/tankViewer.js', () => ({
  initTankViewer: vi.fn((options) => {
    const api = { destroy: vi.fn(), retry: vi.fn(() => viewer.retryResult), options }
    viewer.calls.push(api)
    return api
  }),
}))

vi.mock('../scene/assetProvider.js', () => ({ assetProvider: { configured: () => true } }))

vi.mock('../composables/useBreakpoint.js', async () => {
  const { computed } = await import('vue')
  return { usePointer: () => ({ coarse: computed(() => false) }) }
})

const translate = (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key)
vi.mock('vue-i18n', () => ({
  useI18n: () => ({ locale: ref('zh'), t: translate, te: () => false }),
}))

/** WebGL 模拟：'webgl2' | 'webgl1' | 'none' */
function mockWebGL(level) {
  return vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (name) {
    const ok = (level === 'webgl2' && name === 'webgl2') || (level === 'webgl1' && name === 'webgl')
    return ok ? { getExtension: () => ({ loseContext() {} }) } : null
  })
}

async function mountWithRouter(component, query) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] })
  await router.push({ path: '/', query })
  const wrapper = mount(component, { global: { plugins: [router], mocks: { $t: translate } }, attachTo: document.body })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  viewer.calls.length = 0
  viewer.retryResult = true
})
afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('Scene3DStatus', () => {
  it('loading：有进度时显示百分比与 aria-valuenow；无进度为不确定态', async () => {
    const wrapper = mount(Scene3DStatus, { props: { mode: 'loading', progress: 0.42, message: 'Loading tank' } })
    const bar = wrapper.find('[role="progressbar"]')
    expect(bar.attributes('aria-valuenow')).toBe('42')
    expect(wrapper.find('[data-testid="scene3d-percent"]').text()).toBe('42%')
    await wrapper.setProps({ progress: null })
    expect(bar.attributes('aria-valuenow')).toBeUndefined()
    expect(bar.classes()).toContain('is-indeterminate')
  })

  it('error：显示原因，重试 / 关闭发出事件', async () => {
    const wrapper = mount(Scene3DStatus, { props: { mode: 'error', message: 'boom', dismissible: true } })
    expect(wrapper.text()).toContain('boom')
    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
    await wrapper.find('[data-testid="scene3d-retry"]').trigger('click')
    await wrapper.find('[data-testid="scene3d-dismiss"]').trigger('click')
    expect(wrapper.emitted('retry')).toHaveLength(1)
    expect(wrapper.emitted('dismiss')).toHaveLength(1)
  })

  it('unsupported：按 WebGL 状态给出不同说明', () => {
    const old = mount(Scene3DStatus, { props: { mode: 'unsupported', webglStatus: 'webgl1-only' } })
    expect(old.text()).toContain('scene3d.webgl1_only')
    const none = mount(Scene3DStatus, { props: { mode: 'unsupported', webglStatus: 'unavailable' } })
    expect(none.text()).toContain('scene3d.webgl_unavailable')
  })
})

describe('AgentArmorView WebGL 预检与加载状态', () => {
  async function mountArmor() {
    const { default: AgentArmorView } = await import('./AgentArmorView.vue')
    return mountWithRouter(AgentArmorView, { view: 'agent-armor', tank: '5' })
  }

  it('不支持 WebGL2：不创建场景，显示说明', async () => {
    mockWebGL('webgl1')
    const wrapper = await mountArmor()
    expect(viewer.calls).toHaveLength(0)
    expect(wrapper.find('[data-testid="scene3d-unsupported"]').text()).toContain('scene3d.webgl1_only')
    expect(wrapper.find('#canvas-container').exists()).toBe(false)
  })

  it('支持时创建场景；onLoadState 驱动进度条、完成后隐藏', async () => {
    mockWebGL('webgl2')
    const wrapper = await mountArmor()
    expect(viewer.calls).toHaveLength(1)
    expect(wrapper.find('[data-testid="scene3d-loading"]').exists()).toBe(true)
    const { onLoadState } = viewer.calls[0].options
    onLoadState({ state: 'loading', progress: 0.5 })
    await nextTick()
    expect(wrapper.find('[role="progressbar"]').attributes('aria-valuenow')).toBe('50')
    onLoadState({ state: 'ready', progress: 1 })
    await nextTick()
    expect(wrapper.find('[data-testid="scene3d-loading"]').exists()).toBe(false)
    // 场景脚本的加载阶段名走 i18n
    expect(viewer.calls[0].options.labels.phase('armor model')).toBe('armor.phase_armor_model')
  })

  it('失败显示错误态；重试优先只重载目标坦克，名册未就绪时整体重建', async () => {
    mockWebGL('webgl2')
    const wrapper = await mountArmor()
    const first = viewer.calls[0]
    first.options.onLoadState({ state: 'error', message: 'armor model failed' })
    await nextTick()
    expect(wrapper.find('[data-testid="scene3d-error"]').text()).toContain('armor model failed')

    await wrapper.find('[data-testid="scene3d-retry"]').trigger('click')
    await flushPromises()
    expect(first.retry).toHaveBeenCalledTimes(1)
    expect(viewer.calls).toHaveLength(1)
    expect(wrapper.find('[data-testid="scene3d-loading"]').exists()).toBe(true)

    viewer.retryResult = false
    first.options.onLoadState({ state: 'error', message: 'list failed' })
    await nextTick()
    await wrapper.find('[data-testid="scene3d-retry"]').trigger('click')
    await flushPromises()
    expect(first.destroy).toHaveBeenCalledTimes(1)
    expect(viewer.calls).toHaveLength(2)
    expect(wrapper.find('#canvas-container').exists()).toBe(true)
  })

  it('卸载时销毁场景', async () => {
    mockWebGL('webgl2')
    const wrapper = await mountArmor()
    wrapper.unmount()
    expect(viewer.calls[0].destroy).toHaveBeenCalled()
  })

  it('手机参数开关：默认收起，点击展开 / 再点收起，aria-expanded 跟随', async () => {
    mockWebGL('webgl2')
    const wrapper = await mountArmor()
    const stage = wrapper.find('[data-testid="armor-stage"]')
    const tools = wrapper.find('[data-testid="armor-tools"]')
    expect(tools.exists()).toBe(true)
    // 默认收起：面板的显隐由 .is-tools-open 经移动端 CSS 控制（桌面端该按钮不可见、面板常驻）
    expect(stage.classes()).not.toContain('is-tools-open')
    expect(tools.attributes('aria-expanded')).toBe('false')
    await tools.trigger('click')
    expect(stage.classes()).toContain('is-tools-open')
    expect(tools.attributes('aria-expanded')).toBe('true')
    await tools.trigger('click')
    expect(stage.classes()).not.toContain('is-tools-open')
  })

  it('?clean=1：顶栏与参数开关一并让位（场景脚本会隐藏全部常驻面板）', async () => {
    mockWebGL('webgl2')
    window.history.replaceState({}, '', '/?view=agent-armor&tank=5&clean=1')
    try {
      const { default: AgentArmorView } = await import('./AgentArmorView.vue')
      const wrapper = await mountWithRouter(AgentArmorView, { view: 'agent-armor', tank: '5' })
      expect(wrapper.find('.armor-view').classes()).toContain('is-clean')
      expect(wrapper.find('[data-testid="armor-tools"]').exists()).toBe(false)
    } finally {
      window.history.replaceState({}, '', '/')
    }
  })
})

describe('回放工作台能力归属', () => {
  it('3D / 射击深链落到工作台能力，不再是独立页面', async () => {
    const { VIEW_COMPONENTS, replayInitialCapability } = await import('../app/viewRegistry.js')
    expect(VIEW_COMPONENTS['agent-replay']).toBe(VIEW_COMPONENTS.replay)
    expect(VIEW_COMPONENTS['agent-shots']).toBe(VIEW_COMPONENTS.replay)
    expect(replayInitialCapability('agent-replay')).toBe('3d')
    expect(replayInitialCapability('agent-shots')).toBe('shots')
    // 装甲查看器仍是独立页面（坦克百科侧）
    expect(VIEW_COMPONENTS['agent-armor']).not.toBe(VIEW_COMPONENTS.replay)
  })
})
