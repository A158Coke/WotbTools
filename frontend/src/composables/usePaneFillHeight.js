/**
 * 面板填充高度：让 pane 根元素之下的 stage 精确吃满「视口剩余高度」。
 *
 * 顶部 chrome（顶栏 / 页头）天然被 `getBoundingClientRect().top` 扣除；**底部固定导航
 * 不是**——`AppTabBar` 是 `position: fixed; bottom: 0`（手机竖屏 56px + safe-area），
 * 它盖在内容之上而 `#app` 的 padding-bottom 只增加文档流尾部空间，不会缩短这里显式算出
 * 的高度，底部控件会落到 TabBar 后面。因此非全屏时按**实际渲染的 TabBar 高度**（含
 * safe-area，直接量 DOM——`--tabbar-h` token 在桌面/横屏/沉浸态已是 0，两种口径一致但
 * DOM 更贴近真实）扣减；全屏目标 = pane 根自身时吃满整个视口。
 *
 * 为什么是 JS 度量而不是 CSS `calc(100dvh - …)`：全屏进出（fullscreenchange）与移动端
 * 视口条（visualViewport）都会改变几何，且回放系布局统一用 ResizeObserver + 视口事件
 * 度量（Replay3DPane.measurePresentationBounds 同一家族）；`100vh/100vw` 族是
 * frontend AGENTS.md 的禁用模式。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'

/** 底部固定导航占用的高度（无 TabBar 的形态——桌面/平板/紧凑横屏/沉浸态——返回 0）。 */
export function bottomChromeHeight(doc = typeof document !== 'undefined' ? document : null) {
  if (!doc) return 0
  const tabBar = doc.querySelector('[data-testid="app-tab-bar"]')
  if (!tabBar) return 0
  const rect = tabBar.getBoundingClientRect()
  return rect.height > 0 ? rect.height : 0
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
    height.value = `${Math.max(240, Math.floor(viewportH - top - bottomChromeHeight()))}px`
  }

  let observer = null
  onMounted(() => {
    measure()
    if (typeof ResizeObserver === 'function') {
      observer = new ResizeObserver(measure)
      if (targetRef.value) observer.observe(targetRef.value)
      // TabBar 出现/消失/高度变化（compact 切换、safe-area、横竖屏）也要重算
      const tabBar = document.querySelector('[data-testid="app-tab-bar"]')
      if (tabBar) observer.observe(tabBar)
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
