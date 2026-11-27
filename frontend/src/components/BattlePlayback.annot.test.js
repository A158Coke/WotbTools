// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import BattlePlayback from './BattlePlayback.vue'
import { createBattlePlaybackAnnotTestHarness } from '../test/BattlePlaybackAnnotTestHarness.js'
import { makeBattlePlaybackDataset } from '../test/playbackV2TestUtil'

enableAutoUnmount(afterEach)

vi.mock('../data/mapImages', () => ({
  mapImages: {
    holland: {
      src: 'molendijk.png',
      width: 766,
      height: 769,
      coordinateBounds: { xMin: -300, xMax: 300, yMin: -300, yMax: 300 }
    }
  }
}))

vi.mock('../utils/mapPalette.js', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, luminanceOfImage: vi.fn().mockResolvedValue(0.8) }
})

vi.mock('../vehicle-models/runtime.js', () => ({
  preloadBattleModels: vi.fn(async () => ({
    resolved: new Map(),
    failed: new Set(),
    byTank: new Map(),
  })),
}))

const { makeOverview, mountAnnot, dispatchPointer, setMapLayout, openAnnotations } = createBattlePlaybackAnnotTestHarness(BattlePlayback)

function viewTransformOf(wrapper) {
  const style = wrapper.find('[data-test="pb-viewport"]').attributes('style')
  const translate = style.match(/translate\((-?[\d.]+)px, (-?[\d.]+)px\)/)
  const width = style.match(/width: ([\d.]+)%/)
  if (!translate || !width) throw new Error('cannot parse viewport style: ' + style)
  return { tx: Number(translate[1]), ty: Number(translate[2]), scale: Number(width[1]) / 100 }
}

function svgToCssInverse(sx, sy, view, W, H, rw, rh) {
  return {
    x: (sx / W) * rw * view.scale + view.tx,
    y: (sy / H) * rh * view.scale + view.ty
  }
}

async function drawStroke(wrapper, points) {
  await openAnnotations(wrapper)
  const pen = wrapper.find('[data-test="pb-annot-pen"]')
  if (!pen.classes().includes('active')) await pen.trigger('click')
  const viewport = wrapper.find('[data-test="pb-viewport"]')
  await viewport.trigger('pointerdown', { pointerId: 1, clientX: points[0][0], clientY: points[0][1] })
  for (const [x, y] of points.slice(1)) {
    dispatchPointer('pointermove', { pointerId: 1, clientX: x, clientY: y })
  }
  dispatchPointer('pointerup', { pointerId: 1, clientX: points[points.length - 1][0], clientY: points[points.length - 1][1] })
  await flushPromises()
}

