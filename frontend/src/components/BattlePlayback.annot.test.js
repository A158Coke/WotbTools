// @vitest-environment happy-dom

// 战局回放地图标注回归测试：工具栏渲染（三语）、画笔绘制/撤回/重做/清空、
// 橡皮擦点擦、文字标注、overview 切换重置。
import {describe, expect, it, vi} from 'vitest'
import {flushPromises, mount} from '@vue/test-utils'
import {createI18n} from 'vue-i18n'
import zh from '../locales/zh.json'
import en from '../locales/en.json'
import ru from '../locales/ru.json'
import BattlePlayback from './BattlePlayback.vue'

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

function makeOverview() {
  return {
    mapCode: 'holland',
    displayName: 'Molendijk',
    displayNames: { zh: '莫伦代克', en: 'Molendijk', ru: 'Молендейк' },
    playableBounds: { xMin: -300, xMax: 300, yMin: -300, yMax: 300 },
    friendlyTeam: 1,
    arenaBonusType: 1,
    recorderAccountId: 1001,
    gridCells: [],
    spawnPoints: [],
    routes: [],
    playback: {
      durationSec: 60,
      vehicles: [],
      events: []
    }
  }
}

function mountAnnot(lang = 'zh') {
  const i18n = createI18n({ locale: lang, fallbackLocale: 'en', messages: { zh, en, ru } })
  return mount(BattlePlayback, {
    props: { overview: makeOverview(), seekTo: null },
    global: { plugins: [i18n] }
  })
}

/** 派发 window 级指针事件（组件在 window 上监听 move/up）。 */
function dispatchPointer(type, props) {
  const ev = new Event(type)
  Object.defineProperty(ev, 'pointerId', { value: props.pointerId })
  Object.defineProperty(ev, 'clientX', { value: props.clientX })
  Object.defineProperty(ev, 'clientY', { value: props.clientY })
  window.dispatchEvent(ev)
}

/** mock .pb-map 的真实渲染尺寸（clientWidth/clientHeight，happy-dom 无布局默认 0）。 */
function setMapLayout(wrapper, width, height) {
  const el = wrapper.find('[data-test="pb-map"]').element
  Object.defineProperty(el, 'clientWidth', { value: width, configurable: true })
  Object.defineProperty(el, 'clientHeight', { value: height, configurable: true })
}

/** 从 viewport style 解析当前 view 变换（translate(tx,ty) scale(s)）。 */
function viewTransformOf(wrapper) {
  const style = wrapper.find('[data-test="pb-viewport"]').attributes('style')
  const m = style.match(/translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\(([\d.]+)\)/)
  if (!m) throw new Error('cannot parse viewport style: ' + style)
  return { tx: Number(m[1]), ty: Number(m[2]), scale: Number(m[3]) }
}

/**
 * 测试侧独立逆公式：SVG viewBox 点 → 地图容器 CSS px。
 * 不调用组件/生产代码，独立验证组件换算结果落回真实指针位置。
 */
function svgToCssInverse(sx, sy, view, W, H, rw, rh) {
  return {
    x: (sx / W) * rw * view.scale + view.tx,
    y: (sy / H) * rh * view.scale + view.ty
  }
}

