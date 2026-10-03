// @vitest-environment happy-dom
// 3D 视图的 WebGL 预检与加载状态（审计 3D-23）：AgentArmorView / AgentReplay3D / Scene3DStatus。
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

const playback = vi.hoisted(() => ({ api: null, init: null }))
vi.mock('../scene/playbackScene.js', () => {
  playback.init = vi.fn((container, store) => {
    playback.api = {
      store,
      loadData: vi.fn(async () => {}),
      destroy: vi.fn(),
      setQuality: vi.fn(),
    }
    return playback.api
  })
  return { initPlayback: playback.init, QUALITY_PRESETS: { low: { label: 'Low' } } }
})
vi.mock('../scene/assetProvider.js', () => ({ assetProvider: { configured: () => true } }))
vi.mock('../scene/replaySource.js', () => ({ loadPlaybackData: vi.fn() }))

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
  playback.api = null
  playback.init?.mockClear()
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

describe('AgentReplay3D WebGL 预检与加载状态', () => {
  async function mountReplay() {
    const { default: AgentReplay3D } = await import('./AgentReplay3D.vue')
    return mountWithRouter(AgentReplay3D, { view: 'agent-replay' })
  }

  it('不支持 WebGL：不初始化场景，显示说明', async () => {
    mockWebGL('none')
    const wrapper = await mountReplay()
    expect(playback.init).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="scene3d-unsupported"]').text()).toContain('scene3d.webgl_unavailable')
  })

  it('解析中为不确定进度，资产阶段显示资产进度；失败后可重试同一文件或关闭', async () => {
    mockWebGL('webgl2')
    const wrapper = await mountReplay()
    expect(playback.init).toHaveBeenCalledTimes(1)
    const { store } = playback.api

    let finish
    playback.api.loadData.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const input = wrapper.find('input[type="file"]')
    const file = new File(['x'], 'battle.wotbreplay')
    Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
    await input.trigger('change')
    await nextTick()
    expect(wrapper.find('[data-testid="scene3d-loading"]').text()).toContain('agentReplay.parsing')
    expect(wrapper.find('[role="progressbar"]').attributes('aria-valuenow')).toBeUndefined()

    store.assetStage = true
    store.assetProgress = 0.3
    await nextTick()
    expect(wrapper.find('[data-testid="scene3d-loading"]').text()).toContain('agentReplay.loading_assets')
    expect(wrapper.find('[role="progressbar"]').attributes('aria-valuenow')).toBe('30')

    store.err = 'bad replay'
    store.assetStage = false
    finish()
    await flushPromises()
    expect(wrapper.find('[data-testid="scene3d-error"]').text()).toContain('agentReplay.error_load')
    await wrapper.find('[data-testid="scene3d-retry"]').trigger('click')
    await flushPromises()
    expect(playback.api.loadData).toHaveBeenLastCalledWith({ kind: 'local', file })

    store.err = 'still bad'
    await nextTick()
    await wrapper.find('[data-testid="scene3d-dismiss"]').trigger('click')
    expect(store.err).toBe('')
    expect(wrapper.find('[data-testid="scene3d-error"]').exists()).toBe(false)
  })
})
