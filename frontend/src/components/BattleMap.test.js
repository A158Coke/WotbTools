// @vitest-environment happy-dom

import { defineComponent, h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import BattleMap from './BattleMap.vue'
import { makeOverview, makePlaybackV2, mountPlayback, stubRaf } from './playbackTestHarness.js'
import { activeTerrainRelief, createTerrainReliefModel } from '../utils/terrainReliefProjection.js'

const markerStub = defineComponent({
  props: ['marker', 'selected', 'label', 'hp', 'hpVisible', 't', 'hpGhost', 'hpFlash', 'hpNoTransition'],
  emits: ['select'],
  setup(props, { emit }) {
    return () => h('button', {
      'data-test': `marker-${props.marker.vehicle.accountId}`,
      'data-selected': String(props.selected),
      style: props.marker?.markerStyle || {},
      onClick: event => emit('select', event),
    })
  },
})

const mapView = {
  W: 100,
  H: 100,
  toX: value => value,
  toY: value => 100 - value,
  fromX: value => value,
  fromY: value => 100 - value,
}

const baseProps = () => ({
  image: { src: '/map.png' },
  mapView,
  pbOverview: {
    playableBounds: { xMin: -20, xMax: 20, yMin: -20, yMax: 20 },
    spawnPoints: [{ name: 'spawn', x: 4, y: 5, team: 1 }],
  },
  friendlyTeam: 1,
  bases: [
    { baseId: 'A', x: -10, y: 10, radius: 15, status: 'friendly_controlled' },
    { baseId: 'B', x: 10, y: -10, radius: 15, status: 'capturing' },
  ],
  visibleTracers: [{ timeSec: 2, hasLine: true, x1: 1, y1: 2, x2: 5, y2: 6, attackerAccountId: 1, opacity: 1, flashProgress: 1, flashOpacity: 0 }],
  tracerColor: () => '#fff',
  renderedAnnotations: [{ type: 'text', x: 30, y: 30, text: 'Callout', color: '#fff' }],
  annotVisible: true,
  vehicleStates: [
    { vehicle: { accountId: 1, team: 1 } },
    { vehicle: { accountId: 2, team: 2 } },
  ],
  selectedAccountId: 2,
  markerLabel: () => ({ showTank: true }),
  hpFor: () => null,
  hpPrefs: { showHp: true },
  translate: key => key,
  ghostFor: () => null,
  flashFor: () => false,
  floatTeamClass: team => `team-${team}`,
})

function mountMap(overrides = {}) {
  return mount(BattleMap, {
    props: { ...baseProps(), ...overrides },
    global: { stubs: { VehicleMarker: markerStub }, mocks: { $t: key => key } },
  })
}

afterEach(() => {
  activeTerrainRelief.value = null
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('BattleMap', () => {
  it('renders the HD raster as a standalone layer and keeps SVG overlay-only', () => {
    const wrapper = mountMap()

    expect(wrapper.find('[data-test="pb-basemap"]').element.tagName).toBe('IMG')
    expect(wrapper.find('[data-test="pb-basemap"]').attributes('src')).toBe('/map.png')
    expect(wrapper.find('.pb-svg image').exists()).toBe(false)
    expect(wrapper.find('.pb-basemap').element.parentElement).toBe(wrapper.find('.pb-svg').element.parentElement)
    expect(wrapper.find('[data-test="pb-viewport"]').attributes('style')).toContain('aspect-ratio: 100 / 100')
    expect(wrapper.findAll('.pb-base-circle')).toHaveLength(2)
    expect(wrapper.find('[data-test="pb-bases"]').text()).toContain('A')
    expect(wrapper.findAll('.pb-base-friendly_controlled')).toHaveLength(1)
    expect(wrapper.findAll('.pb-base-capturing')).toHaveLength(1)
    expect(wrapper.findAll('.pb-spawn-friendly')).toHaveLength(1)
    expect(wrapper.findAll('.pb-tracer')).toHaveLength(1)
    expect(wrapper.find('[data-test="pb-annotations"]').text()).toContain('Callout')
    expect(wrapper.find('[data-test="marker-1"]').attributes('data-selected')).toBe('false')
    expect(wrapper.find('[data-test="marker-2"]').attributes('data-selected')).toBe('true')
  })

  it('keeps relief collision offsets in screen pixels with the layout-scaled camera', () => {
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
        presentationOffset: { x: 20, y: -16 },
      }],
    })

    const style = wrapper.find('[data-test="marker-1"]').attributes('style')
    expect(style).toContain('+ 20px')
    expect(style).toContain('+ -16px')
    expect(style).not.toContain('+ 5px')
    expect(style).not.toContain('+ -4px')
  })

  it('forwards map gestures and marker selection to the orchestrator', async () => {
    const wrapper = mountMap()
    const viewport = wrapper.find('[data-test="pb-viewport"]')

    await viewport.trigger('pointerdown', { clientX: 1, clientY: 2 })
    await viewport.trigger('pointermove', { clientX: 3, clientY: 4 })
    await viewport.trigger('pointerup', { clientX: 3, clientY: 4 })
    await viewport.trigger('click')
    await wrapper.find('[data-test="marker-2"]').trigger('click')
    await wrapper.find('[data-test="pb-map"]').trigger('wheel', { deltaY: -1 })

    expect(wrapper.emitted('pointer-down')).toHaveLength(1)
    expect(wrapper.emitted('pointer-move')).toHaveLength(1)
    expect(wrapper.emitted('pointer-up')).toHaveLength(1)
    expect(wrapper.emitted('viewport-click')).toHaveLength(2)
    expect(wrapper.emitted('marker-select')[0][0].accountId).toBe(2)
    expect(wrapper.emitted('wheel')).toHaveLength(1)
    // focused map responsibility regression matrix
  })
})
describe('tracer shots', () => {
  it('draws a tracer at the damage moment only within its window (seek-safe)', async () => {
    stubRaf()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    expect(wrapper.findAll('.pb-tracer').length).toBeGreaterThanOrEqual(1)
    expect(wrapper.findAll('.pb-tracer')[0].attributes('x1')).toBeTruthy()
    const before = mountPlayback(makeOverview(), 11)
    await flushPromises()
    expect(before.findAll('.pb-tracer')).toHaveLength(0)
    const after = mountPlayback(makeOverview(), 13)
    await flushPromises()
    expect(after.findAll('.pb-tracer')).toHaveLength(0)
  })

  it('dedupes a same-shot DAMAGE+KILL pair into one tracer', async () => {
    stubRaf()
    const overview = makeOverview()
    const dataset = makePlaybackV2()
    dataset.events.push({ type: 'KILL', timeSec: 12.1, accountId: 1001, targetAccountId: 2001, observedHpLoss: null })
    const wrapper = mountPlayback(overview, 12.05, dataset)
    await flushPromises()
    expect(wrapper.findAll('.pb-tracer')).toHaveLength(1)
  })
})
describe('map zoom and pan', () => {
  async function zoomedWrapper() {
    stubRaf()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    await wrapper.find('[data-test="pb-map"]').trigger('wheel', { deltaY: -120, clientX: 0, clientY: 0 })
    return wrapper
  }

  it('wheel zooms in/out anchored at the cursor and clamps to 1x-4x', async () => {
    const wrapper = await zoomedWrapper()
    expect(wrapper.find('[data-test="pb-viewport"]').attributes('style')).toContain('width: 120%')
    for (let i = 0; i < 12; i++) {
      await wrapper.find('[data-test="pb-map"]').trigger('wheel', { deltaY: -120, clientX: 0, clientY: 0 })
    }
    expect(wrapper.find('[data-test="pb-viewport"]').attributes('style')).toContain('width: 400%')
    for (let i = 0; i < 20; i++) {
      await wrapper.find('[data-test="pb-map"]').trigger('wheel', { deltaY: 120, clientX: 0, clientY: 0 })
    }
    expect(wrapper.find('[data-test="pb-viewport"]').attributes('style')).toContain('width: 100%')
  })

  it('dragging pans the viewport and suppresses the follow-up click (no accidental selection)', async () => {
    const wrapper = await zoomedWrapper()
    const viewport = wrapper.find('[data-test="pb-viewport"]')
    await viewport.trigger('pointerdown', { pointerId: 1, clientX: 10, clientY: 10 })
    await viewport.trigger('pointermove', { pointerId: 1, clientX: 60, clientY: 30 })
    expect(viewport.attributes('style')).toContain('translate(50px, 20px)')
    await viewport.trigger('pointerup', { pointerId: 1 })
    await wrapper.find('[data-test="pb-marker-1001"]').trigger('click')
    expect(wrapper.find('[data-test="pb-info"]').exists()).toBe(false)
    await viewport.trigger('pointerdown', { pointerId: 2, clientX: 0, clientY: 0 })
    await viewport.trigger('pointerup', { pointerId: 2 })
    await wrapper.find('[data-test="pb-marker-1001"]').trigger('click')
    expect(wrapper.find('[data-test="pb-info"]').exists()).toBe(true)
  })

  it('pinch with two pointers zooms around the midpoint', async () => {
    stubRaf()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    const viewport = wrapper.find('[data-test="pb-viewport"]')
    await viewport.trigger('pointerdown', { pointerId: 1, clientX: 0, clientY: 0 })
    await viewport.trigger('pointerdown', { pointerId: 2, clientX: 100, clientY: 0 })
    await viewport.trigger('pointermove', { pointerId: 2, clientX: 200, clientY: 0 })
    expect(viewport.attributes('style')).toContain('width: 200%')
    await viewport.trigger('pointerup', { pointerId: 1 })
    await viewport.trigger('pointerup', { pointerId: 2 })
  })

  function nonzeroRect() {
    return {
      left: 100,
      top: 50,
      width: 400,
      height: 300,
      right: 500,
      bottom: 350,
      x: 100,
      y: 50,
      toJSON: () => ({})
    }
  }

  it('pinch anchor uses map-local coordinates when the map is not at the viewport origin', async () => {
    stubRaf()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    wrapper.find('[data-test="pb-map"]').element.getBoundingClientRect = () => nonzeroRect()
    const viewport = wrapper.find('[data-test="pb-viewport"]')
    await viewport.trigger('pointerdown', { pointerId: 1, clientX: 110, clientY: 60 })
    await viewport.trigger('pointerdown', { pointerId: 2, clientX: 210, clientY: 60 })
    await viewport.trigger('pointermove', { pointerId: 2, clientX: 310, clientY: 60 })
    // 锚点局部 (60,10)，dist 100→200（ratio 2）：t'=anchor−anchor·2=(−60,−10)；中点位移 (50,0)
    expect(viewport.attributes('style')).toContain('translate(-10px, -10px)')
    expect(viewport.attributes('style')).toContain('width: 200%')
    await viewport.trigger('pointerup', { pointerId: 1 })
    await viewport.trigger('pointerup', { pointerId: 2 })
  })

  it('wheel zoom anchors at the cursor in screen coordinates', async () => {
    stubRaf()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    wrapper.find('[data-test="pb-map"]').element.getBoundingClientRect = () => nonzeroRect()
    await wrapper.find('[data-test="pb-map"]').trigger('wheel', { deltaY: -120, clientX: 110, clientY: 60 })
    // 屏幕锚点 (10,10)：t' = 10 − 10×1.2 = −2
    expect(wrapper.find('[data-test="pb-viewport"]').attributes('style')).toContain('translate(-2px, -2px)')
    expect(wrapper.find('[data-test="pb-viewport"]').attributes('style')).toContain('width: 120%')
  })

  function parseTransform(style) {
    const translate = style.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/)
    const width = style.match(/width: ([-\d.]+)%/)
    return translate && width
      ? { tx: Number(translate[1]), ty: Number(translate[2]), scale: Number(width[1]) / 100 }
      : null
  }

  it('wheel zoom keeps the cursor content point fixed after prior zoom and pan', async () => {
    stubRaf()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    wrapper.find('[data-test="pb-map"]').element.getBoundingClientRect = () => nonzeroRect()
    const map = wrapper.find('[data-test="pb-map"]')
    const viewport = wrapper.find('[data-test="pb-viewport"]')
    await map.trigger('wheel', { deltaY: -120, clientX: 110, clientY: 60 }) // → (-2,-2) scale 1.2
    await viewport.trigger('pointerdown', { pointerId: 1, clientX: 10, clientY: 10 })
    await viewport.trigger('pointermove', { pointerId: 1, clientX: 60, clientY: 30 }) // 平移 +50/+20 → (48,18)
    await viewport.trigger('pointerup', { pointerId: 1 })
    await map.trigger('wheel', { deltaY: -120, clientX: 150, clientY: 80 }) // 屏幕锚点 (50,30)
    const t = parseTransform(viewport.attributes('style'))
    expect(t).not.toBeNull()
    expect(t.scale).toBeCloseTo(1.44, 6)
    expect(t.tx).toBeCloseTo(47.6, 6)
    expect(t.ty).toBeCloseTo(15.6, 6)
    // 锚点内容不变式：(px − tx)/scale
    const before = { x: (50 - 48) / 1.2, y: (30 - 18) / 1.2 }
    const after = { x: (50 - t.tx) / t.scale, y: (30 - t.ty) / t.scale }
    expect(after.x).toBeCloseTo(before.x, 6)
    expect(after.y).toBeCloseTo(before.y, 6)
  })

  it('consecutive wheel zooms keep the anchor fixed at every step and clamp to 1x-4x', async () => {
    stubRaf()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    wrapper.find('[data-test="pb-map"]').element.getBoundingClientRect = () => nonzeroRect()
    const map = wrapper.find('[data-test="pb-map"]')
    const viewport = wrapper.find('[data-test="pb-viewport"]')
    // 初始 scale 1、t=0：屏幕锚点 (50,30) 即内容点
    for (let i = 0; i < 3; i++) {
      await map.trigger('wheel', { deltaY: -120, clientX: 150, clientY: 80 })
      const t = parseTransform(viewport.attributes('style'))
      expect((50 - t.tx) / t.scale).toBeCloseTo(50, 6)
      expect((30 - t.ty) / t.scale).toBeCloseTo(30, 6)
    }
    for (let i = 0; i < 12; i++) {
      await map.trigger('wheel', { deltaY: -120, clientX: 150, clientY: 80 })
    }
    expect(parseTransform(viewport.attributes('style')).scale).toBe(4)
    for (let i = 0; i < 30; i++) {
      await map.trigger('wheel', { deltaY: 120, clientX: 150, clientY: 80 })
    }
    const min = parseTransform(viewport.attributes('style'))
    expect(min.scale).toBe(1)
    expect(min.tx).toBe(0)
    expect(min.ty).toBe(0)
  })

  it('pinch keeps the mid-point content fixed after prior zoom and pan, including consecutive pinches', async () => {
    stubRaf()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    wrapper.find('[data-test="pb-map"]').element.getBoundingClientRect = () => nonzeroRect()
    const map = wrapper.find('[data-test="pb-map"]')
    const viewport = wrapper.find('[data-test="pb-viewport"]')
    await map.trigger('wheel', { deltaY: -120, clientX: 110, clientY: 60 }) // (-2,-2) 1.2
    await viewport.trigger('pointerdown', { pointerId: 9, clientX: 10, clientY: 10 })
    await viewport.trigger('pointermove', { pointerId: 9, clientX: 60, clientY: 30 }) // → (48,18) 1.2
    await viewport.trigger('pointerup', { pointerId: 9 })
    // 第一次捏合：mid 160→210、dist 100→200（ratio 2）
    await viewport.trigger('pointerdown', { pointerId: 1, clientX: 110, clientY: 60 })
    await viewport.trigger('pointerdown', { pointerId: 2, clientX: 210, clientY: 60 })
    await viewport.trigger('pointermove', { pointerId: 2, clientX: 310, clientY: 60 })
    const t = parseTransform(viewport.attributes('style'))
    expect(t.scale).toBeCloseTo(2.4, 6)
    // 不变式：捏合前 mid0 下的内容点 == 捏合后 mid1 下的内容点（手指跟随）
    const beforeMid = { x: (160 - 100 - 48) / 1.2, y: (60 - 50 - 18) / 1.2 }
    const afterMid = { x: (210 - 100 - t.tx) / t.scale, y: (60 - 50 - t.ty) / t.scale }
    expect(afterMid.x).toBeCloseTo(beforeMid.x, 6)
    expect(afterMid.y).toBeCloseTo(beforeMid.y, 6)
    await viewport.trigger('pointerup', { pointerId: 1 })
    await viewport.trigger('pointerup', { pointerId: 2 })
    // 连续第二次捏合：mid 170→210、dist 100→200，2.4×2 → clamp 4
    await viewport.trigger('pointerdown', { pointerId: 3, clientX: 120, clientY: 70 })
    await viewport.trigger('pointerdown', { pointerId: 4, clientX: 220, clientY: 70 })
    await viewport.trigger('pointermove', { pointerId: 4, clientX: 320, clientY: 70 })
    const t2 = parseTransform(viewport.attributes('style'))
    expect(t2.scale).toBe(4)
    const mid2Before = { x: (170 - 100 - t.tx) / t.scale, y: (70 - 50 - t.ty) / t.scale }
    const mid2After = { x: (220 - 100 - t2.tx) / t2.scale, y: (70 - 50 - t2.ty) / t2.scale }
    expect(mid2After.x).toBeCloseTo(mid2Before.x, 6)
    expect(mid2After.y).toBeCloseTo(mid2Before.y, 6)
    await viewport.trigger('pointerup', { pointerId: 3 })
    await viewport.trigger('pointerup', { pointerId: 4 })
  })

  it('reset restores identity view and keeps all layers on the single transform', async () => {
    const wrapper = await zoomedWrapper()
    const markerStyleBefore = wrapper.find('[data-test="pb-marker-1001"]').attributes('style')
    await wrapper.find('[data-test="pb-reset"]').trigger('click')
    const style = wrapper.find('[data-test="pb-viewport"]').attributes('style')
    expect(style).toContain('width: 100%')
    expect(style).toContain('translate(0px, 0px)')
    // 图层对齐契约：camera 只在 viewport 的 translate/width layout 上；标记 left/top（%）
    // 不随缩放变化，marker 保留自身 scale，SVG 自身无 style。
    const markerAfter = wrapper.find('[data-test="pb-marker-1001"]').attributes('style')
    const leftTop = (s) => s.match(/left: ([^;]+); top: ([^;]+);/).slice(1, 3)
    expect(leftTop(markerAfter)).toEqual(leftTop(markerStyleBefore))
    expect(markerAfter).toContain('scale(1)')
    expect(wrapper.find('.pb-svg').attributes('style')).toBeUndefined()
  })
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
    await wrapper.find('[data-test="pb-map"]').trigger('wheel', { deltaY: -120 })
    await flushPromises()
    const marker = wrapper.find('[data-test="pb-marker-1001"]')
    expect(marker.attributes('style')).toContain('scale(1.2)')
    expect(marker.find('.pb-labels').attributes('style')).toContain('scale(0.833')
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
      await wrapper.find('[data-test="pb-map"]').trigger('wheel', { deltaY: -120, clientX: 0, clientY: 0 })
    }
    expect(viewportScale(wrapper)).toBe(4)
    expect(parseMarkerScale(marker.attributes('style'))).toBe(4)
    expect(marker.find('.pb-labels').attributes('style')).toContain('scale(0.25)')
  })

  it('zoom 下 selected→name gap 与 recorder→vehicle 恒定；浮动幅度恒 ≈2px（1×/≈2×/4×）', async () => {
    stubRaf()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    await wrapper.find('[data-test="pb-marker-1001"]').trigger('click')
    const readOffset = (sel) => {
      const style = wrapper.find(sel).attributes('style') || ''
      const m = style.match(/calc\(100% \+ ([\d.]+)px\)/)
      return m ? Number(m[1]) : null
    }
    const readInv = () => {
      const style = wrapper.find('.pb-selected-mark').attributes('style') || ''
      const m = style.match(/--pb-overlay-inv: ([\d.]+)/)
      return m ? Number(m[1]) : null
    }
    // 屏幕几何（layout→screen）：三角底边 = (X + 4.5)·s − 4.5；name 顶边 = 9·s + 7（name 锚点 2px + 盒高 14px，与 .pb-name CSS 一致）
    const triBottom = (x, s) => (x + 4.5) * s - 4.5
    const nameTop = (s) => 9 * s + 7
    const check = () => {
      const s = viewportScale(wrapper)
      const x = readOffset('.pb-selected-mark')
      const r = readOffset('.pb-recorder-badge')
      const inv = readInv()
      expect(x).toBeTruthy()
      expect(r).toBeTruthy()
      expect(inv).toBeTruthy()
      // selected → name 顶边屏幕 gap 恒 3px（三角跟随 name 上移）
      expect(triBottom(x, s) - nameTop(s)).toBeCloseTo(3, 6)
      // recorder → vehicle 恒 5px
      expect(r * s).toBeCloseTo(5, 6)
      // 浮动幅度 = 2px × inv × s = 2px（inv = 1/s）
      expect(inv * s).toBeCloseTo(1, 6)
    }
    // 1×：selected 19px / recorder 5px（既有基准契约）
    expect(viewportScale(wrapper)).toBe(1)
    expect(readOffset('.pb-selected-mark')).toBe(19)
    expect(readOffset('.pb-recorder-badge')).toBe(5)
    check()
    // ≈2×（1.2^4 ≈ 2.07）
    for (let i = 0; i < 4; i++) {
      await wrapper.find('[data-test="pb-map"]').trigger('wheel', { deltaY: -120, clientX: 0, clientY: 0 })
    }
    expect(viewportScale(wrapper)).toBeGreaterThan(1.9)
    check()
    // 4×（钳制）
    for (let i = 0; i < 12; i++) {
      await wrapper.find('[data-test="pb-map"]').trigger('wheel', { deltaY: -120, clientX: 0, clientY: 0 })
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
      await wrapper.find('[data-test="pb-map"]').trigger('wheel', { deltaY: -120, clientX: 0, clientY: 0 })
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
    // 1×：外层光晕 6px / 内芯 1.75px（逐元素绑定，屏幕宽度恒定）
    expect(wrapper.find('.pb-tracer').attributes('stroke-width')).toBe('6')
    expect(wrapper.find('.pb-tracer-core').attributes('stroke-width')).toBe('1.75')
    for (let i = 0; i < 12; i++) {
      await wrapper.find('[data-test="pb-map"]').trigger('wheel', { deltaY: -120, clientX: 0, clientY: 0 })
    }
    // 4×：除以 view.scale 保持屏幕宽度（长度仍随地图坐标缩放）
    expect(wrapper.find('.pb-tracer').attributes('stroke-width')).toBe('1.5')
    expect(wrapper.find('.pb-tracer-core').attributes('stroke-width')).toBe('0.4375')
  })

  it('renders laser layers (glow + white core + impact flash) with flash expanding', async () => {
    stubRaf()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    // 命中瞬间三层齐全：光晕（阵营色）、内芯（亮白）、命中闪光圆点
    expect(wrapper.findAll('.pb-tracer')).toHaveLength(1)
    expect(wrapper.findAll('.pb-tracer-core')).toHaveLength(1)
    expect(wrapper.findAll('.pb-tracer-flash')).toHaveLength(1)
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
    for (const label of labels) {
      expect(label.attributes('style')).toContain('scale(')
    }
    const firstStyle = wrapper.find('.pb-vehicle').attributes('style')
    expect(firstStyle).toContain('scale(1)') // marker 自身保留缩放，避免 layout camera 改变其屏幕尺寸
    for (let i = 0; i < 12; i++) { // 1× → 4×
      await wrapper.find('[data-test="pb-map"]').trigger('wheel', { deltaY: -120, clientX: 0, clientY: 0 })
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
describe('gesture click suppression and pointer cleanup', () => {
  it('pinch followed by a click does not select the vehicle; next plain click does', async () => {
    stubRaf()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    const viewport = wrapper.find('[data-test="pb-viewport"]')
    await viewport.trigger('pointerdown', { pointerId: 1, clientX: 0, clientY: 0 })
    await viewport.trigger('pointerdown', { pointerId: 2, clientX: 100, clientY: 0 })
    await viewport.trigger('pointermove', { pointerId: 2, clientX: 220, clientY: 0 })
    await viewport.trigger('pointerup', { pointerId: 1 })
    await viewport.trigger('pointerup', { pointerId: 2 })
    await wrapper.find('[data-test="pb-marker-1001"]').trigger('click')
    expect(wrapper.find('[data-test="pb-info"]').exists()).toBe(false)
    await wrapper.find('[data-test="pb-marker-1001"]').trigger('click')
    expect(wrapper.find('[data-test="pb-info"]').exists()).toBe(true)
  })

  it('plain click selects and sub-threshold single-finger move is not a drag', async () => {
    stubRaf()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    const viewport = wrapper.find('[data-test="pb-viewport"]')
    await viewport.trigger('pointerdown', { pointerId: 1, clientX: 10, clientY: 10 })
    await viewport.trigger('pointermove', { pointerId: 1, clientX: 12, clientY: 12 }) // <5px
    await viewport.trigger('pointerup', { pointerId: 1 })
    await wrapper.find('[data-test="pb-marker-1001"]').trigger('click')
    expect(wrapper.find('[data-test="pb-info"]').exists()).toBe(true)
  })

  it('pointerup on window cleans state; next pan starts from a fresh baseline', async () => {
    stubRaf()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    const viewport = wrapper.find('[data-test="pb-viewport"]')
    await wrapper.find('[data-test="pb-map"]').trigger('wheel', { deltaY: -120, clientX: 0, clientY: 0 }) // scale>1 才可平移
    await viewport.trigger('pointerdown', { pointerId: 1, clientX: 10, clientY: 10 })
    await viewport.trigger('pointermove', { pointerId: 1, clientX: 60, clientY: 30 }) // pan +50/+20
    const up = new window.Event('pointerup')
    up.pointerId = 1
    window.dispatchEvent(up) // 指针移出元素后在 window 上结束
    await viewport.trigger('pointerdown', { pointerId: 2, clientX: 20, clientY: 20 })
    await viewport.trigger('pointermove', { pointerId: 2, clientX: 30, clientY: 20 })
    expect(viewport.attributes('style')).toContain('translate(60px, 20px)') // 上次 50,20 + 新位移 10,0
    await viewport.trigger('pointerup', { pointerId: 2 })
  })

  it('pinch ending with one finger left continues panning (no stuck state)', async () => {
    stubRaf()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    const viewport = wrapper.find('[data-test="pb-viewport"]')
    await viewport.trigger('pointerdown', { pointerId: 1, clientX: 0, clientY: 0 })
    await viewport.trigger('pointerdown', { pointerId: 2, clientX: 100, clientY: 0 })
    await viewport.trigger('pointermove', { pointerId: 2, clientX: 200, clientY: 0 })
    await viewport.trigger('pointerup', { pointerId: 2 }) // 剩下一根手指
    await viewport.trigger('pointermove', { pointerId: 1, clientX: 50, clientY: 30 })
    const style = viewport.attributes('style')
    expect(style).toContain('width: 200%')
    expect(style).toContain('translate(50px, 30px)')
    await viewport.trigger('pointerup', { pointerId: 1 })
  })

  it('unmount removes window listeners and pointer state', async () => {
    stubRaf()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    const removeSpy = vi.spyOn(window, 'removeEventListener')
    await wrapper.find('[data-test="pb-viewport"]').trigger('pointerdown', { pointerId: 1, clientX: 0, clientY: 0 })
    wrapper.unmount()
    expect(removeSpy).toHaveBeenCalledWith('pointermove', expect.any(Function))
    expect(removeSpy).toHaveBeenCalledWith('pointerup', expect.any(Function))
    expect(removeSpy).toHaveBeenCalledWith('pointercancel', expect.any(Function))
    removeSpy.mockRestore()
    const up = new window.Event('pointerup')
    up.pointerId = 1
    window.dispatchEvent(up)
    const move = new window.Event('pointermove')
    move.pointerId = 1
    window.dispatchEvent(move)
  })
})