/** 在战局回放地图上画一条折线：pen 工具 → down/move/up。 */
async function drawStroke(wrapper, points) {
  await wrapper.find('[data-test="pb-annot-pen"]').trigger('click')
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
    expect(wrapper.find('[data-test="pb-annotations"] polyline').exists()).toBe(false)

    // 渲染尺寸 600×602 ≠ viewBox 766×769：1 CSS px ≠ 1 SVG unit
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
    // 每个 SVG 点 = CSS px × (viewBox/渲染尺寸)，且经独立逆公式必须回到原点击位置
    pts.forEach((pair, i) => {
      const [sx, sy] = pair.split(',').map(Number)
      expect(sx).toBeCloseTo(clicks[i][0] * (W / 600), 2)
      expect(sy).toBeCloseTo(clicks[i][1] * (H / 602), 2)
      const back = svgToCssInverse(sx, sy, view, W, H, 600, 602)
      expect(back.x).toBeCloseTo(clicks[i][0], 4)
      expect(back.y).toBeCloseTo(clicks[i][1], 4)
    })

    // undo / redo 仍正常
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
      // toFixed(2) 存储引入亚像素误差（<0.005px），容差 0.005
      expect(back.x).toBeCloseTo(clicks[i][0], 2)
      expect(back.y).toBeCloseTo(clicks[i][1], 2)
    })
    // 中心点击的语义 x 必须为 0（旧实现 fromX(180) ≈ -159 的回归防护）
    const [sx] = pts[0].split(',').map(Number)
    expect(-300 + (sx / W) * 600).toBeCloseTo(0, 6)
  })

  it('zoom + pan round-trip: stroke and text input land on the pointer', async () => {
    const wrapper = mountAnnot()
    await flushPromises()
    setMapLayout(wrapper, 600, 602)
    // 滚轮在 (100,100) 放大 ×1.2 → tx=ty=-20；拖拽 (100,100)→(140,130) 平移 +40/+30
    await wrapper.find('[data-test="pb-map"]').trigger('wheel', { clientX: 100, clientY: 100, deltaY: -100 })
    const viewport = wrapper.find('[data-test="pb-viewport"]')
    await viewport.trigger('pointerdown', { pointerId: 1, clientX: 100, clientY: 100 })
    dispatchPointer('pointermove', { pointerId: 1, clientX: 140, clientY: 130 })
    dispatchPointer('pointerup', { pointerId: 1, clientX: 140, clientY: 130 })
    await flushPromises()
    const view = viewTransformOf(wrapper)
    expect(view.scale).toBe(1.2)

    // 缩放平移后绘制：每个 SVG 点 round-trip 回原 CSS 点击位置
    const clicks = [[200, 250], [260, 280]]
    await drawStroke(wrapper, clicks)
    const pts = wrapper.find('[data-test="pb-annotations"] polyline').attributes('points').split(' ')
    expect(pts).toHaveLength(2)
    pts.forEach((pair, i) => {
      const [sx, sy] = pair.split(',').map(Number)
      const back = svgToCssInverse(sx, sy, view, 766, 769, 600, 602)
      // toFixed(2) 存储引入亚像素误差（<0.005px），容差 0.005
      expect(back.x).toBeCloseTo(clicks[i][0], 2)
      expect(back.y).toBeCloseTo(clicks[i][1], 2)
    })

    // 文字输入框 left/top 必须落在点击位置（SVG unit → CSS px → view 变换）
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
    await drawStroke(wrapper, [[300, 300], [400, 300]])
    await wrapper.find('[data-test="pb-annot-clear"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test="pb-annotations"] polyline').exists()).toBe(false)
  })

  it('hides and shows annotations without losing them', async () => {
    const wrapper = mountAnnot()
    await flushPromises()
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
    setMapLayout(wrapper, 600, 602)
    await wrapper.find('[data-test="pb-annot-text"]').trigger('click')
    const viewport = wrapper.find('[data-test="pb-viewport"]')
    await viewport.trigger('pointerdown', { pointerId: 1, clientX: 200, clientY: 150 })
    await flushPromises()
    const input = wrapper.find('[data-test="pb-text-input"]')
    expect(input.exists()).toBe(true)
    // 临时输入框必须出现在点击位置（SVG unit 经渲染尺寸比例 + view 变换）
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
    await drawStroke(wrapper, [[300, 300], [400, 300]])
    expect(wrapper.find('[data-test="pb-annotations"] polyline').exists()).toBe(true)
    await wrapper.setProps({ overview: makeOverview() })
    await flushPromises()
    expect(wrapper.find('[data-test="pb-annotations"] polyline').exists()).toBe(false)
  })

  it('keeps browsing interactions intact when no tool is active', async () => {
    const wrapper = mountAnnot()
    await flushPromises()
    // 现有行为：scale≤1 时平移复位（clampViewPan），先滚轮放大到 1.2 再拖拽平移
    await wrapper.find('[data-test="pb-map"]').trigger('wheel', { clientX: 100, clientY: 100, deltaY: -100 })
    const viewport = wrapper.find('[data-test="pb-viewport"]')
    await viewport.trigger('pointerdown', { pointerId: 1, clientX: 100, clientY: 100 })
    dispatchPointer('pointermove', { pointerId: 1, clientX: 150, clientY: 150 })
    dispatchPointer('pointerup', { pointerId: 1, clientX: 150, clientY: 150 })
    await flushPromises()
    // 未选工具：缩放 + 平移照常发生，且不产生标注
    expect(wrapper.find('[data-test="pb-annotations"] polyline').exists()).toBe(false)
    const style = wrapper.find('[data-test="pb-viewport"]').attributes('style')
    // 缩放锚点 (100,100) 把 tx/ty 推到 -20，再拖 50px → 30px
    expect(style).toContain('translate(30px, 30px)')
    expect(style).toContain('scale(1.2)')
  })
})
