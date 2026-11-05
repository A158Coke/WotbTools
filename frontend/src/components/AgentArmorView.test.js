// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import AgentArmorView from './AgentArmorView.vue'
import ArmorShotHud from './ArmorShotHud.vue'
import ArmorSideConfig from './ArmorSideConfig.vue'
import { PLAYBACK_PHONE_QUERY } from '../composables/usePlaybackPhoneForm.ts'
import { PLAYBACK_PORTRAIT_QUERY } from '../composables/usePlaybackPortraitViewport.ts'
import { SHELL_CHROME_KEY } from '../shared/shellChrome.js'
import { createShellChrome } from '../app/shellChrome.js'
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
const translate = (key, args) => args ? `${key} ${args.current}/${args.total}` : key
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: translate, te: () => false }) }))
const shots = [
  { index: 6, time_s: 72, shooter_tank_name: 'Object 907', target_tank_name: 'E 100', shooter_name: 'Nickname', shooter_tank_id: 1, target_tank_id: 2, target_eid: 20, damage: 350, hit_flags: 0x10 },
  { index: 9, time_s: 95, shooter_tank_name: 'Object 907', target_tank_name: 'Maus', shooter_tank_id: 1, target_tank_id: 3, target_eid: 30, damage: 0, hit_flags: 0x8 },
]
const mounted = [], scenes = [], restoredMedia = []
function deferred() { let resolve, reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej }); return { promise, resolve, reject } }
async function setup({ query = { view: 'agent-armor', shot: '6' }, shellChrome = null, phone = false, portrait = false } = {}) {
  // 组件的手机形态 / 朝向判据直接读 window.matchMedia（shared/breakpoints 的查询字符串）；
  // happy-dom 无法逐条命中，测试里按字符串恒等桩掉，并在 afterEach 卸载后还原。
  // 竖屏用例还须让 window.innerWidth 与桩一致（usePlaybackPortraitViewport 有第二道
  // innerWidth < 768 守卫，防「查询被桩成一律命中」），happy-dom 默认视口是 1024 宽。
  const original = window.matchMedia
  window.matchMedia = (query) => ({
    matches: (phone && query === PLAYBACK_PHONE_QUERY) || (portrait && query === PLAYBACK_PORTRAIT_QUERY),
    addEventListener: () => {},
    removeEventListener: () => {},
  })
  restoredMedia.push(() => { window.matchMedia = original })
  if (portrait) {
    const width = Object.getOwnPropertyDescriptor(window, 'innerWidth')
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
    restoredMedia.push(() => { if (width) Object.defineProperty(window, 'innerWidth', width); else delete window.innerWidth })
  }
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] })
  await router.push({ query })
  const wrapper = mount(AgentArmorView, {
    global: {
      plugins: [router],
      mocks: { $t: translate },
      ...(shellChrome ? { provide: { [SHELL_CHROME_KEY]: shellChrome } } : {}),
      stubs: { Scene3DStatus: { name: 'Scene3DStatus', props: ['mode', 'message'], template: '<div data-testid="status" :data-mode="mode">{{ message }}</div>' } },
    },
  })
  mounted.push(wrapper); await flushPromises(); return { wrapper, router }
}
beforeEach(() => {
  mocks.init.mockReset(); mocks.fetch.mockReset(); mocks.query.mockReset(); scenes.length = 0
  mocks.tank.mockReset().mockResolvedValue({ nation: 'germany' })
  mocks.devices.mockReset().mockResolvedValue({ devicePresets: { defaultPreset: [] } })
  mocks.modules.mockReset().mockResolvedValue({ tanks: {} })
  mocks.fetch.mockResolvedValue({ shots })
  mocks.query.mockImplementation(async shot => ({ view: 'agent-armor', shot: String(shot.index), tank: String(shot.target_tank_id) }))
  mocks.init.mockImplementation(options => { const scene = { destroy: vi.fn(), options, setPitchDeviceBonus: vi.fn(), setPitchDeviceAvailable: vi.fn(), setEquipmentOverride: vi.fn() }; scenes.push(scene); options.onLoadState({ state: 'ready' }); return scene })
})
afterEach(() => {
  mounted.forEach(w => w.unmount()); mounted.length = 0
  restoredMedia.forEach(restore => restore()); restoredMedia.length = 0
  mocks.coarse.value = false
  vi.useRealTimers()
  vi.clearAllMocks()
})
describe('Armor recorded-shot navigation', () => {
  it('shows tank names and recorded facts, disposes the previous scene, and respects navigation bounds', async () => {
    const { wrapper, router } = await setup()
    const header = wrapper.get('[data-testid="armor-shot-header"]')
    for (const value of ['Object 907', 'E 100', '01:12', '350']) expect(header.text()).toContain(value)
    expect(header.text()).not.toContain('Nickname')
    expect(wrapper.get('[aria-label="armor.previous_shot"]').attributes('disabled')).toBeDefined()
    await wrapper.get('[aria-label="armor.next_shot"]').trigger('click'); await flushPromises()
    expect(router.currentRoute.value.query.shot).toBe('9'); expect(scenes[0].destroy).toHaveBeenCalledOnce(); expect(scenes).toHaveLength(2)
    expect(header.text()).toContain('Maus'); expect(wrapper.get('[aria-label="armor.next_shot"]').attributes('disabled')).toBeDefined()
    scenes[0].options.onLoadState({ state: 'error', message: 'stale error' }); await flushPromises()
    expect(wrapper.text()).not.toContain('stale error')
  })
  it('reports failed navigation without destroying the current scene', async () => {
    const { wrapper, router } = await setup(); mocks.query.mockRejectedValueOnce(new Error('unavailable'))
    await wrapper.get('[aria-label="armor.next_shot"]').trigger('click'); await flushPromises()
    expect(router.currentRoute.value.query.shot).toBe('6'); expect(scenes[0].destroy).not.toHaveBeenCalled()
    expect(wrapper.get('[role="alert"]').text()).toBe('armor.navigation_failed')
    expect(wrapper.get('[aria-label="armor.next_shot"]').attributes('disabled')).toBeUndefined()
  })
  it('ignores stale snapshot completions after rapid same-view navigation', async () => {
    const { wrapper, router } = await setup(); const stale = deferred(); mocks.fetch.mockReturnValueOnce(stale.promise)
    await router.replace({ query: { view: 'agent-armor', shot: '8' } }); await flushPromises()
    await router.replace({ query: { view: 'agent-armor', shot: '9' } }); await flushPromises()
    const latest = scenes.at(-1)
    stale.resolve({ shots: [{ index: 9, shooter_tank_name: 'WRONG', target_eid: 2 }] }); await flushPromises()
    expect(wrapper.text()).toContain('Maus'); expect(wrapper.text()).not.toContain('WRONG'); expect(scenes.at(-1)).toBe(latest)
  })
  it('recreates the scene on retry and ignores the failed scene’s later callbacks', async () => {
    const { wrapper } = await setup()
    scenes[0].options.onLoadState({ state: 'error', message: 'assets unavailable' })
    await flushPromises()
    wrapper.findComponent({ name: 'Scene3DStatus' }).vm.$emit('retry')
    await flushPromises()
    expect(scenes).toHaveLength(2)
    expect(scenes[0].destroy).toHaveBeenCalledOnce()
    scenes[0].options.onLoadState({ state: 'error', message: 'stale failure' })
    await flushPromises()
    expect(wrapper.text()).not.toContain('stale failure')
  })
  it('does not recreate the scene when leaving during a retry', async () => {
    const { wrapper } = await setup()
    scenes[0].options.onLoadState({ state: 'error', message: 'assets unavailable' })
    await flushPromises()
    wrapper.findComponent({ name: 'Scene3DStatus' }).vm.$emit('retry')
    wrapper.unmount()
    await flushPromises()
    expect(scenes).toHaveLength(1)
    expect(scenes[0].destroy).toHaveBeenCalledOnce()
  })
  it('ignores shell resolution after unmount', async () => {
    const { wrapper, router } = await setup(); const replace = vi.spyOn(router, 'replace'); const query = deferred(); mocks.query.mockReturnValueOnce(query.promise)
    await wrapper.get('[aria-label="armor.next_shot"]').trigger('click'); wrapper.unmount()
    query.resolve({ view: 'agent-armor', shot: '9' }); await flushPromises()
    expect(replace).not.toHaveBeenCalled(); expect(scenes[0].destroy).toHaveBeenCalledOnce()
  })
  it('opens and closes the initially hidden setup panel', async () => {
    const { wrapper } = await setup(); const tools = wrapper.get('[data-testid="armor-tools"]')
    expect(tools.attributes('aria-expanded')).toBe('false'); await tools.trigger('click'); expect(tools.attributes('aria-expanded')).toBe('true')
    await tools.trigger('click'); expect(tools.attributes('aria-expanded')).toBe('false')
  })
})
describe('Armor exit entry (deep link without history)', () => {
  it('keeps an exit on phone-landscape deep link: immersive on, back goes to tankopedia', async () => {
    window.history.replaceState(null, '') // 深链形态：无 history.state.back
    restoredMedia.push(() => window.history.replaceState(null, ''))
    const chrome = createShellChrome()
    mocks.coarse.value = true
    const { wrapper, router } = await setup({ query: { view: 'agent-armor', tank: '1' }, shellChrome: chrome, phone: true })
    expect(chrome.immersive.value).toBe(true)
    await wrapper.get('[data-testid="armor-back"]').trigger('click'); await flushPromises()
    expect(router.currentRoute.value.query.view).toBe('agent-tankopedia')
  })
  it('still uses browser history when history.state.back exists', async () => {
    window.history.replaceState({ back: '/?view=agent-tankopedia' }, '')
    restoredMedia.push(() => window.history.replaceState(null, ''))
    mocks.coarse.value = true
    const { wrapper, router } = await setup({ query: { view: 'agent-armor', tank: '1' }, phone: true })
    const backSpy = vi.spyOn(router, 'back')
    await wrapper.get('[data-testid="armor-back"]').trigger('click')
    expect(backSpy).toHaveBeenCalledOnce()
    await flushPromises()
    expect(router.currentRoute.value.query.view).toBe('agent-armor') // 未走 replace 兜底
  })
})
describe('Armor immersive shell chrome', () => {
  it('requests immersion on touch phone landscape and releases on unmount', async () => {
    const chrome = createShellChrome()
    mocks.coarse.value = true
    const { wrapper } = await setup({ shellChrome: chrome, phone: true })
    expect(chrome.immersive.value).toBe(true)
    wrapper.unmount()
    expect(chrome.immersive.value).toBe(false)
  })
  it('keeps the shell chrome on portrait phones', async () => {
    const chrome = createShellChrome()
    mocks.coarse.value = true
    const { wrapper } = await setup({ shellChrome: chrome, phone: true, portrait: true })
    expect(chrome.immersive.value).toBe(false)
    wrapper.unmount()
    expect(chrome.immersive.value).toBe(false)
  })
  it('does not request immersion for fine pointers or without a provider', async () => {
    const chrome = createShellChrome()
    const { wrapper } = await setup({ shellChrome: chrome, phone: true })
    expect(chrome.immersive.value).toBe(false)
    // coarse 是非响应式桩：无 provider 的挂载要在 mount 前置位，随后立刻还原
    mocks.coarse.value = true
    const { wrapper: bare } = await setup({ phone: true })
    mocks.coarse.value = false
    await flushPromises()
    expect(() => bare.unmount()).not.toThrow()
    expect(chrome.immersive.value).toBe(false)
    wrapper.unmount()
  })
})

