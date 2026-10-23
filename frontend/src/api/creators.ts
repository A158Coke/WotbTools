import type { components } from './generated/http-contract.js'
import * as validators from './generated/contract-validators.js'
import { optionalBearer } from './replay-capabilities.js'
import { ApiError, apiFetch, requireOk } from '../utils/http.js'
import { useAuth, contentAdminAllowed } from '../composables/useAuth.js'
import { Feature } from '../app/featureCapabilities.js'
import { useFeatureGate } from '../composables/useFeatureGate.js'
import { resolveApiUrl } from '../platform/runtime.js'

type Schemas = components['schemas']
export type CreatorLevel = Schemas['CreatorLevel']
export type RecommendationType = Schemas['RecommendationType']
export type RecommendationCategory = Schemas['RecommendationCategory']
export type RecommendationCard = Schemas['RecommendationCard']
export type RecommendationDetail = Schemas['RecommendationDetail']
export type RecommendationSaveRequest = Schemas['RecommendationSaveRequest']
export type RecommendationMetadata = Schemas['RecommendationMetadata']

export const recommendationInputValid = (value: unknown): boolean => validators.recommendationSaveRequestValidator(value)

export const creatorNameValid = (value: unknown): boolean => validators.creatorNameRequestValidator(value)

export function validateCreator<K extends keyof Schemas>(schema: K, value: unknown): Schemas[K] {
  const validate = validators[`${schema[0].toLowerCase()}${schema.slice(1)}Validator`] as ((value: unknown) => boolean) | undefined
  if (!validate?.(value)) throw new ApiError({ errorCode: 'INVALID_RESPONSE' })
  return value as Schemas[K]
}

function requireOnline() {
  if (!useFeatureGate().requireFeature(Feature.CREATORS)) throw new ApiError({ errorCode: 'NETWORK_ERROR', retryable: true })
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch (error) {
    if (error instanceof SyntaxError) throw new ApiError({ errorCode: 'INVALID_RESPONSE', retryable: false })
    throw error
  }
}

async function request<T>(path: string, access: 'public' | 'admin', options: RequestInit,
  read: (response: Response) => Promise<T>): Promise<T> {
  requireOnline()
  const auth = useAuth(), epoch = auth.authEpoch()
  const ownsIdentity = () => auth.authenticated.value && auth.authInitState.value === 'authenticated'
    && epoch === auth.authEpoch() && contentAdminAllowed(auth)
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

export async function getCreatorAvailability(signal?: AbortSignal): Promise<{ supported: boolean }> {
  const response = await requireOk(await apiFetch('/api/health', { signal, cache: 'no-store' }))
  const capabilities = validateCreator('BackendHealth', await readJson(response)).capabilities ?? []
  return { supported: capabilities.includes('recommendations-v1') }
}
function json<K extends keyof Schemas>(path: string, schema: K, access: 'public' | 'admin', options: RequestInit = {}): Promise<Schemas[K]> {
  return request(path, access, options, async response => validateCreator(schema, await readJson(response)))
}
function list<K extends keyof Schemas>(path: string, schema: K, access: 'public' | 'admin', signal?: AbortSignal): Promise<Schemas[K][]> {
  return request(path, access, { signal }, async response => {
    const value: unknown = await readJson(response)
    if (!Array.isArray(value)) throw new ApiError({ errorCode: 'INVALID_RESPONSE' })
    return value.map(item => validateCreator(schema, item))
  })
}
const body = (method: string, value: unknown, signal?: AbortSignal): RequestInit => ({
  method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value), signal,
})

