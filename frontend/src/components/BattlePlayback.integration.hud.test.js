// @vitest-environment happy-dom
// BattlePlayback 集成矩阵（拆分自 BattlePlayback.integration.test.js；装配见 .harness.js）。
// vi 必须直接来自 vitest：vi.mock 提升依赖它被识别为 vitest API。
import { vi } from 'vitest'
import {
  describe, expect, it, afterEach,
  flushPromises, mount,
  makeOverview, makePlaybackV2,
  preloadBattleModels, loadVehiclePortrait,
  BattlePlayback, usePlaybackPreferences,
  mountPlayback, trackOf, setPositionSamples,
  rafState, stubRaf, installIntegrationLifecycle,
} from './BattlePlayback.integration.test.harness.js'

const i18n = vi.hoisted(() => ({
  t: vi.fn(key => key)
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: i18n.t, locale: { value: 'zh' } })
}))

vi.mock('../platform/screenForm.js', () => ({ forcedLandscapeDevice: async () => 'android-phone-app' }))

vi.mock('../data/mapImages', () => ({
  mapImages: {
    holland: {
      src: 'molendijk.png',
      width: 766,
      height: 769,
      coordinateBounds: { xMin: -300, xMax: 300, yMin: -300, yMax: 300 }
    },
    neptune: {
      src: 'neptune.png', width: 766, height: 769,
      coordinateBounds: { xMin: -300, xMax: 300, yMin: -300, yMax: 300 }
    },
    malinovka: {
      src: 'malinovka.png', width: 766, height: 769,
      coordinateBounds: { xMin: -300, xMax: 300, yMin: -300, yMax: 300 }
    },
    // 有底图但 mapBases 未收录几何——新地图上线到基地坐标补齐之间的真实状态。
    map_without_base_geometry: {
      src: 'no-bases.webp',
      width: 766,
      height: 769,
      coordinateBounds: { xMin: -300, xMax: 300, yMin: -300, yMax: 300 }
    }
  }
}))

vi.mock('../utils/mapPalette.js', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    luminanceOfImage: vi.fn().mockResolvedValue(0.8)
  }
})

vi.mock('../vehicle-models/runtime.js', () => ({
  preloadBattleModels: vi.fn(async () => ({
    resolved: new Map(),
    failed: new Set(),
    byTank: new Map(),
  })),
}))

vi.mock('../vehicle-portraits/runtime.js', () => ({
  loadVehiclePortrait: vi.fn(async (tankId) => tankId === 2 ? '/portraits/2.webp' : null),
}))

installIntegrationLifecycle()

