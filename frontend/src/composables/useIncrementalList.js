import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

/**
 * 长列表增量渲染（审计 3D-18：坦克百科 735 辆车一次全部渲染，手机页面约 167,000px 高）。
 * 先渲染一页，哨兵元素进入视口（IntersectionObserver，提前 rootMargin 预取）时再追加一页；
 * 不支持 IntersectionObserver 的环境由页面上的"加载更多"按钮兜底（键盘用户同样可用）。
 * 不做真正的虚拟窗口：卡片高度随网格列数变化，分页追加更简单，也不会破坏页内查找 / 焦点顺序。
 */

/** 纯函数：在 current 基础上追加一页，不超过 total。 */
export function nextVisibleCount(current, total, pageSize) {
  const size = Math.max(1, Math.floor(pageSize) || 1)
  const max = Math.max(0, Math.floor(total) || 0)
  const base = Math.max(0, Math.floor(current) || 0)
  return Math.min(max, base + size)
}

/**
 * @param {import('vue').Ref<unknown[]>} items 全部（已筛选）条目
 * @param {{ pageSize?: number, resetKey?: () => unknown, rootMargin?: string }} options
 *   resetKey 变化时回到第一页（筛选条件改变）
 */
export function useIncrementalList(items, { pageSize = 48, resetKey, rootMargin = '600px 0px' } = {}) {
  const count = ref(pageSize)
  const visible = computed(() => items.value.slice(0, count.value))
  const hasMore = computed(() => count.value < items.value.length)

  function loadMore() {
    count.value = nextVisibleCount(count.value, items.value.length, pageSize)
  }

  if (resetKey) watch(resetKey, () => { count.value = pageSize })

  let observer = null
  let observed = null
  const supportsObserver = typeof window !== 'undefined' && typeof window.IntersectionObserver === 'function'

  /** 模板 ref 回调：哨兵挂载 / 卸载时接上 / 断开观察 */
  function sentinel(el) {
    // Vue 在每次 patch 都会回调函数 ref：同一元素不重复建 observer
    if (el === observed) return
    observer?.disconnect()
    observer = null
    observed = el || null
    if (!el || !supportsObserver) return
    const io = new window.IntersectionObserver((entries) => {
      if (!entries.some(entry => entry.isIntersecting) || !hasMore.value) return
      loadMore()
      // 追加后哨兵若仍在视口内（大屏一页填不满），IO 不会再次触发——重新观察以拿到新的初始回调
      io.unobserve(el)
      nextTick(() => { if (observer === io) io.observe(el) })
    }, { rootMargin })
    observer = io
    observer.observe(el)
  }

  onBeforeUnmount(() => {
    observer?.disconnect()
    observer = null
    observed = null
  })

  return { visible, hasMore, loadMore, sentinel, count }
}
