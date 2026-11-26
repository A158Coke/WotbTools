import { onScopeDispose, readonly, ref } from 'vue'
import { PLAYBACK_MOBILE_QUERY } from '../shared/breakpoints.js'

export const PLAYBACK_PHONE_QUERY = PLAYBACK_MOBILE_QUERY

export function usePlaybackPhoneForm() {
  const isPhone = ref(false)
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return { isPhone: readonly(isPhone) }
  }
  const query = window.matchMedia(PLAYBACK_PHONE_QUERY)
  isPhone.value = query.matches
  const update = () => { isPhone.value = query.matches }
  query.addEventListener?.('change', update)
  onScopeDispose(() => query.removeEventListener?.('change', update))
  return { isPhone: readonly(isPhone) }
}
