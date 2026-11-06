import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

/** Combine the pane owner with browser foreground state; this does not own playback. */
export function useSceneActivity(active: () => boolean) {
  const visible = ref(typeof document === 'undefined' || document.visibilityState === 'visible')
  const pageShown = ref(true)
  const updateVisibility = () => { visible.value = document.visibilityState === 'visible' }
  const hidePage = () => { pageShown.value = false }
  const showPage = () => { pageShown.value = true; updateVisibility() }
  onMounted(() => {
    updateVisibility()
    document.addEventListener('visibilitychange', updateVisibility)
    window.addEventListener('pagehide', hidePage)
    window.addEventListener('pageshow', showPage)
  })
  onBeforeUnmount(() => {
    document.removeEventListener('visibilitychange', updateVisibility)
    window.removeEventListener('pagehide', hidePage)
    window.removeEventListener('pageshow', showPage)
  })
  return computed(() => active() && visible.value && pageShown.value)
}
