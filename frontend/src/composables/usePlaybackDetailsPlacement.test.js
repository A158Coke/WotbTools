// @vitest-environment happy-dom

import { defineComponent, h, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePlaybackDetailsPlacement } from './usePlaybackDetailsPlacement.ts'
import { detailsPlacementLimits, detailsPlacementPreserved } from '../utils/detailsPlacementBounds.ts'

function rect(left, top, width, height) {
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top }
}

function harness({ host = rect(0, 0, 1200, 700), panel = rect(0, 0, 320, 400), bounds = null, origin = null, initialVertical = 'top' } = {}) {
  const hostEl = ref(null)
  const panelEl = ref(null)
  const boundsEl = ref(null)
  const active = ref(true)
  const state = { host, panel, bounds }
  const api = {}

  const Host = defineComponent({
    setup() {
      const placement = usePlaybackDetailsPlacement({
        isActive: () => active.value,
        hostEl,
        panelEl,
        boundsEl,
        initialSide: ref('left'),
        initialVertical,
      })
      Object.assign(api, placement, { active })
      return () => h('div', { ref: hostEl }, [
        h('div', { ref: panelEl }),
        h('div', { ref: boundsEl }),
      ])
    },
  })

  const wrapper = mount(Host)
  const geometry = (el, key) => {
    if (!el) return
    el.getBoundingClientRect = () => state[key] || rect(0, 0, 0, 0)
  }
  geometry(api.hostEl.value, 'host')
  geometry(panelEl.value, 'panel')
  geometry(api.boundsEl.value, 'bounds')
  return { wrapper, api, state, hostEl, panelEl, boundsEl, active }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('usePlaybackDetailsPlacement', () => {
  it('初始位置落在点击原点的反侧：点右半 → 浮窗在左；点左半 → 浮窗在右', async () => {
    const { api, wrapper } = harness()
    await nextTick()
    api.placeInitial({ x: 900, y: 0 })
    expect(api.pos.value).toEqual({ left: 16, top: 16 })

    api.placeInitial({ x: 100, y: 0 })
    expect(api.pos.value).toEqual({ left: 864, top: 16 })
    wrapper.unmount()
  })

  it("initialVertical='bottom'：贴底落下（3D 悬浮名册占顶部两角，浮窗不得盖住）", async () => {
    const { api, wrapper } = harness({ initialVertical: 'bottom', bounds: rect(0, 520, 1200, 160) })
    await nextTick()
    api.placeInitial({ x: 900, y: 0 })
    expect(api.pos.value).toEqual({ left: 16, top: 112 })
    api.placeInitial({ x: 100, y: 0 })
    expect(api.pos.value).toEqual({ left: 864, top: 112 })
    wrapper.unmount()
  })

  it('始终夹在 workspace 内：不缓存尺寸，面板变大后按当时的实测矩形重新夹紧', async () => {
    const { api, state, wrapper } = harness()
    await nextTick()
    api.placeInitial({ x: 900, y: 0 })
    expect(api.pos.value).toEqual({ left: 16, top: 16 })

    const hostWidth = 1200
    state.panel = rect(0, 0, 1100, 400)
    api.clampIntoHost()
    expect(api.pos.value.left + 1100).toBeLessThanOrEqual(hostWidth - 8)

    api.onPointerDown({ button: 0, pointerId: 31, clientX: 0, clientY: 0, currentTarget: { setPointerCapture: vi.fn() } })
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 31, clientX: 1100, clientY: 600 }))
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 31 }))
    expect(api.pos.value).toEqual({ left: 92, top: 292 })

    state.panel = rect(0, 0, 320, 400)
    api.clampIntoHost()
    expect(api.pos.value).toEqual({ left: 92, top: 292 })

    expect(api.userPositioned.value).toBe(true)
    api.placeInitial({ x: 900, y: 0 })
    expect(api.pos.value).toEqual({ left: 92, top: 292 })
    api.placeInitial({ x: 100, y: 0 })
    expect(api.pos.value).toEqual({ left: 92, top: 292 })

    state.panel = rect(0, 0, 1100, 400)
    api.clampIntoHost()
    expect(api.pos.value).toEqual({ left: 92, top: 292 })
    wrapper.unmount()
  })

  it('受保护边界：候选项落在传输控件上时被顶到控件上方（320x400 面板 → top 112）', async () => {
    const { api, state, wrapper } = harness({ bounds: null })
    await nextTick()
    api.placeInitial({ x: 900, y: 0 })
    api.onPointerDown({ button: 0, pointerId: 21, clientX: 0, clientY: 0, currentTarget: { setPointerCapture: vi.fn() } })
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 21, clientX: 16, clientY: 292 }))
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 21 }))
    expect(api.pos.value).toEqual({ left: 16, top: 292 })

    state.bounds = rect(0, 520, 1200, 160)
    api.clampIntoHost()
    expect(api.pos.value).toEqual({ left: 16, top: 112 })
    wrapper.unmount()
  })

  it('受保护边界：拖动到控件上方即刻被挡住，不会盖住传输控件', async () => {
    const { api, wrapper } = harness({ bounds: rect(0, 520, 1200, 160) })
    await nextTick()
    api.placeInitial({ x: 900, y: 0 })
    api.onPointerDown({ button: 0, pointerId: 11, clientX: 0, clientY: 0, currentTarget: { setPointerCapture: vi.fn() } })
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 11, clientX: 16, clientY: 600 }))
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 11 }))
    expect(api.pos.value.top).toBe(112)
    wrapper.unmount()
  })

  it('边界不可测量（传输控件不在 DOM / 高度为 0）时退化为 workspace 边界，不会把浮窗顶到天上', async () => {
    const { api, wrapper } = harness({ bounds: rect(0, 0, 0, 0) })
    await nextTick()
    api.placeInitial({ x: 900, y: 0 })
    expect(api.pos.value.top).toBe(16)
    wrapper.unmount()
  })

  it('面板尚未完成布局（0×0）时不写位置，等下一帧再量', async () => {
    const { api, wrapper } = harness({ panel: rect(0, 0, 0, 0) })
    await nextTick()
    api.placeInitial({ x: 900, y: 0 })
    expect(api.pos.value).toBe(null)
    wrapper.unmount()
  })

  it('拖动写入新位置并置位 userPositioned；之后 placeInitial 不再覆盖用户位置', async () => {
    const { api, wrapper } = harness()
    await nextTick()
    api.placeInitial({ x: 900, y: 0 })
    expect(api.userPositioned.value).toBe(false)

    const target = { setPointerCapture: vi.fn(), currentTarget: null }
    api.onPointerDown({ button: 0, pointerId: 3, clientX: 100, clientY: 60, currentTarget: target })
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 3, clientX: 500, clientY: 260 }))
    expect(api.userPositioned.value).toBe(true)
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 3 }))
    expect(api.pos.value).toEqual({ left: 400, top: 200 })
    expect(api.userPositioned.value).toBe(true)
    expect(target.setPointerCapture).toHaveBeenCalledWith(3)

    api.placeInitial({ x: 100, y: 0 })
    expect(api.pos.value).toEqual({ left: 400, top: 200 })

    api.clampIntoHost()
    expect(api.pos.value.left).toBeLessThanOrEqual(1200 - 320 - 8)
    wrapper.unmount()
  })

  it('拖动中越界即被夹住：向左拖出宿主 → 停在边缘余量处', async () => {
    const { api, wrapper } = harness()
    await nextTick()
    api.placeInitial({ x: 900, y: 0 })
    api.onPointerDown({ button: 0, pointerId: 5, clientX: 0, clientY: 0, currentTarget: { setPointerCapture: vi.fn() } })
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 5, clientX: -800, clientY: -800 }))
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 5 }))
    expect(api.pos.value).toEqual({ left: 8, top: 8 })
    wrapper.unmount()
  })

  it('关闭再打开是一次新的浮窗：位置与用户位置闩锁都重置（不持久化原始像素）', async () => {
    const { api, active, wrapper } = harness()
    await nextTick()
    api.placeInitial({ x: 900, y: 0 })
    api.onPointerDown({ button: 0, pointerId: 7, clientX: 0, clientY: 0, currentTarget: { setPointerCapture: vi.fn() } })
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 7, clientX: 300, clientY: 300 }))
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7 }))
    expect(api.userPositioned.value).toBe(true)

    active.value = false
    await nextTick()
    expect(api.pos.value).toBe(null)
    expect(api.userPositioned.value).toBe(false)
    wrapper.unmount()
  })

  it('卸载时摘掉 window 上的拖动监听，不留悬挂会话', async () => {
    const remove = vi.spyOn(window, 'removeEventListener')
    const { api, wrapper } = harness()
    await nextTick()
    api.placeInitial({ x: 900, y: 0 })
    api.onPointerDown({ button: 0, pointerId: 9, clientX: 0, clientY: 0, currentTarget: { setPointerCapture: vi.fn() } })
    wrapper.unmount()
    const removed = remove.mock.calls.map(([type]) => type)
    expect(removed).toContain('pointermove')
    expect(removed).toContain('pointerup')
  })
})

