// @vitest-environment happy-dom
// BattlePlayback 集成矩阵（拆分自 BattlePlayback.integration.test.js；装配见 .harness.js）。
// vi 必须直接来自 vitest：vi.mock 提升依赖它被识别为 vitest API。
import { vi } from 'vitest'
import {
  describe, expect, it, afterEach, beforeEach,
  KeepAlive, defineComponent, h, nextTick, ref,
  flushPromises, mount, readFileSync, resolve,
  PLAYBACK_MOBILE_QUERY, makeOverview, makePlaybackV2,
  preloadBattleModels, loadVehiclePortrait, TANK_ID_TO_MODEL,
  BattlePlayback, usePlaybackPreferences,
  mountBattlePlayback, mountPlayback, openPanel, trackOf, setPositionSamples, setLife,
  rafState, mountedWrappers, stubRaf, detailsHpNum, enemyHudNum, installIntegrationLifecycle,
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

describe('Playback secondary convergence', () => {
  it('opens Events through Display and keeps event seek/pause behavior reachable', async () => {
    const wrapper = mountPlayback()
    await flushPromises()
    expect(wrapper.find('[data-testid="display-panel"]').exists()).toBe(false)
    await wrapper.get('[data-test="pb-secondary-entry"]').trigger('click')
    await wrapper.get('[data-test="pb-panel-events"]').trigger('click')
    expect(wrapper.get('[data-testid="display-panel"]').find('[data-test="pb-event-panel"]').exists()).toBe(true)
    const event = wrapper.find('[data-test="pb-event"]')
    expect(event.exists()).toBe(true)
    await event.trigger('click')
    expect(wrapper.getComponent({ name: 'PlaybackControls' }).props('playing')).toBe(false)
    expect(wrapper.getComponent({ name: 'PlaybackControls' }).props('currentTime')).toBeGreaterThan(0)
    await wrapper.get('[data-test="pb-events-back"]').trigger('click')
    expect(wrapper.find('[data-test="pb-panel-content-display"]').exists()).toBe(true)
  })

  it('opens one closeable annotation toolbar under Transport in wide form', async () => {
    const wrapper = mountPlayback()
    await flushPromises()
    await wrapper.get('[data-test="pb-secondary-entry"]').trigger('click')
    await wrapper.get('[data-test="pb-annotation-entry"]').trigger('click')
    expect(wrapper.find('[data-testid="display-panel"]').exists()).toBe(false)
    expect(wrapper.findAllComponents({ name: 'AnnotationToolbar' })).toHaveLength(1)
    expect(wrapper.get('[data-test="pb-transport-slot"]').find('.pb-annotation-toolbar').exists()).toBe(true)
    expect(wrapper.getComponent({ name: 'BattleMap' }).props('activeTool')).toBe('select')
    await wrapper.getComponent({ name: 'AnnotationToolbar' }).vm.$emit('close')
    await nextTick()
    expect(wrapper.findComponent({ name: 'AnnotationToolbar' }).exists()).toBe(false)
    expect(wrapper.getComponent({ name: 'BattleMap' }).props('activeTool')).toBe(null)
  })

  it('map selection displays and updates HP from the current replay time', async () => {
    const ds = makePlaybackV2()
    ds.vehicles[0].healthTransitions = [
      { timeSec: 0, currentHp: 1000, knowledge: 'CURRENT', displayCapacityHp: 1000, source: 'EXACT_BATTLE_EVENT' },
      { timeSec: 10, currentHp: 600, knowledge: 'CURRENT', displayCapacityHp: 1000, source: 'EXACT_BATTLE_EVENT' },
      { timeSec: 20, currentHp: 400, knowledge: 'CURRENT', displayCapacityHp: 1000, source: 'EXACT_BATTLE_EVENT' },
    ]
    const wrapper = mountPlayback(makeOverview(), 10, ds)
    await flushPromises()
    await wrapper.get('[data-test="pb-marker-1001"]').trigger('click')
    expect(wrapper.get('[data-test="pb-sb-hp-current"]').text()).toBe('600')
    expect(wrapper.get('[data-test="pb-sb-hp-max"]').text()).toContain('1000')
    expect(wrapper.get('[data-test="pb-sb-hp-percentage"]').text()).toContain('60%')
    await wrapper.setProps({ seekTo: 20 })
    await flushPromises()
    expect(wrapper.get('[data-test="pb-sb-hp-current"]').text()).toBe('400')
  })

  it('switches HP presentation and applies the ring declutter preset without changing playback', async () => {
    const wrapper = mountPlayback()
    await flushPromises()
    const time = wrapper.getComponent({ name: 'PlaybackControls' }).props('currentTime')
    await wrapper.get('[data-test="pb-secondary-entry"]').trigger('click')
    await wrapper.get('[data-testid="pb-hp-mode-ring"]').trigger('click')
    const map = wrapper.getComponent({ name: 'BattleMap' })
    const prefs = usePlaybackPreferences()
    expect(map.props('hpPrefs').mode).toBe('ring')
    expect(map.props('markerLabel')(1001).showReload).toBe(false)
    expect(wrapper.get('[data-test="pb-show-reload"]').element.disabled).toBe(true)
    expect(prefs.labelPrefs.showReload).toBe(true)
    expect(wrapper.findAll('[data-test="pb-hp-ring"]').length).toBeGreaterThan(0)
    await wrapper.get('[data-testid="pb-hp-mode-bar"]').trigger('click')
    expect(map.props('markerLabel')(1001).showReload).toBe(true)
    await wrapper.get('[data-test="pb-declutter"]').trigger('click')
    expect(prefs.hpPrefs).toEqual({ showHp: true, mode: 'ring' })
    expect(wrapper.findAll('[data-test="pb-hp-ring"]').length).toBeGreaterThan(0)
    expect(wrapper.find('[data-test="pb-hp-hud"]').exists()).toBe(false)
    await wrapper.get('[data-test="pb-declutter"]').trigger('click')
    expect(prefs.hpPrefs.mode).toBe('bar')
    expect(prefs.labelPrefs.showReload).toBe(true)
    expect(wrapper.getComponent({ name: 'PlaybackControls' }).props('currentTime')).toBe(time)
  })

  it('honors shared HUD/base/killfeed/Reload preferences without changing replay state', async () => {
    const dataset = makePlaybackV2({ baseStates: [{ timeSec: 0, baseId: 'A', ownerTeam: 1, capturingTeam: null, captureProgress: null }] })
    const wrapper = mountPlayback(makeOverview(), 8, dataset)
    await flushPromises()
    const time = wrapper.getComponent({ name: 'PlaybackControls' }).props('currentTime')
    await wrapper.get('[data-test="pb-secondary-entry"]').trigger('click')
    await wrapper.get('[data-test="pb-show-hud"]').setValue(false)
    expect(wrapper.find('[data-test="pb-hp-bars"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="pb-hud-bases"]').exists()).toBe(true)
    await wrapper.get('[data-test="pb-show-base"]').setValue(false)
    expect(wrapper.find('[data-test="pb-hud"]').exists()).toBe(false)
    await wrapper.get('[data-test="pb-show-killfeed"]').setValue(false)
    await wrapper.get('[data-test="pb-show-reload"]').setValue(false)
    const prefs = usePlaybackPreferences()
    expect(prefs.uiPrefs.showKillfeed).toBe(false)
    expect(prefs.labelPrefs.showReload).toBe(false)
    expect(wrapper.getComponent({ name: 'BattleMap' }).props('markerLabel')(1001).showReload).toBe(false)
    expect(wrapper.getComponent({ name: 'PlaybackControls' }).props('currentTime')).toBe(time)
  })

  it('hides all UI transiently and restores retained time, selection and preferences via H', async () => {
    const wrapper = mountPlayback(makeOverview(), 8)
    await flushPromises()
    await wrapper.get('[data-test="pb-marker-1001"]').trigger('click', { clientX: 0, clientY: 0 })
    const map = wrapper.getComponent({ name: 'BattleMap' })
    const selected = map.props('selectedAccountId')
    const time = wrapper.getComponent({ name: 'PlaybackControls' }).props('currentTime')
    const prefs = usePlaybackPreferences()
    const before = { ...prefs.uiPrefs }
    await wrapper.get('[data-test="pb-secondary-entry"]').trigger('click')
    await wrapper.get('[data-test="pb-hide-all-ui"]').trigger('click')
    expect(wrapper.find('[data-test="pb-controls"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="pb-hud"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="pb-team-lane-left"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="pb-show-all-ui"]').exists()).toBe(true)
    expect(map.props('selectedAccountId')).toBe(selected)
    expect(map.props('hpPrefs').showHp).toBe(false)
    expect(prefs.uiPrefs).toEqual(before)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'h' }))
    await nextTick()
    expect(wrapper.find('[data-test="pb-show-all-ui"]').exists()).toBe(false)
    expect(wrapper.getComponent({ name: 'PlaybackControls' }).props('currentTime')).toBe(time)
    expect(wrapper.getComponent({ name: 'BattleMap' }).props('selectedAccountId')).toBe(selected)
    expect(wrapper.findComponent({ name: 'VehicleDetailsPanel' }).exists()).toBe(true)
  })
})

