import type { components } from './generated/http-contract.js'
import * as validators from './generated/contract-validators.js'
import { optionalBearer } from './replay-capabilities.js'
import { ApiError, apiFetch, requireOk } from '../utils/http.js'
import { useAuth, tournamentAdminAllowed } from '../composables/useAuth.js'
import { Feature } from '../app/featureCapabilities.js'
import { useFeatureGate } from '../composables/useFeatureGate.js'
import { resolveApiUrl } from '../platform/runtime.js'

type Schemas = components['schemas']
export type CreatorCategory = Schemas['CreatorCategory']
export type CreatorLevel = Schemas['CreatorLevel']
export type CreatorCard = Schemas['CreatorCard']
export type CreatorDetail = Schemas['CreatorDetail']
export type CreatorSaveRequest = Schemas['CreatorSaveRequest']
export type CreatorSettings = Schemas['CreatorSettings']

export function validateCreator<K extends keyof Schemas>(schema: K, value: unknown): Schemas[K] {
  const validate = validators[`${schema[0].toLowerCase()}${schema.slice(1)}Validator`] as ((value: unknown) => boolean) | undefined
  if (!validate?.(value)) throw new ApiError({ errorCode: 'INVALID_RESPONSE' })
  return value as Schemas[K]
}

function requireOnline() {
  if (!useFeatureGate().requireFeature(Feature.CREATORS)) throw new ApiError({ errorCode: 'NETWORK_ERROR', retryable: true })
}

async function request<T>(path: string, access: 'public' | 'user' | 'admin', options: RequestInit,
  read: (response: Response) => Promise<T>): Promise<T> {
  requireOnline()
  const auth = useAuth(), epoch = auth.authEpoch()
  const ownsIdentity = () => auth.authenticated.value && auth.authInitState.value === 'authenticated'
    && epoch === auth.authEpoch() && (access !== 'admin' || tournamentAdminAllowed(auth))
  if (access !== 'public' && !ownsIdentity()) throw new ApiError({ errorCode: access === 'admin' ? 'AUTH_FORBIDDEN' : 'AUTH_UNAUTHENTICATED', status: access === 'admin' ? 403 : 401 })
  const headers = access === 'public' ? {} : await optionalBearer(auth)
  if (access !== 'public' && !headers.Authorization) throw new ApiError({ errorCode: 'AUTH_UNAUTHENTICATED', status: 401 })
  if (access !== 'public' && !ownsIdentity()) throw new ApiError({ errorCode: 'REQUEST_ABORTED' })
  requireOnline()
  const response = await requireOk(await apiFetch(path, { ...options, headers: { ...headers, ...options.headers } }))
  const value = await read(response)
  if (access !== 'public' && !ownsIdentity()) throw new ApiError({ errorCode: 'REQUEST_ABORTED' })
  return value
}

const publicBase = '/api/creators'
const adminBase = '/api/admin/creators'
function json<K extends keyof Schemas>(path: string, schema: K, access: 'public' | 'user' | 'admin', options: RequestInit = {}): Promise<Schemas[K]> {
  return request(path, access, options, async response => validateCreator(schema, await response.json()))
}
function list<K extends keyof Schemas>(path: string, schema: K, access: 'public' | 'admin', signal?: AbortSignal): Promise<Schemas[K][]> {
  return request(path, access, { signal }, async response => {
    const value: unknown = await response.json()
    if (!Array.isArray(value)) throw new ApiError({ errorCode: 'INVALID_RESPONSE' })
    return value.map(item => validateCreator(schema, item))
  })
}
const body = (method: string, value: unknown, signal?: AbortSignal): RequestInit => ({
  method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value), signal,
})

export const listCreatorCategories = (signal?: AbortSignal) => list(`${publicBase}/categories`, 'CreatorCategory', 'public', signal)
export const listCreators = (categoryId: number | null = null, signal?: AbortSignal) => list(`${publicBase}${categoryId ? `?categoryId=${categoryId}` : ''}`, 'CreatorCard', 'public', signal)
export const getCreatorFavorites = (signal?: AbortSignal) => json(`${publicBase}/favorites`, 'CreatorFavorites', 'user', { signal })
export const setCreatorFavorite = (id: number, active: boolean, signal?: AbortSignal) => json(`${publicBase}/${id}/favorite`, 'CreatorFavoriteResult', 'user', { method: active ? 'PUT' : 'DELETE', signal })
export const getCreatorDetail = (id: number, signal?: AbortSignal) => json(`${adminBase}/${id}`, 'CreatorDetail', 'admin', { signal })
export const saveCreator = (id: number | null, value: CreatorSaveRequest, signal?: AbortSignal) => json(`${adminBase}${id ? `/${id}` : ''}`, 'CreatorDetail', 'admin', body(id ? 'PUT' : 'POST', value, signal))
export const removeCreator = (id: number, signal?: AbortSignal) => request(`${adminBase}/${id}`, 'admin', { method: 'DELETE', signal }, async () => undefined)
export const listCreatorAdminCategories = (signal?: AbortSignal) => list(`${adminBase}/categories`, 'CreatorCategory', 'admin', signal)
export const listCreatorLevels = (signal?: AbortSignal) => list(`${adminBase}/levels`, 'CreatorLevel', 'admin', signal)
export const addCreatorCategory = (name: string, signal?: AbortSignal) => json(`${adminBase}/categories`, 'CreatorCategory', 'admin', body('POST', { name }, signal))
export const addCreatorLevel = (name: string, signal?: AbortSignal) => json(`${adminBase}/levels`, 'CreatorLevel', 'admin', body('POST', { name }, signal))
export const removeCreatorCategory = (id: number, signal?: AbortSignal) => request(`${adminBase}/categories/${id}`, 'admin', { method: 'DELETE', signal }, async () => undefined)
export const removeCreatorLevel = (id: number, signal?: AbortSignal) => request(`${adminBase}/levels/${id}`, 'admin', { method: 'DELETE', signal }, async () => undefined)
export const getCreatorSettings = (signal?: AbortSignal) => json(`${adminBase}/settings`, 'CreatorSettings', 'admin', { signal })
export const saveCreatorSettings = (favoriteThreshold: number, signal?: AbortSignal) => json(`${adminBase}/settings`, 'CreatorSettings', 'admin', body('PUT', { favoriteThreshold }, signal))
export function uploadCreatorAvatar(file: File, signal?: AbortSignal) {
  const form = new FormData()
  form.append('file', file)
  return json(`${adminBase}/avatars`, 'CreatorAvatar', 'admin', { method: 'POST', body: form, signal })
}
export const removeUnusedCreatorAvatar = (id: string, signal?: AbortSignal) => request(`${adminBase}/avatars/${encodeURIComponent(id)}`, 'admin', { method: 'DELETE', signal }, async () => undefined)
export const creatorAvatarUrl = (value: string | null) => value ? resolveApiUrl(value) : ''