describe('BattlePlayback annotations', () => {
  it('renders the annotation toolbar with localized labels in zh/en/ru', async () => {
    const expected = {
      zh: ['画笔', '橡皮擦', '箭头', '直线', '矩形', '圆', '文字', '撤回', '重做', '清空'],
      en: ['Pen', 'Eraser', 'Arrow', 'Line', 'Rectangle', 'Circle', 'Text', 'Undo', 'Redo', 'Clear all'],
      ru: ['Кисть', 'Ластик', 'Стрелка', 'Линия', 'Прямоугольник', 'Круг', 'Текст', 'Отменить', 'Вернуть', 'Очистить']
    }
    for (const lang of ['zh', 'en', 'ru']) {
      const wrapper = mountAnnot(lang)
      await flushPromises()
      await openAnnotations(wrapper)
      const toolbar = wrapper.find('[data-test="pb-annot-toolbar"]')
      expect(toolbar.exists()).toBe(true)
      const text = toolbar.text()
      for (const label of expected[lang]) {
        expect(text).toContain(label)
      }
      expect(text).not.toContain('@')
      wrapper.unmount()
    }
  })

  it('draws a pen stroke that lands on the pointer (desktop responsive round-trip)', async () => {
    const wrapper = mountAnnot()
    await flushPromises()
    await openAnnotations(wrapper)
    expect(wrapper.find('[data-test="pb-annotations"] polyline').exists()).toBe(false)

    setMapLayout(wrapper, 600, 602)
    const clicks = [[300, 301], [360, 301], [420, 301]]
    await drawStroke(wrapper, clicks)
    const polyline = wrapper.find('[data-test="pb-annotations"] polyline')
    expect(polyline.exists()).toBe(true)

    const W = 766
    const H = 769
    const view = viewTransformOf(wrapper)
    const pts = polyline.attributes('points').split(' ')
    expect(pts).toHaveLength(3)
    pts.forEach((pair, i) => {
      const [sx, sy] = pair.split(',').map(Number)
      expect(sx).toBeCloseTo(clicks[i][0] * (W / 600), 2)
      expect(sy).toBeCloseTo(clicks[i][1] * (H / 602), 2)
      const back = svgToCssInverse(sx, sy, view, W, H, 600, 602)
      expect(back.x).toBeCloseTo(clicks[i][0], 4)
      expect(back.y).toBeCloseTo(clicks[i][1], 4)
    })

    await wrapper.find('[data-test="pb-annot-undo"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test="pb-annotations"] polyline').exists()).toBe(false)
    await wrapper.find('[data-test="pb-annot-redo"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test="pb-annotations"] polyline').exists()).toBe(true)
  })

  it('mobile: rendered width 360 — stroke lands on the pointer (no CSS-as-SVG bug)', async () => {
    const wrapper = mountAnnot()
    await flushPromises()
    await openAnnotations(wrapper)
    setMapLayout(wrapper, 360, 361)
    const clicks = [[180, 181], [240, 181]]
    await drawStroke(wrapper, clicks)
    const polyline = wrapper.find('[data-test="pb-annotations"] polyline')
    expect(polyline.exists()).toBe(true)
    const W = 766
    const H = 769
    const view = viewTransformOf(wrapper)
    const pts = polyline.attributes('points').split(' ')
    expect(pts).toHaveLength(2)
    pts.forEach((pair, i) => {
      const [sx, sy] = pair.split(',').map(Number)
      const back = svgToCssInverse(sx, sy, view, W, H, 360, 361)
      expect(back.x).toBeCloseTo(clicks[i][0], 2)
      expect(back.y).toBeCloseTo(clicks[i][1], 2)
    })
    const [sx] = pts[0].split(',').map(Number)
    expect(-300 + (sx / W) * 600).toBeCloseTo(0, 6)
  })

  it('zoom + pan round-trip: stroke and text input land on the pointer', async () => {
    const wrapper = mountAnnot()
    await flushPromises()
    setMapLayout(wrapper, 600, 602)
    await wrapper.find('[data-test="pb-map"]').trigger('wheel', { ctrlKey: true, clientX: 100, clientY: 100, deltaY: -100 })
    const viewport = wrapper.find('[data-test="pb-viewport"]')
    await viewport.trigger('pointerdown', { pointerId: 1, clientX: 100, clientY: 100 })
    dispatchPointer('pointermove', { pointerId: 1, clientX: 140, clientY: 130 })
    dispatchPointer('pointerup', { pointerId: 1, clientX: 140, clientY: 130 })
    await flushPromises()
    const view = viewTransformOf(wrapper)
    expect(view.scale).toBe(1.2)

    const clicks = [[200, 250], [260, 280]]
    await drawStroke(wrapper, clicks)
    const pts = wrapper.find('[data-test="pb-annotations"] polyline').attributes('points').split(' ')
    expect(pts).toHaveLength(2)
    pts.forEach((pair, i) => {
      const [sx, sy] = pair.split(',').map(Number)
      const back = svgToCssInverse(sx, sy, view, 766, 769, 600, 602)
      expect(back.x).toBeCloseTo(clicks[i][0], 2)
      expect(back.y).toBeCloseTo(clicks[i][1], 2)
    })

    await wrapper.find('[data-test="pb-annot-text"]').trigger('click')
    await viewport.trigger('pointerdown', { pointerId: 2, clientX: 200, clientY: 250 })
    await flushPromises()
    const input = wrapper.find('[data-test="pb-text-input"]')
    expect(input.exists()).toBe(true)
    const style = input.attributes('style')
    expect(Number(style.match(/left: (-?[\d.]+)px/)[1])).toBeCloseTo(200, 3)
    expect(Number(style.match(/top: (-?[\d.]+)px/)[1])).toBeCloseTo(250, 3)
  })

  it('clears all annotations with the clear button', async () => {
    const wrapper = mountAnnot()
    await flushPromises()
    await openAnnotations(wrapper)
    await drawStroke(wrapper, [[300, 300], [400, 300]])
    await wrapper.find('[data-test="pb-annot-clear"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test="pb-annotations"] polyline').exists()).toBe(false)
  })

  it('hides and shows annotations without losing them', async () => {
    const wrapper = mountAnnot()
    await flushPromises()
    await openAnnotations(wrapper)
    await drawStroke(wrapper, [[300, 300], [400, 300]])
    await wrapper.find('[data-test="pb-annot-toggle"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test="pb-annotations"]').exists()).toBe(false)
    await wrapper.find('[data-test="pb-annot-toggle"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test="pb-annotations"] polyline').exists()).toBe(true)
  })

  it('erases a pen stroke locally with the eraser', async () => {
    const wrapper = mountAnnot()
    await flushPromises()
    await openAnnotations(wrapper)
    await drawStroke(wrapper, [[300, 300], [350, 300], [400, 300]])
    expect(wrapper.find('[data-test="pb-annotations"] polyline').exists()).toBe(true)

    await wrapper.find('[data-test="pb-annot-eraser"]').trigger('click')
    const viewport = wrapper.find('[data-test="pb-viewport"]')
    await viewport.trigger('pointerdown', { pointerId: 1, clientX: 300, clientY: 300 })
    dispatchPointer('pointermove', { pointerId: 1, clientX: 350, clientY: 300 })
    dispatchPointer('pointermove', { pointerId: 1, clientX: 400, clientY: 300 })
    dispatchPointer('pointerup', { pointerId: 1, clientX: 400, clientY: 300 })
    await flushPromises()
    expect(wrapper.find('[data-test="pb-annotations"] polyline').exists()).toBe(false)
  })

  it('commits a text annotation on Enter and positions the input at the click point', async () => {
    const wrapper = mountAnnot()
    await flushPromises()
    await openAnnotations(wrapper)
    setMapLayout(wrapper, 600, 602)
    await wrapper.find('[data-test="pb-annot-text"]').trigger('click')
    const viewport = wrapper.find('[data-test="pb-viewport"]')
    await viewport.trigger('pointerdown', { pointerId: 1, clientX: 200, clientY: 150 })
    await flushPromises()
    const input = wrapper.find('[data-test="pb-text-input"]')
    expect(input.exists()).toBe(true)
    const style = input.attributes('style')
    expect(Number(style.match(/left: (-?[\d.]+)px/)[1])).toBeCloseTo(200, 3)
    expect(Number(style.match(/top: (-?[\d.]+)px/)[1])).toBeCloseTo(150, 3)
    await input.setValue('集火点')
    await input.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(wrapper.find('[data-test="pb-text-input"]').exists()).toBe(false)
    const text = wrapper.find('[data-test="pb-annotations"] text')
    expect(text.exists()).toBe(true)
    expect(text.text()).toBe('集火点')
  })

  it('resets annotations when the overview (file) changes', async () => {
    const wrapper = mountAnnot()
    await flushPromises()
    await openAnnotations(wrapper)
    await drawStroke(wrapper, [[300, 300], [400, 300]])
    expect(wrapper.find('[data-test="pb-annotations"] polyline').exists()).toBe(true)
    await wrapper.setProps({ overview: makeOverview(), playbackV2: makeBattlePlaybackDataset({ vehicles: [], events: [] }) })
    await flushPromises()
    expect(wrapper.find('[data-test="pb-annotations"] polyline').exists()).toBe(false)
  })

})
