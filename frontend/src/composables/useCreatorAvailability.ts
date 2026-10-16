import { computed, inject, onMounted, onScopeDispose, provide, readonly, ref, watch } from 'vue'
import type { InjectionKey, Ref } from 'vue'
import { getCreatorAvailability } from '../api/creators.js'
import { Feature } from '../app/featureCapabilities.js'
import { useFeatureGate } from './useFeatureGate.js'

type CreatorAvailability = { available: Readonly<Ref<boolean>>; loading: Readonly<Ref<boolean>>; refresh: () => Promise<void> }
export const CREATOR_AVAILABILITY_KEY: InjectionKey<CreatorAvailability> = Symbol('creator-availability')

/** AppShell owns one bounded probe; legacy health responses keep creator routes unavailable. */
export function provideCreatorAvailability() {
  const gate = useFeatureGate(), online = computed(() => gate.availability(Feature.CREATORS).available)
  const available = ref(false), loading = ref(false)
  let generation = 0, controller: AbortController | null = null
  async function refresh() {
    controller?.abort()
    const gen = ++generation
    if (!online.value) { loading.value = false; return }
    const request = new AbortController()
    controller = request; loading.value = true
    const timer = setTimeout(() => request.abort(), 5000)
    try {
      const supported = await getCreatorAvailability(request.signal)
      if (gen === generation && !request.signal.aborted) available.value = supported
    } catch {
      // Fail closed initially, but a transient disconnect must not discard an existing form.
    } finally {
      clearTimeout(timer)
      if (gen === generation) loading.value = false
    }
  }
  const context = { available: readonly(available), loading: readonly(loading), refresh }
  provide(CREATOR_AVAILABILITY_KEY, context)
  watch(online, () => { void refresh() }, { immediate: true })
  const retryUnavailable = () => { if (!available.value && !loading.value) void refresh() }
  onMounted(() => window.addEventListener('focus', retryUnavailable))
  onScopeDispose(() => { generation++; controller?.abort(); window.removeEventListener('focus', retryUnavailable) })
  return context
}

export function useCreatorAvailability(): CreatorAvailability {
  return inject(CREATOR_AVAILABILITY_KEY, { available: readonly(ref(false)), loading: readonly(ref(false)), refresh: async () => {} })
}