describe('short workspace panel capacity', () => {
  it('bounds tall content above Transport while preserving the drag position contract', async () => {
    const { wrapper, api } = harness({ host: rect(0, 0, 740, 256), panel: rect(0, 0, 320, 280), bounds: rect(144, 174, 452, 82) })
    await nextTick()
    api.placeInitial()
    expect(api.maxPanelHeight.value).toBe(158)
    expect(api.pos.value.top + api.maxPanelHeight.value).toBeLessThanOrEqual(166)
    wrapper.unmount()
  })
})

describe('initial placement keeps the center column clear', () => {
  it('1280 宽桌面全屏：侧边只有 318，340 宽浮窗收窄到侧边可用宽度，不盖顶栏右端', async () => {
    const { wrapper, api } = harness({ host: rect(0, 0, 1280, 720), panel: rect(0, 0, 340, 600), bounds: rect(322, 670, 636, 50) })
    await nextTick()
    api.placeInitial({ x: 100, y: 0 })
    expect(api.maxPanelWidth.value).toBe(298)
    expect(api.pos.value.left).toBe(966)
    expect(api.pos.value.left).toBeGreaterThanOrEqual(958 + 8)

    api.placeInitial({ x: 900, y: 0 })
    expect(api.maxPanelWidth.value).toBe(298)
    expect(api.pos.value.left).toBe(16)
    expect(api.pos.value.left + api.maxPanelWidth.value).toBeLessThanOrEqual(322 - 8)
    wrapper.unmount()
  })

  it('侧边够宽时只给上限：浮窗保持自身宽度与原来的落位', async () => {
    const { wrapper, api } = harness({ host: rect(0, 0, 1600, 900), panel: rect(0, 0, 340, 600), bounds: rect(400, 850, 800, 50) })
    await nextTick()
    api.placeInitial({ x: 100, y: 0 })
    expect(api.maxPanelWidth.value).toBe(376)
    expect(api.pos.value.left).toBe(1244)
    wrapper.unmount()
  })

  it('名册关闭（中心栏铺满）或侧边不足下限时不收窄；关闭浮窗后上限一并清掉', async () => {
    const { wrapper, api, state } = harness({ host: rect(0, 0, 1200, 700), panel: rect(0, 0, 320, 400), bounds: rect(0, 640, 1200, 60) })
    await nextTick()
    api.placeInitial({ x: 100, y: 0 })
    expect(api.maxPanelWidth.value).toBe(null)
    expect(api.pos.value.left).toBe(864)

    state.bounds = rect(250, 640, 800, 60)
    api.placeInitial({ x: 100, y: 0 })
    expect(api.maxPanelWidth.value).toBe(null)

    state.bounds = rect(300, 640, 600, 60)
    api.placeInitial({ x: 100, y: 0 })
    expect(api.maxPanelWidth.value).toBe(276)
    api.active.value = false
    await nextTick()
    expect(api.maxPanelWidth.value).toBe(null)
    wrapper.unmount()
  })
})

describe('user-dragged placement after selection change', () => {
  const base = {
    hostWidth: 1200,
    hostHeight: 700,
    panelWidth: 320,
    transportTop: 600,
  }

  it('negative: old top remains legal under the new height → exact top must be preserved', () => {
    const input = {
      ...base,
      oldTop: 100,
      newTop: 50,
      newHeight: 150,
    }
    const limits = detailsPlacementLimits({ ...base, panelHeight: 150 })
    expect(limits.maxTop).toBeGreaterThan(100)
    expect(detailsPlacementPreserved(input)).toBe(false)
    expect(detailsPlacementPreserved({ ...input, newTop: 100 })).toBe(true)
  })

  it('positive: new height truly crosses the transport boundary → clamp to maxTop and stay clear', () => {
    const input = {
      ...base,
      oldTop: 390,
      newTop: 372,
      newHeight: 220,
    }
    const limits = detailsPlacementLimits({ ...base, panelHeight: 220 })
    expect(limits.maxTop).toBe(372)
    expect(limits.maxTop + 220).toBeLessThanOrEqual(limits.maxBottom)
    expect(detailsPlacementPreserved(input)).toBe(true)
    expect(detailsPlacementPreserved({ ...input, newTop: 300 })).toBe(false)
  })
})
