import { onScopeDispose, readonly, ref } from 'vue'

export const PLAYBACK_PORTRAIT_QUERY = '(orientation: portrait) and (width < 768px)'
const PORTRAIT_MAX_WIDTH = 768

export function usePlaybackPortraitViewport() {
  const isPortrait = ref(false)
  if (typeof window === 'undefined') return { isPortrait: readonly(isPortrait) }

  const read = () => {
    if (typeof window.matchMedia !== 'function') return false
    if (!window.matchMedia(PLAYBACK_PORTRAIT_QUERY).matches) return false
    const width = Number(window.innerWidth)
    return !Number.isFinite(width) || width < PORTRAIT_MAX_WIDTH
  }
  isPortrait.value = read()

  const query = typeof window.matchMedia === 'function' ? window.matchMedia(PLAYBACK_PORTRAIT_QUERY) : null
  const onQueryChange = () => { isPortrait.value = read() }
  const onResize = () => { isPortrait.value = read() }
  query?.addEventListener?.('change', onQueryChange)
  window.addEventListener?.('resize', onResize)
  window.addEventListener?.('orientationchange', onResize)
  onScopeDispose(() => {
    query?.removeEventListener?.('change', onQueryChange)
    window.removeEventListener?.('resize', onResize)
    window.removeEventListener?.('orientationchange', onResize)
  })
  return { isPortrait: readonly(isPortrait) }
}
