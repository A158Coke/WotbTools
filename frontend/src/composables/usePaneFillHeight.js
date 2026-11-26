import { onBeforeUnmount, onMounted, ref } from 'vue'

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
