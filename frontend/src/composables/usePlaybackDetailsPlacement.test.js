// @vitest-environment happy-dom

/**
 * 详情浮窗的**位置所有权**测试。
 *
 * 这一层不能用「渲染出什么」来验证——它只写 left/top 与维护一个 userPositioned 闩锁，
 * 所以测试直接给宿主/面板喂几何，然后断言：
 *   · 只在 workspace 内（左右上下都被夹住，不用缓存尺寸）；
 *   · 不越过受保护边界（传输控件上缘）；
 *   · 初始位置按点击原点避让（点右 → 落左）；
 *   · 用户拖过之后初始位置启发式永久让位，但窗口变化仍会重新夹紧；
 *   · 不持久化（重开就是新的一次）。
 */
import { defineComponent, h, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePlaybackDetailsPlacement } from './usePlaybackDetailsPlacement.js'

/** 用 happy-dom 的元素几何桩：这一层只读 getBoundingClientRect，不需要真实布局引擎。 */
function rect(left, top, width, height) {
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top }
}

function harness({ host = rect(0, 0, 1200, 700), panel = rect(0, 0, 320, 400), bounds = null, origin = null, initialVertical = 'top' } = {}) {
  const hostEl = ref(null)
  const panelEl = ref(null)
  const boundsEl = ref(null)
  const active = ref(true)
  // 保护区元素**总是**渲染：`state.bounds = null` 表示「当前量不到控件」（0 高），
  // 而不是「DOM 里没有这个节点」。这样测试可以在同一个挂载里让控件出现/消失。
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
  // 每次调用都读**当前** state：这一层要验证的正是「不缓存尺寸」，
  // 桩也必须跟着变（否则测的是一个不存在的缓存行为）。
  // 三个元素都取自**composable 真正持有的 ref**（宿主与保护区是父组件传进来的模板 ref，
  // 不是本组件里声明的那个），否则桩打在别的节点上、边界检查会静默失效。
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
    // 右对齐：宿主 1200 - 面板 320 - 16 = 864
    expect(api.pos.value).toEqual({ left: 864, top: 16 })
    wrapper.unmount()
  })

  it("initialVertical='bottom'：贴底落下（3D 悬浮名册占顶部两角，浮窗不得盖住）", async () => {
    // host 1200×700、panel 320×400、bounds（传输控件）上缘 y=520 → 底界 520−8=512
    const { api, wrapper } = harness({ initialVertical: 'bottom', bounds: rect(0, 520, 1200, 160) })
    await nextTick()
    api.placeInitial({ x: 900, y: 0 })
    // 左列（点右半 → 落左）：left = gutter + pad = 16；贴底：top = 512 − 400 = 112
    expect(api.pos.value).toEqual({ left: 16, top: 112 })
    api.placeInitial({ x: 100, y: 0 })
    // 右列：1200 − 320 − 16 = 864，同样贴底
    expect(api.pos.value).toEqual({ left: 864, top: 112 })
    wrapper.unmount()
  })

  it('始终夹在 workspace 内：不缓存尺寸，面板变大后按当时的实测矩形重新夹紧', async () => {
    const { api, state, wrapper } = harness()
    await nextTick()
    api.placeInitial({ x: 900, y: 0 })
    expect(api.pos.value).toEqual({ left: 16, top: 16 })

    // 同一台车换到长文案 / 出现 V2 检查器之后面板变宽 → 夹紧必须立刻用**新**尺寸，
    // 而不是沿用「上次量到的尺寸」（那会让右边缘越出 workspace）。
    const hostWidth = 1200
    state.panel = rect(0, 0, 1100, 400)
    api.clampIntoHost()
    // 左边缘本来就在界内 → 不动；右边缘 = left + 1100 必须 ≤ 1200 - 8
    expect(api.pos.value.left + 1100).toBeLessThanOrEqual(hostWidth - 8)

    // 把浮窗拖到右下角：两个方向都被夹在界内
    api.onPointerDown({ button: 0, pointerId: 31, clientX: 0, clientY: 0, currentTarget: { setPointerCapture: vi.fn() } })
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 31, clientX: 1100, clientY: 600 }))
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 31 }))
    expect(api.pos.value).toEqual({ left: 92, top: 292 })

    // 尺寸回到小面板也不「弹回去」：夹紧只保证在界内，不改写用户位置
    state.panel = rect(0, 0, 320, 400)
    api.clampIntoHost()
    expect(api.pos.value).toEqual({ left: 92, top: 292 })

    // 用户已经拖过 → 后续选择**不再**重算初始位置（这是本层的核心承诺）
    expect(api.userPositioned.value).toBe(true)
    api.placeInitial({ x: 900, y: 0 })
    expect(api.pos.value).toEqual({ left: 92, top: 292 })
    api.placeInitial({ x: 100, y: 0 })
    expect(api.pos.value).toEqual({ left: 92, top: 292 })

    // 但窗口/形态变化仍会重新夹紧（用户位置不是「永不越界」的豁免）
    state.panel = rect(0, 0, 1100, 400)
    api.clampIntoHost()
    expect(api.pos.value).toEqual({ left: 92, top: 292 })
    wrapper.unmount()
  })

  it('受保护边界：候选项落在传输控件上时被顶到控件上方（320x400 面板 → top 112）', async () => {
    // 宿主 1200x700，传输控件从 y=520 开始，面板 320x400。
    // 这里用 origin.y 之外的路径：先把浮窗拖到最下方（此刻还没有边界），再挂上边界重新夹紧，
    // 这样候选 top 一定**大于**上界，才能真正验证「top 的上界」而不是恒等的 Math.min。
    const { api, state, wrapper } = harness({ bounds: null })
    await nextTick()
    api.placeInitial({ x: 900, y: 0 })
    api.onPointerDown({ button: 0, pointerId: 21, clientX: 0, clientY: 0, currentTarget: { setPointerCapture: vi.fn() } })
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 21, clientX: 16, clientY: 292 }))
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 21 }))
    // 没有保护区时下界就是 host：700 - 8 - 400 = 292
    expect(api.pos.value).toEqual({ left: 16, top: 292 })

    // 现在传输控件出现了：同样的位置必须被顶到 520 - 8 - 400 = 112
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
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 3 }))
    // 指针相对面板原点偏移 100/60 → 新位置 = 500-100 / 260-60
    expect(api.pos.value).toEqual({ left: 400, top: 200 })
    expect(api.userPositioned.value).toBe(true)
    expect(target.setPointerCapture).toHaveBeenCalledWith(3)

    api.placeInitial({ x: 100, y: 0 })
    expect(api.pos.value).toEqual({ left: 400, top: 200 })

    // 但窗口变化仍然重新夹紧（用户位置不是「永不越界」的豁免）
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

