// @vitest-environment happy-dom

// 战局回放地图标注回归测试：工具栏渲染（三语）、画笔绘制/撤回/重做/清空、
// 橡皮擦点擦、文字标注、overview 切换重置。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import BattlePlayback from './BattlePlayback.vue'
import { createBattlePlaybackAnnotTestHarness } from '../test/BattlePlaybackAnnotTestHarness.js'

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

async function clickMap(wrapper, x, y, pointerId = 1) {
  await wrapper.get('[data-test="pb-viewport"]').trigger('pointerdown', { pointerId, clientX: x, clientY: y, pointerType: 'mouse', button: 0 })
  dispatchPointer('pointerup', { pointerId, clientX: x, clientY: y })
  await flushPromises()
}

describe('BattlePlayback annotation input lifecycle', () => {
  it('starts empty and closed; direct marking entry pauses and selects without drawing or auto-resuming', async () => {
    const wrapper = mountAnnot()
    await flushPromises()
    expect(wrapper.find('[data-test="pb-annot-toolbar"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="pb-annotation-entry"]').text()).toContain('标记模式')
    expect(wrapper.findAll('[data-annotation-type]')).toHaveLength(0)
    await wrapper.get('[data-test="pb-play"]').trigger('click')
    expect(wrapper.getComponent({ name: 'PlaybackControls' }).props('playing')).toBe(true)
    await openAnnotations(wrapper)
    expect(wrapper.find('[data-test="pb-annot-select"]').classes()).toContain('active')
    expect(wrapper.find('[data-test="pb-play"]').attributes('aria-label')).toBe('播放')
    await clickMap(wrapper, 100, 100)
    expect(wrapper.findAll('[data-annotation-type]')).toHaveLength(0)
    await wrapper.get('[data-test="pb-annot-close"]').trigger('click')
    expect(wrapper.find('[data-test="pb-play"]').attributes('aria-label')).toBe('播放')
    await openAnnotations(wrapper)
    await wrapper.get('[data-test="pb-play"]').trigger('click')
    expect(wrapper.find('[data-test="pb-annot-toolbar"]').exists()).toBe(false)
    expect(wrapper.getComponent({ name: 'PlaybackControls' }).props('playing')).toBe(true)
    wrapper.unmount()
  })

  it.each(['LT', 'MT', 'HT', 'TD'])('places a planned %s marker, edits, moves and undoes without changing replay vehicles', async (tankClass) => {
    const wrapper = mountAnnot()
    await flushPromises()
    setMapLayout(wrapper, 600, 602)
    await openAnnotations(wrapper)
    await wrapper.get(`[data-test="pb-annot-${tankClass}"]`).trigger('click')
    await clickMap(wrapper, 300, 301)
    const marker = () => wrapper.get(`[data-test="pb-annot-unit-${tankClass}"]`)
    expect(marker().text()).toBe('')
    expect(marker().attributes('transform')).toBe('translate(383, 384.5)')
    expect(wrapper.findAll('[data-test="pb-markers"] button')).toHaveLength(0)
    await wrapper.get('[data-test="pb-annot-name"]').setValue('A 点防守')
    expect(marker().text()).toContain('A 点防守')
    await wrapper.findAll('.pb-annot-color')[1].trigger('click')
    expect(marker().find('path').attributes('fill')).toBe('#ffd166')
    await wrapper.get('[data-test="pb-viewport"]').trigger('pointerdown', { pointerId: 1, clientX: 300, clientY: 301 })
    dispatchPointer('pointermove', { pointerId: 1, clientX: 360, clientY: 301 })
    dispatchPointer('pointerup', { pointerId: 1, clientX: 360, clientY: 301 })
    await flushPromises()
    expect(Number(marker().attributes('transform').match(/translate\(([^,]+)/)[1])).toBeCloseTo(459.6)
    await wrapper.get('[data-test="pb-annot-undo"]').trigger('click')
    expect(marker().attributes('transform')).toBe('translate(383, 384.5)')
    await clickMap(wrapper, 300, 301)
    await wrapper.get('[data-test="pb-annot-delete"]').trigger('click')
    expect(wrapper.find(`[data-test="pb-annot-unit-${tankClass}"]`).exists()).toBe(false)
    await wrapper.get('[data-test="pb-annot-undo"]').trigger('click')
    expect(marker().text()).toContain('A 点防守')
    await wrapper.setProps({ overview: makeOverview() })
    expect(wrapper.findAll('[data-annotation-type]')).toHaveLength(0)
    expect(wrapper.find('[data-test="pb-annot-toolbar"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('commits a multipoint route only on Finish and cancels a second route without losing history', async () => {
    const wrapper = mountAnnot()
    await flushPromises()
    setMapLayout(wrapper, 600, 602)
    await openAnnotations(wrapper)
    await wrapper.get('[data-test="pb-annot-route"]').trigger('click')
    await clickMap(wrapper, 100, 100)
    expect(wrapper.get('[data-test="pb-annot-route-finish"]').attributes('disabled')).toBeDefined()
    await clickMap(wrapper, 200, 150)
    await clickMap(wrapper, 300, 100)
    expect(wrapper.get('[data-test="pb-annot-route-shape"] polyline').attributes('points').split(' ')).toHaveLength(3)
    expect(wrapper.get('[data-test="pb-annot-undo"]').attributes('disabled')).toBeDefined()
    await wrapper.get('[data-test="pb-annot-route-finish"]').trigger('click')
    expect(wrapper.findAll('[data-test="pb-annot-route-shape"]')).toHaveLength(1)
    await wrapper.get('[data-test="pb-annot-name"]').setValue('夹击')
    expect(wrapper.get('[data-test="pb-annot-route-shape"]').text()).toBe('夹击')
    await wrapper.get('[data-test="pb-annot-route"]').trigger('click')
    await clickMap(wrapper, 400, 200)
    await clickMap(wrapper, 400, 300)
    await wrapper.get('[data-test="pb-annot-route-cancel"]').trigger('click')
    expect(wrapper.findAll('[data-test="pb-annot-route-shape"]')).toHaveLength(1)
    wrapper.unmount()
  })

  it('moves focus from marking tools to the map for Escape, Enter, undo and delete shortcuts', async () => {
    const wrapper = mountAnnot('zh', document.body)
    await flushPromises()
    await openAnnotations(wrapper)
    const viewport = wrapper.get('[data-test="pb-viewport"]').element
    async function pickTool(tool) {
      const button = wrapper.get(`[data-test="pb-annot-${tool}"]`)
      button.element.focus()
      await button.trigger('click')
      expect(document.activeElement).toBe(button.element)
    }
    async function keyAtFocus(key, options = {}) {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options })
      document.activeElement.dispatchEvent(event)
      await flushPromises()
      return event.defaultPrevented
    }

    await pickTool('TD')
    // Toolbar keys retain native button semantics; the editor must not hijack them.
    expect(await keyAtFocus('Enter')).toBe(false)
    expect(await keyAtFocus(' ')).toBe(false)
    await clickMap(wrapper, 100, 100)
    expect(document.activeElement).toBe(viewport)
    expect(wrapper.find('[data-test="pb-annot-unit-TD"]').exists()).toBe(true)
    const label = wrapper.get('[data-test="pb-annot-name"]')
    label.element.focus()
    expect(await keyAtFocus('Delete')).toBe(false)
    expect(wrapper.find('[data-test="pb-annot-unit-TD"]').exists()).toBe(true)

    await pickTool('route')
    await clickMap(wrapper, 100, 200)
    await clickMap(wrapper, 100, 300)
    expect(document.activeElement).toBe(viewport)
    expect(await keyAtFocus('Escape')).toBe(true)
    expect(wrapper.find('[data-test="pb-annot-route-shape"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="pb-annot-unit-TD"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="pb-annot-toolbar"]').exists()).toBe(true)

    await pickTool('route')
    await clickMap(wrapper, 200, 200)
    await clickMap(wrapper, 300, 300)
    expect(document.activeElement).toBe(viewport)
    expect(await keyAtFocus('Enter')).toBe(true)
    expect(wrapper.get('[data-test="pb-annot-select"]').classes()).toContain('active')
    expect(wrapper.find('[data-test="pb-annot-route-shape"]').exists()).toBe(true)
    expect(await keyAtFocus('z', { metaKey: true })).toBe(true)
    expect(wrapper.find('[data-test="pb-annot-route-shape"]').exists()).toBe(false)
    expect(await keyAtFocus('z', { metaKey: true, shiftKey: true })).toBe(true)
    expect(wrapper.find('[data-test="pb-annot-route-shape"]').exists()).toBe(true)

    await pickTool('select')
    await clickMap(wrapper, 100, 100)
    expect(document.activeElement).toBe(viewport)
    expect(await keyAtFocus('Delete')).toBe(true)
    expect(wrapper.find('[data-test="pb-annot-unit-TD"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="pb-annot-route-shape"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('second touch and pointer cancellation do not commit accidental markers or route vertices', async () => {
    const wrapper = mountAnnot()
    await flushPromises()
    await openAnnotations(wrapper)
    await wrapper.get('[data-test="pb-annot-TD"]').trigger('click')
    const viewport = wrapper.get('[data-test="pb-viewport"]')
    await viewport.trigger('pointerdown', { pointerId: 1, clientX: 100, clientY: 100, pointerType: 'touch' })
    await viewport.trigger('pointerdown', { pointerId: 2, clientX: 200, clientY: 200, pointerType: 'touch' })
    dispatchPointer('pointerup', { pointerId: 1, clientX: 100, clientY: 100 })
    dispatchPointer('pointerup', { pointerId: 2, clientX: 200, clientY: 200 })
    await flushPromises()
    expect(wrapper.findAll('[data-annotation-type]')).toHaveLength(0)
    await wrapper.get('[data-test="pb-annot-route"]').trigger('click')
    await viewport.trigger('pointerdown', { pointerId: 3, clientX: 100, clientY: 100 })
    dispatchPointer('pointercancel', { pointerId: 3, clientX: 100, clientY: 100 })
    await flushPromises()
    expect(wrapper.findAll('[data-annotation-type]')).toHaveLength(0)
    wrapper.unmount()
  })

  it('IME Enter keeps text editing open', async () => {
    const wrapper = mountAnnot()
    await flushPromises()
    await openAnnotations(wrapper)
    await wrapper.get('[data-test="pb-annot-text"]').trigger('click')
    await clickMap(wrapper, 100, 100)
    const input = wrapper.get('[data-test="pb-text-input"]')
    await input.setValue('进攻')
    await input.trigger('keydown', { key: 'Enter', isComposing: true })
    expect(wrapper.find('[data-test="pb-text-input"]').exists()).toBe(true)
    expect(wrapper.find('[data-annotation-type="text"]').exists()).toBe(false)
    await input.trigger('keydown', { key: 'Enter' })
    expect(wrapper.find('[data-annotation-type="text"]').text()).toBe('进攻')
    wrapper.unmount()
  })

  // 关闭标注必须同时收起画笔，否则退出后地图上继续画而不是平移。
  it('clears the active tool when annotations close', async () => {
    const wrapper = mountAnnot()
    await flushPromises()
    setMapLayout(wrapper, 600, 602)
    await openAnnotations(wrapper)
    // 工具条的关闭按钮是标注面的唯一出口（工具栏与画笔状态同生共死）。
    await wrapper.get('[data-test="pb-annot-close"]').trigger('click')
    await flushPromises()

    const viewport = wrapper.find('[data-test="pb-viewport"]')
    await viewport.trigger('pointerdown', { pointerId: 1, clientX: 300, clientY: 301 })
    dispatchPointer('pointermove', { pointerId: 1, clientX: 360, clientY: 301 })
    dispatchPointer('pointerup', { pointerId: 1, clientX: 360, clientY: 301 })
    await flushPromises()
    expect(wrapper.find('[data-test="pb-annotations"] polyline').exists()).toBe(false)
  })

  it('鼠标在地图上按下不触发浏览器选择（平移 / 画标注同一入口）；触屏与右键不拦', async () => {
    const wrapper = mountAnnot()
    await flushPromises()
    const viewport = wrapper.find('[data-test="pb-viewport"]').element
    const press = (pointerType, button = 0) => {
      const ev = new Event('pointerdown', { bubbles: true, cancelable: true })
      for (const [key, value] of Object.entries({ pointerId: 9, pointerType, button, clientX: 40, clientY: 40 })) {
        Object.defineProperty(ev, key, { value })
      }
      viewport.dispatchEvent(ev)
      dispatchPointer('pointerup', { pointerId: 9, clientX: 40, clientY: 40 })
      return ev.defaultPrevented
    }
    expect(press('mouse')).toBe(true)
    expect(press('touch')).toBe(false)
    expect(press('mouse', 2)).toBe(false)
    await openAnnotations(wrapper)
    expect(press('mouse')).toBe(true)
    wrapper.unmount()
  })

  it('keeps browsing interactions intact when no tool is active', async () => {
    const wrapper = mountAnnot()
    await flushPromises()
    // 现有行为：scale≤1 时平移复位（clampViewPan），先滚轮放大到 1.2 再拖拽平移
    await wrapper.find('[data-test="pb-map"]').trigger('wheel', { ctrlKey: true, clientX: 100, clientY: 100, deltaY: -100 })
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
    expect(style).toContain('width: 120%')
  })
})
