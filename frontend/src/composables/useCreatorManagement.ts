import { computed, onScopeDispose, ref, watch } from 'vue'
import * as api from '../api/creators.js'
import { useAuth, tournamentAdminAllowed } from './useAuth.js'
import { useFeatureGate } from './useFeatureGate.js'
import { Feature } from '../app/featureCapabilities.js'

export function useCreatorManagement(deps: { api?: typeof api; auth?: ReturnType<typeof useAuth>;
  onChanged?: () => Promise<unknown>; network?: () => ReturnType<ReturnType<typeof useFeatureGate>['availability']> } = {}) {
  const transport = deps.api ?? api, auth = deps.auth ?? useAuth(), gate = useFeatureGate()
  const network = computed(deps.network ?? (() => gate.availability(Feature.CREATORS)))
  const allowed = computed(() => tournamentAdminAllowed(auth) && auth.authInitState.value === 'authenticated')
  const categories = ref<api.CreatorCategory[]>([]), levels = ref<api.CreatorLevel[]>([])
  const settings = ref<api.CreatorSettings | null>(null), detail = ref<api.CreatorDetail | null>(null)
  const loading = ref(false), busy = ref(false), editorLoading = ref(false), editorOpen = ref(false)
  const error = ref<unknown>(null), editorError = ref<unknown>(null), notice = ref(''), draftEpoch = ref(0)
  let generation = 0, controller = new AbortController(), editorGeneration = 0, readGeneration = 0
  let editingId: number | null = null
  function invalidate() {
    generation++; editorGeneration++; readGeneration++; controller.abort(); controller = new AbortController()
    loading.value = false; busy.value = false; editorLoading.value = false; editorOpen.value = false
    detail.value = null; error.value = null; editorError.value = null; notice.value = ''; draftEpoch.value++
    editingId = null
  }
  function owns(gen: number, epoch: number) { return gen === generation && epoch === auth.authEpoch() && allowed.value && network.value.available && !controller.signal.aborted }
  async function refresh() {
    if (!allowed.value || !network.value.available || busy.value || editorLoading.value) return
    const gen = generation, epoch = auth.authEpoch(), signal = controller.signal, readGen = ++readGeneration
    loading.value = true; error.value = null
    try {
      const [nextCategories, nextLevels, nextSettings] = await Promise.all([
        transport.listCreatorAdminCategories(signal), transport.listCreatorLevels(signal), transport.getCreatorSettings(signal),
      ])
      if (owns(gen, epoch) && readGen === readGeneration) { categories.value = nextCategories; levels.value = nextLevels; settings.value = nextSettings }
    } catch (value) { if (owns(gen, epoch) && readGen === readGeneration) error.value = value }
    finally { if (owns(gen, epoch) && readGen === readGeneration) loading.value = false }
  }
  async function editCreator(id: number) {
    if (!allowed.value || !network.value.available || busy.value) return
    const gen = generation, epoch = auth.authEpoch(), editGen = ++editorGeneration, readGen = ++readGeneration
    const signal = controller.signal
    editingId = id
    // Opening an editor supersedes an older dictionary refresh, including its loading indicator.
    loading.value = false
    editorOpen.value = true; editorLoading.value = true; detail.value = null; editorError.value = null
    try {
      const [nextCategories, nextLevels, nextSettings, value] = await Promise.all([
        transport.listCreatorAdminCategories(signal), transport.listCreatorLevels(signal), transport.getCreatorSettings(signal), transport.getCreatorDetail(id, signal),
      ])
      if (owns(gen, epoch) && editGen === editorGeneration && readGen === readGeneration) {
        categories.value = nextCategories; levels.value = nextLevels; settings.value = nextSettings; detail.value = value
      }
    } catch (value) { if (owns(gen, epoch) && editGen === editorGeneration) editorError.value = value }
    finally { if (owns(gen, epoch) && editGen === editorGeneration) editorLoading.value = false }
  }
  function closeEditor() {
    if (busy.value) return
    editorGeneration++; editorOpen.value = false; editorLoading.value = false; detail.value = null; editorError.value = null; editingId = null
  }
  function retryEditor() { if (editingId != null) return editCreator(editingId) }
  async function mutation(run: (signal: AbortSignal) => Promise<void>, editor = false) {
    if (!allowed.value || !network.value.available || busy.value || loading.value) return false
    const gen = generation, epoch = auth.authEpoch()
    busy.value = true; (editor ? editorError : error).value = null; notice.value = ''
    try {
      await run(controller.signal)
      if (!owns(gen, epoch)) return false
      await deps.onChanged?.()
      if (!owns(gen, epoch)) return false
      return true
    } catch (value) { if (owns(gen, epoch)) (editor ? editorError : error).value = value; return false }
    finally { if (owns(gen, epoch)) busy.value = false }
  }
  async function save(value: api.CreatorSaveRequest, editing = false) {
    const id = editing ? detail.value?.id : null
    if (editing && !id) return false
    const success = await mutation(async signal => { await transport.saveCreator(id ?? null, value, signal) }, editing)
    if (success) notice.value = 'saved'
    return success
  }
  function finishSave(editing = false) { if (editing) closeEditor(); else draftEpoch.value++ }
  async function remove(id: number) {
    const success = await mutation(async signal => { await transport.removeCreator(id, signal) })
    if (success) notice.value = 'removed'
    return success
  }
  async function addDictionary(kind: 'categories' | 'levels', name: string) {
    const gen = generation, epoch = auth.authEpoch()
    const success = await mutation(async signal => {
      const value = kind === 'categories' ? await transport.addCreatorCategory(name.trim(), signal) : await transport.addCreatorLevel(name.trim(), signal)
      if (!owns(gen, epoch)) return
      if (kind === 'categories') categories.value = [...categories.value, value]; else levels.value = [...levels.value, value]
    })
    if (success) notice.value = 'saved'
    return success
  }
  async function removeDictionary(kind: 'categories' | 'levels', id: number) {
    const gen = generation, epoch = auth.authEpoch()
    const success = await mutation(async signal => {
      if (kind === 'categories') { await transport.removeCreatorCategory(id, signal); if (owns(gen, epoch)) categories.value = categories.value.filter(value => value.id !== id) }
      else { await transport.removeCreatorLevel(id, signal); if (owns(gen, epoch)) levels.value = levels.value.filter(value => value.id !== id) }
    })
    if (success) notice.value = 'removed'
    return success
  }
  async function setThreshold(value: number) {
    const gen = generation, epoch = auth.authEpoch()
    const success = await mutation(async signal => {
      const result = await transport.saveCreatorSettings(value, signal)
      if (owns(gen, epoch)) settings.value = result
    })
    if (success) notice.value = 'saved'
    return success
  }
  watch([allowed, () => auth.tokenParsed.value?.sub], () => {
    invalidate(); categories.value = []; levels.value = []; settings.value = null
    if (allowed.value && network.value.available) void refresh()
  }, { immediate: true })
  watch(() => network.value.available, available => {
    if (!available) {
      generation++; readGeneration++; editorGeneration++; controller.abort(); controller = new AbortController()
      loading.value = false; busy.value = false; editorLoading.value = false
      return
    }
    // A temporary disconnect cancels work without discarding this account's drafts or avatar reservation.
    if (editorOpen.value && !detail.value && editingId != null) void editCreator(editingId)
    else void refresh()
  })
  onScopeDispose(invalidate)
  return { network, allowed, categories, levels, settings, detail, loading, busy, editorLoading, editorOpen,
    error, editorError, notice, draftEpoch, operationSignal: () => controller.signal, refresh, editCreator, retryEditor, closeEditor, save, finishSave, remove, addDictionary, removeDictionary, setThreshold }
}
