import type { MaybeRefOrGetter } from 'vue'
import { computed, onScopeDispose, ref, watch, toValue } from 'vue'
import * as api from '../api/creators.js'
import { useAuth, contentAdminAllowed } from './useAuth.js'
import { useFeatureGate } from './useFeatureGate.js'
import { useCreatorAvailability } from './useCreatorAvailability.js'
import type { CreatorAvailability } from '../shared/creatorAvailability.js'
import { Feature } from '../app/featureCapabilities.js'

export function useCreatorManagement(deps: { type?: MaybeRefOrGetter<api.RecommendationType>; api?: typeof api; auth?: ReturnType<typeof useAuth>;
  availability?: CreatorAvailability; onChanged?: () => Promise<unknown>; network?: () => ReturnType<ReturnType<typeof useFeatureGate>['availability']> } = {}) {
  const transport = deps.api ?? api, auth = deps.auth ?? useAuth(), gate = useFeatureGate()
  const availability = deps.availability ?? useCreatorAvailability()
  const type = computed(() => toValue(deps.type) ?? 'UP')
  const typed = () => availability.recommendationsSupported.value
  const network = computed(deps.network ?? (() => gate.availability(Feature.CREATORS)))
  const allowed = computed(() => contentAdminAllowed(auth) && auth.authInitState.value === 'authenticated' && availability.typeAvailable(type.value))
  const categories = ref<api.RecommendationCategory[]>([]), levels = ref<api.CreatorLevel[]>([])
  const avatarUploadsAvailable = ref(false), metadataLoaded = ref(false), detail = ref<api.RecommendationDetail | null>(null)
  const loading = ref(false), busy = ref(false), editorLoading = ref(false), editorOpen = ref(false)
  const error = ref<unknown>(null), editorError = ref<unknown>(null), notice = ref(''), draftEpoch = ref(0)
  let generation = 0, controller = new AbortController(), editorGeneration = 0, readGeneration = 0
  let editingId: number | null = null
  let mounted = true
  let savedForm: { draftGeneration: number; epoch: number; editing: boolean } | null = null
  function invalidate() {
    generation++; editorGeneration++; readGeneration++; controller.abort(); controller = new AbortController()
    loading.value = false; busy.value = false; editorLoading.value = false; editorOpen.value = false
    detail.value = null; error.value = null; editorError.value = null; notice.value = ''; draftEpoch.value++
    editingId = null
    savedForm = null
  }
  function owns(gen: number, epoch: number) { return mounted && gen === generation && epoch === auth.authEpoch() && allowed.value && network.value.available && !controller.signal.aborted }
  function ownsForm(context: { draftGeneration: number; epoch: number }) {
    return mounted && context.draftGeneration === draftEpoch.value && context.epoch === auth.authEpoch() && allowed.value
  }
  async function refresh() {
    if (!allowed.value || !network.value.available || busy.value || editorLoading.value) return
    const gen = generation, epoch = auth.authEpoch(), signal = controller.signal, readGen = ++readGeneration
    loading.value = true; error.value = null
    try {
      const metadata = await transport.getRecommendationMetadata(type.value, typed(), signal)
      if (owns(gen, epoch) && readGen === readGeneration) { categories.value = metadata.categories; levels.value = metadata.levels; avatarUploadsAvailable.value = metadata.imageUploadsAvailable; metadataLoaded.value = true }
    } catch (value) { if (owns(gen, epoch) && readGen === readGeneration) error.value = value }
    finally { if (owns(gen, epoch) && readGen === readGeneration) loading.value = false }
  }
  async function editCreator(id: number) {
    if (!allowed.value || !network.value.available || busy.value) return
    const gen = generation, epoch = auth.authEpoch(), editGen = ++editorGeneration, readGen = ++readGeneration
    const signal = controller.signal
    editingId = id
    draftEpoch.value++; savedForm = null
    // Opening an editor supersedes an older dictionary refresh, including its loading indicator.
    loading.value = false
    editorOpen.value = true; editorLoading.value = true; detail.value = null; editorError.value = null
    try {
      const [metadata, value] = await Promise.all([transport.getRecommendationMetadata(type.value, typed(), signal), transport.getRecommendationDetail(id, type.value, typed(), signal)])
      if (owns(gen, epoch) && editGen === editorGeneration && readGen === readGeneration) {
        categories.value = metadata.categories; levels.value = metadata.levels; avatarUploadsAvailable.value = metadata.imageUploadsAvailable; metadataLoaded.value = true; detail.value = value
      }
    } catch (value) { if (owns(gen, epoch) && editGen === editorGeneration) editorError.value = value }
    finally { if (owns(gen, epoch) && editGen === editorGeneration) editorLoading.value = false }
  }
  function closeEditor() {
    if (busy.value) return
    editorGeneration++; draftEpoch.value++; savedForm = null; editorOpen.value = false; editorLoading.value = false; detail.value = null; editorError.value = null; editingId = null
  }
  function retryEditor() { if (editingId != null) return editCreator(editingId) }
  async function mutation(run: (signal: AbortSignal) => Promise<void>, editor = false) {
    if (!allowed.value || !network.value.available || busy.value || loading.value) return false
    const gen = generation, epoch = auth.authEpoch()
    busy.value = true; (editor ? editorError : error).value = null; notice.value = ''
    try {
      await run(controller.signal)
      // The server acknowledged the write. A catalog refresh has its own read/error ownership.
      if (owns(gen, epoch)) void Promise.resolve().then(() => {
        if (!owns(gen, epoch)) return
        const publicRefresh = availability.refreshPublicCategories()
        return Promise.allSettled([publicRefresh, Promise.resolve().then(() => {
          if (owns(gen, epoch)) return deps.onChanged?.()
        })])
      }).catch(() => { /* Best-effort refresh must not turn a committed write into a retryable failure. */ })
      return true
    } catch (value) { if (owns(gen, epoch)) (editor ? editorError : error).value = value; return false }
    finally { if (owns(gen, epoch)) busy.value = false }
  }
  async function save(value: api.RecommendationSaveRequest, avatar: File | null = null, editing = false) {
    if (value.type !== type.value) return false
    const id = editing ? detail.value?.id : null
    if (editing && !id) return false
    const gen = generation, epoch = auth.authEpoch(), context = { draftGeneration: draftEpoch.value, epoch, editing }
    const success = await mutation(async signal => { await transport.saveRecommendation(id ?? null, value, avatar, typed(), signal) }, editing)
    if (success && ownsForm(context)) savedForm = context
    if (success && owns(gen, epoch)) notice.value = 'saved'
    return success
  }
  function finishSave(editing = false) {
    if (!savedForm || savedForm.editing !== editing || !ownsForm(savedForm)) return
    savedForm = null
    if (editing) closeEditor(); else draftEpoch.value++
  }
  async function remove(id: number, expectedVersion: number) {
    const gen = generation, epoch = auth.authEpoch()
    const success = await mutation(async signal => { await transport.removeRecommendation(id, type.value, expectedVersion, typed(), signal) })
    if (success && owns(gen, epoch)) notice.value = 'removed'
    return success && owns(gen, epoch)
  }
  async function addDictionary(kind: 'categories' | 'levels', name: string) {
    if (kind === 'levels' && type.value !== 'UP') return false
    const gen = generation, epoch = auth.authEpoch()
    const success = await mutation(async signal => {
      const value = kind === 'categories' ? await transport.addRecommendationCategory(type.value, name.trim(), typed(), signal) : await transport.addCreatorLevel(name.trim(), signal)
      if (!owns(gen, epoch)) return
      if (kind === 'categories') categories.value = [...categories.value, value as api.RecommendationCategory]; else levels.value = [...levels.value, value]
    })
    if (success && owns(gen, epoch)) notice.value = 'saved'
    return success && owns(gen, epoch)
  }
  async function removeDictionary(kind: 'categories' | 'levels', id: number) {
    if (kind === 'levels' && type.value !== 'UP') return false
    const gen = generation, epoch = auth.authEpoch()
    const success = await mutation(async signal => {
      if (kind === 'categories') { await transport.removeRecommendationCategory(id, type.value, typed(), signal); if (owns(gen, epoch)) categories.value = categories.value.filter(value => value.id !== id) }
      else { await transport.removeCreatorLevel(id, signal); if (owns(gen, epoch)) levels.value = levels.value.filter(value => value.id !== id) }
    })
    if (success && owns(gen, epoch)) notice.value = 'removed'
    return success && owns(gen, epoch)
  }
  watch([type, allowed, () => auth.tokenParsed.value?.sub], () => {
    invalidate(); categories.value = []; levels.value = []; avatarUploadsAvailable.value = false; metadataLoaded.value = false
    if (allowed.value && network.value.available) void refresh()
  }, { immediate: true })
  watch([() => network.value.available, availability.recommendationsSupported], ([available, typed], [, previousTyped]) => {
    if (!available || typed !== previousTyped) {
      generation++; readGeneration++; editorGeneration++; controller.abort(); controller = new AbortController()
      loading.value = false; busy.value = false; editorLoading.value = false
      if (!available) return
    }
    // A transport upgrade uses the same neutral model and must not discard an active UP draft.
    // A temporary disconnect cancels work without discarding this account's drafts or selected image.
    if (editorOpen.value && !detail.value && editingId != null) void editCreator(editingId)
    else void refresh()
  })
  onScopeDispose(() => { mounted = false; invalidate() })
  return { network, allowed, categories, levels, avatarUploadsAvailable, metadataLoaded, detail, loading, busy, editorLoading, editorOpen,
    error, editorError, notice, draftEpoch, operationSignal: () => controller.signal, refresh, editCreator, retryEditor, closeEditor, save, finishSave, remove, addDictionary, removeDictionary }
}