function dictionaryBody(name: string, signal?: AbortSignal) {
  const value = { name: name.trim() }
  if (!creatorNameValid(value)) throw new ApiError({ errorCode: 'CREATOR_INVALID_REQUEST' })
  return body('POST', value, signal)
}
const recommendationPublicBase = '/api/recommendations'
const recommendationAdminBase = '/api/admin/recommendations'
function requireRecommendationType(type: RecommendationType) {
  if (type !== 'UP' && type !== 'VIDEO') throw new ApiError({ errorCode: 'CREATOR_INVALID_REQUEST' })
}
function ofType<T extends { type: RecommendationType }>(value: T, type: RecommendationType): T {
  if (value.type !== type) throw new ApiError({ errorCode: 'INVALID_RESPONSE' })
  return value
}
export const listRecommendationCategories = (signal?: AbortSignal): Promise<RecommendationCategory[]> =>
  list(`${recommendationPublicBase}/categories`, 'RecommendationCategory', 'public', signal)
export async function listRecommendations(type: RecommendationType, categoryId: number | null, signal?: AbortSignal): Promise<RecommendationCard[]> {
  requireRecommendationType(type)
  return (await list(`${recommendationPublicBase}?type=${type}${categoryId ? `&categoryId=${categoryId}` : ''}`, 'RecommendationCard', 'public', signal)).map(value => ofType(value, type))
}
export async function getRecommendationMetadata(type: RecommendationType, signal?: AbortSignal): Promise<RecommendationMetadata> {
  requireRecommendationType(type)
  return ofType(await json(`${recommendationAdminBase}/metadata?type=${type}`, 'RecommendationMetadata', 'admin', { signal }), type)
}
export async function getRecommendationDetail(id: number, type: RecommendationType, signal?: AbortSignal): Promise<RecommendationDetail> {
  requireRecommendationType(type)
  return ofType(await json(`${recommendationAdminBase}/${id}?type=${type}`, 'RecommendationDetail', 'admin', { signal }), type)
}
export function saveRecommendation(id: number | null, value: RecommendationSaveRequest, image: File | null, signal?: AbortSignal): Promise<RecommendationDetail> {
  if (!recommendationInputValid(value) || (id === null) !== (value.expectedVersion === null)
    || (value.imageAction === 'REPLACE') !== Boolean(image)) throw new ApiError({ errorCode: 'CREATOR_INVALID_REQUEST' })
  requireRecommendationType(value.type)
  const form = new FormData()
  form.append('payload', new Blob([JSON.stringify(value)], { type: 'application/json' }))
  if (image) form.append('image', image)
  return json(`${recommendationAdminBase}${id ? `/${id}` : ''}`, 'RecommendationDetail', 'admin', { method: id ? 'PUT' : 'POST', body: form, signal }).then(detail => ofType(detail, value.type))
}
export function removeRecommendation(id: number, type: RecommendationType, expectedVersion: number, signal?: AbortSignal) {
  requireRecommendationType(type)
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0) throw new ApiError({ errorCode: 'CREATOR_INVALID_REQUEST' })
  return request(`${recommendationAdminBase}/${id}?type=${type}&expectedVersion=${expectedVersion}`, 'admin', { method: 'DELETE', signal }, async () => undefined)
}
export function addRecommendationCategory(type: RecommendationType, name: string, signal?: AbortSignal): Promise<RecommendationCategory> {
  requireRecommendationType(type)
  const value = { type, name: name.trim() }
  if (!validators.recommendationCategoryRequestValidator(value)) throw new ApiError({ errorCode: 'CREATOR_INVALID_REQUEST' })
  return json(`${recommendationAdminBase}/categories`, 'RecommendationCategory', 'admin', body('POST', value, signal)).then(category => ofType(category, type))
}
export function removeRecommendationCategory(id: number, type: RecommendationType, signal?: AbortSignal) {
  requireRecommendationType(type)
  return request(`${recommendationAdminBase}/categories/${id}?type=${type}`, 'admin', { method: 'DELETE', signal }, async () => undefined)
}
export const addCreatorLevel = (name: string, signal?: AbortSignal) => json(`${recommendationAdminBase}/levels`, 'CreatorLevel', 'admin', dictionaryBody(name, signal))
export const removeCreatorLevel = (id: number, signal?: AbortSignal) => request(`${recommendationAdminBase}/levels/${id}`, 'admin', { method: 'DELETE', signal }, async () => undefined)
export const recommendationImageUrl = (value: string | null) => value ? resolveApiUrl(value) : ''
