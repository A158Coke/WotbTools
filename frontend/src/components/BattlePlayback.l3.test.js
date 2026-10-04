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

// 左侧二级菜单：面板内容现在由左侧导航项（pb-rail-*）打开。
async function openPanel(wrapper, name) {
  const tab = wrapper.find(`[data-test="pb-rail-${name}"]`)
  if (tab.attributes('aria-expanded') !== 'true') await tab.trigger('click')
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
    expect(wrapper.find('[data-test="pb-play"]').text()).toBe('recon.map.playback.pause')
    await wrapper.setProps({ active: false })
    expect(wrapper.find('[data-test="pb-play"]').text()).toBe('recon.map.playback.play')
    const space = new KeyboardEvent('keydown', { key: ' ', code: 'Space', cancelable: true })
    window.dispatchEvent(space)
    await flushPromises()
    expect(space.defaultPrevented).toBe(false)
    expect(wrapper.find('[data-test="pb-play"]').text()).toBe('recon.map.playback.play')
  })
})

describe('L3：名册是常驻的两侧车道（审计 BZ-13 / PB-03 + 正方形 Stage 契约）', () => {
  afterEach(() => { mountedWrappers.splice(0).forEach(wrapper => wrapper.unmount()); vi.unstubAllGlobals() })

  it('名册按 friendly/enemy 分成左右两条车道；点行 → 选中车辆 + 详情浮窗，名册车道不消失', async () => {
    stubRaf()
    const wrapper = mountPlayback()
    await flushPromises()
    const rows = wrapper.findAll('[data-test="pb-roster-row"]')
    expect(rows.length).toBeGreaterThan(1)
    // 车道结构：左 = friendly，右 = enemy，各自一个共享 PlaybackRoster
    const left = wrapper.get('[data-test="pb-team-lane-left"]')
    const right = wrapper.get('[data-test="pb-team-lane-right"]')
    expect(left.find('.pb-roster-friendly').exists()).toBe(true)
    expect(right.find('.pb-roster-enemy').exists()).toBe(true)
    // 三段式标记：根类由「名册开着 且 非手机竖屏」独占
    expect(wrapper.get('[data-test="battle-playback"]').classes()).toContain('pb-roster-lanes')

    await rows[0].trigger('click')
    await flushPromises()
    // 选中不再把名册换掉：详情是 workspace 顶层的浮窗，名册**两条车道都还在**
    expect(wrapper.find('[data-test="pb-shell-roster"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="pb-team-lane-left"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="pb-team-lane-right"]').exists()).toBe(true)
    const details = wrapper.get('[data-test="pb-info"]')
    expect(details.attributes('data-presentation')).toBe('floating')
    // 三段式下右侧详情列**整列不存在**：详情是 workspace 顶层的浮窗、名册在两侧车道，
    // 这一列没有内容可放（留着空壳会把正方形挤到第一轨里，见 playback-workspace.css）。
    expect(wrapper.find('[data-test="pb-side-panel-shell"]').exists()).toBe(false)
    expect(wrapper.get('[data-test="battle-playback"]').classes()).not.toContain('pb-details-column')
  })
})
