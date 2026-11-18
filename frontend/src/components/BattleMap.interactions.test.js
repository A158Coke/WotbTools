// @vitest-environment happy-dom

import { flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBattleMapTestFixtures } from '../test/BattleMapTestHelpers.js'
import { makeOverview, makePlaybackV2, mountPlayback, stubRaf } from './playbackTestHarness.js'
import { activeTerrainRelief } from '../utils/terrainReliefProjection.js'

const { mountMap } = createBattleMapTestFixtures()

afterEach(() => {
  activeTerrainRelief.value = null
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
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
    await wrapper.find('[data-test="pb-map"]').trigger('wheel', { ctrlKey: true, deltaY: -120, clientX: 0, clientY: 0 })
    return wrapper
  }

  it('wheel zooms in/out anchored at the cursor and clamps to 1x-4x', async () => {
    const wrapper = await zoomedWrapper()
    expect(wrapper.find('[data-test="pb-viewport"]').attributes('style')).toContain('width: 120%')
    for (let i = 0; i < 12; i++) {
      await wrapper.find('[data-test="pb-map"]').trigger('wheel', { ctrlKey: true, deltaY: -120, clientX: 0, clientY: 0 })
    }
    expect(wrapper.find('[data-test="pb-viewport"]').attributes('style')).toContain('width: 400%')
    for (let i = 0; i < 20; i++) {
      await wrapper.find('[data-test="pb-map"]').trigger('wheel', { ctrlKey: true, deltaY: 120, clientX: 0, clientY: 0 })
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
    await wrapper.find('[data-test="pb-map"]').trigger('wheel', { ctrlKey: true, deltaY: -120, clientX: 110, clientY: 60 })
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
    await map.trigger('wheel', { ctrlKey: true, deltaY: -120, clientX: 110, clientY: 60 }) // → (-2,-2) scale 1.2
    await viewport.trigger('pointerdown', { pointerId: 1, clientX: 10, clientY: 10 })
    await viewport.trigger('pointermove', { pointerId: 1, clientX: 60, clientY: 30 }) // 平移 +50/+20 → (48,18)
    await viewport.trigger('pointerup', { pointerId: 1 })
    await map.trigger('wheel', { ctrlKey: true, deltaY: -120, clientX: 150, clientY: 80 }) // 屏幕锚点 (50,30)
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
      await map.trigger('wheel', { ctrlKey: true, deltaY: -120, clientX: 150, clientY: 80 })
      const t = parseTransform(viewport.attributes('style'))
      expect((50 - t.tx) / t.scale).toBeCloseTo(50, 6)
      expect((30 - t.ty) / t.scale).toBeCloseTo(30, 6)
    }
    for (let i = 0; i < 12; i++) {
      await map.trigger('wheel', { ctrlKey: true, deltaY: -120, clientX: 150, clientY: 80 })
    }
    expect(parseTransform(viewport.attributes('style')).scale).toBe(4)
    for (let i = 0; i < 30; i++) {
      await map.trigger('wheel', { ctrlKey: true, deltaY: 120, clientX: 150, clientY: 80 })
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
    await map.trigger('wheel', { ctrlKey: true, deltaY: -120, clientX: 110, clientY: 60 }) // (-2,-2) 1.2
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
    // Reset View 是次级动作：只从 Display 面可达，不再占用 primary 控件行。
    await wrapper.get('[data-test="pb-secondary-entry"]').trigger('click')
    await wrapper.get('[data-test="pb-panel-reset"]').trigger('click')
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
describe('map gesture forwarding', () => {
  it('forwards map gestures and marker selection to the orchestrator', async () => {
    const wrapper = mountMap()
    const viewport = wrapper.find('[data-test="pb-viewport"]')

    await viewport.trigger('pointerdown', { clientX: 1, clientY: 2 })
    await viewport.trigger('pointermove', { clientX: 3, clientY: 4 })
    await viewport.trigger('pointerup', { clientX: 3, clientY: 4 })
    await viewport.trigger('click')
    await wrapper.find('[data-test="marker-2"]').trigger('click')
    await wrapper.find('[data-test="pb-map"]').trigger('wheel', { ctrlKey: true, deltaY: -1 })

    expect(wrapper.emitted('pointer-down')).toHaveLength(1)
    expect(wrapper.emitted('pointer-move')).toHaveLength(1)
    expect(wrapper.emitted('pointer-up')).toHaveLength(1)
    expect(wrapper.emitted('viewport-click')).toHaveLength(2)
    expect(wrapper.emitted('marker-select')[0][0].accountId).toBe(2)
    expect(wrapper.emitted('wheel')).toHaveLength(1)
    // focused map responsibility regression matrix
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
    await wrapper.find('[data-test="pb-map"]').trigger('wheel', { ctrlKey: true, deltaY: -120, clientX: 0, clientY: 0 }) // scale>1 才可平移
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