describe('122 可用性容错（网络失败 ≠ 不支持）', () => {
  it('目录请求失败保留 eqpitch 覆盖，重试成功确认无槽位后才清理', async () => {
    vi.useFakeTimers()
    mocks.tank.mockRejectedValueOnce(new Error('offline'))
    const { router } = await setup({ query: { view: 'agent-armor', tank: '2', eqpitch: '1' } })
    await flushPromises()
    expect(router.currentRoute.value.query.eqpitch).toBe('1', '瞬时失败不得删除共享链接覆盖')
    // 重试成功：目标车预设不含 122 → 这是「确认不支持」，此时才允许清理 URL
    mocks.tank.mockResolvedValueOnce({ nation: 'germany' })
    mocks.modules.mockResolvedValueOnce({ tanks: {} })
    await vi.advanceTimersByTimeAsync(5000)
    await flushPromises()
    expect(router.currentRoute.value.query.eqpitch).toBeUndefined()
  })

  it('devices 重试成功后恢复 122 加成并保留 eqpitch 覆盖', async () => {
    vi.useFakeTimers()
    // 目录的所有并发读者都先失败；重试前再整体切换为成功目录，避免首个调用被其他
    // 组件（HUD/侧栏）抢走导致可用性路径根本没经历失败。
    mocks.devices.mockRejectedValue(new Error('offline'))
    mocks.modules.mockResolvedValue({
      tanks: { 'Type71_stem': { tankId: 2, optDevicePreset: 'AlternatePitchGrouserPreset' } },
    })
    const { router } = await setup({ query: { view: 'agent-armor', tank: '2', eqpitch: '1' } })
    mocks.devices.mockResolvedValue({
      devices: [{ id: 122, script: { params: { bonusValues: { upperPitchLimitIncrease: 4, lowerPitchLimitIncrease: 3 } } } }],
      devicePresets: { AlternatePitchGrouserPreset: [{ left: 'improvedPitchLimitsSystem' }] },
    })
    await vi.advanceTimersByTimeAsync(5000)
    await flushPromises()
    expect(router.currentRoute.value.query.eqpitch).toBe('1', '重试成功且该车支持 122，覆盖必须保留')
    expect(scenes.at(-1).setPitchDeviceAvailable).toHaveBeenCalledWith(true)
    expect(scenes.at(-1).setPitchDeviceBonus).toHaveBeenCalledWith({ up: 4, down: 3 })
  })

  it('unmount 后迟到的目录失败不再挂重试', async () => {
    vi.useFakeTimers()
    const pending = deferred()
    // 所有目录读者共用该挂起 promise：无论挂载期谁先调用，可用性请求都必然在飞行中。
    mocks.devices.mockImplementation(() => pending.promise)
    const { wrapper } = await setup({ query: { view: 'agent-armor', tank: '2', eqpitch: '1' } })
    wrapper.unmount()
    const callsAfterUnmount = mocks.devices.mock.calls.length
    pending.reject(new Error('late offline'))
    await flushPromises()
    await vi.advanceTimersByTimeAsync(5000)
    await flushPromises()
    expect(mocks.devices).toHaveBeenCalledTimes(callsAfterUnmount)
  })
})

