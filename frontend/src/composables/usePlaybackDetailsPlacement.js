/**
 * 车辆详情浮窗的**位置所有权**（2D / 3D 共用）。它是浮窗唯一的写入者，别人只读。
 *
 * 为什么需要单独一层：详情面板从「侧栏里的一个格子」变成「整个 Playback workspace 顶层的
 * 可拖动浮窗」之后，位置就不能再交给 CSS 流式布局——它必须同时满足四件事，而每一件都和
 * 另外三件耦合：
 *
 *   1. **只在 workspace 内**：`left/top` 永远夹在 host 的 padding box 里，`maxLeft/maxTop`
 *      由拖动当时的实测尺寸算，不用缓存值（字体/内容变化后缓存会立刻过期）。
 *   2. **不遮传输控件**：下边界取「传输控件上缘」与「host 下缘」的较小者。控件不在 DOM 里
 *      （3D 隐藏 UI / 桌面把控件放进 rail）时退化成 host 边界，不会把浮窗顶到天上。
 *   3. **初始位置避让点击目标**：新选中一台车时按点击原点挑一侧——点右侧的车，浮窗落左侧，
 *      否则浮窗会立刻盖住刚点的那台车。用户自己拖过之后（`userPositioned`）**永久尊重**
 *      用户位置，只有 workspace 尺寸/形态变化才重新夹紧，不再重算初始位置。
 *   4. **不持久化**：原始像素位置与窗口/字体/全屏状态强相关，写进 localStorage 只会在别的
 *      形态下变成一处越界浮窗。所以只活在内存里，重载即回默认。
 *
 * `clampToBounds` 刻意做成「纯函数 + 一个写手」：ResizeObserver / 全屏切换 / 方向变化都调它，
 * 调用时机再多也不会互相打架。
 */
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

/** 左侧/顶部的最小可见余量：贴边时不能整个压出 workspace。 */
const EDGE_MARGIN = 8

