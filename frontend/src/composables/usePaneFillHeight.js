/**
 * 面板填充高度：让 pane 根元素之下的 stage 精确吃满「视口剩余高度」（design-language §9 L2）。
 *
 * 顶部 chrome（顶栏 / 页头）天然被 `getBoundingClientRect().top` 扣除；外壳没有底部常驻栏（L1），
 * 底部只扣设备的底部安全区（Home 指示条 / 手势条），控件不落进安全区（L4）。
 * 全屏目标 = pane 根自身时吃满整个视口。
 *
 * 为什么是 JS 度量而不是 CSS `calc(100dvh - …)`：全屏进出（fullscreenchange）与移动端
 * 视口条（visualViewport）都会改变几何，且回放系布局统一用 ResizeObserver + 视口事件
 * 度量（Replay3DPane.measurePresentationBounds 同一家族）；`100vh/100vw` 族是
 * frontend AGENTS.md 的禁用模式。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'

/** 底部安全区的像素值：JS 读不到 env()，用一个 padding 取 env() 的隐藏探针换算。 */
export function bottomSafeAreaHeight(doc = typeof document !== 'undefined' ? document : null) {
  if (!doc?.body) return 0
  const probe = doc.createElement('div')
  probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;padding-bottom:env(safe-area-inset-bottom)'
  doc.body.appendChild(probe)
  const value = parseFloat(getComputedStyle(probe).paddingBottom) || 0
  probe.remove()
  return Math.max(0, value)
}

export function usePaneFillHeight(targetRef) {
  const height = ref('480px')

  function measure() {
    const el = targetRef.value
    if (!el) return
    const viewportH = window.visualViewport?.height || window.innerHeight
    if (typeof document !== 'undefined' && document.fullscreenElement === el) {
      height.value = `${Math.max(240, Math.floor(viewportH))}px`
      return
    }
    const top = el.getBoundingClientRect().top
    height.value = `${Math.max(240, Math.floor(viewportH - top - bottomSafeAreaHeight()))}px`
  }

  let observer = null
  onMounted(() => {
    measure()
    if (typeof ResizeObserver === 'function') {
      observer = new ResizeObserver(measure)
      if (targetRef.value) observer.observe(targetRef.value)
    }
    window.addEventListener('resize', measure)
    document.addEventListener('fullscreenchange', measure)
    window.visualViewport?.addEventListener?.('resize', measure)
  })
  onBeforeUnmount(() => {
    observer?.disconnect()
    observer = null
    window.removeEventListener('resize', measure)
    document.removeEventListener('fullscreenchange', measure)
    window.visualViewport?.removeEventListener?.('resize', measure)
  })

  return { height, measure }
}
