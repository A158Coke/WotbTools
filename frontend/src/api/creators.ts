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
export type CreatorMetadata = Schemas['CreatorMetadata']

export function validateCreator<K extends keyof Schemas>(schema: K, value: unknown): Schemas[K] {
  const validate = validators[`${schema[0].toLowerCase()}${schema.slice(1)}Validator`] as ((value: unknown) => boolean) | undefined
  if (!validate?.(value)) throw new ApiError({ errorCode: 'INVALID_RESPONSE' })
  return value as Schemas[K]
}

function requireOnline() {
  if (!useFeatureGate().requireFeature(Feature.CREATORS)) throw new ApiError({ errorCode: 'NETWORK_ERROR', retryable: true })
}

async function request<T>(path: string, access: 'public' | 'admin', options: RequestInit,
  read: (response: Response) => Promise<T>): Promise<T> {
  requireOnline()
  const auth = useAuth(), epoch = auth.authEpoch()
  const ownsIdentity = () => auth.authenticated.value && auth.authInitState.value === 'authenticated'
    && epoch === auth.authEpoch() && tournamentAdminAllowed(auth)
  if (access === 'admin' && !ownsIdentity()) throw new ApiError({ errorCode: 'AUTH_FORBIDDEN', status: 403 })
  const headers = access === 'public' ? {} : await optionalBearer(auth)
  if (access === 'admin' && !headers.Authorization) throw new ApiError({ errorCode: 'AUTH_UNAUTHENTICATED', status: 401 })
  if (access === 'admin' && !ownsIdentity()) throw new ApiError({ errorCode: 'REQUEST_ABORTED' })
  requireOnline()
  const response = await requireOk(await apiFetch(path, { ...options, headers: { ...headers, ...options.headers } }))
  const value = await read(response)
  if (access === 'admin' && !ownsIdentity()) throw new ApiError({ errorCode: 'REQUEST_ABORTED' })
  return value
}

const publicBase = '/api/creators'
const adminBase = '/api/admin/creators'
function json<K extends keyof Schemas>(path: string, schema: K, access: 'public' | 'admin', options: RequestInit = {}): Promise<Schemas[K]> {
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
export const getCreatorDetail = (id: number, signal?: AbortSignal) => json(`${adminBase}/${id}`, 'CreatorDetail', 'admin', { signal })
export function saveCreator(id: number | null, value: CreatorSaveRequest, avatar: File | null = null, signal?: AbortSignal) {
  if ((value.avatarAction === 'REPLACE') !== Boolean(avatar)) throw new ApiError({ errorCode: 'CREATOR_INVALID_REQUEST' })
  const form = new FormData()
  form.append('payload', new Blob([JSON.stringify(value)], { type: 'application/json' }))
  if (avatar) form.append('avatar', avatar)
  return json(`${adminBase}${id ? `/${id}` : ''}`, 'CreatorDetail', 'admin', { method: id ? 'PUT' : 'POST', body: form, signal })
}
export const getCreatorMetadata = (signal?: AbortSignal) => json(`${adminBase}/metadata`, 'CreatorMetadata', 'admin', { signal })
export const removeCreator = (id: number, signal?: AbortSignal) => request(`${adminBase}/${id}`, 'admin', { method: 'DELETE', signal }, async () => undefined)
export const addCreatorCategory = (name: string, signal?: AbortSignal) => json(`${adminBase}/categories`, 'CreatorCategory', 'admin', body('POST', { name }, signal))
export const addCreatorLevel = (name: string, signal?: AbortSignal) => json(`${adminBase}/levels`, 'CreatorLevel', 'admin', body('POST', { name }, signal))
export const removeCreatorCategory = (id: number, signal?: AbortSignal) => request(`${adminBase}/categories/${id}`, 'admin', { method: 'DELETE', signal }, async () => undefined)
export const removeCreatorLevel = (id: number, signal?: AbortSignal) => request(`${adminBase}/levels/${id}`, 'admin', { method: 'DELETE', signal }, async () => undefined)
export const creatorAvatarUrl = (value: string | null) => value ? resolveApiUrl(value) : ''
