import { computed, onScopeDispose, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { LocationQueryRaw } from 'vue-router'
import * as api from '../api/game-announcements.js'
import { useAuth } from './useAuth.js'
import { useFeatureGate } from './useFeatureGate.js'
import { Feature } from '../app/featureCapabilities.js'
import { confirm } from './useConfirm.js'
import { ApiError } from '../utils/http.js'

const keys = ['newsTab', 'newsPage', 'newsArticle', 'newsArchive', 'newsVersion', 'newsManage', 'newsSource'] as const
const single = (value: unknown) => typeof value === 'string' ? value : ''
const positive = (value: unknown) => /^[1-9]\d*$/.test(single(value)) && Number.isSafeInteger(Number(value)) ? Number(value) : null

export function useGameAnnouncements(route = useRoute(), router = useRouter(), deps = { api, auth: useAuth(), gate: useFeatureGate(), confirm }) {
  const auth = deps.auth, transport = deps.api
  const allowed = computed(() => auth.isNewsAdmin.value)
  const network = computed(() => deps.gate.availability(Feature.NEWS))
  const tab = computed(() => route.query.newsTab === 'history' ? 'history' : 'latest')
  const page = computed(() => positive(route.query.newsPage) ?? 1)
  const version = computed(() => single(route.query.newsVersion))
  const managementRequested = computed(() => tab.value === 'history' && route.query.newsManage === '1')
  const denied = computed(() => managementRequested.value && !allowed.value)
  const managed = computed(() => managementRequested.value && allowed.value)
  const articleKey = computed(() => tab.value === 'latest' ? single(route.query.newsArticle) : '')
  const archiveId = computed(() => tab.value === 'history' ? positive(route.query.newsArchive) : null)
  const categories = ref<api.NewsCategory[]>([]), sources = ref<api.NewsSource[]>([])
  const articlePage = ref<api.NewsArticlePage | null>(null), archivePage = ref<api.NewsArchivePage | null>(null)
  const article = ref<api.NewsArticle | null>(null), archive = ref<api.NewsArchive | null>(null)
  const selected = ref<api.NewsArticle[]>([])
  const loading = ref(false), busy = ref(false), error = ref<unknown>(null), notice = ref(''), editorEpoch = ref(0)
  const contextKey = computed(() => keys.map(key => `${key}=${String(route.query[key] ?? '')}`).join('&'))
  const total = computed(() => tab.value === 'latest' ? articlePage.value?.totalItems ?? 0 : archivePage.value?.totalItems ?? 0)
  let controller = new AbortController(), generation = 0, poll: ReturnType<typeof setTimeout> | undefined
  function invalidate() {
    generation++; controller.abort(); controller = new AbortController()
    clearTimeout(poll); loading.value = false; busy.value = false
  }
  function owns(gen: number, epoch: number) { return gen === generation && epoch === auth.authEpoch() && !controller.signal.aborted }
  function schedulePoll(gen: number, epoch: number) {
    clearTimeout(poll)
    if (!owns(gen, epoch) || busy.value || !managed.value || !network.value.available) return
    if (archive.value?.status !== 'PREPARING' && !archivePage.value?.items.some(item => item.status === 'PREPARING')) return
    poll = setTimeout(() => { if (owns(gen, epoch) && !busy.value) void refresh() }, 5000)
  }
  function navigate(values: Record<string, string | number | null>, replace = false) {
    const query: LocationQueryRaw = { ...route.query, view: 'game-announcements' }
    for (const [key, value] of Object.entries(values)) { if (value == null || value === '') delete query[key]; else query[key] = String(value) }
    return router[replace ? 'replace' : 'push']({ path: '/', query, hash: route.hash })
  }
  function switchTab(value: string) {
    return navigate({ newsTab: value, newsPage: null, newsArticle: null, newsArchive: null, newsManage: null, newsVersion: null })
  }
  async function refresh() {
    invalidate()
    const gen = generation, epoch = auth.authEpoch(), signal = controller.signal
    error.value = null
    if (!network.value.available || denied.value) return
    if (route.query.newsSource && route.query.newsSource !== 'WG') { await navigate({ newsSource: 'WG' }, true); return }
    loading.value = true
    try {
      const [sourceValues, categoryValues] = await Promise.all([transport.listNewsSources(signal), transport.listNewsCategories(signal)])
      if (!owns(gen, epoch)) return
      sources.value = sourceValues; categories.value = categoryValues
      if (tab.value === 'latest') {
        const values = await transport.listNewsArticles(page.value, signal)
        if (!owns(gen, epoch)) return
        articlePage.value = values
        if (articleKey.value) {
          const detail = await transport.getNewsArticle(articleKey.value, signal)
          if (!owns(gen, epoch)) return
          article.value = detail
        }
      } else {
        const values = await transport.listNewsArchives(page.value, version.value, managed.value, signal)
        if (!owns(gen, epoch)) return
        archivePage.value = values
        if (archiveId.value) {
          const detail = await transport.getNewsArchive(archiveId.value, managed.value, signal)
          if (!owns(gen, epoch)) return
          archive.value = detail
        }
      }
    } catch (value) {
      if (!owns(gen, epoch)) return
      error.value = value
      if (value instanceof ApiError && value.status === 404) {
        article.value = null; archive.value = null
        notice.value = 'notFound'
        await navigate({ newsArticle: null, newsArchive: null }, true)
      }
    } finally {
      if (owns(gen, epoch)) { loading.value = false; schedulePoll(gen, epoch) }
    }
  }
  async function mutate(run: (signal: AbortSignal) => Promise<unknown>, reload = true) {
    if (!allowed.value || busy.value || loading.value || !network.value.available) return false
    const gen = generation, epoch = auth.authEpoch()
    busy.value = true; error.value = null; notice.value = ''; clearTimeout(poll)
    try {
      const result = await run(controller.signal)
      if (!owns(gen, epoch) || !allowed.value) return false
      if (result === false) return false
      notice.value = 'saved'
      if (reload) await refresh()
      return true
    } catch (value) { if (owns(gen, epoch) && allowed.value) error.value = value; return false }
    finally {
      if (owns(gen, epoch)) { busy.value = false; schedulePoll(gen, epoch) }
    }
  }
  async function selectArticle(key: string) {
    const existing = selected.value.findIndex(value => value.sourceKey === key)
    if (existing >= 0) { selected.value.splice(existing, 1); return }
    if (selected.value.length >= 20) { notice.value = 'selectionLimit'; return }
    const success = await mutate(async signal => {
      const gen = generation, epoch = auth.authEpoch()
      const value = await transport.getNewsArticle(key, signal)
      if (owns(gen, epoch) && allowed.value) selected.value.push(value)
    }, false)
    if (success) notice.value = ''
  }
  async function save(value: api.NewsCreateRequest) {
    let ids: number[] = []
    const success = await mutate(async signal => { const receipt = await transport.createNewsArchives(value, signal); ids = receipt.archiveIds }, false)
    if (!success) {
      if (error.value instanceof ApiError && error.value.errorCode === 'NEWS_REVISION_CONFLICT') {
        selected.value = []; editorEpoch.value++
      }
      return false
    }
    selected.value = []; editorEpoch.value++
    await navigate({ newsTab: 'history', newsManage: '1', newsArchive: ids[0] ?? null, newsArticle: null, newsPage: null })
    return true
  }
  async function act(target: api.NewsArchive, action: 'retry' | 'withdraw' | 'restore' | 'delete', message: string) {
    await mutate(async signal => {
      const gen = generation, epoch = auth.authEpoch()
      if (!await deps.confirm({ title: target.title, message, danger: action === 'delete', signal })) return false
      if (!owns(gen, epoch) || !allowed.value) return false
      if (action === 'delete') {
        await transport.deleteNewsArchive(target, signal)
        if (owns(gen, epoch) && archiveId.value === target.id) await navigate({ newsArchive: null })
      } else await transport.changeNewsArchive(target, action, signal)
    })
  }
  async function removeCategory(category: api.NewsCategory, message: string) {
    await mutate(async signal => {
      const gen = generation, epoch = auth.authEpoch()
      if (!await deps.confirm({ title: category.name, message, danger: true, signal })) return false
      if (owns(gen, epoch) && allowed.value) await transport.deleteNewsCategory(category.id, signal)
    })
  }
  watch(contextKey, () => {
    article.value = null; archive.value = null; articlePage.value = null; archivePage.value = null
    editorEpoch.value++
    if (tab.value !== 'latest') selected.value = []
    void refresh()
  }, { immediate: true })
  watch([() => auth.tokenParsed.value?.sub, allowed], () => {
    selected.value = []; article.value = null; archive.value = null; archivePage.value = null
    editorEpoch.value++; void refresh()
  })
  // A connectivity interruption may happen after the server saved the request. Keep the
  // editor's frozen UUID/payload alive so a retry cannot create another archive batch.
  watch(() => network.value.available, () => { void refresh() })
  onScopeDispose(invalidate)
  return { allowed, network, tab, page, version, managed, denied, articleKey, archiveId, categories, sources, articlePage, archivePage,
    article, archive, selected, loading, busy, error, notice, editorEpoch, total, refresh, navigate, switchTab, mutate, selectArticle, save, act, removeCategory }
}
