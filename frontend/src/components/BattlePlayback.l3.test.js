// @vitest-environment happy-dom

/** L3：2D 回放不抢页面的滚轮与快捷键（审计 PB-04 / PB-05）。独立文件：避免其他套件残留实例的 window 监听干扰。 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import BattlePlayback from './BattlePlayback.vue'
import { makeOverview, makePlaybackV2 } from './playbackTestHarness.js'

const i18n = vi.hoisted(() => ({
  t: vi.fn(key => key)
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: i18n.t, locale: { value: 'zh' } })
}))

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

function mountBattlePlayback(props) {
  const wrapper = mount(BattlePlayback, {
    props,
    global: { mocks: { $t: i18n.t } }
  })
  mountedWrappers.push(wrapper)
  return wrapper
}

function mountPlayback(overview = makeOverview(), seekTo = null, dataset = undefined) {
  const finalDataset = dataset === undefined ? makePlaybackV2() : dataset
  return mountBattlePlayback({ overview, seekTo, playbackV2: finalDataset })
}

// 二级面统一由传输控件上的 Display（⚙）打开，面板内容再由 pb-panel-* 行切换。
async function openPanel(wrapper, name) {
  const entry = wrapper.get('[data-test="pb-secondary-entry"]')
  if (entry.attributes('aria-expanded') !== 'true') await entry.trigger('click')
  await flushPromises()
  if (name === 'display') {
    const back = wrapper.find('[data-test="pb-events-back"]')
    if (back.exists()) await back.trigger('click')
  } else {
    await wrapper.get(`[data-test="pb-panel-${name}"]`).trigger('click')
  }
  await flushPromises()
}

const mountedWrappers = []
let rafCb = null
function stubRaf() {
  vi.stubGlobal('requestAnimationFrame', (cb) => { rafCb = cb; return 1 })
  vi.stubGlobal('cancelAnimationFrame', () => {})
}

describe('L3：滚轮与快捷键不抢页面（审计 PB-04 / PB-05）', () => {
  afterEach(() => { mountedWrappers.splice(0).forEach(wrapper => wrapper.unmount()); vi.unstubAllGlobals() })
  const scaleOf = wrapper => Number(wrapper.find('[data-test="pb-viewport"]').attributes('data-view-scale'))

  it('普通滚轮不缩放、不阻止页面滚动并提示；按住 Ctrl 或先在地图上按下后才缩放', async () => {
    stubRaf()
    const wrapper = mountPlayback()
    await flushPromises()
    const map = wrapper.find('[data-test="pb-map"]')
    const before = scaleOf(wrapper)
    const plain = new WheelEvent('wheel', { deltaY: -120, clientX: 400, clientY: 300, bubbles: true, cancelable: true })
    map.element.dispatchEvent(plain)
    await flushPromises()
    expect(plain.defaultPrevented).toBe(false)
    expect(scaleOf(wrapper)).toBe(before)
    expect(wrapper.find('[data-test="pb-wheel-hint"]').exists()).toBe(true)

    await map.trigger('wheel', { ctrlKey: true, deltaY: -120, clientX: 400, clientY: 300 })
    expect(scaleOf(wrapper)).toBeGreaterThan(before)

    // 指针离开地图 → 交互结束；再次按下后普通滚轮也能缩放
    map.element.dispatchEvent(new Event('pointerleave'))
    const zoomed = scaleOf(wrapper)
    await wrapper.find('[data-test="pb-viewport"]').trigger('pointerdown', { pointerId: 7, clientX: 400, clientY: 300 })
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7 }))
    await map.trigger('wheel', { deltaY: -120, clientX: 400, clientY: 300 })
    expect(scaleOf(wrapper)).toBeGreaterThan(zoomed)
  })

  it('active=false：暂停播放，空格不再切换播放', async () => {
    stubRaf()
    const wrapper = mountPlayback()
    await flushPromises()
    await wrapper.find('[data-test="pb-play"]').trigger('click')
    expect(wrapper.find('[data-test="pb-play"]').attributes('aria-label')).toBe('recon.map.playback.pause')
    await wrapper.setProps({ active: false })
    expect(wrapper.find('[data-test="pb-play"]').attributes('aria-label')).toBe('recon.map.playback.play')
    const space = new KeyboardEvent('keydown', { key: ' ', code: 'Space', cancelable: true })
    window.dispatchEvent(space)
    await flushPromises()
    expect(space.defaultPrevented).toBe(false)
    expect(wrapper.find('[data-test="pb-play"]').attributes('aria-label')).toBe('recon.map.playback.play')
  })
})

describe('L3：名册是常驻的两侧车道（审计 BZ-13 / PB-03 + 正方形 Stage 契约）', () => {
  afterEach(() => { mountedWrappers.splice(0).forEach(wrapper => wrapper.unmount()); vi.unstubAllGlobals() })

  /** 录像者属于 Team 2 的同一份数据：friendly 标志翻转，物理队伍（team）不变。 */
  function recorderOnTeam2() {
    const dataset = makePlaybackV2()
    dataset.friendlyTeam = 2
    dataset.recorderAccountId = 2001
    dataset.vehicles = dataset.vehicles.map(v => ({ ...v, friendly: v.team === 2 }))
    return dataset
  }
  const laneIds = (wrapper, side) => wrapper.get(`[data-test="pb-team-lane-${side}"]`)
    .findAll('[data-test="pb-roster-row"]').map(row => Number(row.attributes('data-account-id')))

  it('名册按**物理队伍**分车道：左 = Team 1、右 = Team 2；点行 → 选中车辆 + 详情浮窗，名册车道不消失', async () => {
    stubRaf()
    const wrapper = mountPlayback()
    await flushPromises()
    expect(laneIds(wrapper, 'left')).toEqual([1001])
    expect(laneIds(wrapper, 'right')).toEqual([2001, 2002])
    expect(wrapper.get('[data-test="pb-team-lane-left"]').find('.pb-roster-team1').exists()).toBe(true)
    expect(wrapper.get('[data-test="pb-team-lane-right"]').find('.pb-roster-team2').exists()).toBe(true)
    // 物理车道不再用录像者视角的 friendly / enemy 分组
    expect(wrapper.find('.pb-roster-friendly').exists()).toBe(false)
    expect(wrapper.find('.pb-roster-enemy').exists()).toBe(false)
    // 三段式标记：根类由「名册开着 且 非手机竖屏」独占
    expect(wrapper.get('[data-test="battle-playback"]').classes()).toContain('pb-roster-lanes')

    await wrapper.get('[data-test="pb-team-lane-left"] [data-test="pb-roster-row"]').trigger('click')
    await flushPromises()
    // 选中不再把名册换掉：详情是 workspace 顶层的浮窗，名册**两条车道都还在**
    expect(wrapper.find('[data-test="pb-team-lane-left"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="pb-team-lane-right"]').exists()).toBe(true)
    const details = wrapper.get('[data-test="pb-info"]')
    expect(details.attributes('data-presentation')).toBe('floating')
    // 浮窗挂在**整个战场 workspace（.pb-main）**下，不在 Stage 里
    expect(details.element.parentElement).toBe(wrapper.get('[data-test="pb-main"]').element)
    // 三段式下右侧详情列**整列不存在**：详情是 workspace 顶层的浮窗、名册在两侧车道。
    expect(wrapper.find('[data-test="pb-side-panel-shell"]').exists()).toBe(false)
    expect(wrapper.get('[data-test="battle-playback"]').classes()).not.toContain('pb-details-column')
  })

  it('录像者属于 Team 2：己方 Team 2 在左、敌方 Team 1 在右，HUD 同视角', async () => {
    stubRaf()
    // HUD 是录像者视角：录像者在 Team 1 时 friendly 总血量 = Team 1（1500）
    const recorderTeam1 = mountPlayback()
    await flushPromises()
    expect(recorderTeam1.get('[data-test="pb-hp-value-friendly"]').text()).toContain('1500')
    recorderTeam1.unmount()
    mountedWrappers.splice(mountedWrappers.indexOf(recorderTeam1), 1)

    const recorderTeam2 = mountPlayback(makeOverview(), null, recorderOnTeam2())
    await flushPromises()
    // 车道位置跟随 Recorder 视角，物理队伍身份不变
    expect(laneIds(recorderTeam2, 'left')).toEqual([2001, 2002])
    expect(laneIds(recorderTeam2, 'right')).toEqual([1001])
    // 录像者换到 Team 2：friendly 总血量跟着换成 Team 2（1200），名册左右不动
    expect(recorderTeam2.get('[data-test="pb-hp-value-friendly"]').text()).toContain('1200')
    // 详情里的关系文案仍按录像者视角给出（右车道 Team 2 的车对 Team 2 录像者是己方）
    await recorderTeam2.setProps({ seekTo: 15 })
    await flushPromises()
    await recorderTeam2.get('[data-test="pb-roster-row"][data-account-id="2001"]').trigger('click')
    await flushPromises()
    expect(recorderTeam2.get('[data-test="pb-sb-team"]').text()).toBe('agentReplay.team2')
    expect(recorderTeam2.get('[data-test="pb-sb-relation"]').text()).toContain('recon.map.playback.team_friendly')
  })

  it('详情 × 只关详情：选中保留（名册行仍高亮），时间不变；再点同一台 / 另一台都重新打开同一个窗', async () => {
    stubRaf()
    const wrapper = mountPlayback()
    await flushPromises()
    // EnemyA 在 10–20s 才有位置：先 seek 到它可见的时刻
    await wrapper.setProps({ seekTo: 15 })
    await flushPromises()
    const rowOf = id => wrapper.get(`[data-test="pb-roster-row"][data-account-id="${id}"]`)
    await rowOf(2001).trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-test="pb-sb-player"]').text()).toBe('EnemyA')
    const timeBefore = wrapper.get('[data-test="pb-time"]').text()

    await wrapper.get('[data-test="pb-sb-close"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test="pb-info"]').exists()).toBe(false)
    // 选中还在：行仍是 aria-pressed / selected
    expect(rowOf(2001).attributes('aria-pressed')).toBe('true')
    expect(rowOf(2001).classes()).toContain('is-selected')
    expect(wrapper.get('[data-test="pb-time"]').text()).toBe(timeBefore)
    // 名册两条车道都还在
    expect(wrapper.find('[data-test="pb-team-lane-right"]').exists()).toBe(true)

    // 再点同一台：同一个窗重新打开
    await rowOf(2001).trigger('click')
    await flushPromises()
    expect(wrapper.findAll('[data-test="pb-info"]')).toHaveLength(1)
    expect(wrapper.get('[data-test="pb-sb-player"]').text()).toBe('EnemyA')
    // 点另一台：仍是唯一一个窗，内容换成新车
    await rowOf(1001).trigger('click')
    await flushPromises()
    expect(wrapper.findAll('[data-test="pb-info"]')).toHaveLength(1)
    expect(wrapper.get('[data-test="pb-sb-player"]').text()).toBe('You')
    expect(rowOf(1001).attributes('aria-pressed')).toBe('true')
    expect(rowOf(2001).attributes('aria-pressed')).toBe('false')
  })

  it('uiPrefs.showRoster=false：两条车道都消失，详情与选中保留；打开后名册从既有状态恢复', async () => {
    stubRaf()
    const wrapper = mountPlayback()
    await flushPromises()
    await wrapper.setProps({ seekTo: 15 })
    await flushPromises()
    await wrapper.get('[data-test="pb-roster-row"][data-account-id="2001"]').trigger('click')
    await flushPromises()
    await openPanel(wrapper, 'display')
    await wrapper.get('[data-test="pb-show-roster"]').setValue(false)
    await flushPromises()
    expect(wrapper.find('[data-test="pb-team-lane-left"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="pb-team-lane-right"]').exists()).toBe(false)
    expect(wrapper.get('[data-test="battle-playback"]').classes()).not.toContain('pb-roster-lanes')
    // 详情不依赖名册：仍开着、仍是同一台车
    expect(wrapper.get('[data-test="pb-sb-player"]').text()).toBe('EnemyA')

    // 显示分页仍开着（同一个开关），直接打开名册
    await wrapper.get('[data-test="pb-show-roster"]').setValue(true)
    await flushPromises()
    expect(wrapper.get('[data-test="pb-roster-row"][data-account-id="2001"]').attributes('aria-pressed')).toBe('true')
  })
})
