import { computed, onScopeDispose, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { LocationQueryRaw } from 'vue-router'
import * as api from '../api/league-broadcasts.js'
import type { BroadcastIndex, BroadcastSeasonContents } from '../api/league-broadcasts.js'
import { useAuth } from './useAuth.js'
import { useFeatureGate } from './useFeatureGate.js'
import { confirm } from './useConfirm.js'
import { Feature } from '../app/featureCapabilities.js'
import { ApiError } from '../utils/http.js'
import { BROADCAST_DISPLAY_ZONES } from '../utils/broadcastTime.js'

const queryKeys = ['lbServer', 'lbSeason', 'lbCategory'] as const
const displayZoneKey = 'wotb-broadcast-display-time-zone'
function savedDisplayZone(): string {
  try {
    const value = localStorage.getItem(displayZoneKey)
    return BROADCAST_DISPLAY_ZONES.some(zone => zone === value) ? value! : 'server'
  } catch { return 'server' }
}
function single(value: unknown): string | null { return typeof value === 'string' && value.length ? value : null }
function id(value: unknown): number | null {
  const raw = single(value)
  return raw && /^[1-9]\d*$/.test(raw) && Number.isSafeInteger(Number(raw)) ? Number(raw) : null
}

export function useLeagueBroadcasts(route = useRoute(), router = useRouter(), deps = { api, auth: useAuth(), gate: useFeatureGate(), confirm }) {
  const auth = deps.auth, transport = deps.api
  const network = computed(() => deps.gate.availability(Feature.LEAGUE_BROADCASTS))
  const allowed = computed(() => auth.isLeagueBroadcastAdmin.value)
  const index = ref<BroadcastIndex | null>(null)
  const snapshot = ref<BroadcastSeasonContents | null>(null)
  const displayTimeZonePreference = ref(savedDisplayZone())
  const defaultTimeZone = computed(() => snapshot.value?.defaultTimeZone ?? null)
  const displayTimeZone = computed(() => displayTimeZonePreference.value === 'server' ? defaultTimeZone.value : displayTimeZonePreference.value)
  watch(displayTimeZonePreference, value => {
    try { localStorage.setItem(displayZoneKey, value) } catch { /* Preference remains usable when storage is unavailable. */ }
  })
  const loading = ref(false), busy = ref(false), readFailed = ref(false), error = ref<unknown>(null), notice = ref(''), editorEpoch = ref(0)
  const servers = computed(() => index.value?.servers ?? [])
  const server = computed(() => servers.value.find(value => value === single(route.query.lbServer)) ?? null)
  const seasonId = computed(() => id(route.query.lbSeason)), categoryId = computed(() => id(route.query.lbCategory))
  const season = computed(() => snapshot.value?.season ?? null)
  const categories = computed(() => snapshot.value?.categories ?? [])
  const category = computed(() => categories.value.find(value => value.id === categoryId.value) ?? null)
  const nodes = computed(() => snapshot.value?.nodes ?? [])
  const seasons = computed(() => index.value?.seasons ?? [])
  const coverUploadAvailable = computed(() => snapshot.value?.coverUploadAvailable ?? index.value?.coverUploadAvailable ?? false)
  const contextKey = computed(() => queryKeys.map(key => `${key}=${String(route.query[key] ?? '')}`).join('&'))
  let controller = new AbortController(), generation = 0

  function invalidate() {
    generation++; controller.abort(); controller = new AbortController()
    busy.value = false; loading.value = false; editorEpoch.value++
  }
  function owns(gen: number, epoch: number) {
    return generation === gen && auth.authEpoch() === epoch && !controller.signal.aborted
  }
  function destination(value: { server?: string | null; season?: number | null; category?: number | null }) {
    const query: LocationQueryRaw = { ...route.query, view: 'league-broadcasts' }
    for (const key of queryKeys) delete query[key]
    if (value.server) query.lbServer = value.server
    if (value.server && value.season) query.lbSeason = String(value.season)
    if (value.server && value.season && value.category) query.lbCategory = String(value.category)
    return { path: '/', query, hash: route.hash }
  }
  function navigate(value: { server?: string | null; season?: number | null; category?: number | null }) {
    return router.push(destination(value))
  }
  async function repair(value: { server?: string | null; season?: number | null; category?: number | null }) {
    notice.value = 'notFound'
    await router.replace(destination(value))
  }
  async function refresh() {
    invalidate()
    const gen = generation, epoch = auth.authEpoch(), signal = controller.signal
    snapshot.value = null; error.value = null; readFailed.value = false
    if (!network.value.available) return
    loading.value = true
    try {
      const rawServer = single(route.query.lbServer)
      const selectedServer = servers.value.find(value => value === rawServer)
      const initial = await transport.listBroadcasts(selectedServer, signal)
      if (!owns(gen, epoch)) return
      index.value = initial
      if (!rawServer || !initial.servers.includes(rawServer as api.BroadcastServer)) {
        if (queryKeys.some(key => route.query[key] != null)) await repair({})
        return
      }
      if (!selectedServer) {
        const value = await transport.listBroadcasts(rawServer as api.BroadcastServer, signal)
        if (!owns(gen, epoch)) return
        index.value = value
      }
      const requestedSeason = seasonId.value, requestedCategory = categoryId.value
      if (!requestedSeason) {
        if (route.query.lbSeason != null || route.query.lbCategory != null) await repair({ server: rawServer })
        return
      }
      if (!index.value!.seasons.some(value => value.id === requestedSeason)) {
        await repair({ server: rawServer }); return
      }
      const view = await transport.getBroadcastSeasonContents(requestedSeason, signal)
      if (!owns(gen, epoch)) return
      const categoryIds = new Set(view.categories.map(category => category.id))
      if (view.season.server !== rawServer || view.season.id !== requestedSeason
        || view.categories.some(category => category.seasonId !== requestedSeason)
        || view.nodes.some(node => !categoryIds.has(node.categoryId) || node.replays.some(replay => replay.nodeId !== node.id))) {
        throw new ApiError({ errorCode: 'INVALID_RESPONSE' })
      }
      snapshot.value = view
      if (!requestedCategory || !view.categories.some(value => value.id === requestedCategory && value.seasonId === requestedSeason)) {
        if (route.query.lbCategory != null) await repair({ server: rawServer, season: requestedSeason })
        return
      }
    } catch (value) {
      if (!owns(gen, epoch)) return
      if (value instanceof ApiError && value.status === 404) {
        await repair({ server: server.value, season: snapshot.value?.season.id })
      } else { error.value = value; readFailed.value = true }
    } finally { if (owns(gen, epoch)) loading.value = false }
  }

  async function mutate(run: (signal: AbortSignal) => Promise<unknown>): Promise<boolean> {
    if (!allowed.value || busy.value || loading.value || !network.value.available) return false
    const gen = generation, epoch = auth.authEpoch()
    busy.value = true; error.value = null; notice.value = ''
    try {
      await run(controller.signal)
      if (!owns(gen, epoch) || !allowed.value) return false
      notice.value = 'saved'
      await refresh()
      return true
    } catch (value) {
      if (owns(gen, epoch) && allowed.value) error.value = value
      return false
    } finally { if (owns(gen, epoch)) busy.value = false }
  }

  async function remove(kind: 'seasons' | 'categories' | 'nodes' | 'replays', targetId: number, title: string, t: (key: string, values?: Record<string, unknown>) => string) {
    if (!allowed.value || busy.value || loading.value || !network.value.available) return
    const gen = generation, epoch = auth.authEpoch(), signal = controller.signal
    busy.value = true; error.value = null; notice.value = ''
    try {
      const preview = kind === 'replays' ? null : await transport.getBroadcastDeletionPreview(kind, targetId, signal)
      if (!owns(gen, epoch) || !allowed.value) return
      const version = preview?.expectedVersion ?? season.value?.version
      if (version == null) return
      const name = { seasons: 'season', categories: 'category', nodes: 'node', replays: 'replay' }[kind]
      const accepted = await deps.confirm({ title: t(`leagueBroadcasts.${name}DeleteTitle`),
        message: t(`leagueBroadcasts.${name}DeleteMessage`, { title, nodes: preview?.rootCount, replays: preview?.replayCount }),
        confirmLabel: t('leagueBroadcasts.delete'), danger: true, signal })
      if (!accepted || !owns(gen, epoch) || !allowed.value) return
      await transport.deleteBroadcastResource(kind, targetId, version, signal)
      if (!owns(gen, epoch) || !allowed.value) return
      notice.value = 'deleted'
      if (kind === 'seasons' && seasonId.value === targetId) await navigate({ server: server.value })
      else await refresh()
    } catch (value) { if (owns(gen, epoch) && allowed.value) error.value = value }
    finally { if (owns(gen, epoch)) busy.value = false }
  }

  watch([contextKey, () => network.value.available, () => auth.tokenParsed.value?.sub, allowed], () => {
    if (!allowed.value && busy.value) notice.value = 'permissionLost'
    void refresh()
  }, { immediate: true })
  onScopeDispose(invalidate)
  return { network, allowed, index, server, servers, seasonId, categoryId, season, seasons, categories, category, nodes,
    defaultTimeZone, displayTimeZonePreference, displayTimeZone,
    coverUploadAvailable, loading, busy, readFailed, error, notice, editorEpoch, contextKey, refresh, navigate, mutate, remove }
}
