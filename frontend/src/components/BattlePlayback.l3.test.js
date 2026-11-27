// @vitest-environment happy-dom


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
    expect(wrapper.find('.pb-roster-friendly').exists()).toBe(false)
    expect(wrapper.find('.pb-roster-enemy').exists()).toBe(false)
    expect(wrapper.get('[data-test="battle-playback"]').classes()).toContain('pb-roster-lanes')

    await wrapper.get('[data-test="pb-team-lane-left"] [data-test="pb-roster-row"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test="pb-team-lane-left"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="pb-team-lane-right"]').exists()).toBe(true)
    const details = wrapper.get('[data-test="pb-info"]')
    expect(details.attributes('data-presentation')).toBe('floating')
    expect(details.element.parentElement).toBe(wrapper.get('[data-test="pb-main"]').element)
    expect(wrapper.get('[data-test="battle-playback"]').classes()).not.toContain('pb-details-column')
  })

  it('录像者属于 Team 2：己方 Team 2 在左、敌方 Team 1 在右，HUD 同视角', async () => {
    stubRaf()
    const recorderTeam1 = mountPlayback()
    await flushPromises()
    expect(recorderTeam1.get('[data-test="pb-hp-value-friendly"]').text()).toContain('1500')
    recorderTeam1.unmount()
    mountedWrappers.splice(mountedWrappers.indexOf(recorderTeam1), 1)

    const recorderTeam2 = mountPlayback(makeOverview(), null, recorderOnTeam2())
    await flushPromises()
    expect(laneIds(recorderTeam2, 'left')).toEqual([2001, 2002])
    expect(laneIds(recorderTeam2, 'right')).toEqual([1001])
    expect(recorderTeam2.get('[data-test="pb-hp-value-friendly"]').text()).toContain('1200')
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
    expect(rowOf(2001).attributes('aria-pressed')).toBe('true')
    expect(rowOf(2001).classes()).toContain('is-selected')
    expect(wrapper.get('[data-test="pb-time"]').text()).toBe(timeBefore)
    expect(wrapper.find('[data-test="pb-team-lane-right"]').exists()).toBe(true)

    await rowOf(2001).trigger('click')
    await flushPromises()
    expect(wrapper.findAll('[data-test="pb-info"]')).toHaveLength(1)
    expect(wrapper.get('[data-test="pb-sb-player"]').text()).toBe('EnemyA')
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
    expect(wrapper.get('[data-test="pb-sb-player"]').text()).toBe('EnemyA')

    await wrapper.get('[data-test="pb-show-roster"]').setValue(true)
    await flushPromises()
    expect(wrapper.get('[data-test="pb-roster-row"][data-account-id="2001"]').attributes('aria-pressed')).toBe('true')
  })
})
