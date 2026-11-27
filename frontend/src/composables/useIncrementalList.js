import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'


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

  function sentinel(el) {
    if (el === observed) return
    observer?.disconnect()
    observer = null
    observed = el || null
    if (!el || !supportsObserver) return
    const io = new window.IntersectionObserver((entries) => {
      if (!entries.some(entry => entry.isIntersecting) || !hasMore.value) return
      loadMore()
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