// A short workspace cannot protect Transport by changing top alone: the panel must also scroll.
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

// 初始落位不压中心栏（HUD / Stage / 传输控件同一列）：侧边名册比浮窗窄时收窄浮窗，而不是伸进中心栏。
describe('initial placement keeps the center column clear', () => {
  it('1280 宽桌面全屏：侧边只有 318，340 宽浮窗收窄到侧边可用宽度，不盖顶栏右端', async () => {
    // 中心栏 = 传输控件所在列 x 322..958；面板天然 340 宽
    const { wrapper, api } = harness({ host: rect(0, 0, 1280, 720), panel: rect(0, 0, 340, 600), bounds: rect(322, 670, 636, 50) })
    await nextTick()
    api.placeInitial({ x: 100, y: 0 }) // 点左侧 → 落右侧
    // 右侧可用 = 1280 - 16 - (958 + 8) = 298
    expect(api.maxPanelWidth.value).toBe(298)
    expect(api.pos.value.left).toBe(966)
    expect(api.pos.value.left).toBeGreaterThanOrEqual(958 + 8)

    api.placeInitial({ x: 900, y: 0 }) // 点右侧 → 落左侧：可用 = (322 - 8) - 16 = 298
    expect(api.maxPanelWidth.value).toBe(298)
    expect(api.pos.value.left).toBe(16)
    expect(api.pos.value.left + api.maxPanelWidth.value).toBeLessThanOrEqual(322 - 8)
    wrapper.unmount()
  })

  it('侧边够宽时只给上限：浮窗保持自身宽度与原来的落位', async () => {
    const { wrapper, api } = harness({ host: rect(0, 0, 1600, 900), panel: rect(0, 0, 340, 600), bounds: rect(400, 850, 800, 50) })
    await nextTick()
    api.placeInitial({ x: 100, y: 0 })
    // 右侧可用 = 1600 - 16 - (1200 + 8) = 376 ≥ 340：left 仍是 1600 - 340 - 16
    expect(api.maxPanelWidth.value).toBe(376)
    expect(api.pos.value.left).toBe(1244)
    wrapper.unmount()
  })

  it('名册关闭（中心栏铺满）或侧边不足下限时不收窄；关闭浮窗后上限一并清掉', async () => {
    const { wrapper, api, state } = harness({ host: rect(0, 0, 1200, 700), panel: rect(0, 0, 320, 400), bounds: rect(0, 640, 1200, 60) })
    await nextTick()
    api.placeInitial({ x: 100, y: 0 })
    expect(api.maxPanelWidth.value).toBe(null) // 中心栏铺满：没有侧边
    expect(api.pos.value.left).toBe(864)

    state.bounds = rect(250, 640, 800, 60) // 右侧只剩 1200 - 16 - 1058 = 126 < 240
    api.placeInitial({ x: 100, y: 0 })
    expect(api.maxPanelWidth.value).toBe(null)

    state.bounds = rect(300, 640, 600, 60) // 右侧 1200 - 16 - 908 = 276 → 收窄
    api.placeInitial({ x: 100, y: 0 })
    expect(api.maxPanelWidth.value).toBe(276)
    api.active.value = false
    await nextTick()
    expect(api.maxPanelWidth.value).toBe(null)
    wrapper.unmount()
  })
})
