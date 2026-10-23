import { computed, inject, onMounted, onScopeDispose, provide, readonly, ref, watch } from 'vue'
import { getCreatorAvailability, listRecommendationCategories } from '../api/creators.js'
import type { RecommendationCategory, RecommendationType } from '../api/creators.js'
import { CREATOR_AVAILABILITY_KEY } from '../shared/creatorAvailability.js'
import type { CreatorAvailability } from '../shared/creatorAvailability.js'
import { Feature } from '../app/featureCapabilities.js'
import { useFeatureGate } from './useFeatureGate.js'
import { contentAdminAllowed, useAuth } from './useAuth.js'

export { CREATOR_AVAILABILITY_KEY } from '../shared/creatorAvailability.js'

/** AppShell owns both capability and public content; private metadata never enters this cache. */
export function provideCreatorAvailability() {
  const gate = useFeatureGate(), auth = useAuth()
  const online = computed(() => gate.availability(Feature.CREATORS).available)
  const available = ref(false), loading = ref(false), error = ref<unknown>(null)
  const contentKnown = ref(false), publicCategories = ref<RecommendationCategory[]>([])
  const adminAllowed = computed(() => auth.authInitState.value === 'authenticated' && contentAdminAllowed(auth))
  const typeAvailable = (type: RecommendationType) => available.value && (type === 'UP' || type === 'VIDEO')
  const typeVisible = (type: RecommendationType) => typeAvailable(type) && (adminAllowed.value
    || (contentKnown.value && publicCategories.value.some(category => category.type === type)))
  const directoryVisible = computed(() => typeVisible('UP') || typeVisible('VIDEO'))
  let generation = 0, controller: AbortController | null = null, inFlight: Promise<void> | null = null
  function cancel() {
    generation++; controller?.abort(); controller = null; inFlight = null; loading.value = false
  }
  function refresh(): Promise<void> {
    if (inFlight) return inFlight
    if (!online.value) return Promise.resolve()
    const gen = ++generation, request = new AbortController()
    controller = request; loading.value = true; error.value = null
    // Settle even when an underlying transport ignores AbortSignal; late completions have no ownership.
    const aborted = new Promise<never>((_resolve, reject) => request.signal.addEventListener('abort', () => reject(new Error('REQUEST_ABORTED')), { once: true }))
    const timer = setTimeout(() => request.abort(), 5000)
    inFlight = (async () => {
      try {
        const capability = await Promise.race([getCreatorAvailability(request.signal), aborted])
        if (gen !== generation || request.signal.aborted) return
        available.value = capability.supported
        if (!available.value) {
          contentKnown.value = false; publicCategories.value = []; return
        }
        const categories = await Promise.race([listRecommendationCategories(request.signal), aborted])
        if (gen !== generation || request.signal.aborted) return
        publicCategories.value = categories; contentKnown.value = true
      } catch (value) {
        // A failed read preserves the last successful snapshot, including an acknowledged empty one.
        if (gen === generation) error.value = value
      } finally {
        clearTimeout(timer)
        if (gen === generation) { loading.value = false; inFlight = null }
      }
    })()
    return inFlight
  }
  function refreshPublicCategories() {
    // An ACK invalidates any pre-write read, while subsequent page/focus refreshes share this request.
    cancel()
    return refresh()
  }
  const context: CreatorAvailability = { typeAvailable, typeVisible, available: readonly(available), loading: readonly(loading), error: readonly(error),
    contentKnown: readonly(contentKnown), publicCategories: readonly(publicCategories), directoryVisible, refresh, refreshPublicCategories }
  provide(CREATOR_AVAILABILITY_KEY, context)
  watch(online, value => { if (value) void refresh(); else cancel() }, { immediate: true })
  const retry = () => { void refresh() }
  onMounted(() => { window.addEventListener('focus', retry); window.addEventListener('online', retry) })
  onScopeDispose(() => { cancel(); window.removeEventListener('focus', retry); window.removeEventListener('online', retry) })
  return context
}

export function useCreatorAvailability(): CreatorAvailability {
  return inject(CREATOR_AVAILABILITY_KEY, { typeAvailable: () => false, typeVisible: () => false, available: readonly(ref(false)), loading: readonly(ref(false)), error: readonly(ref(null)),
    contentKnown: readonly(ref(false)), publicCategories: readonly(ref([])), directoryVisible: readonly(ref(false)),
    refresh: async () => {}, refreshPublicCategories: async () => {} })
}