export function usePlaybackDetailsPlacement({
  isActive,
  hostEl,
  panelEl,
  boundsEl = null,
  initialSide = null,
}) {
  /** 已应用的位置；null = 还没定位（首帧交给 CSS 的默认角落）。 */
  const pos = ref(null)
  /** 用户是否亲手拖过：拖过之后初始位置启发式永久让位。 */
  const userPositioned = ref(false)

  // 拖动期间的会话：pointerId + 指针相对面板原点的偏移。同时 live 的只可能有一个。
  let session = null

  /**
   * 把一组候选坐标夹进当前可用矩形。
   * @returns {{left:number, top:number, maxLeft:number, maxTop:number}|null} 尺寸不可测量时为 null
   */  function clampToBounds(left, top) {
    const host = hostEl.value
    const panel = panelEl.value
    if (!host || !panel) return null
    const hostRect = host.getBoundingClientRect()
    const rect = panel.getBoundingClientRect()
    if (!hostRect.width || !hostRect.height) return null
    // 未布局时 rect 会是 0×0；此时夹紧无意义，等下一帧的真实尺寸。
    if (!rect.width || !rect.height) return null
    const maxLeft = Math.max(EDGE_MARGIN, hostRect.width - rect.width - EDGE_MARGIN)
    // 传输控件是保护区：浮窗**下缘**不得越过它的上缘（控件缺失 → 只受 host 约束）。
    const bounds = boundsEl?.value
    let transportTop = hostRect.height
    if (bounds) {
      const boundsRect = bounds.getBoundingClientRect()
      if (boundsRect.height > 0) {
        transportTop = Math.min(transportTop, boundsRect.top - hostRect.top)
      }
    }
    const maxBottom = Math.min(hostRect.height - EDGE_MARGIN, transportTop - EDGE_MARGIN)
    // 这里是 top 的上界，不是高度：`maxBottom` 已经是「浮窗下缘允许到的位置」，
    // 减去面板自身高度才是浮窗左上角的极限。写反的后果不是布局偏移，而是保护边界**完全失效**
    // —— 只要候选 top 小于这个数值，`Math.min` 就永远选候选值，浮窗会盖在传输控件上。
    const maxTop = Math.max(EDGE_MARGIN, maxBottom - rect.height)
    const out = {
      left: Math.round(Math.min(Math.max(left, EDGE_MARGIN), maxLeft)),
      top: Math.round(Math.min(Math.max(top, EDGE_MARGIN), maxTop)),
      maxLeft,
      maxTop,
    }
    return out
  }

  function apply(next) {
    if (!next) return
    pos.value = { left: next.left, top: next.top }
  }

  /** 重新夹紧当前位置（ResizeObserver / 全屏 / 方向变化）。未定位时不做任何事。 */
  function clampIntoHost() {
    if (!pos.value) return
    apply(clampToBounds(pos.value.left, pos.value.top))
  }

  /**
   * 选择变化时的初始位置：`origin` 是点击原点（workspace 内坐标，可为 null）。
   * 点右半 → 落左半；点左半 → 落右半。原点未知时按 `initialSide` 偏好，缺省左上。
   */
  function placeInitial(origin = null) {
    if (userPositioned.value) return
    const host = hostEl.value
    const panel = panelEl.value
    if (!host || !panel) return
    const hostRect = host.getBoundingClientRect()
    const rect = panel.getBoundingClientRect()
    if (!hostRect.width || !rect.width) return
    let side = initialSide
    if (origin && Number.isFinite(origin.x)) {
      side = origin.x > hostRect.width / 2 ? 'left' : 'right'
    }
    const gutter = EDGE_MARGIN * 2
    const left = side === 'right'
      ? hostRect.width - rect.width - gutter
      : gutter
    const top = EDGE_MARGIN * 2
    const next = clampToBounds(left, top)
    if (next) {
      // 初始位置是「已应用的位置」但不是「用户位置」：之后的选择仍然可以重算它。
      pos.value = { left: next.left, top: next.top }
    }
  }

  function onPointerDown(event) {
    if (event.button != null && event.button !== 0) return
    const panel = panelEl.value
    if (!panel) return
    const rect = panel.getBoundingClientRect()
    session = {
      pointerId: event.pointerId,
      dx: event.clientX - rect.left,
      dy: event.clientY - rect.top,
    }
    // 指针捕获让指针离开面板后仍然收到 move/up（触屏尤其需要）。
    try {
      event.currentTarget?.setPointerCapture?.(event.pointerId)
    } catch {
      /* 无捕获能力（测试环境 / 老浏览器）时 window 监听已经足够 */
    }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
  }

  function onPointerMove(event) {
    if (!session || (session.pointerId != null && event.pointerId !== session.pointerId)) return
    const host = hostEl.value
    if (!host) return
    const hostRect = host.getBoundingClientRect()
    apply(clampToBounds(event.clientX - hostRect.left - session.dx, event.clientY - hostRect.top - session.dy))
  }

  function onPointerUp() {
    session = null
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('pointercancel', onPointerUp)
    if (pos.value) userPositioned.value = true
  }

  // 面板内容随选择变化（车型名长短、是否有 V2 检查器），尺寸一变就可能越界 → 重新夹紧。
  let panelObserver = null
  let hostObserver = null
  onMounted(() => {
    if (typeof ResizeObserver === 'function') {
      if (panelEl.value) {
        panelObserver = new ResizeObserver(clampIntoHost)
        panelObserver.observe(panelEl.value)
      }
      if (hostEl.value) {
        hostObserver = new ResizeObserver(() => {
          if (pos.value == null) return
          if (userPositioned.value) clampIntoHost()
          else placeInitial()
        })
        hostObserver.observe(hostEl.value)
      }
    }
  })
  onBeforeUnmount(() => {
    panelObserver?.disconnect()
    panelObserver = null
    hostObserver?.disconnect()
    hostObserver = null
    session = null
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('pointercancel', onPointerUp)
  })

  /** 关闭 → 打开：位置重置。用户位置只在**同一次打开**里有效（浮窗重开就是新的一次）。 */
  watch(() => !!isActive(), (active) => {
    if (!active) {
      pos.value = null
      userPositioned.value = false

      return
    }
    // 面板刚挂上还没布局：等一帧再量尺寸。
    nextTick(() => placeInitial())
  })

  // `hostEl` / `boundsEl` 一并回传：调用方（与测试）需要能够读到**同一份**元素引用，
  // 而不是另拿一个模板 ref——参考元素与量测元素必须是同一个节点，否则边界检查会静默失效。
  return { pos, userPositioned, clampIntoHost, placeInitial, onPointerDown, hostEl, boundsEl, panelEl }
}
