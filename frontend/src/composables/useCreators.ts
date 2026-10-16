import { computed, onScopeDispose, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import * as api from '../api/creators.js'
import { useAuth, tournamentAdminAllowed } from './useAuth.js'
import { useFeatureGate } from './useFeatureGate.js'
import { Feature } from '../app/featureCapabilities.js'

export function useCreators(deps: { api?: typeof api; auth?: ReturnType<typeof useAuth>; route?: ReturnType<typeof useRoute>;
  router?: Pick<ReturnType<typeof useRouter>, 'push'>; network?: () => ReturnType<ReturnType<typeof useFeatureGate>['availability']> } = {}) {
  const transport = deps.api ?? api, auth = deps.auth ?? useAuth()
  const route = deps.route ?? useRoute(), router = deps.router ?? useRouter(), gate = useFeatureGate()
  const network = computed(deps.network ?? (() => gate.availability(Feature.CREATORS)))
  const categoryId = computed(() => {
    const value = route.query.creatorCategory
    return typeof value === 'string' && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null
  })
  const categories = ref<api.CreatorCategory[]>([]), creators = ref<api.CreatorCard[]>([])
  const loading = ref(false), error = ref<unknown>(null), adminAllowed = computed(() => tournamentAdminAllowed(auth))
  let generation = 0, controller = new AbortController(), activeCategory = categoryId.value
  async function refresh() {
    controller.abort(); controller = new AbortController()
    const gen = ++generation, signal = controller.signal
    error.value = null; loading.value = false
    if (categoryId.value !== activeCategory) { creators.value = []; activeCategory = categoryId.value }
    if (!network.value.available) return
    loading.value = true
    try {
      const [dictionary, cards] = await Promise.all([transport.listCreatorCategories(signal), transport.listCreators(categoryId.value, signal)])
      if (gen === generation && !signal.aborted) { categories.value = dictionary; creators.value = cards }
    } catch (value) { if (gen === generation && !signal.aborted) error.value = value }
    finally { if (gen === generation) loading.value = false }
  }
  function selectCategory(id: number | null) {
    const query = { ...route.query }
    if (id) query.creatorCategory = String(id); else delete query.creatorCategory
    return router.push({ path: route.path, query, hash: route.hash })
  }
  watch([categoryId, () => network.value.available], () => { void refresh() }, { immediate: true })
  onScopeDispose(() => { generation++; controller.abort() })
  return { categoryId, categories, creators, adminAllowed, network, loading, error, refresh, selectCategory }
}
