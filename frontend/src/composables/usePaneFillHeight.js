/**
 * 面板填充高度：让 pane 根元素之下的 stage 精确吃满「视口剩余高度」（视口顶 → 元素顶
 * 之间的一切 chrome——顶栏 / Tab 栏 / 页头——都天然被 getBoundingClientRect 扣除）。
 *
 * 为什么是 JS 度量而不是 CSS `calc(100dvh - …)`：全屏进出（fullscreenchange）与移动端
 * 视口条（visualViewport）都会改变几何，且回放系布局统一用 ResizeObserver + 视口事件
 * 度量（Replay3DPane.measurePresentationBounds 同一家族）；`100vh/100vw` 族是
 * frontend AGENTS.md 的禁用模式。全屏目标是 pane 根自身时高度 = 视口全高。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'

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
    height.value = `${Math.max(240, Math.floor(viewportH - top))}px`
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
