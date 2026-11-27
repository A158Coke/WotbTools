// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import ArmorShotHud from './ArmorShotHud.vue'
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
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key, args) => args ? `${key} ${args.current}/${args.total}` : key, te: () => false }) }))
import { installHarness } from '../test/AgentArmorViewTestHarness.js'
const { deferred, restoredMedia, scenes, setup, shots } = installHarness(mocks)
describe('Armor recorded-shot navigation', () => {
  it('距离快照只来自当前场景，滑杆不写路由，重建与错误态不保留旧读数', async () => {
    const { wrapper, router } = await setup({ query: { view: 'agent-armor', tank: '1' } })
    const hud = wrapper.getComponent(ArmorShotHud)
    const state = { distance: 300, min: 3, max: 500, readOnly: false }
    scenes[0].options.onDistanceChange(state)
    await flushPromises()
    expect(hud.props('distanceState')).toEqual(state)
    const query = { ...router.currentRoute.value.query }
    hud.vm.$emit('distance', 400)
    expect(scenes[0].setDistance).toHaveBeenCalledWith(400)
    expect(router.currentRoute.value.query).toEqual(query)
    scenes[0].options.onLoadState({ state: 'error' })
    await flushPromises()
    expect(hud.props('distanceState')).toBeNull()
    await router.replace({ query: { view: 'agent-armor', tank: '2' } })
    await flushPromises()
    scenes[0].options.onDistanceChange(state)
    await flushPromises()
    expect(wrapper.getComponent(ArmorShotHud).props('distanceState')).toBeNull()
    scenes[1].options.onDistanceChange({ ...state, distance: 15 })
    await flushPromises()
    expect(wrapper.getComponent(ArmorShotHud).props('distanceState').distance).toBe(15)
  })
  it('判定回传的本次弹道固定在点击值，相机中心变化不改写，重建与错误态清空', async () => {
    const { wrapper, router } = await setup({ query: { view: 'agent-armor', tank: '1' } })
    const state = { distance: 48, exactDistance: 48.4, factor: 1.4 }
    scenes[0].options.onJudgmentDistance(state)
    await flushPromises()
    expect(wrapper.getComponent(ArmorShotHud).props('shotState')).toEqual(state)
    scenes[0].options.onDistanceChange({ distance: 300, exactDistance: 300.4, min: 3, max: 500, readOnly: false })
    await flushPromises()
    expect(wrapper.getComponent(ArmorShotHud).props('shotState')).toEqual(state)
    scenes[0].options.onLoadState({ state: 'error' })
    await flushPromises()
    expect(wrapper.getComponent(ArmorShotHud).props('shotState')).toBeNull()
    await router.replace({ query: { view: 'agent-armor', tank: '2' } })
    await flushPromises()
    scenes[0].options.onJudgmentDistance(state)
    await flushPromises()
    expect(wrapper.getComponent(ArmorShotHud).props('shotState')).toBeNull()
    scenes[1].options.onJudgmentDistance({ ...state, distance: 15, exactDistance: 15.2 })
    await flushPromises()
    expect(wrapper.getComponent(ArmorShotHud).props('shotState').distance).toBe(15)
    scenes[1].options.onJudgmentDistance(null)
    await flushPromises()
    expect(wrapper.getComponent(ArmorShotHud).props('shotState')).toBeNull()
  })
  it('shows tank names and recorded facts, disposes the previous scene, and respects navigation bounds', async () => {
    const { wrapper, router } = await setup()
    const header = wrapper.get('[data-testid="armor-shot-header"]')
    for (const value of ['Object 907', 'E 100', '01:12', '350', 'AP']) expect(header.text()).toContain(value)
    expect(header.text()).not.toContain('Nickname')
    expect(wrapper.get('[aria-label="armor.previous_shot"]').attributes('disabled')).toBeDefined()
    await wrapper.get('[aria-label="armor.next_shot"]').trigger('click'); await flushPromises()
    expect(router.currentRoute.value.query.shot).toBe('9'); expect(scenes[0].destroy).toHaveBeenCalledOnce(); expect(scenes).toHaveLength(2)
    expect(header.text()).toContain('Maus'); expect(wrapper.get('[aria-label="armor.next_shot"]').attributes('disabled')).toBeDefined()
    scenes[0].options.onLoadState({ state: 'error', message: 'stale error' }); await flushPromises()
    expect(wrapper.text()).not.toContain('stale error')
  })
  it('射击时间减去开战原始时钟，与射击分析列表同口径（回归：02:06 vs 02:20）', async () => {
    mocks.fetch.mockResolvedValue({ shots, battleStartRaw: 14 })
    const { wrapper } = await setup()
    const header = wrapper.get('[data-testid="armor-shot-header"]')
    expect(header.text()).toContain('00:58')
    expect(header.text()).not.toContain('01:12')
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
    window.history.replaceState(null, '')
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
    expect(router.currentRoute.value.query.view).toBe('agent-armor')
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
    mocks.tank.mockResolvedValueOnce({ nation: 'germany' })
    mocks.modules.mockResolvedValueOnce({ tanks: {} })
    await vi.advanceTimersByTimeAsync(5000)
    await flushPromises()
    expect(router.currentRoute.value.query.eqpitch).toBeUndefined()
  })

  it('devices 重试成功后恢复 122 加成并保留 eqpitch 覆盖', async () => {
    vi.useFakeTimers()
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
    expect([scene.options.pitchDeviceBonus, ...scene.setPitchDeviceBonus.mock.calls.map(([v]) => v)])
      .toContainEqual({ up: 4, down: 3 })
    expect([scene.options.pitchDeviceAvailable, ...scene.setPitchDeviceAvailable.mock.calls.map(([v]) => v)])
      .toContain(true)
  })

  it('切到不支持 122 的车清覆盖时恢复 null（不写死 false），切回原目标 122 可再恢复', async () => {
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
    mocks.init.mock.calls.at(-1)[0].onTankSelection({ shooter: 1, target: 3 })
    await flushPromises()
    expect(router.currentRoute.value.query.eqpitch).toBeUndefined()
    const pitchCalls = scene.setEquipmentOverride.mock.calls.filter(([kind]) => kind === 'pitch')
    expect(pitchCalls.some(([, value]) => value === false)).toBe(false)
    expect(pitchCalls.at(-1)).toEqual(['pitch', null])
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
    mocks.init.mock.calls.at(-1)[0].onTankSelection({ shooter: 1, target: 3 })
    await flushPromises()
    const button = wrapper.get('[data-testid="hud-pitch-device"]')
    expect(button.attributes('aria-pressed')).toBe('false')
  })
})
