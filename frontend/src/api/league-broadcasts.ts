import type { components } from './generated/http-contract.js'
import * as validators from './generated/contract-validators.js'
import { optionalBearer } from './replay-capabilities.js'
import { ApiError, apiFetch, requireOk } from '../utils/http.js'
import { useAuth, leagueBroadcastAdminAllowed } from '../composables/useAuth.js'
import { Feature } from '../app/featureCapabilities.js'
import { useFeatureGate } from '../composables/useFeatureGate.js'
import { resolveApiUrl } from '../platform/runtime.js'

type Schemas = components['schemas']
export type BroadcastIndex = Schemas['BroadcastIndex']
export type BroadcastSeason = Schemas['BroadcastSeason']
export type BroadcastSeasonView = Schemas['BroadcastSeasonView']
export type BroadcastCategory = Schemas['BroadcastCategory']
export type BroadcastCategoryView = Omit<Schemas['BroadcastCategoryView'], 'nodes'> & { nodes: BroadcastNode[]; defaultTimeZone: string }
export type BroadcastNode = Omit<Schemas['BroadcastNode'], 'replays'> & { replays: BroadcastReplay[] }
export type BroadcastReplay = Schemas['BroadcastReplay'] & { startsAt: string | null }
export type BroadcastSeasonCreate = Schemas['BroadcastSeasonCreate']
export type BroadcastSeasonUpdate = Schemas['BroadcastSeasonUpdate']
export type BroadcastCategoryCreate = Schemas['BroadcastCategoryCreate']
export type BroadcastNodeCreate = Schemas['BroadcastNodeCreate']
export type BroadcastReplaySave = Schemas['BroadcastReplaySave']
export type BroadcastTimedReplaySave = Schemas['BroadcastTimedReplaySave']
export type BroadcastDeletionPreview = Schemas['BroadcastDeletionPreview']
export type BroadcastServer = BroadcastSeason['server']
export const BROADCAST_CATEGORIES: BroadcastCategory['type'][] = ['POINTS', 'QUARTER_FINALS', 'SEMI_FINALS']

const publicBase = '/api/tournament-broadcasts/v2'
const adminBase = '/api/admin/tournament-broadcasts/v2'
const coverBase = '/api/tournament-broadcasts/covers'
// Released v2 servers do not supply a zone. Only this legacy read adapter uses
// the released defaults; v3's backend-provided zone remains authoritative.
const legacyServerZones: Record<BroadcastServer, string> = {
  CN: 'Asia/Shanghai', ASIA: 'Asia/Shanghai', NA: 'America/Los_Angeles', EU: 'Europe/Berlin', LESTA: 'Europe/Moscow',
}

export function validateBroadcast<K extends keyof Schemas>(schema: K, value: unknown): Schemas[K] {
  const name = `${schema[0].toLowerCase()}${schema.slice(1)}Validator`
  const validate = validators[name] as ((value: unknown) => boolean) | undefined
  if (!validate?.(value)) throw new ApiError({ errorCode: 'INVALID_RESPONSE' })
  return value as Schemas[K]
}

function requireOnline() {
  if (!useFeatureGate().requireFeature(Feature.LEAGUE_BROADCASTS)) {
    throw new ApiError({ errorCode: 'NETWORK_ERROR', retryable: true })
  }
}

async function request<T>(path: string, admin: boolean, options: RequestInit, read: (response: Response) => Promise<T>, timed = false): Promise<T> {
  requireOnline()
  const auth = useAuth(), epoch = auth.authEpoch()
  const ownsIdentity = () => leagueBroadcastAdminAllowed(auth) && epoch === auth.authEpoch()
  if (admin && !ownsIdentity()) throw new ApiError({ errorCode: 'AUTH_FORBIDDEN', status: 403 })
  const headers = admin ? await optionalBearer(auth) : {}
  if (admin && !headers.Authorization) throw new ApiError({ errorCode: 'AUTH_UNAUTHENTICATED', status: 401 })
  if (admin && !ownsIdentity()) throw new ApiError({ errorCode: 'AUTH_FORBIDDEN', status: 403 })
  requireOnline()
  const base = admin ? adminBase : publicBase
  const response = await requireOk(await apiFetch(`${timed ? base.replace('/v2', '/v3') : base}${path}`, { ...options, headers: { ...headers, ...options.headers } }))
  const value = await read(response)
  if (admin && !ownsIdentity()) throw new ApiError({ errorCode: 'REQUEST_ABORTED' })
  return value
}

