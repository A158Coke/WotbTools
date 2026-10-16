import { computed, onScopeDispose, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import * as api from '../api/creators.js'
import { useAuth, tournamentAdminAllowed } from './useAuth.js'
import { useFeatureGate } from './useFeatureGate.js'
import { Feature } from '../app/featureCapabilities.js'

export function useCreators(deps: { api?: typeof api; auth?: ReturnType<typeof useAuth>; route?: ReturnType<typeof useRoute>;
  router?: Pick<ReturnType<typeof useRouter>, 'push'>; network?: () => ReturnType<ReturnType<typeof useFeatureGate>['availability']> } = {}) {
  const transport = deps.api ?? api, auth = deps.auth ?? useAuth()
  const route = deps.route ?? useRoute(), router = deps.router ?? useRouter()
  const gate = useFeatureGate()
  const network = computed(deps.network ?? (() => gate.availability(Feature.CREATORS)))
  const categoryId = computed(() => {
    const value = route.query.creatorCategory
    return typeof value === 'string' && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null
  })
  const categories = ref<api.CreatorCategory[]>([]), creators = ref<api.CreatorCard[]>([])
  const favoriteIds = ref(new Set<number>()), pendingIds = ref(new Set<number>())
  const loading = ref(false), error = ref<unknown>(null), favoriteError = ref<unknown>(null)
  const favoritesReady = ref(false)
  const adminAllowed = computed(() => tournamentAdminAllowed(auth))
  const signedIn = computed(() => auth.authenticated.value && auth.authInitState.value === 'authenticated')
  // Public reads and account-private state have separate ownership: an auth change must not hide anonymous data.
  let catalogGeneration = 0, catalogController = new AbortController()
  let catalogUpdates = new Map<number, api.CreatorCard>()
  let activeCategory = categoryId.value
  let identityGeneration = 0, identityController = new AbortController()
  const ordered = computed(() => [...creators.value].sort((a, b) => b.score - a.score
    || Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id - a.id))

  async function refresh() {
    catalogController.abort(); catalogController = new AbortController()
    catalogUpdates = new Map()
    const gen = ++catalogGeneration, signal = catalogController.signal
    const updates = catalogUpdates
    error.value = null; loading.value = false
    if (categoryId.value !== activeCategory) { creators.value = []; activeCategory = categoryId.value }
    if (!network.value.available) return
    loading.value = true
    try {
      const [dictionary, cards] = await Promise.all([transport.listCreatorCategories(signal), transport.listCreators(categoryId.value, signal)])
      if (gen !== catalogGeneration || signal.aborted) return
      categories.value = dictionary; creators.value = cards.map(card => updates.get(card.id) ?? card)
    } catch (value) { if (gen === catalogGeneration && !signal.aborted) error.value = value }
    finally { if (gen === catalogGeneration) loading.value = false }
  }
  function resetIdentity() {
    identityGeneration++; identityController.abort(); identityController = new AbortController()
    favoriteIds.value = new Set(); pendingIds.value = new Set(); favoritesReady.value = false; favoriteError.value = null
  }
  async function refreshFavorites() {
    resetIdentity()
    if (!signedIn.value || !network.value.available) return
    const gen = identityGeneration, epoch = auth.authEpoch(), signal = identityController.signal
    try {
      const value = await transport.getCreatorFavorites(signal)
      if (gen === identityGeneration && epoch === auth.authEpoch() && !signal.aborted && signedIn.value) {
        favoriteIds.value = new Set(value.creatorIds); favoritesReady.value = true
      }
    } catch (value) { if (gen === identityGeneration && epoch === auth.authEpoch() && !signal.aborted) favoriteError.value = value }
  }
  async function toggleFavorite(id: number) {
    if (!signedIn.value) {
      const gen = identityGeneration
      try { await auth.login({ path: route.path, query: { ...route.query }, hash: route.hash }) }
      catch (value) { if (gen === identityGeneration) favoriteError.value = value }
      return
    }
    if (!network.value.available || pendingIds.value.has(id) || !favoritesReady.value) return
    const gen = identityGeneration, epoch = auth.authEpoch(), signal = identityController.signal
    pendingIds.value = new Set([...pendingIds.value, id]); favoriteError.value = null
    try {
      const result = await transport.setCreatorFavorite(id, !favoriteIds.value.has(id), signal)
      if (gen !== identityGeneration || epoch !== auth.authEpoch() || signal.aborted || !signedIn.value) return
      // Replay mutations completed during this read onto its response, preserving the new category's membership.
      catalogUpdates.set(result.creator.id, result.creator)
      creators.value = creators.value.map(card => card.id === result.creator.id ? result.creator : card)
      const next = new Set(favoriteIds.value)
      if (result.active) next.add(id); else next.delete(id)
      favoriteIds.value = next
    } catch (value) { if (gen === identityGeneration && epoch === auth.authEpoch() && !signal.aborted) favoriteError.value = value }
    finally { if (gen === identityGeneration && epoch === auth.authEpoch()) pendingIds.value = new Set([...pendingIds.value].filter(value => value !== id)) }
  }
  function selectCategory(id: number | null) {
    const query = { ...route.query }
    if (id) query.creatorCategory = String(id); else delete query.creatorCategory
    return router.push({ path: route.path, query, hash: route.hash })
  }
  watch([categoryId, () => network.value.available], () => { void refresh() }, { immediate: true })
  watch([signedIn, () => auth.tokenParsed.value?.sub, () => network.value.available], () => { void refreshFavorites() }, { immediate: true })
  onScopeDispose(() => { catalogGeneration++; catalogController.abort(); resetIdentity() })
  return { categoryId, categories, creators: ordered, favoriteIds, pendingIds, favoritesReady, signedIn, adminAllowed,
    network, loading, error, favoriteError, refresh, refreshFavorites, toggleFavorite, selectCategory }
}
