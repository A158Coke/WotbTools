import type { components } from './generated/http-contract.js'
import * as validators from './generated/contract-validators.js'
import { optionalBearer } from './replay-capabilities.js'
import { ApiError, apiFetch, requireOk } from '../utils/http.js'
import { useAuth, newsAdminAllowed } from '../composables/useAuth.js'
import { useFeatureGate } from '../composables/useFeatureGate.js'
import { Feature } from '../app/featureCapabilities.js'
import { resolveApiUrl } from '../platform/runtime.js'

type Schemas = components['schemas']
export type NewsArticle = Schemas['NewsArticle']
export type NewsCategory = Schemas['NewsCategory']
export type NewsArchive = Schemas['NewsArchive']
export type NewsDraft = Schemas['NewsDraft']
export type NewsCreateRequest = Schemas['NewsCreateRequest']
export type NewsArticlePage = Schemas['NewsArticlePage']
export type NewsArchivePage = Schemas['NewsArchivePage']
export type NewsSource = Schemas['NewsSource']

export function validateNews<K extends keyof Schemas>(schema: K, value: unknown): Schemas[K] {
  const validate = validators[`${schema[0].toLowerCase()}${schema.slice(1)}Validator`] as ((input: unknown) => boolean) | undefined
  if (!validate?.(value)) throw new ApiError({ errorCode: 'INVALID_RESPONSE' })
  return value as Schemas[K]
}
function requireOnline() {
  if (!useFeatureGate().requireFeature(Feature.NEWS)) throw new ApiError({ errorCode: 'NETWORK_ERROR', retryable: true })
}
async function request<T>(path: string, managed: boolean, options: RequestInit, read: (response: Response) => Promise<T>): Promise<T> {
  requireOnline()
  const auth = useAuth(), epoch = auth.authEpoch()
  const owns = () => newsAdminAllowed(auth) && epoch === auth.authEpoch()
  if (managed && !owns()) throw new ApiError({ errorCode: 'AUTH_FORBIDDEN', status: 403 })
  const bearer = managed ? await optionalBearer(auth) : {}
  if (managed && !bearer.Authorization) throw new ApiError({ errorCode: 'AUTH_UNAUTHENTICATED', status: 401 })
  if (managed && !owns()) throw new ApiError({ errorCode: 'AUTH_FORBIDDEN', status: 403 })
  requireOnline()
  const response = await requireOk(await apiFetch(`${managed ? '/api/admin/news' : '/api/news'}${path}`, { ...options, headers: { ...bearer, ...options.headers } }))
  const value = await read(response)
  if (managed && !owns()) throw new ApiError({ errorCode: 'REQUEST_ABORTED' })
  return value
}
function json<K extends keyof Schemas>(path: string, schema: K, managed = false, options: RequestInit = {}): Promise<Schemas[K]> {
  return request(path, managed, options, async response => validateNews(schema, await response.json()))
}
function list<K extends keyof Schemas>(path: string, schema: K, signal?: AbortSignal): Promise<Schemas[K][]> {
  return request(path, false, { signal }, async response => {
    const values: unknown = await response.json()
    if (!Array.isArray(values)) throw new ApiError({ errorCode: 'INVALID_RESPONSE' })
    return values.map(value => validateNews(schema, value))
  })
}
const body = (value: unknown, signal?: AbortSignal): RequestInit => ({ method: 'POST', body: JSON.stringify(value), headers: { 'Content-Type': 'application/json' }, signal })
export const listNewsSources = (signal?: AbortSignal) => list('/sources', 'NewsSource', signal)
export const listNewsCategories = (signal?: AbortSignal) => list('/categories', 'NewsCategory', signal)
export const listNewsArticles = (page: number, signal?: AbortSignal) => json(`/articles?page=${page}&size=20`, 'NewsArticlePage', false, { signal })
export const getNewsArticle = (key: string, signal?: AbortSignal) => json(`/articles/${encodeURIComponent(key)}`, 'NewsArticle', false, { signal })
export const listNewsArchives = (page: number, version: string, managed: boolean, signal?: AbortSignal) => json(`/archives?source=WG&page=${page}&size=20${version ? `&version=${encodeURIComponent(version)}` : ''}`, 'NewsArchivePage', managed, { signal })
export const getNewsArchive = (id: number, managed: boolean, signal?: AbortSignal) => json(`/archives/${id}`, 'NewsArchive', managed, { signal })
export const createNewsArchives = (value: NewsCreateRequest, signal?: AbortSignal) => json('/archives', 'NewsReceiptResult', true, body(value, signal))
export const changeNewsArchive = (archive: NewsArchive, action: 'retry' | 'withdraw' | 'restore', signal?: AbortSignal) => json(`/archives/${archive.id}/${action}`, 'NewsArchive', true, body({ expectedRevision: archive.revision }, signal))
export const createNewsCategory = (name: string, type: NewsCategory['type'], signal?: AbortSignal) => json('/categories', 'NewsCategory', true, body({ name, type }, signal))
export async function deleteNewsCategory(id: number, signal?: AbortSignal) {
  await request(`/categories/${id}`, true, { method: 'DELETE', signal }, async () => undefined)
}
export async function deleteNewsArchive(archive: NewsArchive, signal?: AbortSignal) {
  await request(`/archives/${archive.id}?expectedRevision=${archive.revision}&confirm=true`, true, { method: 'DELETE', signal }, async () => undefined)
}
export function newsImagePath(id: string, archived = false) {
  return `/api/news/${archived ? 'images' : 'source-images'}/${encodeURIComponent(id)}`
}
export function newsImageUrl(path: string) {
  return /^\/api\/news\/(?:source-images|images)\/[A-Za-z0-9_-]+$/.test(path) ? resolveApiUrl(path) : ''
}
export function getManagedNewsImage(id: string, signal?: AbortSignal, sourceArchiveId?: number) {
  const path = sourceArchiveId ? `/archives/${sourceArchiveId}/source-images/${encodeURIComponent(id)}` : `/images/${encodeURIComponent(id)}`
  return request(path, true, { signal }, async response => {
    const blob = await response.blob()
    if (!/^image\/(png|jpeg|gif|webp)$/.test(blob.type)) throw new ApiError({ errorCode: 'INVALID_RESPONSE' })
    return blob
  })
}