describe('2D 位姿与 3D 同源（poseFacet 通道）', () => {
  /** 常量位姿切面：game 系 (x, z) + 朝向；网格 11 点覆盖原始时钟 100..101s */
  function constantPoseFacet(accountId, { x, z, hullYawRad, turretAbsRad }) {
    const n = 11
    return {
      tStart: 100, samples: n,
      vehicles: [{
        eid: 1, account_id: accountId,
        pos: Array.from({ length: n }, () => [x, 0, z]).flat(),
        hull_yaw: new Array(n).fill(hullYawRad),
        hull_pitch: new Array(n).fill(0),
        turret_yaw: new Array(n).fill(turretAbsRad),
        gun_pitch: new Array(n).fill(0),
        coverage: [100, 101],
      }],
    }
  }

  it('位姿通道在场：标记位置/朝向取通道值（canonical 原始观测被覆盖）', async () => {
    stubRaf()
    const ds = makePlaybackV2()
    // canonical：1001 车 t=0..40 从 (0,0) 走到 (200,200)、朝向 90°
    setPositionSamples(ds, 1001, [{ x: 0, y: 0, timeSec: 0 }, { x: 200, y: 200, timeSec: 40 }], 0, 40)
    trackOf(ds, 1001).orientationSegments = [{
      knowledge: 'CURRENT', startSec: 0, endSec: 40,
      samples: [{ timeSec: 0, hullYawDeg: 90, turretRelativeYawDeg: 0 }],
    }]
    // 位姿通道：常量 (game x=50, z=-60)、朝北 0°（偏移 100 ⇒ 原始时刻 100+战斗秒）
    const wrapper = mountBattlePlayback({
      overview: makeOverview(),
      playbackV2: ds,
      poseFacet: constantPoseFacet(1001, { x: 50, z: -60, hullYawRad: 0, turretAbsRad: 0 }),
      clockOffset: 100,
    })
    await flushPromises()
    const marker = wrapper.find('[data-test="pb-marker-1001"]')
    expect(marker.exists()).toBe(true)
    // 位置来自通道：(50, -60) 在 ±300 框、766×769 逻辑框内
    const style = marker.attributes('style')
    expect(style).toMatch(/58\.33/)
    expect(style).toMatch(/60%/)
    // 朝向来自通道（0°），而不是 canonical 的 90°
    expect(marker.findAll('img')[0].attributes('style')).toContain('rotate(0deg)')
    expect(marker.findAll('img')[0].attributes('style')).not.toContain('rotate(90deg)')
  })

  it('无位姿通道：回退 canonical 原始观测（与既往行为一致）', async () => {
    stubRaf()
    const ds = makePlaybackV2()
    setPositionSamples(ds, 1001, [{ x: 0, y: 0, timeSec: 0 }, { x: 200, y: 200, timeSec: 40 }], 0, 40)
    trackOf(ds, 1001).orientationSegments = [{
      knowledge: 'CURRENT', startSec: 0, endSec: 40,
      samples: [{ timeSec: 0, hullYawDeg: 90, turretRelativeYawDeg: 30 }],
    }]
    const wrapper = mountPlayback(makeOverview(), 20, ds)
    await flushPromises()
    const marker = wrapper.find('[data-test="pb-marker-1001"]')
    expect(marker.findAll('img')[0].attributes('style')).toContain('rotate(90deg)')
    expect(marker.findAll('img')[1].attributes('style')).toContain('rotate(120deg)')
  })

  it('失察即冻结：观测段结束后标记停在最后观测点，不跟随滤波器继续移动', async () => {
    stubRaf()
    const ds = makePlaybackV2()
    // canonical：OBSERVED [0,30]（0→60 m），其后 LAST_KNOWN（冻结在 t=30）
    trackOf(ds, 1001).positionSegments = [
      { knowledge: 'OBSERVED', startSec: 0, endSec: 30, interpolationAllowed: true,
        samples: [{ timeSec: 0, x: 0, y: 0 }, { timeSec: 30, x: 60, y: 0 }] },
      { knowledge: 'LAST_KNOWN', startSec: 30, endSec: 60,
        samples: [{ timeSec: 30, x: 60, y: 0 }] },
    ]
    // 位姿通道：x 随原始时钟线性增长 2 m/s（raw = battle + 100）
    const n = 601
    const pos = []
    const yaw = []
    for (let i = 0; i < n; i++) { pos.push(i * 0.2, 0, 0); yaw.push(0) }
    const facet = {
      tStart: 100, samples: n,
      vehicles: [{
        eid: 1, account_id: 1001, pos, hull_yaw: yaw, hull_pitch: new Array(n).fill(0),
        turret_yaw: new Array(n).fill(0), gun_pitch: new Array(n).fill(0), coverage: [100, 160],
      }],
    }
    const wrapper = mountBattlePlayback({
      overview: makeOverview(), playbackV2: ds, poseFacet: facet, clockOffset: 100,
    })
    await flushPromises()
    // 期望的 left%：x = 2 m/s × 战斗秒（raw = 战斗秒 + 100）
    const pctOf = (x) => (((x + 300) / 600) * 766 / 766) * 100
    const readLeft = async (seekTo) => {
      await wrapper.setProps({ seekTo })
      await flushPromises()
      const t = wrapper.vm.currentTime
      const style = wrapper.find('[data-test="pb-marker-1001"]').attributes('style') || ''
      return { t, left: Number(/left: ([\d.]+)%/.exec(style)?.[1]) }
    }
    // t=20（观测内）：跟随位姿通道（x = 2·t）
    const observed = await readLeft(20)
    expect(observed.left).toBeCloseTo(pctOf(2 * observed.t), 3)
    // t>30（失察）：冻结在 t=30 的位姿（x=60），而不是滤波延续值（x = 2·t）
    const frozen = await readLeft(60)
    expect(frozen.t).toBeGreaterThan(30)
    expect(frozen.left).toBeCloseTo(pctOf(60), 3)
    expect(Math.abs(frozen.left - pctOf(2 * frozen.t))).toBeGreaterThan(5)
  })

  it('位姿通道缺该车 / 缺时钟偏移：该车回退 canonical，其余车不受影响', async () => {
    stubRaf()
    const ds = makePlaybackV2()
    setPositionSamples(ds, 1001, [{ x: 0, y: 0, timeSec: 0 }, { x: 200, y: 200, timeSec: 40 }], 0, 40)
    trackOf(ds, 1001).orientationSegments = [{
      knowledge: 'CURRENT', startSec: 0, endSec: 40,
      samples: [{ timeSec: 0, hullYawDeg: 90, turretRelativeYawDeg: 0 }],
    }]
    // 切面只含 2001；且 clockOffset 缺失（Number 缺省 null）
    const wrapper = mountBattlePlayback({
      overview: makeOverview(),
      playbackV2: ds,
      poseFacet: constantPoseFacet(2001, { x: 0, z: 0, hullYawRad: 0, turretAbsRad: 0 }),
    })
    await flushPromises()
    const marker = wrapper.find('[data-test="pb-marker-1001"]')
    expect(marker.findAll('img')[0].attributes('style')).toContain('rotate(90deg)')
  })

  it('多实体账号（AoI 重入 / 复活换实体）：按 canonical 身份证据选活跃实体，后一实体不得泄漏到重入之前', async () => {
    stubRaf()
    const ds = makePlaybackV2()
    setPositionSamples(ds, 1001, [{ x: 0, y: 0, timeSec: 0 }, { x: 200, y: 200, timeSec: 40 }], 0, 40)
    const n = 401
    const defOf = (eid, x) => ({
      eid, account_id: 1001,
      pos: Array.from({ length: n }, () => [x, 0, 0]).flat(),
      hull_yaw: new Array(n).fill(0), hull_pitch: new Array(n).fill(0),
      turret_yaw: new Array(n).fill(0), gun_pitch: new Array(n).fill(0),
      coverage: [100, 140],
    })
    // 同一账号两个实体：eid 1 首见 0s（x=50）、eid 2 首见 30s（x=150）。数组里 eid 2 在后 ——
    // 若按"后写覆盖"取 def，重入之前的每一帧都会被 eid 2 的钳位首帧（x=150）顶掉（未来泄漏）。
    const facet = {
      tStart: 100, samples: n,
      vehicles: [defOf(1, 50), defOf(2, 150)],
      entityStartsByAccount: new Map([[1001, new Map([[1, 0], [2, 30]])]]),
    }
    const wrapper = mountBattlePlayback({
      overview: makeOverview(), playbackV2: ds, poseFacet: facet, clockOffset: 100,
    })
    await flushPromises()
    const pctOf = (x) => ((x + 300) / 600) * 100
    const leftAt = async (seekTo) => {
      await wrapper.setProps({ seekTo })
      await flushPromises()
      const style = wrapper.find('[data-test="pb-marker-1001"]').attributes('style') || ''
      return Number(/left: ([\d.]+)%/.exec(style)?.[1])
    }
    expect(await leftAt(5)).toBeCloseTo(pctOf(50), 1)    // 重入前：eid 1
    expect(await leftAt(35)).toBeCloseTo(pctOf(150), 1)  // 重入后：eid 2
  })

  it('实体身份证据早于位姿覆盖（HP 先见）→ 覆盖外的采样回落 canonical，不泄漏该实体未来首帧（review P2）', async () => {
    stubRaf()
    const ds = makePlaybackV2()
    // canonical：观测 [0,40]、x 恒 0——回落路径的期望位置
    setPositionSamples(ds, 1001, [{ x: 0, y: 0, timeSec: 0 }, { x: 0, y: 0, timeSec: 40 }], 0, 40)
    const n = 401
    const defOf = (eid, x, coverage) => ({
      eid, account_id: 1001,
      pos: Array.from({ length: n }, () => [x, 0, 0]).flat(),
      hull_yaw: new Array(n).fill(0), hull_pitch: new Array(n).fill(0),
      turret_yaw: new Array(n).fill(0), gun_pitch: new Array(n).fill(0),
      coverage,
    })
    const facet = {
      tStart: 100, samples: n,
      // eid 2 的位姿证据从战斗 30s（raw 130）才出现，但身份证据（HP/观测先见）在战斗 10s ——
      // 战斗 20s 的采样时刻落在 eid 2 的 coverage 之外，钳位会把它未来的首帧（x=150）泄漏到过去。
      vehicles: [defOf(1, 50, [100, 140]), defOf(2, 150, [130, 200])],
      entityStartsByAccount: new Map([[1001, new Map([[1, 0], [2, 10]])]]),
    }
    const wrapper = mountBattlePlayback({
      overview: makeOverview(), playbackV2: ds, poseFacet: facet, clockOffset: 100,
    })
    await flushPromises()
    const pctOf = (x) => ((x + 300) / 600) * 100
    const leftAt = async (seekTo) => {
      await wrapper.setProps({ seekTo })
      await flushPromises()
      const style = wrapper.find('[data-test="pb-marker-1001"]').attributes('style') || ''
      return Number(/left: ([\d.]+)%/.exec(style)?.[1])
    }
    expect(await leftAt(20)).toBeCloseTo(pctOf(0), 1)     // 覆盖外 → canonical 的 x=0（不是 eid 2 的 150）
    expect(await leftAt(35)).toBeCloseTo(pctOf(150), 1)   // 进入覆盖（raw 135）→ eid 2 的通道值
  })
})

