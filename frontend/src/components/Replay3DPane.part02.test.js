// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import {
  installPaneTestLifecycle, mountPane, mockWebGL, mkFile, flush, start, openDetailsViaScene,
  paneComponent, translate, here, testState, fullscreenCalls,
  nextTick, ref, shallowReactive, mount, readFileSync, fileURLToPath, dirname, resolve,
  makeBattlePlaybackDataset, zh, en, ru,
} from './Replay3DPane.test.harness.js'
import { PLAYBACK_ROLES } from '../data/mapTeamColors.js'

const { canonical, playback, layout, connectivityState } = testState

installPaneTestLifecycle()

describe('Replay3DPane', () => {
  it('实时帧率角标：平均/峰值帧时驱动文本，顿挫时变警示色，空闲显示占位', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    await start(wrapper)
    const { store } = playback.api
    store.fps = 59.8
    store.frameMs = 16.7
    store.framePeakMs = 16.9
    await flush()
    const badge = wrapper.get('[data-testid="replay3d-fps"]')
    expect(badge.text()).toBe('59.8 FPS · 16.7/16.9 ms')
    expect(badge.classes()).not.toContain('pb-fps-low')
    store.framePeakMs = 52
    await flush()
    expect(wrapper.get('[data-testid="replay3d-fps"]').classes()).toContain('pb-fps-low')
    expect(wrapper.get('[data-testid="replay3d-fps"]').text()).toBe('59.8 FPS · 16.7/52.0 ms')
    store.fps = 0
    store.frameMs = 0
    store.framePeakMs = 0
    await flush()
    expect(wrapper.get('[data-testid="replay3d-fps"]').text()).toBe('— FPS')
    wrapper.unmount()
  })

  it('核心资产降级显示非阻塞状态，不把加载完成伪装成健康', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    await start(wrapper)
    const { store } = playback.api
    expect(store.hasData).toBe(true)
    expect(wrapper.find('[data-testid="scene3d-asset-degraded"]').exists()).toBe(false)
    store.assetDegraded = true
    await flush()
    expect(wrapper.get('[data-testid="scene3d-asset-degraded"]').text()).toContain('agentReplay.asset_degraded')
    store.assetDegraded = false
    await flush()
    expect(wrapper.find('[data-testid="scene3d-asset-degraded"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('资产降级提示三语均落在 agentReplay 命名空间且真实 i18n 可翻译', async () => {
    const { createI18n } = await vi.importActual('vue-i18n')
    for (const [lang, messages] of Object.entries({ zh, en, ru })) {
      expect(messages.agentTanks.asset_degraded).toBeUndefined()
      const i18n = createI18n({ legacy: false, locale: lang, fallbackLocale: 'en', messages: { [lang]: messages } })
      const text = i18n.global.t('agentReplay.asset_degraded')
      expect(text).not.toBe('agentReplay.asset_degraded')
      expect(text.length).toBeGreaterThan(10)
    }
  })

  it('3D完整详情按canonical账号与时间投影，包含肖像装备物资道具且seek不泄露未来', async () => {
    mockWebGL('webgl2')
    const dataset = makeBattlePlaybackDataset()
    const track = dataset.vehicles[0]
    track.positionSegments = [{ knowledge: 'OBSERVED', interpolationAllowed: true, startSec: 0, endSec: 5,
      samples: [{ timeSec: 0, x: 0, y: 0 }, { timeSec: 5, x: 5, y: 0 }] }]
    track.healthTransitions.push({ timeSec: 10, currentHp: 1400, displayCapacityHp: 1500, knowledge: 'CURRENT' })
    track.damageLosses = [{ fromSec: 9, toSec: 10, hpLoss: 100, attackerAccountId: 2001, attackerReliable: true }]
    track.damageDealtSamples = [{ timeSec: 10, total: 900 }, { timeSec: 30, total: 2000 }]
    track.loadout = { consumables: ['repairkit', null, null], provisions: ['food', null, null], equipmentIds: ['rammer'], consumableWireCodes: [] }
    track.consumableTransitions = [{ timeSec: 8, consumableSlot: 0, state: 'COOLDOWN', logicalItemId: 'repairkit' }]
    dataset.events.push({ type: 'KILL', timeSec: 12, accountId: 1001, targetAccountId: 2001 })
    canonical.load.mockResolvedValue({ dataset, clock: { startRaw: 42 }, reloadTelemetry: null })
    canonical.portrait.mockResolvedValue('/portrait.png')
    const wrapper = mountPane()
    await start(wrapper)
    const store = playback.api.store
    store.time = 54
    store.startTime = 0
    store.roster = { team1: [{ eid: 7, accountId: 1001, tankId: 1, team: 1, nick: 'Scene name', tank: 'Scene tank', hp: 999, maxHp: 999 }], team2: [], unknown: [] }
    await flush()
    await openDetailsViaScene(7)
    const details = wrapper.getComponent({ name: 'VehicleDetailsPanel' })
    expect(details.props('selectedTrack').accountId).toBe(1001)
    expect(details.props('currentTime')).toBe(12)
    await vi.waitFor(() => expect(details.props('selectedPortraitUrl')).toBe('/portrait.png'))
    expect(details.props('selLastKnownSec')).toBe(5)
    expect(details.props('health')).toEqual({ currentHp: 1400, maxHp: 1500 })
    expect(details.props('selCurStats')).toEqual({ dealt: 900, received: 100, kills: 1 })
    expect(details.props('selDamageLog')).toHaveLength(2)
    for (const group of ['equipment', 'provisions', 'consumables']) expect(details.find(`[data-test="v2-inspector-${group}"]`).exists()).toBe(true)
    expect(details.find('[data-state="COOLDOWN"]').exists()).toBe(true)
    store.time = 47
    await nextTick()
    expect(details.find('[data-state="COOLDOWN"]').exists()).toBe(false)
    store.time = 51
    await nextTick()
    expect(details.props('selCurStats')).toEqual({ dealt: 0, received: 0, kills: 0 })
    expect(details.props('selDamageLog')).toEqual([])
    store.time = 54
    await nextTick()
    expect(details.props('selCurStats').dealt).toBe(900)
    wrapper.unmount()
  })

  it('换文件时迟到canonical结果不得覆盖新场详情', async () => {
    mockWebGL('webgl2')
    let finishOld
    canonical.load.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve }))
    const nextDataset = makeBattlePlaybackDataset()
    nextDataset.vehicles[0].playerName = 'New battle'
    canonical.load.mockResolvedValue({ dataset: nextDataset, clock: { startRaw: 10 }, reloadTelemetry: null })
    const wrapper = mountPane()
    await start(wrapper)
    expect(canonical.load).toHaveBeenCalledTimes(1)
    await wrapper.setProps({ file: mkFile('next.wotbreplay') })
    await start(wrapper)
    playback.api.store.time = 10
    playback.api.store.roster = { team1: [{ eid: 77, accountId: 1001, team: 1, nick: 'New battle', tank: 'Maus' }], team2: [], unknown: [] }
    await flush()
    await openDetailsViaScene(77)
    const details = wrapper.getComponent({ name: 'VehicleDetailsPanel' })
    expect(details.props('selectedTrack').playerName).toBe('New battle')
    finishOld({ dataset: makeBattlePlaybackDataset(), clock: { startRaw: 42 }, reloadTelemetry: null })
    await flush()
    expect(details.props('selectedTrack').playerName).toBe('New battle')
    expect(details.props('currentTime')).toBe(0)
    wrapper.unmount()
  })

  it('scene starts with canonical pending and the open Details automatically enriches later', async () => {
    mockWebGL('webgl2')
    const state = shallowReactive({ canonical: null, canonicalError: null, canonicalState: 'loading', sceneState: 'ready' })
    const session = { loadScene: vi.fn().mockResolvedValue({}), getState: () => state }
    const wrapper = mountPane({ playbackSession: session })
    await start(wrapper)
    const store = playback.api.store
    expect(store.hasData).toBe(true)
    expect(state.canonicalState).toBe('loading')
    store.time = 54
    store.roster = { team1: [{ eid: 7, accountId: 1001, team: 1, nick: 'Scene player', tank: 'Maus', hp: 100, maxHp: 1500 }], team2: [], unknown: [] }
    await flush()
    await openDetailsViaScene(7)
    const details = wrapper.getComponent({ name: 'VehicleDetailsPanel' })
    expect(details.props('selectedState').vehicle.playerName).toBe('Scene player')
    expect(details.props('health')).toEqual({ currentHp: 100, maxHp: 1500 })
    expect(details.props('selectedTrack')).toBeNull()
    expect(details.props('selCurStats')).toBeNull()
    expect(details.props('selDamageLog')).toEqual([])
    const dataset = makeBattlePlaybackDataset({ events: [
      { timeSec: 10, kind: 'DAMAGE', attackerAccountId: 1001, victimAccountId: 2001, amount: 400, visibility: 'OBSERVED' },
    ] })
    state.canonical = { dataset, clock: { startRaw: 42 }, reloadTelemetry: null }
    state.canonicalState = 'ready'
    await flush()
    expect(details.props('selectedTrack').accountId).toBe(1001)
    expect(details.props('selCurStats').dealt).toBe(400)
    expect(details.props('selDamageLog')).toHaveLength(1)
    expect(details.props('currentTime')).toBe(12)
    expect(session.loadScene).toHaveBeenCalledTimes(1)
    state.canonical = null
    state.canonicalState = 'error'
    state.canonicalError = new Error('AI failed')
    await flush()
    expect(store.hasData).toBe(true)
    expect(details.props('selectedState').vehicle.playerName).toBe('Scene player')
    expect(details.props('selCurStats')).toBeNull()
    wrapper.unmount()
  })

  it('a successful 2D retry updates retained 3D Details without reloading the scene', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    await start(wrapper)
    const shared = shallowReactive({ canonical: null })
    playback.api.store.playbackSession = shared
    playback.api.store.roster = { team1: [{ eid: 7, accountId: 1001, team: 1, nick: 'A', tank: 'Maus' }], team2: [], unknown: [] }
    await flush()
    await openDetailsViaScene(7)
    const details = wrapper.getComponent({ name: 'VehicleDetailsPanel' })
    expect(details.props('selectedTrack')).toBeNull()
    await wrapper.setProps({ active: false })
    shared.canonical = { dataset: makeBattlePlaybackDataset(), clock: { startRaw: 42 }, reloadTelemetry: null }
    await wrapper.setProps({ active: true })
    expect(details.props('selectedTrack').accountId).toBe(1001)
    expect(playback.api.loadData).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('canonical缺失时不为3D详情伪造统计或inspect track', async () => {
    mockWebGL('webgl2')
    canonical.load.mockResolvedValue({ dataset: null, clock: null })
    const wrapper = mountPane()
    await start(wrapper)
    playback.api.store.roster = { team1: [{ eid: 7, accountId: 1001, team: 1, nick: 'A', tank: 'Maus', hp: 100, maxHp: 100 }], team2: [], unknown: [] }
    await flush()
    await openDetailsViaScene(7)
    const details = wrapper.getComponent({ name: 'VehicleDetailsPanel' })
    expect(details.props('selCurStats')).toBeNull()
    expect(details.props('selectedTrack')).toBeNull()
    expect(details.find('[data-test="pb-sb-dealt"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it.each(['offline', 'unknown', 'degraded', 'service-unavailable'])('never initializes a remote loader on a %s direct mount', async (state) => {
    connectivityState.state.value = state
    mockWebGL('webgl2')
    const wrapper = mountPane()
    await flush()
    expect(playback.init).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="replay3d-connectivity"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('disconnect destroys the remote session; reconnect initializes once with the retained file', async () => {
    mockWebGL('webgl2')
    const file = mkFile('kept.wotbreplay')
    const wrapper = mountPane({ file })
    await flush()
    await start(wrapper)
    const oldApi = playback.api
    connectivityState.state.value = 'offline'
    await flush()
    expect(oldApi.destroy).toHaveBeenCalledTimes(1)
    expect(wrapper.props('file')).toStrictEqual(file)
    connectivityState.state.value = 'online'
    await flush()
    expect(playback.init).toHaveBeenCalledTimes(2)
    expect(playback.api.loadData).not.toHaveBeenCalled()
    expect(wrapper.find('[data-test="replay3d-pending"]').exists()).toBe(true)
    expect(wrapper.get('[data-pane-ready]').attributes('data-pane-ready')).toBe('true')
    await start(wrapper)
    expect(playback.api.loadData).toHaveBeenCalledTimes(1)
    connectivityState.state.value = 'online'
    await flush()
    expect(playback.init).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })

  it('reconnect while the retained 3D pane is hidden defers new assets until activation', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    await flush()
    connectivityState.state.value = 'offline'
    await flush()
    await wrapper.setProps({ active: false })
    connectivityState.state.value = 'online'
    await flush()
    expect(playback.init).toHaveBeenCalledTimes(1)
    await wrapper.setProps({ active: true })
    await flush()
    expect(playback.init).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })

  it('不支持 WebGL：不初始化场景，显示说明', () => {
    mockWebGL('none')
    const wrapper = mountPane()
    expect(playback.init).not.toHaveBeenCalled()
    expect(wrapper.get('[data-testid="scene3d-unsupported"]').text()).toContain('scene3d.webgl_unavailable')
    wrapper.unmount()
  })

  it('没有文件 / 被工作台阻断时不初始化场景，也不自己开文件选择器', () => {
    mockWebGL('webgl2')
    const empty = mountPane({ file: null })
    expect(playback.init).not.toHaveBeenCalled()
    expect(empty.get('[data-testid="replay3d-empty"]').text()).toBe('agentReplay.no_file')
    expect(empty.find('input[type="file"]').exists()).toBe(false)
    empty.unmount()

    const blocked = mountPane({ blockedReason: 'workspace.single_replay_required' })
    expect(blocked.get('[data-testid="replay3d-blocked"]').text()).toBe('workspace.single_replay_required')
    blocked.unmount()
  })

  it('有文件先停在待开播；按开始才用工作台派生文件加载一次；同一文件不重复解析', async () => {
    mockWebGL('webgl2')
    const file = mkFile('battle.wotbreplay')
    const wrapper = mountPane({ file })
    await flush()
    expect(playback.init).toHaveBeenCalledTimes(1)
    expect(playback.api.loadData).not.toHaveBeenCalled()
    expect(wrapper.get('[data-test="replay3d-pending"]').text()).toContain('battle.wotbreplay')
    const perf = wrapper.get('[data-test="replay3d-perf-options"]')
    expect(perf.element.closest('details')).toBeNull()
    for (const id of ['perf-logdepth', 'perf-dynres', 'perf-armor-highlight', 'perf-contact-shadows']) {
      expect(perf.find(`[data-testid="${id}"]`).exists()).toBe(true)
    }
    await start(wrapper)
    expect(playback.api.loadData).toHaveBeenCalledWith(expect.objectContaining({ kind: 'local', file }))
    expect(wrapper.find('[data-test="replay3d-pending"]').exists()).toBe(false)
    await wrapper.setProps({ active: false })
    await wrapper.setProps({ active: true })
    await flush()
    expect(playback.api.loadData).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('接地阴影开关：流畅 / 均衡停用，高清 / 极致可开；换文件后新待开播沿用跨回放偏好', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane({ file: mkFile('a.wotbreplay') })
    await flush()
    const box = () => wrapper.get('[data-testid="perf-contact-shadows"]')
    const store = playback.api.store
    for (const [key, disabled] of [['low', true], ['mid', true], ['high', false], ['ultra', false]]) {
      store.qualityKey = key
      await flush()
      expect(box().element.disabled).toBe(disabled)
    }
    expect(box().element.checked).toBe(false)
    await box().setValue(true)
    expect(playback.api.setContactShadows).toHaveBeenLastCalledWith(true)
    expect(box().element.checked).toBe(true)
    await wrapper.setProps({ file: mkFile('b.wotbreplay') })
    await flush()
    expect(playback.api.setContactShadows).toHaveBeenLastCalledWith(true)
    expect(box().element.checked).toBe(true)
    wrapper.unmount()
  })

  it('解析所有权：换文件 / 撤下 / 卸载会真正 abort 在途解析（signal 透传给内核 source）', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    await start(wrapper)
    expect(playback.api.loadData).toHaveBeenCalledTimes(1)
    const firstSignal = playback.api.loadData.mock.calls[0][0].signal
    expect(firstSignal.aborted).toBe(false)

    const next = mkFile('b2.wotbreplay')
    await wrapper.setProps({ file: next })
    await flush()
    expect(firstSignal.aborted).toBe(true)

    await start(wrapper)
    const secondSignal = playback.api.loadData.mock.calls[1][0].signal
    expect(secondSignal).not.toBe(firstSignal)
    expect(secondSignal.aborted).toBe(false)

    wrapper.unmount()
    expect(secondSignal.aborted).toBe(true)
  })

  it('换目标回放 → 先撤下上一场（内核 reset）回到待开播，按开始才解析新文件', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    await start(wrapper)
    expect(playback.api.loadData).toHaveBeenCalledTimes(1)
    playback.api.store.hasData = true
    await nextTick()

    const next = mkFile('b2.wotbreplay')
    await wrapper.setProps({ file: next })
    await flush()
    expect(playback.api.reset).toHaveBeenCalledTimes(1)
    expect(playback.api.loadData).toHaveBeenCalledTimes(1)
    expect(playback.api.store.hasData).toBe(false)
    expect(wrapper.get('[data-test="replay3d-pending"]').text()).toContain('b2.wotbreplay')

    await start(wrapper)
    expect(playback.api.loadData).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'local', file: next }))
    wrapper.unmount()
  })

  it('active 闸门：切走 setPaused(true)、切回 setPaused(false)，且不销毁场景', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    expect(playback.api.setPaused).toHaveBeenLastCalledWith(false)
    playback.api.setPaused.mockClear()
    await wrapper.setProps({ active: false })
    expect(playback.api.setPaused).toHaveBeenCalledWith(true)
    expect(playback.api.destroy).not.toHaveBeenCalled()
    await wrapper.setProps({ active: true })
    expect(playback.api.setPaused).toHaveBeenLastCalledWith(false)
    wrapper.unmount()
    expect(playback.api.destroy).toHaveBeenCalledTimes(1)
  })

  it('foreground changes pause and resume without changing playback intent or reloading', async () => {
    mockWebGL('webgl2')
    let visibility = 'visible'
    const getter = vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
    const wrapper = mountPane()
    await start(wrapper)
    const api = playback.api
    api.setPlaying.mockClear()
    visibility = 'hidden'
    document.dispatchEvent(new Event('visibilitychange'))
    await nextTick()
    expect(api.setPaused).toHaveBeenLastCalledWith(true)
    expect(api.destroy).not.toHaveBeenCalled()
    visibility = 'visible'
    document.dispatchEvent(new Event('visibilitychange'))
    await nextTick()
    expect(api.setPaused).toHaveBeenLastCalledWith(false)
    expect(api.loadData).toHaveBeenCalledTimes(1)
    expect(api.setPlaying).not.toHaveBeenCalled()
    wrapper.unmount()
    getter.mockRestore()
  })

  it('解析中为不确定进度，资产阶段显示资产进度；失败后可重试同一文件或关闭', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    await flush()
    const { store } = playback.api

    let finish
    playback.api.loadData.mockImplementationOnce(() => {
      store.hasData = false
      store.loading = true
      return new Promise((resolve) => { finish = resolve })
        .finally(() => { store.loading = false })
    })
    await start(wrapper)
    expect(playback.api.loadData).toHaveBeenCalledTimes(1)
    expect(store.loading).toBe(true)
    expect(store.hasData).toBe(false)
    expect(wrapper.get('[data-testid="scene3d-loading"]').text()).toContain('agentReplay.parsing')
    expect(wrapper.get('[role="progressbar"]').attributes('aria-valuenow')).toBeUndefined()

    store.assetStage = true
    store.assetProgress = 0.3
    await nextTick()
    expect(wrapper.get('[data-testid="scene3d-loading"]').text()).toContain('agentReplay.loading_assets')
    expect(wrapper.get('[role="progressbar"]').attributes('aria-valuenow')).toBe('30')

    store.err = 'bad replay'
    store.assetStage = false
    finish()
    await flush()
    expect(wrapper.get('[data-testid="scene3d-error"]').text()).toContain('agentReplay.error_load')
    await wrapper.get('[data-testid="scene3d-retry"]').trigger('click')
    await flush()
    expect(playback.api.loadData).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'local', file: wrapper.props('file') }))

    store.err = 'still bad'
    await nextTick()
    await wrapper.get('[data-testid="scene3d-dismiss"]').trigger('click')
    expect(store.err).toBe('')
    expect(wrapper.find('[data-testid="scene3d-error"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('Recorder 在 Team 2：己方在左、敌方在右，颜色和标题跟随视角', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    const { store } = playback.api
    store.hasData = true
    store.friendlyTeam = 2
    store.roster = {
      team1: [{ eid: 1, team: 1, nick: 'A', tank: 'T-62A', hp: 975, maxHp: 1950, dead: false, followed: false }],
      team2: [{ eid: 2, team: 2, nick: 'B', tank: 'Maus', hp: 1500, maxHp: 3000, dead: false, followed: false }],
      unknown: [{ eid: 3, team: null, nick: 'C', tank: '', hp: 100, maxHp: 0, dead: false, followed: false }],
    }
    document.documentElement.style.setProperty('--color-team-1', 'rgb(1, 2, 3)')
    document.documentElement.style.setProperty('--color-team-2', 'rgb(4, 5, 6)')
    document.documentElement.style.setProperty('--color-team-ally', 'rgb(9, 9, 9)')
    document.documentElement.style.setProperty('--color-team-enemy', 'rgb(8, 8, 8)')
    await nextTick()
    const rootStyle = wrapper.get('[data-testid="replay3d-root"]').attributes('style')
    expect(rootStyle).toContain(`--color-team-ally: ${PLAYBACK_ROLES.friendly.base}`)
    expect(rootStyle).toContain(`--color-team-enemy: ${PLAYBACK_ROLES.enemy.base}`)
    expect(wrapper.get('.side-left .team2').exists()).toBe(true)
    expect(wrapper.get('.side-right .team1').exists()).toBe(true)
    expect(wrapper.get('.side-left .pl').attributes('style')).toContain('--color-team-ally')
    expect(wrapper.get('.side-right .pl').attributes('style')).toContain('--color-team-enemy')
    const dots = (sel) => wrapper.findAll(`${sel} .pl .dot`)
    expect(dots('.team1')).toHaveLength(1)
    expect(dots('.team1')[0].attributes('style')).toContain('--color-team-enemy')
    expect(dots('.team2')).toHaveLength(1)
    expect(dots('.team2')[0].attributes('style')).toContain('--color-team-ally')
    expect(dots('.team-unknown')).toHaveLength(1)
    expect(dots('.team-unknown')[0].attributes('style')).not.toContain('rgb(1, 2, 3)')
    expect(dots('.team-unknown')[0].attributes('style')).not.toContain('rgb(4, 5, 6)')
    expect(wrapper.findAll('.team h3').map(h => h.text())).toEqual([
      'recon.map.team_friendly', 'agentReplay.teamUnknown', 'recon.map.team_enemy',
    ])
    for (const p of ['--color-team-1', '--color-team-2', '--color-team-ally', '--color-team-enemy']) {
      document.documentElement.style.removeProperty(p)
    }
    wrapper.unmount()
  })

  it('名册行 HP 走 aria-label（行样式回归原始单行版），随 store 投影变化，阵亡 = 0 / max', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    const { store } = playback.api
    store.hasData = true
    store.roster = {
      team1: [
        { eid: 1, team: 1, nick: 'A', tank: 'Kranvagn', hp: 1950, maxHp: 1950, dead: false, followed: false },
        { eid: 2, team: 1, nick: 'B', tank: 'SPHT', hp: 824, maxHp: 1950, dead: false, followed: false },
      ],
      team2: [{ eid: 3, team: 2, nick: 'C', tank: 'Chieftain', hp: 0, maxHp: 2000, dead: true, followed: false }],
      unknown: [],
    }
    await nextTick()
    const nums = (sel) => wrapper.findAll(`${sel} [data-test="roster-hp"]`).map(n => n.attributes('aria-label'))
    expect(nums('.team1')).toEqual(['1950 / 1950', '824 / 1950'])
    expect(nums('.team2')).toEqual(['0 / 2000'])

    store.roster.team1[0].hp = 1200
    await nextTick()
    expect(nums('.team1')).toEqual(['1200 / 1950', '824 / 1950'])

    store.roster.team1[1].maxHp = 0
    await nextTick()
    expect(nums('.team1')[1]).toBe('—')
    expect(wrapper.findAll('.team1 [data-test="roster-hp"]')[1].classes()).toContain('hp-mode-unknown')
    wrapper.unmount()
  })

  it('阵容在左右两条侧边车道上（team1/team2 各一车道，unknown 归左车道常驻底部）', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    const { store } = playback.api
    store.hasData = true
    store.roster = {
      team1: [{ eid: 1, team: 1, nick: 'A', tank: 'T-62A', hp: 975, maxHp: 1950, dead: false, followed: false }],
      team2: [{ eid: 2, team: 2, nick: 'B', tank: 'Maus', hp: 3000, maxHp: 3000, dead: false, followed: false }],
      unknown: [],
    }
    await nextTick()
    const lanes = wrapper.findAll('.roster-surface > .team-lane')
    expect(lanes.map(l => l.classes())).toEqual([['team-lane', 'side-left'], ['team-lane', 'side-right']])
    const left = lanes[0]
    const team1 = wrapper.get('.team1')
    const team2 = wrapper.get('.team2')
    expect(left.element.firstElementChild.dataset.test).toBe('pb-shell-roster')
    expect(lanes[1].element.firstElementChild.dataset.test).toBe('pb-shell-roster')
    for (const team of [team1, team2]) {
      expect(team.element.parentElement.classList.contains('pb-roster')).toBe(true)
    }
    expect(team1.text()).toContain('A')
    expect(team2.text()).toContain('B')
    expect(wrapper.find('.team-unknown').exists()).toBe(false)
    store.roster.unknown = [{ eid: 3, team: null, nick: 'C', tank: '', hp: 100, maxHp: 100, dead: false, followed: false }]
    await nextTick()
    const unknown = wrapper.get('.team-unknown')
    expect(unknown.element.parentElement.classList.contains('pb-roster')).toBe(true)
    expect(unknown.element.parentElement).toBe(team1.element.parentElement)
    expect(unknown.text()).toContain('C')

    store.hasData = false
    await nextTick()
    expect(wrapper.findAll('.team-lane')).toHaveLength(0)
    wrapper.unmount()
  })

  it('播放传输控件是 2D / 3D 共用的那一套（同一组 data-test 契约）', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    playback.api.store.hasData = true
    playback.api.store.duration = 300
    await nextTick()
    expect(wrapper.find('[data-test="pb-controls"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="pb-play"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="pb-speed-current"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="pb-time"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="replay3d-toolbar"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('播放条 / 顶栏 / 详情只读引擎发布的战斗时间轴；canonical clock 到达 / 消失时交给引擎', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    const store = playback.api.store
    store.hasData = true
    store.startTime = 11
    store.duration = 293
    store.time = 272.9
    await nextTick()
    const transport = wrapper.getComponent({ name: 'PlaybackTransport' })
    expect(transport.props('startTime')).toBe(11)
    expect(transport.props('duration')).toBe(293)
    expect(wrapper.get('[data-test="pb-time"]').text()).toBe('04:22 / 04:42')
    expect(wrapper.get('[data-test="pb-hud-time"]').text()).toBe('04:22')

    const clock = { startRaw: 11.3, durationSec: 282 }
    store.playbackSession = shallowReactive({ canonical: { dataset: null, clock, reloadTelemetry: null } })
    await nextTick()
    expect(playback.api.setBattleClock).toHaveBeenLastCalledWith(clock)
    expect(transport.props('startTime')).toBe(11.3)
    expect(wrapper.get('[data-test="pb-hud-time"]').text()).toBe('04:22')

    store.playbackSession = null
    await nextTick()
    expect(playback.api.setBattleClock).toHaveBeenLastCalledWith(null)
    wrapper.unmount()
  })

  it('canonical life replacement refreshes the paused scene even when the clock object is unchanged', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    const store = playback.api.store
    const clock = { startRaw: 42, durationSec: 200 }
    const state = shallowReactive({ canonical: { dataset: { vehicles: [] }, clock } })
    store.playbackSession = state
    store.hasData = true
    store.playing = false
    await nextTick()
    playback.api.setBattleClock.mockClear()
    state.canonical = { dataset: { vehicles: [{ accountId: 77, lifeTransitions: [{ timeSec: 10, lifeState: 'DESTROYED' }] }] }, clock }
    await nextTick()
    expect(playback.api.setBattleClock).toHaveBeenCalledTimes(1)
    expect(playback.api.setBattleClock).toHaveBeenCalledWith(clock)
    wrapper.unmount()
  })

  it('paused late result marks refresh roster and selected details by account, then clear with the session', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    const store = playback.api.store
    store.hasData = true
    store.playing = false
    store.roster = { team1: [{ eid: 9, accountId: 77, tankId: 101, tank: 'Maus', nick: 'You', team: 1, hp: 100, maxHp: 100 }], team2: [], unknown: [] }
    const clock = { startRaw: 0, durationSec: 200 }
    const state = shallowReactive({ canonical: { dataset: { vehicles: [] }, clock, result: null } })
    store.playbackSession = state
    await flush()
    await openDetailsViaScene(9)
    expect(wrapper.find('.roster-surface [data-gun-marks]').exists()).toBe(false)
    state.canonical = { dataset: { vehicles: [] }, clock, result: { players: [{ account_id: 77, gun_marks: 2 }, { account_id: 9, gun_marks: 3 }] } }
    await flush()
    expect(wrapper.get('.roster-surface [data-gun-marks]').attributes('data-gun-marks')).toBe('2')
    expect(wrapper.get('[data-test="pb-sb-tank"] [data-gun-marks]').attributes('data-gun-marks')).toBe('2')
    store.playbackSession = null
    await flush()
    expect(wrapper.find('.roster-surface [data-gun-marks]').exists()).toBe(false)
    expect(wrapper.get('[data-test="pb-sb-gun-marks"]').text()).toBe('—')
    wrapper.unmount()
  })

  it('direct declutter and roster controls preserve the current session and restore preferences', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    await start(wrapper)
    const store = playback.api.store
    store.time = 52
    const parseCount = playback.api.loadData.mock.calls.length
    await wrapper.get('[data-testid="display-toggle"]').trigger('click')
    await wrapper.get('[data-test="pb-declutter"]').trigger('click')
    expect(wrapper.get('[data-test="pb-declutter"]').attributes('aria-pressed')).toBe('true')
    expect(playback.api.setLabelPrefs).toHaveBeenLastCalledWith({
      enabled: true, showPlayerName: false, showTankName: true, showHp: false, showReload: false,
      classIcons: true, showStatus: false, lastKnown: true,
    })
    await wrapper.get('[data-testid="disp-roster"]').setValue(false)
    expect(wrapper.find('[data-testid="roster-surface"]').exists()).toBe(false)
    await wrapper.get('[data-testid="disp-roster"]').setValue(true)
    expect(wrapper.find('[data-testid="roster-surface"]').exists()).toBe(true)
    await wrapper.get('[data-test="pb-declutter"]').trigger('click')
    expect(playback.api.setLabelPrefs).toHaveBeenLastCalledWith(expect.objectContaining({ classIcons: false, showHp: true, showReload: true, showStatus: true }))
    expect(store.time).toBe(52)
    expect(playback.api.loadData).toHaveBeenCalledTimes(parseCount)
    wrapper.unmount()
  })

  it('旧持久化 2D classIcons:true 不隐藏 3D 车模；3D 面板开关只写 classIcons3d', async () => {
    localStorage.setItem('wotb.pb.marker-prefs', JSON.stringify({ classIcons: true, showStatus: true, battleMarkers: true }))
    mockWebGL('webgl2')
    const wrapper = mountPane()
    await flush()
    expect(playback.api.setLabelPrefs).toHaveBeenLastCalledWith(expect.objectContaining({ classIcons: false }))
    playback.api.store.hasData = true
    await nextTick()
    await wrapper.get('[data-testid="display-toggle"]').trigger('click')
    const box = wrapper.get('[data-testid="disp-class-icons"]')
    expect(box.element.checked).toBe(false)
    await box.setValue(true)
    await nextTick()
    expect(playback.api.setLabelPrefs).toHaveBeenLastCalledWith(expect.objectContaining({ classIcons: true }))
    await box.setValue(false)
    await nextTick()
    expect(JSON.parse(localStorage.getItem('wotb.pb.marker-prefs'))).toMatchObject({ classIcons: true, classIcons3d: false })
    wrapper.unmount()
  })

  it('共享标签偏好推给场景：enabled + 四行开关，面板改动即时下发', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    await flush()
    expect(playback.api.setLabelPrefs).toHaveBeenLastCalledWith({
      enabled: true, showPlayerName: false, showTankName: true, showHp: true, showReload: true,
      classIcons: false, showStatus: true, lastKnown: true,
    })
    playback.api.store.hasData = true
    await nextTick()
    await wrapper.get('[data-testid="display-toggle"]').trigger('click')
    await nextTick()
    wrapper.findComponent({ name: 'PlaybackVehicleLabels3D' }).vm.setLabels([{ eid: 1, playerName: 'Recorder昵称', tankName: 'Maus', friendly: true }])
    await nextTick()
    expect(wrapper.find('[data-test="pb-label-player"]').exists()).toBe(false)
    await wrapper.get('[data-testid="disp-player"]').setValue(true)
    await nextTick()
    expect(playback.api.setLabelPrefs).toHaveBeenLastCalledWith({
      enabled: true, showPlayerName: true, showTankName: true, showHp: true, showReload: true,
      classIcons: false, showStatus: true, lastKnown: true,
    })
    expect(wrapper.get('[data-test="pb-label-player"]').text()).toBe('Recorder昵称')
    await wrapper.get('[data-testid="disp-player"]').setValue(false)
    expect(wrapper.find('[data-test="pb-label-player"]').exists()).toBe(false)
    await wrapper.get('[data-testid="disp-player"]').setValue(true)
    await wrapper.get('[data-testid="disp-hp"]').setValue(false)
    await nextTick()
    expect(playback.api.setLabelPrefs).toHaveBeenLastCalledWith({
      enabled: true, showPlayerName: true, showTankName: true, showHp: false, showReload: true,
      classIcons: false, showStatus: true, lastKnown: true,
    })
    wrapper.unmount()
  })

  it('战场快捷标记开关推给场景：建场景补推 + 面板改动即时下发', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    await flush()
    expect(playback.api.setBattleMarkers).toHaveBeenLastCalledWith(true)
    playback.api.store.hasData = true
    await nextTick()
    await wrapper.get('[data-testid="display-toggle"]').trigger('click')
    await nextTick()
    await wrapper.get('[data-testid="disp-battle-markers"]').setValue(false)
    await nextTick()
    expect(playback.api.setBattleMarkers).toHaveBeenLastCalledWith(false)
    await wrapper.get('[data-testid="disp-battle-markers"]').setValue(true)
    await nextTick()
    expect(playback.api.setBattleMarkers).toHaveBeenLastCalledWith(true)
    await wrapper.get('[data-testid="hide-all-ui"]').trigger('click')
    await nextTick()
    expect(playback.api.setBattleMarkers).toHaveBeenLastCalledWith(false)
    await wrapper.get('[data-testid="show-all-ui"]').trigger('click')
    await nextTick()
    expect(playback.api.setBattleMarkers).toHaveBeenLastCalledWith(true)
    wrapper.unmount()
  })

  it('一次性消费事件流 seek 请求：切回 3D 不重放，新 id 才执行', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane({ pendingSeek: { id: 1, sec: 20 } })
    await flush()
    playback.api.store.hasData = true
    await nextTick()
    expect(playback.api.seekTime).toHaveBeenCalledWith(20)
    playback.api.seekTime.mockClear()
    await wrapper.setProps({ active: false })
    await wrapper.setProps({ active: true })
    await nextTick()
    expect(playback.api.seekTime).not.toHaveBeenCalled()
    await wrapper.setProps({ pendingSeek: { id: 2, sec: 35 } })
    await nextTick()
    expect(playback.api.seekTime).toHaveBeenCalledWith(35)
    wrapper.unmount()
  })

  it('暂停时连续按下一发可持续前进（评审 4595575859）', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    await start(wrapper)
    const { store } = playback.api
    store.hasData = true
    Object.assign(store, { startTime: 5, duration: 100, time: 5, cam: 'follow' })
    playback.api.seekTime.mockImplementation((v) => { store.time = v })
    const workspaceState = wrapper.props('playbackSession').getState(wrapper.props('file'))
    workspaceState.scenePlayback = {
      shots: [
        { t_fire: 10, shooter_eid: 11, is_author: true },
        { t_fire: 20, shooter_eid: 11, is_author: true },
        { t_fire: 30, shooter_eid: 11, is_author: true },
      ],
      kills: [],
    }
    await flush()
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Period', key: '.', bubbles: true }))
    await nextTick()
    expect(playback.api.seekTime).toHaveBeenLastCalledWith(9.95)
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Period', key: '.', bubbles: true }))
    await nextTick()
    expect(playback.api.seekTime).toHaveBeenLastCalledWith(19.95)
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Period', key: '.', bubbles: true }))
    await nextTick()
    expect(playback.api.seekTime).toHaveBeenLastCalledWith(29.95)
    wrapper.unmount()
  })

  it('bounds transient kill events independently of persistent HUD content', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    const { store } = playback.api
    store.hasData = true
    store.killfeed = Array.from({ length: 6 }, (_, id) => ({ id, kill: true, killer: `K${id}`, victim: `V${id}` }))
    await nextTick()
    expect(wrapper.get('[data-test="replay3d-killfeed"]').findAll('.kf')).toHaveLength(3)
    expect(wrapper.get('[data-test="replay3d-killfeed"]').text()).toContain('K5')
    expect(wrapper.get('[data-test="replay3d-killfeed"]').text()).not.toContain('K0')
    expect(wrapper.get('[data-test="pb-hud"]').find('.killfeed').exists()).toBe(false)
    wrapper.unmount()
  })

  it.each([
    [70, ['K2']],
    [50, ['K1', 'K2']],
  ])('击杀流行数预算决定实际渲染：HUD 底边 %ipx 时只渲染最新的 %j', async (hudBottom, expected) => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    const { store } = playback.api
    store.hasData = true
    store.killfeed = [0, 1, 2].map((id) => ({ id, kill: true, killer: `K${id}`, victim: `V${id}` }))
    await nextTick()
    const root = wrapper.get('[data-testid="replay3d-root"]').element
    Object.defineProperty(root, 'clientHeight', { configurable: true, value: 500 })
    vi.spyOn(wrapper.get('.hud').element, 'getBoundingClientRect').mockReturnValue({ bottom: hudBottom })
    window.dispatchEvent(new Event('resize'))
    await nextTick()
    const rows = wrapper.get('[data-test="replay3d-killfeed"]').findAll('.kf').map((row) => row.text())
    expect(rows).toHaveLength(expected.length)
    expected.forEach((killer, index) => expect(rows[index]).toContain(killer))
    wrapper.unmount()
  })

  it('显示面板可分别开关战场 UI 分块（顶栏 / 阵容 / 击杀流 / 基地条）', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    const { store } = playback.api
    store.hasData = true
    store.baseViews = [{ id: 'A', owner: 'friendly', progress: 0.5 }]
    store.killfeed = [{ id: 1, kill: true, killer: 'K', victim: 'V' }]
    store.roster = {
      team1: [{ eid: 1, team: 1, nick: 'A', tank: 'T', hp: 1, maxHp: 2, dead: false, followed: false }],
      team2: [], unknown: [],
    }
    await nextTick()
    expect(wrapper.find('.topbar').exists()).toBe(true)
    expect(wrapper.find('.killfeed').exists()).toBe(true)
    expect(wrapper.find('.base-status').exists()).toBe(true)
    expect(wrapper.find('.team-lane').exists()).toBe(true)

    await wrapper.get('[data-testid="display-toggle"]').trigger('click')
    await nextTick()
    expect(wrapper.get('[data-testid="display-toggle"]').attributes('aria-expanded')).toBe('true')
    await wrapper.get('[data-testid="disp-topbar"]').setValue(false)
    await wrapper.get('[data-testid="disp-killfeed"]').setValue(false)
    await wrapper.get('[data-testid="disp-base"]').setValue(false)
    await wrapper.get('[data-testid="disp-roster"]').setValue(false)
    await nextTick()
    expect(wrapper.find('.topbar').exists()).toBe(false)
    expect(wrapper.find('.killfeed').exists()).toBe(false)
    expect(wrapper.find('.base-status').exists()).toBe(false)
    expect(wrapper.find('.team-lane').exists()).toBe(false)
    expect(wrapper.find('[data-test="pb-controls"]').exists()).toBe(true)
    wrapper.unmount()
  })

})
