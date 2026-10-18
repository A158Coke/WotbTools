import { computed, onScopeDispose, ref, watch, toValue } from 'vue'
import type { MaybeRefOrGetter } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import * as api from '../api/creators.js'
import type { CreatorAvailability } from '../shared/creatorAvailability.js'
import { useCreatorAvailability } from './useCreatorAvailability.js'
import { useAuth, contentAdminAllowed } from './useAuth.js'
import { useFeatureGate } from './useFeatureGate.js'
import { Feature } from '../app/featureCapabilities.js'

export function useCreators(deps: { type?: MaybeRefOrGetter<api.RecommendationType>; api?: typeof api; auth?: ReturnType<typeof useAuth>; route?: ReturnType<typeof useRoute>;
  availability?: CreatorAvailability; router?: Pick<ReturnType<typeof useRouter>, 'push' | 'replace'>;
  network?: () => ReturnType<ReturnType<typeof useFeatureGate>['availability']> } = {}) {
  const transport = deps.api ?? api, auth = deps.auth ?? useAuth()
  const availability = deps.availability ?? useCreatorAvailability()
  const route = deps.route ?? useRoute(), router = deps.router ?? useRouter(), gate = useFeatureGate()
  const type = computed(() => toValue(deps.type) ?? 'UP')
  // Router commits before the parent passes its new type prop; never reconcile the new URL against the old type.
  const routeMatchesType = computed(() => route.query.view === (type.value === 'VIDEO' ? 'recommended-videos' : 'creators'))
  const network = computed(deps.network ?? (() => gate.availability(Feature.CREATORS)))
  const categoryId = computed(() => {
    const value = route.query.creatorCategory
    return typeof value === 'string' && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null
  })
  const categories = computed(() => availability.publicCategories.value.filter(value => value.type === type.value)), creators = ref<api.RecommendationCard[]>([])
  const listLoading = ref(false), listError = ref<unknown>(null)
  const loading = computed(() => listLoading.value || availability.loading.value)
  const error = computed(() => listError.value ?? availability.error.value)
  const adminAllowed = computed(() => auth.authInitState.value === 'authenticated' && contentAdminAllowed(auth))
  // Public content can arrive before check-sso; do not destroy an administrator's deep link while identity is pending.
  const invalidCategory = computed(() => routeMatchesType.value && !['idle', 'initializing'].includes(auth.authInitState.value)
    && !adminAllowed.value && availability.contentKnown.value && categoryId.value !== null
    && !categories.value.some(value => value.id === categoryId.value))
  let disposed = false
  let generation = 0, controller = new AbortController(), activeCategory = categoryId.value, inFlight: Promise<void> | null = null
  function cancel() { generation++; controller.abort(); inFlight = null; listLoading.value = false }
  function loadList(): Promise<void> {
    if (inFlight) return inFlight
    if (disposed || !routeMatchesType.value || !network.value.available || invalidCategory.value) return Promise.resolve()
    controller = new AbortController()
    const gen = ++generation, signal = controller.signal
    listLoading.value = true; listError.value = null
    inFlight = transport.listRecommendations(type.value, categoryId.value, availability.recommendationsSupported.value, signal).then(cards => {
      if (gen === generation && !signal.aborted) creators.value = cards
    }).catch(value => { if (gen === generation && !signal.aborted) listError.value = value })
      .finally(() => { if (gen === generation) { listLoading.value = false; inFlight = null } })
    return inFlight
  }
  function categoryLocation(id: number | null) {
    const query = { ...route.query }
    if (id) query.creatorCategory = String(id); else delete query.creatorCategory
    return { path: route.path, query, hash: route.hash }
  }
  let replacing: Promise<unknown> | null = null
  function reconcileCategory() {
    if (!invalidCategory.value) return replacing ?? Promise.resolve()
    if (!replacing) replacing = Promise.resolve(router.replace(categoryLocation(null))).finally(() => { replacing = null })
    return replacing
  }
  async function refresh() {
    cancel()
    await availability.refresh()
    if (disposed) return
    await reconcileCategory()
    await loadList()
  }
  function selectCategory(id: number | null) { return router.push(categoryLocation(id)) }
  watch(invalidCategory, value => { if (value) { cancel(); creators.value = []; void reconcileCategory() } }, { immediate: true, flush: 'sync' })
  watch([routeMatchesType, type, categoryId, () => network.value.available, adminAllowed, () => auth.tokenParsed.value?.sub, availability.recommendationsSupported], () => {
    cancel()
    if (categoryId.value !== activeCategory || creators.value.some(value => value.type !== type.value)) { creators.value = []; activeCategory = categoryId.value }
    void loadList()
  }, { immediate: true })
  onScopeDispose(() => { disposed = true; cancel() })
  return { categoryId, categories, creators, adminAllowed, network, loading, error, refresh, selectCategory }
}
