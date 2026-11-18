// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import ArmorShotHud from './ArmorShotHud.vue'
import ArmorSideConfig from './ArmorSideConfig.vue'
const mocks = vi.hoisted(() => ({
  init: vi.fn(), fetch: vi.fn(), query: vi.fn(), coarse: { value: false },
  tank: vi.fn(), devices: vi.fn(), modules: vi.fn(),
}))
vi.mock('../scene/tankViewer.js', () => ({ initTankViewer: mocks.init }))
vi.mock('../scene/agentData.js', () => ({
  fetchReplayShots: mocks.fetch,
  shotViewerQuery: mocks.query,
  fetchTankData: mocks.tank,
}))
vi.mock('../utils/researchCatalog.js', async (importOriginal) => ({
  ...(await importOriginal()),
  loadDevices: mocks.devices,
  loadTankModules: mocks.modules,
}))
vi.mock('../scene/webglSupport.js', async (original) => ({ ...(await original()), detectWebGL: () => ({ supported: true }) }))
vi.mock('../composables/useBreakpoint.js', () => ({ usePointer: () => ({ coarse: mocks.coarse }) }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key, args) => args ? `${key} ${args.current}/${args.total}` : key, te: () => false }) }))
import { installHarness } from '../test/AgentArmorViewTestHarness.js'
const { deferred, restoredMedia, scenes, setup, shots } = installHarness(mocks)
describe('Shooter/Target 主炮配置解耦（射击方决定炮弹，受击方决定装甲）', () => {
  async function openTools(wrapper) {
    await wrapper.get('[data-testid="armor-tools"]').trigger('click')
    await flushPromises()
  }

  it('同车型普通检视：缺省 scfg 时射击方 HUD 不跟随受击方 config', async () => {
    // shooter 未指定 → 默认与 target 同车（tank=1），受击方 config=0；
    // 射击方配置必须解析为 null（自身默认顶级配置），不得回落到 &config=
    const { wrapper } = await setup({ query: { view: 'agent-armor', tank: '1', config: '0' } })
    expect(wrapper.getComponent(ArmorShotHud).props('scfg')).toBeNull()
  })

  it('显式 scfg 时射击方 HUD 使用 scfg，不受受击方 config 影响', async () => {
    const { wrapper } = await setup({ query: { view: 'agent-armor', tank: '1', shooter: '1', config: '0', scfg: '2' } })
    expect(wrapper.getComponent(ArmorShotHud).props('scfg')).toBe('2')
  })

  it('受击方换主炮（换发动机/履带也一样）保留射击方 shell 下标', async () => {
    const { wrapper, router } = await setup({ query: { view: 'agent-armor', tank: '1', shell: '2' } })
    await openTools(wrapper)
    const targetEditor = wrapper.findAllComponents(ArmorSideConfig).at(1)
    targetEditor.vm.$emit('apply', { configChanged: true, config: 1, engine: null, track: null, dev: null })
    await flushPromises()
    expect(router.currentRoute.value.query.config).toBe('1')
    expect(router.currentRoute.value.query.shell).toBe('2')
  })

  it('受击方只换发动机/履带不写 scfg、不清 shell', async () => {
    const { wrapper, router } = await setup({ query: { view: 'agent-armor', tank: '1', shell: '2' } })
    await openTools(wrapper)
    const targetEditor = wrapper.findAllComponents(ArmorSideConfig).at(1)
    targetEditor.vm.$emit('apply', { configChanged: false, engine: 5, track: null, dev: null })
    await flushPromises()
    expect(router.currentRoute.value.query.engine).toBe('5')
    expect(router.currentRoute.value.query.scfg).toBeUndefined()
    expect(router.currentRoute.value.query.shell).toBe('2')
  })

  it('射击方换主炮写 scfg 并清除旧 shell 下标；换发动机不清 shell', async () => {
    const { wrapper, router } = await setup({ query: { view: 'agent-armor', tank: '1', shell: '2' } })
    await openTools(wrapper)
    const shooterEditor = wrapper.findAllComponents(ArmorSideConfig).at(0)
    shooterEditor.vm.$emit('apply', { configChanged: true, config: 1, engine: null, track: null, dev: null })
    await flushPromises()
    expect(router.currentRoute.value.query.scfg).toBe('1')
    expect(router.currentRoute.value.query.shell).toBeUndefined()
    shooterEditor.vm.$emit('apply', { configChanged: false, engine: 7, track: null, dev: null })
    await flushPromises()
    expect(router.currentRoute.value.query.sengine).toBe('7')
    expect(router.currentRoute.value.query.scfg).toBe('1')
  })
})