describe('122 回放真值的目标身份', () => {
  const pitchCatalog = {
    devices: [{ id: 122, script: { params: { bonusValues: { upperPitchLimitIncrease: 4, lowerPitchLimitIncrease: 3 } } } }],
    devicePresets: { AlternatePitchGrouserPreset: [{ left: 'improvedPitchLimitsSystem' }] },
  }

  it('回放已确认 122 时，模块目录失败不阻断 4/3 加成', async () => {
    mocks.fetch.mockResolvedValue({
      shots: [{ ...shots[0], target_equipment: { improved_pitch_limits: true } }],
    })
    mocks.devices.mockResolvedValue(pitchCatalog)
    mocks.modules.mockRejectedValue(new Error('modules offline'))
    await setup({ query: { view: 'agent-armor', shot: '6', tank: '2' } })
    await flushPromises()
    const scene = scenes.at(-1)
    // bonus 可能在 viewer 创建前就绪（走构造参数），也可能之后才恢复（走 setter）。
    expect([scene.options.pitchDeviceBonus, ...scene.setPitchDeviceBonus.mock.calls.map(([v]) => v)])
      .toContainEqual({ up: 4, down: 3 })
    expect([scene.options.pitchDeviceAvailable, ...scene.setPitchDeviceAvailable.mock.calls.map(([v]) => v)])
      .toContain(true)
  })

  it('切到不支持 122 的车清覆盖时恢复 null（不写死 false），切回原目标 122 可再恢复', async () => {
    // review P2：清理时若写 setEquipmentOverride('pitch', false)，effectivePitchDevice
    // 的 `override != null 即采用` 会永久压住 after-switch-back 的 recorded truth。
    mocks.fetch.mockResolvedValue({
      shots: [{ ...shots[0], target_equipment: { improved_pitch_limits: true } }],
    })
    mocks.tank.mockResolvedValue({
      nation: 'germany',
      shells: [{ type: 'ap', damage: 400, penetration: 200 }],
    })
    mocks.devices.mockResolvedValue(pitchCatalog)
    mocks.modules.mockResolvedValue({
      tanks: {
        'Type71_stem': { tankId: 2, optDevicePreset: 'AlternatePitchGrouserPreset' },
        'Plain_stem': { tankId: 3, optDevicePreset: 'defaultPreset' },
      },
    })
    const { router } = await setup({ query: { view: 'agent-armor', shot: '6', tank: '2', eqpitch: '1' } })
    await flushPromises()
    const scene = scenes.at(-1)
    // 切到不支持 122 的目标：URL 覆盖被清，场景覆盖必须回 null（不是 false）
    mocks.init.mock.calls.at(-1)[0].onTankSelection({ shooter: 1, target: 3 })
    await flushPromises()
    expect(router.currentRoute.value.query.eqpitch).toBeUndefined()
    const pitchCalls = scene.setEquipmentOverride.mock.calls.filter(([kind]) => kind === 'pitch')
    expect(pitchCalls.some(([, value]) => value === false)).toBe(false)
    expect(pitchCalls.at(-1)).toEqual(['pitch', null])
    // 切回原目标：可用性随真值恢复（覆盖已撤销，不再被 stale false 压住）
    mocks.init.mock.calls.at(-1)[0].onTankSelection({ shooter: 1, target: 2 })
    await flushPromises()
    expect(scene.setPitchDeviceAvailable.mock.calls.at(-1)[0]).toBe(true)
  })

  it('切到另一辆支持 122 但无装备记录的车不继承原目标真值', async () => {
    mocks.fetch.mockResolvedValue({
      shots: [{ ...shots[0], target_equipment: { improved_pitch_limits: true } }],
    })
    mocks.tank.mockResolvedValue({
      nation: 'germany',
      shells: [{ type: 'ap', damage: 400, penetration: 200 }],
    })
    mocks.devices.mockResolvedValue(pitchCatalog)
    mocks.modules.mockResolvedValue({
      tanks: { 'Type71_stem': { tankId: 3, optDevicePreset: 'AlternatePitchGrouserPreset' } },
    })
    const { wrapper } = await setup({ query: { view: 'agent-armor', shot: '6', tank: '2' } })
    await flushPromises()
    expect(wrapper.get('[data-testid="hud-pitch-device"]').attributes('aria-pressed')).toBe('true')
    // 选车器换目标：回放仍是原目标的射击记录，但当前目标已变成另一辆车。
    mocks.init.mock.calls.at(-1)[0].onTankSelection({ shooter: 1, target: 3 })
    await flushPromises()
    const button = wrapper.get('[data-testid="hud-pitch-device"]')
    expect(button.attributes('aria-pressed')).toBe('false')
  })
})

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