function json<K extends keyof Schemas>(path: string, schema: K, admin = false, options: RequestInit = {}): Promise<Schemas[K]> {
  return request(path, admin, options, async response => validateBroadcast(schema, await response.json()))
}
function body(method: string, value: unknown, signal?: AbortSignal): RequestInit {
  return { method, body: JSON.stringify(value), headers: { 'Content-Type': 'application/json' }, signal }
}

function timedCategory(path: string, admin = false, options: RequestInit = {}): Promise<BroadcastCategoryView> {
  return request(path, admin, options, async response => {
    const value = validateBroadcast('BroadcastTimedCategoryView', await response.json())
    const starts = new Map(value.replayStarts.map(replay => [replay.replayId, replay.startsAt]))
    return { ...value.data, defaultTimeZone: value.defaultTimeZone,
      nodes: value.data.nodes.map(node => ({ ...node, replays: node.replays.map(replay => ({ ...replay, startsAt: starts.get(replay.id) ?? null })) })) }
  }, true)
}

export const listBroadcasts = (server?: BroadcastServer, signal?: AbortSignal) => json(server ? `?server=${server}` : '', 'BroadcastIndex', false, { signal })
export const getBroadcastSeason = (id: number, signal?: AbortSignal) => json(`/seasons/${id}`, 'BroadcastSeasonView', false, { signal })
export async function getBroadcastCategory(id: number, signal?: AbortSignal): Promise<BroadcastCategoryView> {
  const path = `/categories/${id}`
  try {
    return await timedCategory(path, false, { signal })
  } catch (error) {
    // Older SecurityConfig denies unknown API paths (anonymous requests get
    // 401); other deployments return 403/404/405. Retry only this public GET,
    // through v2's existing validation. Never retry a write or a malformed v3.
    if (!(error instanceof ApiError) || ![401, 403, 404, 405].includes(error.status ?? 0)) throw error
    const value = await json(path, 'BroadcastCategoryView', false, { signal })
    return { ...value, defaultTimeZone: legacyServerZones[value.season.server],
      nodes: value.nodes.map(node => ({ ...node, replays: node.replays.map(replay => ({ ...replay, startsAt: null })) })) }
  }
}
export const createBroadcastSeason = (value: BroadcastSeasonCreate, signal?: AbortSignal) => json('/seasons', 'BroadcastSeasonView', true, body('POST', value, signal))
export const updateBroadcastSeason = (id: number, value: BroadcastSeasonUpdate, signal?: AbortSignal) => json(`/seasons/${id}`, 'BroadcastSeasonView', true, body('PUT', value, signal))
export const createBroadcastCategory = (id: number, value: BroadcastCategoryCreate, signal?: AbortSignal) => json(`/seasons/${id}/categories`, 'BroadcastSeasonView', true, body('POST', value, signal))
export const createBroadcastNode = (id: number, value: BroadcastNodeCreate, signal?: AbortSignal) => timedCategory(`/categories/${id}/nodes`, true, body('POST', value, signal))
export const getBroadcastDeletionPreview = (kind: 'seasons' | 'nodes', id: number, signal?: AbortSignal) => json(`/${kind}/${id}/deletion-preview`, 'BroadcastDeletionPreview', true, { signal })

export function saveBroadcastReplay(target: { nodeId: number; replayId?: number }, value: BroadcastTimedReplaySave, cover: File | null, signal?: AbortSignal) {
  if ((value.replay.coverAction === 'REPLACE') !== Boolean(cover)) {
    throw new ApiError({ errorCode: 'BROADCAST_COVER_INVALID' })
  }
  const form = new FormData()
  form.append('payload', new Blob([JSON.stringify(value)], { type: 'application/json' }))
  if (cover) form.append('cover', cover)
  return timedCategory(target.replayId ? `/replays/${target.replayId}` : `/nodes/${target.nodeId}/replays`, true,
    { method: target.replayId ? 'PUT' : 'POST', body: form, signal })
}

export async function deleteBroadcastResource(kind: 'seasons' | 'nodes' | 'replays', id: number, expectedVersion: number, signal?: AbortSignal) {
  await request(`/${kind}/${id}?expectedVersion=${expectedVersion}&confirm=true`, true, { method: 'DELETE', signal }, async () => undefined)
}

export function broadcastCoverUrl(id: string) {
  return resolveApiUrl(`${coverBase}/${encodeURIComponent(id)}`)
}
