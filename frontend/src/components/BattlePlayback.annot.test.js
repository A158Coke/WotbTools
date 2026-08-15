// @vitest-environment happy-dom

// 战局回放地图标注回归测试：工具栏渲染（三语）、画笔绘制/撤回/重做/清空、
// 橡皮擦点擦、文字标注、overview 切换重置。
import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
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

  it('draws a pen stroke that appears in the annotation layer, undo removes it, redo restores it', async () => {
    const wrapper = mountAnnot()
    await flushPromises()
    expect(wrapper.find('[data-test="pb-annotations"] polyline').exists()).toBe(false)

    await drawStroke(wrapper, [[300, 300], [400, 300]])
    const polyline = wrapper.find('[data-test="pb-annotations"] polyline')
    expect(polyline.exists()).toBe(true)
    // 屏幕坐标 == SVG 坐标（scale=1, tx=ty=0）→ 点串原样
    expect(polyline.attributes('points')).toBe('300.00,300.00 400.00,300.00')

    await wrapper.find('[data-test="pb-annot-undo"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test="pb-annotations"] polyline').exists()).toBe(false)

    await wrapper.find('[data-test="pb-annot-redo"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test="pb-annotations"] polyline').exists()).toBe(true)
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

  it('commits a text annotation on Enter', async () => {
    const wrapper = mountAnnot()
    await flushPromises()
    await wrapper.find('[data-test="pb-annot-text"]').trigger('click')
    const viewport = wrapper.find('[data-test="pb-viewport"]')
    await viewport.trigger('pointerdown', { pointerId: 1, clientX: 383, clientY: 384 })
    await flushPromises()
    const input = wrapper.find('[data-test="pb-text-input"]')
    expect(input.exists()).toBe(true)
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