describe('XI armor upgrade handoff', () => {
  async function editors(wrapper) {
    await wrapper.get('[data-testid="armor-tools"]').trigger('click')
    await flushPromises()
    return wrapper.findAllComponents(ArmorSideConfig)
  }

  it('shot replay defaults both sides to stock and only explicit what-if upgrades', async () => {
    const { wrapper } = await setup({ query: { view: 'agent-armor', shot: '6', tank: '15153', shooter: '30497' } })
    const [shooter, target] = await editors(wrapper)
    expect(target.props('upgrade')).toBe('stock')
    expect(shooter.props('upgrade')).toBe('stock')
    expect(wrapper.getComponent(ArmorShotHud).props('upgrade')).toBe('stock')
  })

  it('keeps shooter default independent when only the same target has an explicit upgrade', async () => {
    const { wrapper } = await setup({ query: { view: 'agent-armor', tank: '15153', upgrade: 'top', abilities: '101,201' } })
    const [shooter, target] = await editors(wrapper)
    expect(target.props('upgrade')).toBe('top')
    expect(target.props('abilities')).toBe('101,201')
    expect(shooter.props('upgrade')).toBeNull()
    expect(wrapper.getComponent(ArmorShotHud).props('upgrade')).toBeNull()
  })

  it('rebuilds on target upgrade and keeps shooter ammunition and upgrade independent', async () => {
    const { wrapper, router } = await setup({ query: {
      view: 'agent-armor', tank: '15153', shooter: '30497', shell: '2', supgrade: 'top', sabilities: '401',
    } })
    const [, target] = await editors(wrapper)
    target.vm.$emit('apply', { config: 0, configChanged: false, upgrade: 'top', abilities: [101, 201] })
    await flushPromises()
    expect(router.currentRoute.value.query).toMatchObject({ upgrade: 'top', abilities: '101,201', supgrade: 'top', sabilities: '401', shell: '2' })
    expect(scenes).toHaveLength(2)
    expect(scenes[0].destroy).toHaveBeenCalledOnce()
    expect(wrapper.getComponent(ArmorShotHud).props('abilities')).toBe('401')
    expect(wrapper.get('[data-testid="armor-tools"]').attributes('aria-expanded')).toBe('true')
    // Removing the explicit mode restores the XI top default; explicit stock remains available.
    await router.replace({ query: { view: 'agent-armor', tank: '15153', shooter: '30497' } })
    await flushPromises()
    expect(scenes).toHaveLength(3)
    expect(wrapper.findAllComponents(ArmorSideConfig).at(1).props('upgrade')).toBeNull()
    await router.replace({ query: { view: 'agent-armor', tank: '15153', shooter: '30497', upgrade: 'stock' } })
    await flushPromises()
    expect(scenes).toHaveLength(4)
    expect(wrapper.findAllComponents(ArmorSideConfig).at(1).props('upgrade')).toBe('stock')
    expect(wrapper.findAllComponents(ArmorSideConfig).at(0).props('upgrade')).toBeNull()
  })

  it('pins the currently selected tanks before an upgrade rebuild', async () => {
    const { wrapper, router } = await setup({ query: { view: 'agent-armor', tank: '1', shooter: '2' } })
    scenes[0].options.onTankSelection({ target: 15153, shooter: 30497 })
    const [shooter] = await editors(wrapper)
    shooter.vm.$emit('apply', { configChanged: false, upgrade: 'top', abilities: [401] })
    await flushPromises()
    expect(router.currentRoute.value.query).toMatchObject({ tank: '15153', shooter: '30497', supgrade: 'top', sabilities: '401' })
    expect(router.currentRoute.value.query.upgrade).toBeUndefined()
    expect(scenes).toHaveLength(2)
  })

  it('rebuilds for an external ability-only change without sharing the target choices with the shooter', async () => {
    const initial = { view: 'agent-armor', tank: '15153', upgrade: 'top', abilities: '101', supgrade: 'top', sabilities: '401' }
    const { wrapper, router } = await setup({ query: initial })
    await router.replace({ query: { ...initial, abilities: '102' } })
    await flushPromises()
    expect(scenes).toHaveLength(2)
    expect(scenes[0].destroy).toHaveBeenCalledOnce()
    const [shooter, target] = await editors(wrapper)
    expect(target.props('abilities')).toBe('102')
    expect(shooter.props('abilities')).toBe('401')
    expect(wrapper.getComponent(ArmorShotHud).props('abilities')).toBe('401')
  })
})

describe('armor camera actions', () => {
  it('offers front and hull-down in static inspection without changing the URL or recreating the scene', async () => {
    const { wrapper, router } = await setup({ query: { view: 'agent-armor', tank: '15153' } })
    const scene = scenes[0]
    scene.setCameraPreset = vi.fn()
    await wrapper.get('[data-testid="armor-camera-front"]').trigger('click')
    await wrapper.get('[data-testid="armor-camera-hull-down"]').trigger('click')
    // preserveView：预设只换观察方向，不接管用户的旋转中心/距离。
    expect(scene.setCameraPreset.mock.calls).toEqual([
      ['front', { preserveView: true }],
      ['hull_down', { preserveView: true }],
    ])
    expect(router.currentRoute.value.query).toEqual({ view: 'agent-armor', tank: '15153' })
    expect(scenes).toHaveLength(1)
    scene.options.onLoadState({ state: 'loading' })
    await flushPromises()
    expect(wrapper.get('[data-testid="armor-camera-front"]').attributes('disabled')).toBeDefined()
  })

  it('does not offer static camera actions over recorded shots', async () => {
    const { wrapper } = await setup()
    expect(wrapper.find('[data-testid="armor-camera-front"]').exists()).toBe(false)
  })
})
