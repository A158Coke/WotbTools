// @vitest-environment happy-dom

import { flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBattleMapTestFixtures } from '../test/BattleMapTestHelpers.js'
import { makeOverview, makePlaybackV2, mountPlayback, stubRaf } from './playbackTestHarness.js'
import { playbackTracerColor } from '../data/mapTeamColors.js'
import { activeTerrainRelief, createTerrainReliefModel } from '../utils/terrainReliefProjection.js'

const { baseProps, mountMap } = createBattleMapTestFixtures()

afterEach(() => {
  activeTerrainRelief.value = null
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('vehicle marker presentation', () => {
  it('renders two-layer tank markers with independent hull/turret rotation', async () => {
    stubRaf()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    const friendly = wrapper.find('[data-test="pb-marker-1001"]')
    expect(friendly.findAll('img')).toHaveLength(2)
    expect(friendly.findAll('img')[0].attributes('src')).toContain('tank-marker-friendly-hull')
    expect(friendly.findAll('img')[1].attributes('src')).toContain('tank-marker-friendly-turret')
    expect(friendly.findAll('img')[0].attributes('style')).toContain('rotate(18deg)')
    expect(friendly.findAll('img')[1].attributes('style')).toContain('rotate(24deg)')
    const enemy = wrapper.find('[data-test="pb-marker-2001"]')
    expect(enemy.findAll('img')).toHaveLength(2)
    expect(enemy.findAll('img')[0].attributes('src')).toContain('tank-marker-enemy-hull')
    expect(enemy.findAll('img')[1].attributes('src')).toContain('tank-marker-enemy-turret')
  })

  it('hides never-observed enemies while keeping recorder/selected overlays separate', async () => {
    stubRaf()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    expect(wrapper.find('[data-test="pb-marker-2002"]').exists()).toBe(false)
    const recorder = wrapper.find('[data-test="pb-marker-1001"]')
    expect(recorder.find('.pb-recorder-badge').exists()).toBe(true)
    await recorder.trigger('click')
    expect(recorder.find('.pb-selected-mark').exists()).toBe(true)
  })

  it('renders team HP bars from the authoritative playback timeline', async () => {
    stubRaf()
    const overview = makeOverview()
    const ds = makePlaybackV2()
    ds.vehicles[0].healthTransitions = [
      { timeSec: 0, currentHp: 3000, knowledge: 'CURRENT', displayCapacityHp: 3000, source: 'EXACT_BATTLE_EVENT' },
      { timeSec: 12, currentHp: 2600, knowledge: 'CURRENT', displayCapacityHp: 3000, source: 'EXACT_BATTLE_EVENT' },
    ]
    ds.vehicles[1].healthTransitions = [
      { timeSec: 10, currentHp: 2600, knowledge: 'CURRENT', displayCapacityHp: 2600, source: 'EXACT_BATTLE_EVENT' },
      { timeSec: 12, currentHp: 2200, knowledge: 'CURRENT', displayCapacityHp: 2600, source: 'EXACT_BATTLE_EVENT' },
    ]
    const wrapper = mountPlayback(overview, 12, ds)
    await flushPromises()
    expect(wrapper.find('[data-test="pb-hp-bars"]').text()).toContain('2600')
    expect(wrapper.find('[data-test="pb-hp-bars"]').text()).toContain('2200')
  })

  it('keeps tank markers map-scaled while labels stay screen-sized', async () => {
    stubRaf()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    await wrapper.find('[data-test="pb-map"]').trigger('wheel', { ctrlKey: true, deltaY: -120 })
    await flushPromises()
    const marker = wrapper.find('[data-test="pb-marker-1001"]')
    expect(marker.attributes('style')).toContain('scale(1.2)')
    expect(marker.find('.pb-presentation').attributes('style')).toContain('scale(0.833')
  })

  it('updates supremacy points from realtime samples when seeking', async () => {
    stubRaf()
    const overview = makeOverview()
    const ds = makePlaybackV2()
    ds.pointsSamples = [
      { timeSec: 10, team: 1, points: 300 },
      { timeSec: 10, team: 2, points: 300 },
      { timeSec: 20, team: 1, points: 500 },
      { timeSec: 20, team: 2, points: 280 },
    ]
    const wrapper = mountPlayback(overview, 12, ds)
    await flushPromises()
    expect(wrapper.find('[data-test="pb-points-friendly"]').text()).toContain('300')
    await wrapper.find('.pb-range').setValue(20)
    await flushPromises()
    expect(wrapper.find('[data-test="pb-points-friendly"]').text()).toContain('500')
    expect(wrapper.find('[data-test="pb-points-enemy"]').text()).toContain('280')
  })
})

describe('vehicle-aware vehicle markers', () => {
  function parseMarkerScale(style) {
    const m = style.match(/scale\(([-\d.]+)\)/)
    return m ? Number(m[1]) : null
  }

  function viewportScale(wrapper) {
    const m = wrapper.find('[data-test="pb-viewport"]').attributes('style').match(/width: ([-\d.]+)%/)
    return Number(m[1]) / 100
  }

  it('marker scales with the map (no counter-scale) while the name overlay counter-scales to stay constant', async () => {
    stubRaf()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    const marker = wrapper.find('[data-test="pb-marker-1001"]')
    // 1×：标记自身保持 1×
    expect(parseMarkerScale(marker.attributes('style'))).toBe(1)
    // 2× → 4×（wheel）：camera content 改为 layout 放大，marker 保留自身同比缩放，名称按 1/view.scale 反缩放
    for (let i = 0; i < 14; i++) {
      await wrapper.find('[data-test="pb-map"]').trigger('wheel', { ctrlKey: true, deltaY: -120, clientX: 0, clientY: 0 })
    }
    expect(viewportScale(wrapper)).toBe(4)
    expect(parseMarkerScale(marker.attributes('style'))).toBe(4)
    // 反缩放宿主是 .pb-presentation（标签呈现层已抽成共享组件 PlaybackVehicleLabel.vue）
    expect(marker.find('.pb-presentation').attributes('style')).toContain('scale(0.25)')
  })

  it('zoom 下 selected→name gap 与 recorder→vehicle 恒定；浮动幅度恒 ≈2px（1×/≈2×/4×）', async () => {
    stubRaf()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    await wrapper.find('[data-test="pb-marker-1001"]').trigger('click')
    const readOffset = (sel) => {
      const style = wrapper.find(sel).attributes('style') || ''
      const m = style.match(/calc\(100% \+ (-?[\d.]+)px\)/)
      return m ? Number(m[1]) : null
    }
    const readInv = () => {
      const style = wrapper.find('.pb-selected-mark').attributes('style') || ''
      const m = style.match(/--pb-overlay-inv: ([\d.]+)/)
      return m ? Number(m[1]) : null
    }
    // 三角偏移 = 名称块屏幕常量偏移(62) + 三角自身反缩放（见 VehicleMarker 内的实测说明）。
    // 这里锁定：偏移按 overlayInverse 反缩放、恒为正（三角不落进标签块）、recorder 与车身恒 5px。
    const HALF = 4.5
    const BLOCK_SCREEN_TOP = 62
    const NAME_GAP = 3
    const selectedOffset = (inv) => NAME_GAP + HALF + (BLOCK_SCREEN_TOP - HALF) * inv
    const check = () => {
      const currentScale = viewportScale(wrapper)
      const x = readOffset('.pb-selected-mark')
      const r = readOffset('.pb-recorder-badge')
      const inv = readInv()
      expect(x).toBeTruthy()
      expect(r).toBeTruthy()
      expect(inv).toBeTruthy()
      // 偏移随 inv 反缩放，且恒为正 → 三角始终在名称块之上
      expect(x).toBeCloseTo(selectedOffset(inv), 6)
      expect(x).toBeGreaterThan(0)
      // recorder → vehicle 恒 5px
      expect(r * currentScale).toBeCloseTo(5, 6)
      // 浮动幅度 = 2px × inv × s = 2px（inv = 1/s）
      expect(inv * currentScale).toBeCloseTo(1, 6)
    }
    // 1×：三角偏移 = 3 + 4.5 + 57.5 = 65（真实 Chrome 实测值）/ recorder 5px
    expect(viewportScale(wrapper)).toBe(1)
    expect(readOffset('.pb-selected-mark')).toBe(selectedOffset(1))
    expect(readOffset('.pb-recorder-badge')).toBe(5)
    check()
    // ≈2×（1.2^4 ≈ 2.07）
    for (let i = 0; i < 4; i++) {
      await wrapper.find('[data-test="pb-map"]').trigger('wheel', { ctrlKey: true, deltaY: -120, clientX: 0, clientY: 0 })
    }
    expect(viewportScale(wrapper)).toBeGreaterThan(1.9)
    check()
    // 4×（钳制）
    for (let i = 0; i < 12; i++) {
      await wrapper.find('[data-test="pb-map"]').trigger('wheel', { ctrlKey: true, deltaY: -120, clientX: 0, clientY: 0 })
    }
    expect(viewportScale(wrapper)).toBe(4)
    check()
  })

  it('marker map-coordinate anchor and child rotation/overlays survive zooming', async () => {
    stubRaf()
    const overview = makeOverview()
    const dataset = makePlaybackV2()
    dataset.vehicles[0].lifeTransitions = [{ timeSec: 30, lifeState: 'DESTROYED', destroyedKnownAtSec: 30 }]
    const wrapper = mountPlayback(overview, 40, dataset)
    await flushPromises()
    const marker = wrapper.find('[data-test="pb-marker-1001"]')
    const leftTopBefore = marker.attributes('style').match(/left: ([^;]+); top: ([^;]+);/).slice(1, 3)
    const hullRotateBefore = marker.findAll('img')[0].attributes('style')
    const turretRotateBefore = marker.findAll('img')[1].attributes('style')
    expect(marker.classes()).toContain('pb-destroyed')
    expect(marker.find('.pb-death').exists()).toBe(true)
    for (let i = 0; i < 4; i++) {
      await wrapper.find('[data-test="pb-map"]').trigger('wheel', { ctrlKey: true, deltaY: -120, clientX: 0, clientY: 0 })
    }
    const leftTopAfter = marker.attributes('style').match(/left: ([^;]+); top: ([^;]+);/).slice(1, 3)
    expect(leftTopAfter).toEqual(leftTopBefore) // 中心仍锚定同一地图坐标
    expect(marker.findAll('img')[0].attributes('style')).toBe(hullRotateBefore) // 旋转不被反缩放覆盖
    expect(marker.findAll('img')[1].attributes('style')).toBe(turretRotateBefore)
    expect(marker.find('.pb-death').exists()).toBe(true) // ✕ 随标记保持固定屏幕尺寸（同一结构）
  })
})

describe('fixed-size strokes and always-visible tank name labels', () => {
  it('laser glow and core stroke widths stay constant on screen at any zoom', async () => {
    stubRaf()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    // 1×：深色衬底 10px / 外层光晕 6px / 内芯 1.75px（逐元素绑定，屏幕宽度恒定）
    expect(wrapper.find('.pb-tracer-casing').attributes('stroke-width')).toBe('10')
    expect(wrapper.find('.pb-tracer').attributes('stroke-width')).toBe('6')
    expect(wrapper.find('.pb-tracer-core').attributes('stroke-width')).toBe('1.75')
    for (let i = 0; i < 12; i++) {
      await wrapper.find('[data-test="pb-map"]').trigger('wheel', { ctrlKey: true, deltaY: -120, clientX: 0, clientY: 0 })
    }
    // 4×：除以 view.scale 保持屏幕宽度（长度仍随地图坐标缩放）
    expect(wrapper.find('.pb-tracer-casing').attributes('stroke-width')).toBe('2.5')
    expect(wrapper.find('.pb-tracer').attributes('stroke-width')).toBe('1.5')
    expect(wrapper.find('.pb-tracer-core').attributes('stroke-width')).toBe('0.4375')
  })

  it('renders laser layers (dark casing + glow + white core + impact flash) with flash expanding', async () => {
    stubRaf()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    // 命中瞬间四层齐全：深色衬底、光晕（阵营色）、内芯（亮白）、命中闪光圆点
    expect(wrapper.findAll('.pb-tracer-casing')).toHaveLength(1)
    expect(wrapper.findAll('.pb-tracer')).toHaveLength(1)
    expect(wrapper.findAll('.pb-tracer-core')).toHaveLength(1)
    expect(wrapper.findAll('.pb-tracer-flash')).toHaveLength(1)
    // 光晕描边来自共享 tracer variant（射击者 1001 为友军）；衬底来自中性底板墨色 SSOT
    expect(wrapper.find('.pb-tracer').attributes('stroke')).toBe(playbackTracerColor(true))
    expect(wrapper.find('.pb-tracer-casing').attributes('stroke')).toBe('var(--color-on-team-neutral)')
    const core = wrapper.find('.pb-tracer-core')
    expect(core.attributes('stroke')).toBe('#fff')
    expect(core.attributes('opacity')).toBe('1')
    const flash = wrapper.find('.pb-tracer-flash')
    expect(flash.attributes('cx')).toBeTruthy()
    expect(flash.attributes('r')).toBe('3') // flashProgress=0 → 起始半径 3px
    // 0.1s 后闪光扩散（flashProgress≈0.286 → r≈5.57）
    const later = mountPlayback(makeOverview(), 12.1)
    await flushPromises()
    const rLater = Number(later.find('.pb-tracer-flash').attributes('r'))
    expect(rLater).toBeGreaterThan(3)
  })

  it('colors 2D tracers from the shared recorder-relative role (enemy / unknown)', async () => {
    for (const [friendly, expected] of [[false, playbackTracerColor(false)], [null, playbackTracerColor(null)]]) {
      stubRaf()
      const ds = makePlaybackV2()
      ds.vehicles[0].friendly = friendly
      const wrapper = mountPlayback(makeOverview(), 12, ds)
      await flushPromises()
      expect(wrapper.find('.pb-tracer').attributes('stroke')).toBe(expected)
      wrapper.unmount()
    }
  })

  it('marker images keep center-pivot rotation with the visible-body scale', async () => {
    stubRaf()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    const imgs = wrapper.find('[data-test="pb-marker-1001"]').findAll('img')
    expect(imgs.length).toBe(2)
    for (const img of imgs) {
      const style = img.attributes('style')
      expect(style).toContain('translate(-50%, -50%)') // 以素材共同 pivot 居中（vehicle-aware marker box）
      expect(style).toContain('rotate(')
    }
  })

  it('tank name label is always visible above every marker at any zoom', async () => {
    stubRaf()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    // 1× 即常显（不再依赖 ≥2× 缩放）
    const labels = wrapper.findAll('.pb-labels')
    expect(labels.length).toBe(2) // 两辆可见车都显示标签
    expect(labels[0].text()).toContain('Maus')
    expect(labels[1].text()).toContain('T49')
    // 标签块位于图标上方（bottom: calc(100% + 2px)），自身反缩放（overlayInverseScale）→ 屏幕字号恒定
    // 反缩放宿主是 .pb-presentation（呈现层已抽成共享组件）
    for (const presentation of wrapper.findAll('.pb-presentation')) {
      expect(presentation.attributes('style')).toContain('scale(')
    }
    const firstStyle = wrapper.find('.pb-vehicle').attributes('style')
    expect(firstStyle).toContain('scale(1)') // marker 自身保留缩放，避免 layout camera 改变其屏幕尺寸
    for (let i = 0; i < 12; i++) { // 1× → 4×
      await wrapper.find('[data-test="pb-map"]').trigger('wheel', { ctrlKey: true, deltaY: -120, clientX: 0, clientY: 0 })
    }
    expect(wrapper.findAll('.pb-labels').length).toBe(2)
  })

  it('no route polylines are rendered in the playback view', async () => {
    stubRaf()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    expect(wrapper.find('.pb-routes').exists()).toBe(false)
    expect(wrapper.findAll('.pb-route')).toHaveLength(0)
  })
})


describe('marker anchors', () => {
  it('标记严格落在真实位置：忽略任何残留 presentationOffset，且不画虚线引导线', () => {
    // 2026-10-16 用户裁定：删除防重叠位移与虚线引导线——车体必须落在真实位置
    //（密集处允许图标互相压盖），与 3D 一致（3D 从不移动车体模型）。
    activeTerrainRelief.value = createTerrainReliefModel({
      mapCode: 'test',
      worldBounds: { xMin: -100, xMax: 100, yMin: -100, yMax: 100 },
      heightRangeMeters: { min: 0, max: 1 },
      samplesPerAxis: 2,
      heights: new Float32Array([0, 0, 0, 0]),
    })
    const wrapper = mountMap({
      viewScale: 4,
      pbOverview: { ...baseProps().pbOverview, mapCode: 'test' },
      vehicleStates: [{
        vehicle: { accountId: 1, team: 1 },
        pos: { x: 0, y: 0 },
        markerStyle: { left: '50%', top: '50%' },
        // 残留字段（旧数据/旧状态）必须被忽略
        presentationOffset: { x: 20, y: -16 },
      }],
    })
    const style = wrapper.find('[data-test="marker-1"]').attributes('style')
    expect(style).not.toContain('+ 20px')
    expect(style).not.toContain('-16px')
    expect(style).toContain('50%')
    expect(wrapper.findAll('.pb-marker-leader')).toHaveLength(0)
  })

  it('无 terrain relief 时同样严格真实位置（markerStyle 原样透传）', () => {
    const wrapper = mountMap({
      vehicleStates: [{
        vehicle: { accountId: 1, team: 1 },
        pos: { x: 25, y: 30 },
        markerStyle: { left: '25%', top: '70%' },
        presentationOffset: { x: 20, y: -16 },
      }],
    })
    const style = wrapper.find('[data-test="marker-1"]').attributes('style')
    expect(style).toContain('25%')
    expect(style).toContain('70%')
    expect(wrapper.findAll('.pb-marker-leader')).toHaveLength(0)
  })
})