describe('2D 工具栏折叠与名册浮层（§2d-toolbar-collapse / §roster-overlay）', () => {
  afterEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('底部工具栏折叠后只留恢复入口，再展开恢复原内容；折叠会关闭 Display 面', async () => {
    stubRaf()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    const toggle = () => wrapper.get('[data-test="pb-transport-toggle"]')
    const content = () => wrapper.get('[data-test="pb-transport-controls"]')
    expect(toggle().attributes('aria-expanded')).toBe('true')
    expect(content().attributes('style') || '').not.toContain('display: none')
    // 打开 Display 面后折叠：折叠必须同时收起二级面（与 3D 同语义）
    await wrapper.get('[data-test="pb-secondary-entry"]').trigger('click')
    await flushPromises()
    expect(wrapper.vm.displayOpened()).toBe(true)
    await toggle().trigger('click')
    await flushPromises()
    expect(toggle().attributes('aria-expanded')).toBe('false')
    expect(content().attributes('style')).toContain('display: none')
    expect(wrapper.vm.displayOpened()).toBe(false)
    // 折叠时 aria-controls 指向仍在 DOM 的传输内容（可达恢复入口）
    expect(content().attributes('id')).toBe(toggle().attributes('aria-controls'))
    // 恢复：内容回来了，播放时间不变
    const time = wrapper.vm.currentTime
    await toggle().trigger('click')
    await flushPromises()
    expect(toggle().attributes('aria-expanded')).toBe('true')
    expect(content().attributes('style') || '').not.toContain('display: none')
    expect(wrapper.vm.currentTime).toBe(time)
  })

  it('名册浮层收纳/展开不改变选中与时间；手机横屏默认收纳', async () => {
    stubRaf()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    expect(wrapper.find('[data-test="pb-team-lane-left"]').exists()).toBe(true)
    expect(wrapper.classes()).toContain('pb-roster-lanes')
    await wrapper.get('[data-test="pb-marker-1001"]').trigger('click', { clientX: 0, clientY: 0 })
    const time = wrapper.vm.currentTime
    const selected = wrapper.getComponent({ name: 'BattleMap' }).props('selectedAccountId')
    const entry = () => wrapper.get('[data-test="pb-roster-entry"]')
    expect(entry().attributes('aria-pressed')).toBe('true')
    await entry().trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test="pb-team-lane-left"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="pb-team-lane-right"]').exists()).toBe(false)
    expect(wrapper.classes()).not.toContain('pb-roster-lanes')
    expect(entry().attributes('aria-pressed')).toBe('false')
    expect(wrapper.vm.currentTime).toBe(time)
    expect(wrapper.getComponent({ name: 'BattleMap' }).props('selectedAccountId')).toBe(selected)
    await entry().trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test="pb-team-lane-left"]').exists()).toBe(true)
    expect(wrapper.getComponent({ name: 'BattleMap' }).props('selectedAccountId')).toBe(selected)
  })

  it('手机横屏（phoneLandscape）默认收纳名册浮层，入口仍是传输条上的 roster 按钮', async () => {
    stubRaf()
    vi.stubGlobal('innerWidth', 844)
    const mql = (query) => ({
      matches: query === PLAYBACK_MOBILE_QUERY,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })
    vi.stubGlobal('matchMedia', mql)
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    expect(wrapper.classes()).toContain('pb-phone-landscape')
    expect(wrapper.find('[data-test="pb-team-lane-left"]').exists()).toBe(false)
    expect(wrapper.get('[data-test="pb-roster-entry"]').attributes('aria-pressed')).toBe('false')
    await wrapper.get('[data-test="pb-roster-entry"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test="pb-team-lane-left"]').exists()).toBe(true)
    expect(wrapper.get('[data-test="pb-roster-entry"]').attributes('aria-pressed')).toBe('true')
  })
})