describe('PR5 — HP HUD / combat feedback / detail sidebar（§4–§16）', () => {
  afterEach(() => {
    localStorage.clear()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  /** performance.now 受控时钟（驱动 wall-clock transient）。 */
  function fakeClock() {
    const clock = { now: 0 }
    vi.spyOn(performance, 'now').mockImplementation(() => clock.now)
    return clock
  }





  it('§10/§20 floating damage：播放跨过 DAMAGE 触发 -400；seek 不触发；wall-clock 到期消失', async () => {
    stubRaf()
    const clock = fakeClock()
    const overview = makeOverview()
    const ds = makePlaybackV2()
    // EnemyA 位置流覆盖 [10,20]：事件时刻 12 覆盖 → 允许反馈
    const wrapper = mountPlayback(overview, 11, ds)
    await flushPromises()
    // 无布局环境需提供地图宽度（floating 位置锚定 markerScreen）
    Object.defineProperty(wrapper.find('[data-test="pb-map"]').element, 'clientWidth', { value: 800, configurable: true })
    // seek 到 12（恰好事件时刻）不触发（§20.1）
    await wrapper.find('.pb-range').setValue(12)
    await flushPromises()
    expect(wrapper.find('[data-test="pb-float-dmg"]').exists()).toBe(false)
    // 从 11 播放跨过 12 → 触发
    await wrapper.find('.pb-range').setValue(11)
    await wrapper.find('[data-test="pb-play"]').trigger('click')
    clock.now = 100
    rafState.cb(0)
    clock.now = 1300
    rafState.cb(1300) // +1.3s → t=12.3 跨过 DAMAGE@12
    await flushPromises()
    expect(wrapper.find('[data-test="pb-float-dmg"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="pb-float-dmg"]').text()).toBe('-400')
    // wall-clock 到期（>1s）消失（此时 rafState.cb 仍指向 wrapper 的 frame）
    clock.now = 2600
    rafState.cb(2600)
    await flushPromises()
    expect(wrapper.find('[data-test="pb-float-dmg"]').exists()).toBe(false)
    // 失察期间受击不跳伤害（事件时刻无位置流覆盖）
    const overview2 = makeOverview()
    const ds2 = makePlaybackV2()
    setPositionSamples(ds2, 2001, [{ x: -50, y: -50, timeSec: 10 }, { x: -60, y: -60, timeSec: 12 }], 10, 12)
    ds2.vehicles[1].damageLosses = [{ fromSec: 13, toSec: 14, hpLoss: 500, fromHp: 1200, toHp: 700, displayCapacityHp: 1200, transientAllowed: false, attackerAccountId: 1001, attackerReliable: true, damageEventCount: 1 }]
    const w2 = mountPlayback(overview2, 13, ds2)
    await flushPromises()
    Object.defineProperty(w2.find('[data-test="pb-map"]').element, 'clientWidth', { value: 800, configurable: true })
    await w2.find('[data-test="pb-play"]').trigger('click')
    clock.now = 100
    rafState.cb(0)
    clock.now = 1500
    rafState.cb(1500) // t=14.5 跨过 DAMAGE@14（失察期）
    await flushPromises()
    expect(w2.find('[data-test="pb-float-dmg"]').exists()).toBe(false)
  })

  it('hidden AoI DamageLoss keeps canonical stats/log but suppresses all transient feedback', async () => {
    stubRaf()
    const clock = fakeClock()
    const overview = makeOverview()
    const ds = makePlaybackV2()
    ds.events = ds.events.filter((event) => event.type !== 'DAMAGE')
    const enemy = trackOf(ds, 2001)
    enemy.positionSegments = [
      { knowledge: 'OBSERVED', interpolationAllowed: true, startSec: 0, endSec: 20,
        samples: [{ timeSec: 0, x: -50, y: -50 }, { timeSec: 20, x: -60, y: -60 }] },
      { knowledge: 'OBSERVED', interpolationAllowed: true, startSec: 40, endSec: 60,
        samples: [{ timeSec: 40, x: -100, y: -100 }, { timeSec: 60, x: -120, y: -120 }] },
    ]
    enemy.healthTransitions = [
      { timeSec: 0, currentHp: 2000, knowledge: 'CURRENT', displayCapacityHp: 2000, source: 'EXACT_BATTLE_EVENT', confidence: 'HIGH' },
      { timeSec: 42, currentHp: 1500, knowledge: 'CURRENT', displayCapacityHp: 2000, source: 'EXACT_BATTLE_EVENT', confidence: 'HIGH' },
    ]
    enemy.damageLosses = [{
      fromSec: 10, toSec: 42, hpLoss: 500,
      fromHp: 2000, toHp: 1500, displayCapacityHp: 2000, transientAllowed: false,
      attackerAccountId: 1001, attackerReliable: true, damageEventCount: 1,
    }]
    const wrapper = mountPlayback(overview, 9, ds)
    await flushPromises()
    await wrapper.find('[data-test="pb-marker-1001"]').trigger('click')
    await wrapper.find('[data-test="pb-play"]').trigger('click')
    clock.now = 100
    rafState.cb(0)
    clock.now = 34100
    rafState.cb(34100) // t≈43：跨过完整 hidden-window loss，canonical facts remain visible
    await flushPromises()

    expect(wrapper.find('[data-test="pb-float-dmg"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="pb-marker-2001"] .pb-hp-ghost').exists()).toBe(false)
    expect(wrapper.find('[data-test="pb-marker-2001"] .pb-hp-flash').exists()).toBe(false)
    const info = wrapper.find('[data-test="pb-info"]')
    const dts = info.findAll('.pb-sb-grid dt')
    const recordedIndex = dts.findIndex((dt) => dt.text() === 'recon.map.playback.damage_recorded')
    expect(info.findAll('.pb-sb-grid dd')[recordedIndex].text()).toBe('500')
    expect(info.findAll('.pb-sb-log-time').map((node) => node.text())).toEqual(['00:42'])
  })

  it('§10.3/§11 HP transition：跨过 DAMAGE 产生 ghost（同阵营浅版）+ fill 立即到新值', async () => {
    stubRaf()
    fakeClock()
    const overview = makeOverview()
    const ds = makePlaybackV2()
    // Blocker 3：ghost 需要 pct，而 pct 只在进场满血已证明（OBSERVED_EXACT）时存在——
    // 本测试用已证明 entryHp=2600 验证真实百分比 ghost/填充
    ds.vehicles[1].healthTransitions = [
      { timeSec: 0, currentHp: 2600, knowledge: 'CURRENT', displayCapacityHp: 2600, source: 'EXACT_BATTLE_EVENT' },
      { timeSec: 12, currentHp: 2200, knowledge: 'CURRENT', displayCapacityHp: 2600, relativeFull: false, source: 'EXACT_BATTLE_EVENT' },
    ]
    const wrapper = mountPlayback(overview, 11, ds)
    await flushPromises()
    await wrapper.find('[data-test="pb-play"]').trigger('click')
    rafState.cb(0)
    rafState.cb(1300) // t=12.3 跨过 DAMAGE@12
    await flushPromises()
    const marker = wrapper.find('[data-test="pb-marker-2001"]')
    expect(marker.find('.pb-hp-ghost').exists()).toBe(true)
    expect(marker.find('.pb-hp-fill').attributes('style')).toContain('84.61') // 2200/2600（已证明 entryHp）
  })

  it('§16 kill feed：只显示受害者被击毁（§15.2 无攻击者名）；最多 2 条可见队列（§17）', async () => {
    stubRaf()
    fakeClock()
    const overview = makeOverview()
    const ds = makePlaybackV2()
    for (let i = 0; i < 4; i++) {
      ds.events.push({ type: 'KILL', timeSec: 13 + i, accountId: 1001, targetAccountId: 2001, rawProtocolValue: null })
    }
    const wrapper = mountPlayback(overview, 12, ds)
    await flushPromises()
    await wrapper.find('[data-test="pb-play"]').trigger('click')
    rafState.cb(0)
    rafState.cb(5100) // t=17.1 跨过 4 条 KILL
    await flushPromises()
    // §17：最多 2 条 visible，第 3 条及以后排队（从最旧挤出）
    expect(wrapper.findAll('.pb-feed-item')).toHaveLength(2)
    const item = wrapper.find('.pb-feed-item')
    expect(item.text()).toContain('T49') // 受害者坦克名
    expect(item.text()).toContain('recon.map.playback.feed_destroyed')
    expect(item.text()).not.toContain('You') // 不显示攻击者（§15.2）
    // seek 不补 feed
    await wrapper.find('.pb-range').setValue(10)
    await flushPromises()
    expect(wrapper.find('[data-test="pb-kill-feed"]').exists()).toBe(false)
  })








})

describe('Blocker 修复回归（review B1-1 / B1-2 / B1-3 / B2）', () => {
  afterEach(() => {
    localStorage.clear()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  /** performance.now 受控时钟（驱动 wall-clock transient）。 */
  function fakeClock() {
    const clock = { now: 0 }
    vi.spyOn(performance, 'now').mockImplementation(() => clock.now)
    return clock
  }

  /** 从当前状态 dl 读 dt 对应 dd 文本（finalStats 分区不渲染时唯一）。 */
  function sidebarValue(wrapper, dtKey) {
    const dts = wrapper.findAll('.pb-sb-grid dt')
    const idx = dts.findIndex((d) => d.text() === dtKey)
    if (idx === -1) return null
    const dds = wrapper.findAll('.pb-sb-grid dd')
    return dds[idx] ? dds[idx].text() : null
  }

  function logTimes(wrapper) {
    return wrapper.findAll('.pb-sb-log li').map((li) => li.find('.pb-sb-log-time').text())
  }

  it('B1-1 combat feedback 不依赖 Event Panel 折叠状态：播放跨过仍触发', async () => {
    stubRaf()
    const clock = fakeClock()
    const overview = makeOverview()
    const ds = makePlaybackV2()
    ds.events.push({ type: 'KILL', timeSec: 16, accountId: 1001, targetAccountId: 2001, rawProtocolValue: null })
    const wrapper = mountPlayback(overview, 11, ds)
    await flushPromises()
    Object.defineProperty(wrapper.find('[data-test="pb-map"]').element, 'clientWidth', { value: 800, configurable: true })
    await wrapper.find('[data-test="pb-play"]').trigger('click')
    clock.now = 100
    rafState.cb(0)
    clock.now = 6000
    rafState.cb(6000) // +6s → t=17：跨过 DAMAGE@12 与 KILL@16
    await flushPromises()
    // 即使事件面板折叠，combat feedback 仍按需求触发
    expect(wrapper.find('[data-test="pb-float-dmg"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="pb-float-dmg"]').text()).toBe('-400')
    expect(wrapper.find('[data-test="pb-kill-feed"]').exists()).toBe(true)
    // §15：banner 显示「玩家名（车辆名）被击毁」，来自 canonical vehicle identity。
    expect(wrapper.find('[data-test="pb-kill-feed"]').text()).toContain('EnemyA（T49）')
    expect(wrapper.find('[data-test="pb-kill-feed"]').text()).toContain('recon.map.playback.feed_destroyed')
  })

  it('B2 末尾事件消费：播放跨到 duration 时 (prev, duration] 内事件 exactly-once；seek 到末尾不补播', async () => {
    stubRaf()
    const clock = fakeClock()
    const overview = makeOverview()
    const ds = makePlaybackV2()
    ds.durationSec = 20
    setPositionSamples(ds, 2001, [
      { x: -50, y: -50, timeSec: 0 }, { x: -50, y: -50, timeSec: 10 }, { x: -100, y: -100, timeSec: 14 },
    ], 0, 20)
    ds.events.push(
      { type: 'DAMAGE', timeSec: 19.8, accountId: 1001, targetAccountId: 2001, rawProtocolValue: 400, observedHpLoss: 400 },
      { type: 'DESTROYED', timeSec: 20, accountId: 2001, targetAccountId: null, rawProtocolValue: null },
      { type: 'KILL', timeSec: 20, accountId: 1001, targetAccountId: 2001, rawProtocolValue: null }
    )
    ds.vehicles[1].damageLosses.push(
      { fromSec: 19, toSec: 19.8, hpLoss: 400, fromHp: 1200, toHp: 800, displayCapacityHp: 1200, transientAllowed: true, attackerAccountId: 1001, attackerReliable: true, damageEventCount: 1 }
    )
    const wrapper = mountPlayback(overview, 19, ds)
    await flushPromises()
    Object.defineProperty(wrapper.find('[data-test="pb-map"]').element, 'clientWidth', { value: 800, configurable: true })
    await wrapper.find('[data-test="pb-play"]').trigger('click')
    clock.now = 100
    rafState.cb(0)
    clock.now = 1300
    rafState.cb(1300) // +1.3s → t=20（duration）：先消费 (19, 20] 再停止
    await flushPromises()
    // 末尾最后一段事件全部消费一次：floating damage + burst + kill feed
    expect(wrapper.findAll('[data-test="pb-float-dmg"]')).toHaveLength(1)
    expect(wrapper.find('[data-test="pb-float-dmg"]').text()).toBe('-400')
    expect(wrapper.find('[data-test="pb-burst"]').exists()).toBe(true)
    expect(wrapper.findAll('.pb-feed-item')).toHaveLength(1)
    // 到达 duration 后停止；后续仅轻量时钟推进（wall-clock 自然完成），不产生重复消费
    clock.now = 2500
    rafState.cb(2500)
    await flushPromises()
    expect(wrapper.find('[data-test="pb-float-dmg"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="pb-burst"]').exists()).toBe(false)
    expect(wrapper.findAll('.pb-feed-item')).toHaveLength(1) // feed 未重复，仍在自然存活
    // seek 直接到 20s：不补播（无 feedback）
    const w2 = mountPlayback(overview, 20, ds)
    await flushPromises()
    Object.defineProperty(w2.find('[data-test="pb-map"]').element, 'clientWidth', { value: 800, configurable: true })
    expect(w2.find('[data-test="pb-float-dmg"]').exists()).toBe(false)
    expect(w2.find('[data-test="pb-burst"]').exists()).toBe(false)
    expect(w2.find('[data-test="pb-kill-feed"]').exists()).toBe(false)
  })

  it('B2 loop：末尾事件消费一次后回绕 0；下一轮不重复上一轮末尾事件', async () => {
    stubRaf()
    const clock = fakeClock()
    const overview = makeOverview()
    const ds = makePlaybackV2()
    ds.durationSec = 20
    setPositionSamples(ds, 2001, [
      { x: -50, y: -50, timeSec: 0 }, { x: -50, y: -50, timeSec: 10 }, { x: -100, y: -100, timeSec: 14 },
    ], 0, 20)
    ds.events.push(
      { type: 'DAMAGE', timeSec: 19.8, accountId: 1001, targetAccountId: 2001, rawProtocolValue: 400, observedHpLoss: 400 },
      { type: 'DESTROYED', timeSec: 20, accountId: 2001, targetAccountId: null, rawProtocolValue: null },
      { type: 'KILL', timeSec: 20, accountId: 1001, targetAccountId: 2001, rawProtocolValue: null }
    )
    ds.vehicles[1].damageLosses.push(
      { fromSec: 19, toSec: 19.8, hpLoss: 400, fromHp: 1200, toHp: 800, displayCapacityHp: 1200, transientAllowed: true, attackerAccountId: 1001, attackerReliable: true, damageEventCount: 1 }
    )
    // 回绕到 t=0 后受害车（2001）必须仍有锚点：t=0 有真实位置上报，OBSERVED 段从 0 起。
    ds.vehicles[1].positionSegments = [{ knowledge: 'OBSERVED', startSec: 0, endSec: 20,
      samples: [
        { timeSec: 0, x: -50, y: -50 },
        { timeSec: 10, x: -50, y: -50 },
        { timeSec: 14, x: -100, y: -100 },
      ] }]
    const wrapper = mount(BattlePlayback, {
      props: { overview, seekTo: 19, loop: true, playbackV2: ds },
      global: { mocks: { $t: i18n.t } }
    })
    await flushPromises()
    Object.defineProperty(wrapper.find('[data-test="pb-map"]').element, 'clientWidth', { value: 800, configurable: true })
    await wrapper.find('[data-test="pb-play"]').trigger('click')
    clock.now = 100
    rafState.cb(0)
    clock.now = 1300
    rafState.cb(1300) // t=20：先消费 (19, 20] 再回绕到 0（仍在播放）
    await flushPromises()
    // 回绕：时间归 0；末尾事件已被消费（kill feed 可见，恰好 1 条；float 已生成）
    expect(wrapper.find('.pb-time').text()).toBe('00:00 / 00:20')
    expect(wrapper.findAll('.pb-feed-item')).toHaveLength(1)
    expect(wrapper.find('[data-test="pb-float-dmg"]').exists()).toBe(true)
    // 下一轮前段（无事件）：上一轮末尾事件不重复（feed 仍 1 条、float 按 wall-clock 到期）
    clock.now = 2600
    rafState.cb(2600) // +1.3s → t=1.3（round 2）
    await flushPromises()
    expect(wrapper.find('[data-test="pb-float-dmg"]').exists()).toBe(false) // 上一轮 float 到期，未重复
    expect(wrapper.findAll('.pb-feed-item')).toHaveLength(1) // 上一轮 feed 仍在自然存活，未重复
  })

  it('B5A-fix kill feed 隐藏时不无限续约暂停时钟；恢复显示重启时钟并展示队列', async () => {
    // 记录 RAF 调度次数：隐藏 feed 时暂停时钟必须收敛，不得为不可见内容无限续约
    let rafScheduled = 0
    vi.stubGlobal('requestAnimationFrame', (cb) => { rafScheduled += 1; rafState.cb = cb; return 1 })
    vi.stubGlobal('cancelAnimationFrame', () => {})
    const clock = fakeClock()
    const prefs = usePlaybackPreferences()
    prefs.uiPrefs.showKillfeed = false
    const overview = makeOverview()
    const ds = makePlaybackV2()
    ds.events.push({ type: 'KILL', timeSec: 16, accountId: 1001, targetAccountId: 2001, rawProtocolValue: null })
    const wrapper = mountPlayback(overview, 11, ds)
    await flushPromises()
    Object.defineProperty(wrapper.find('[data-test="pb-map"]').element, 'clientWidth', { value: 800, configurable: true })
    await wrapper.find('[data-test="pb-play"]').trigger('click')
    clock.now = 100
    rafState.cb(0)
    clock.now = 6000
    rafState.cb(6000) // t=17：消费 DAMAGE@12 + KILL@16（feed 隐藏 → 排队无 shownAt）
    await flushPromises()
    expect(wrapper.find('[data-test="pb-kill-feed"]').exists()).toBe(false)
    // 暂停：隐藏 feed 不算 pending；可见 float/ghost 按原寿命完成后调度必须收敛
    await wrapper.find('[data-test="pb-play"]').trigger('click')
    await flushPromises()
    const counts = []
    for (let i = 0; i < 12; i++) {
      clock.now += 500
      if (rafState.cb) rafState.cb(clock.now)
      await flushPromises()
      counts.push(rafScheduled)
    }
    expect(counts[counts.length - 1]).toBe(counts[counts.length - 4]) // 末 3 帧无新调度
    expect(wrapper.find('[data-test="pb-kill-feed"]').exists()).toBe(false)
    // 暂停期间墙钟前移 10s（不执行任何 RAF）：nowMs 保持旧值
    clock.now += 10_000
    // 恢复显示：watch 重启时钟，队列提升并可见
    prefs.uiPrefs.showKillfeed = true
    await flushPromises()
    expect(rafScheduled).toBeGreaterThan(counts[counts.length - 1]) // 时钟被重启
    expect(wrapper.find('[data-test="pb-kill-feed"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="pb-kill-feed"]').text()).toContain('EnemyA（T49）')
    // 恢复后 +2s 仍可见（shownAt 必须取新鲜时钟——旧 nowMs 会把首帧渲染的
    // shownAt 记成暂停前旧值，下一帧新鲜时间一到立即过期 → 只闪现一帧）
    for (let i = 0; i < 4; i++) {
      clock.now += 500
      if (rafState.cb) rafState.cb(clock.now)
      await flushPromises()
    }
    expect(wrapper.find('[data-test="pb-kill-feed"]').exists()).toBe(true)
    // 恢复后累计 >4s：自然消失
    for (let i = 0; i < 6; i++) {
      clock.now += 500
      if (rafState.cb) rafState.cb(clock.now)
      await flushPromises()
    }
    expect(wrapper.find('[data-test="pb-kill-feed"]').exists()).toBe(false)
    // 动画结束后 RAF 停止续约
    const scheduledAtEnd = rafScheduled
    clock.now += 500
    if (rafState.cb) rafState.cb(clock.now)
    await flushPromises()
    expect(rafScheduled).toBe(scheduledAtEnd)
  })
})