describe('2D 自动全屏（Android 手机 App）：退出不打断回放', () => {
  const file = new File(['x'], 'a.wotbreplay')
  function installFullscreen() {
    const state = { request: 0, exit: 0 }
    Element.prototype.requestFullscreen = vi.fn(async function () {
      state.request++
      Object.defineProperty(document, 'fullscreenElement', { value: this, configurable: true, writable: true })
      document.dispatchEvent(new Event('fullscreenchange'))
    })
    document.exitFullscreen = vi.fn(async () => {
      state.exit++
      Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true, writable: true })
      document.dispatchEvent(new Event('fullscreenchange'))
    })
    Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true, writable: true })
    return state
  }
  afterEach(() => {
    delete Element.prototype.requestFullscreen
    delete document.exitFullscreen
    delete document.fullscreenElement
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('挂载即成功就绪：自动进入一次；退出后时间 / 播放态 / 选中 / 组件实例保持且不重入', async () => {
    vi.stubGlobal('requestAnimationFrame', () => 0)
    vi.stubGlobal('cancelAnimationFrame', () => {})
    vi.stubGlobal('matchMedia', (query) => ({ matches: query === PLAYBACK_MOBILE_QUERY, media: query, addEventListener() {}, removeEventListener() {} }))
    const fs = installFullscreen()
    const wrapper = mountBattlePlayback({ overview: makeOverview(), seekTo: 12, playbackV2: makePlaybackV2(), autoFullscreen: { token: 1, key: file }, active: true })
    await flushPromises()
    await vi.waitFor(() => expect(fs.request).toBe(1))
    await flushPromises()
    const root = wrapper.find('[data-test="battle-playback"]').element
    expect(document.fullscreenElement).toBe(root)

    await wrapper.find('.pb-range').setValue(12)
    await wrapper.find('[data-test="pb-marker-1001"]').trigger('click', { clientX: 0, clientY: 0 })
    await flushPromises()
    const before = {
      time: wrapper.find('.pb-time').text(),
      playLabel: wrapper.get('[data-test="pb-play"]').attributes('aria-label'),
      info: wrapper.find('[data-test="pb-info"]').text(),
    }
    // 退出按钮与 Back/系统手势最终都是 fullscreenchange(null)
    await document.exitFullscreen()
    await flushPromises()
    expect(wrapper.find('[data-test="battle-playback"]').element).toBe(root)
    expect(wrapper.find('.pb-time').text()).toBe(before.time)
    expect(wrapper.get('[data-test="pb-play"]').attributes('aria-label')).toBe(before.playLabel)
    expect(wrapper.find('[data-test="pb-info"]').text()).toBe(before.info)
    expect(fs.request).toBe(1)
    await wrapper.setProps({ seekTo: 12 })
    await flushPromises()
    expect(fs.request).toBe(1)
    // 新的进入事件才会再次自动进入
    await wrapper.setProps({ autoFullscreen: { token: 2, key: file } })
    await vi.waitFor(() => expect(fs.request).toBe(2))
    wrapper.unmount()
  })

  describe('请求挂起期间失活：迟到的完成必须立刻交还全屏，且不留方向锁', () => {
    function deferredFullscreen() {
      let release
      const gate = new Promise((resolve) => { release = resolve })
      const exit = vi.fn(async () => {
        Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true, writable: true })
        document.dispatchEvent(new Event('fullscreenchange'))
      })
      Element.prototype.requestFullscreen = vi.fn(async function () {
        await gate
        Object.defineProperty(document, 'fullscreenElement', { value: this, configurable: true, writable: true })
        document.dispatchEvent(new Event('fullscreenchange'))
      })
      document.exitFullscreen = exit
      Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true, writable: true })
      const lock = vi.fn(async () => {})
      vi.stubGlobal('screen', { orientation: { lock, unlock: vi.fn() } })
      return { release, exit, lock }
    }
    const phoneMedia = () => vi.stubGlobal('matchMedia', (query) => ({ matches: query === PLAYBACK_MOBILE_QUERY, media: query, addEventListener() {}, removeEventListener() {} }))

    it('切走能力（props.active=false）后请求才完成：旧 2D 根立刻退出全屏，不锁方向', async () => {
      vi.stubGlobal('requestAnimationFrame', () => 0)
      vi.stubGlobal('cancelAnimationFrame', () => {})
      phoneMedia()
      const fs = deferredFullscreen()
      const wrapper = mountBattlePlayback({ overview: makeOverview(), seekTo: 12, playbackV2: makePlaybackV2(), autoFullscreen: { token: 1, key: file }, active: true })
      await flushPromises()
      await vi.waitFor(() => expect(Element.prototype.requestFullscreen).toHaveBeenCalledTimes(1))
      await wrapper.setProps({ active: false })
      fs.release()
      await flushPromises()
      expect(document.fullscreenElement).toBeNull()
      expect(fs.exit).toHaveBeenCalledTimes(1)
      expect(fs.lock).not.toHaveBeenCalled()
      wrapper.unmount()
    })

    it('KeepAlive 停用后请求才完成：同样交还全屏；重新激活不会自动重入', async () => {
      vi.stubGlobal('requestAnimationFrame', () => 0)
      vi.stubGlobal('cancelAnimationFrame', () => {})
      phoneMedia()
      const fs = deferredFullscreen()
      const show = ref(true)
      const Host = defineComponent({
        setup: () => () => h(KeepAlive, null, show.value
          ? [h(BattlePlayback, { overview: makeOverview(), seekTo: 12, playbackV2: makePlaybackV2(), autoFullscreen: { token: 1, key: file }, active: true })]
          : []),
      })
      const wrapper = mount(Host, { attachTo: document.body, global: { mocks: { $t: i18n.t } } })
      await flushPromises()
      await vi.waitFor(() => expect(Element.prototype.requestFullscreen).toHaveBeenCalledTimes(1))
      show.value = false
      await flushPromises()
      fs.release()
      await flushPromises()
      expect(document.fullscreenElement).toBeNull()
      expect(fs.lock).not.toHaveBeenCalled()
      show.value = true
      await flushPromises()
      expect(Element.prototype.requestFullscreen).toHaveBeenCalledTimes(1)
      wrapper.unmount()
    })
  })
})

