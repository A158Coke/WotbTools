import type { components } from './generated/http-contract.js'
import * as validators from './generated/contract-validators.js'
import { optionalBearer } from './replay-capabilities.js'
import { ApiError, apiFetch, requireOk } from '../utils/http.js'
import { useAuth, contentAdminAllowed } from '../composables/useAuth.js'
import { Feature } from '../app/featureCapabilities.js'
import { useFeatureGate } from '../composables/useFeatureGate.js'
import { resolveApiUrl } from '../platform/runtime.js'

type Schemas = components['schemas']
type CreatorCategory = Schemas['CreatorCategory']
export type CreatorLevel = Schemas['CreatorLevel']
type CreatorCard = Schemas['CreatorCard']
type CreatorDetail = Schemas['CreatorDetail']
export type CreatorSaveRequest = Schemas['CreatorSaveRequest']
export type RecommendationType = Schemas['RecommendationType']
export type RecommendationCategory = Schemas['RecommendationCategory']
export type RecommendationCard = Schemas['RecommendationCard']
export type RecommendationDetail = Schemas['RecommendationDetail']
export type RecommendationSaveRequest = Schemas['RecommendationSaveRequest']
export type RecommendationMetadata = Schemas['RecommendationMetadata']

export const recommendationInputValid = (value: unknown): boolean => validators.recommendationSaveRequestValidator(value)

export function creatorInputValid(schema: 'CreatorSaveRequest' | 'CreatorNameRequest', value: unknown): boolean {
  return schema === 'CreatorSaveRequest' ? validators.creatorSaveRequestValidator(value) : validators.creatorNameRequestValidator(value)
}

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

const publicBase = '/api/creators'
const adminBase = '/api/admin/creators'
export async function getCreatorAvailability(signal?: AbortSignal): Promise<{ supported: boolean; contentVisibilitySupported: boolean; recommendationsSupported: boolean }> {
  const response = await requireOk(await apiFetch('/api/health', { signal, cache: 'no-store' }))
  const capabilities = validateCreator('BackendHealth', await response.json()).capabilities ?? []
  return { supported: capabilities.includes('creators-v1'), contentVisibilitySupported: capabilities.includes('creators-content-visibility-v1'), recommendationsSupported: capabilities.includes('recommendations-v1') }
}
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

const listCreatorCategories = (signal?: AbortSignal) => list(`${publicBase}/categories`, 'CreatorCategory', 'public', signal)
export const listCreators = (categoryId: number | null = null, signal?: AbortSignal) => list(`${publicBase}${categoryId ? `?categoryId=${categoryId}` : ''}`, 'CreatorCard', 'public', signal)
export const getCreatorDetail = (id: number, signal?: AbortSignal) => json(`${adminBase}/${id}`, 'CreatorDetail', 'admin', { signal })
export function saveCreator(id: number | null, value: CreatorSaveRequest, avatar: File | null = null, signal?: AbortSignal) {
  if (!creatorInputValid('CreatorSaveRequest', value) || (id === null) !== (value.expectedVersion === null)
    || (value.avatarAction === 'REPLACE') !== Boolean(avatar)) throw new ApiError({ errorCode: 'CREATOR_INVALID_REQUEST' })
  const form = new FormData()
  form.append('payload', new Blob([JSON.stringify(value)], { type: 'application/json' }))
  if (avatar) form.append('avatar', avatar)
  return json(`${adminBase}${id ? `/${id}` : ''}`, 'CreatorDetail', 'admin', { method: id ? 'PUT' : 'POST', body: form, signal })
}
export const getCreatorMetadata = (signal?: AbortSignal) => json(`${adminBase}/metadata`, 'CreatorMetadata', 'admin', { signal })
export function removeCreator(id: number, expectedVersion: number, signal?: AbortSignal) {
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0) throw new ApiError({ errorCode: 'CREATOR_INVALID_REQUEST' })
  return request(`${adminBase}/${id}?expectedVersion=${expectedVersion}`, 'admin', { method: 'DELETE', signal }, async () => undefined)
}
function dictionaryBody(name: string, signal?: AbortSignal) {
  const value = { name: name.trim() }
  if (!creatorInputValid('CreatorNameRequest', value)) throw new ApiError({ errorCode: 'CREATOR_INVALID_REQUEST' })
  return body('POST', value, signal)
}
export const addCreatorCategory = (name: string, signal?: AbortSignal) => json(`${adminBase}/categories`, 'CreatorCategory', 'admin', dictionaryBody(name, signal))
export const addCreatorLevel = (name: string, signal?: AbortSignal) => json(`${adminBase}/levels`, 'CreatorLevel', 'admin', dictionaryBody(name, signal))
const removeCreatorCategory = (id: number, signal?: AbortSignal) => request(`${adminBase}/categories/${id}`, 'admin', { method: 'DELETE', signal }, async () => undefined)
export const removeCreatorLevel = (id: number, signal?: AbortSignal) => request(`${adminBase}/levels/${id}`, 'admin', { method: 'DELETE', signal }, async () => undefined)
export const creatorAvatarUrl = (value: string | null) => value ? resolveApiUrl(value) : ''

// Released clients still use the UP-only API. Keep the legacy projection here;
// components consume one shape and never infer VIDEO support from a successful UP request.
const recommendationPublicBase = '/api/recommendations'
const recommendationAdminBase = '/api/admin/recommendations'
function requireRecommendationType(type: RecommendationType, typed: boolean) {
  if (type !== 'UP' && type !== 'VIDEO') throw new ApiError({ errorCode: 'CREATOR_INVALID_REQUEST' })
  if (!typed && type !== 'UP') throw new ApiError({ errorCode: 'SERVICE_UNAVAILABLE', status: 503 })
}
const legacyCategory = (value: CreatorCategory): RecommendationCategory => ({ ...value, type: 'UP' })
function legacyCard(value: CreatorCard): RecommendationCard {
  const { bilibiliUid, homepageUrl, avatarUrl, categories, ...rest } = value
  return { ...rest, type: 'UP', externalId: bilibiliUid, targetUrl: homepageUrl, imageUrl: avatarUrl, categories: categories.map(legacyCategory) }
}
function legacyDetail(value: CreatorDetail): RecommendationDetail {
  const { bilibiliUid, avatarUrl, ...rest } = value
  return { ...rest, type: 'UP', externalId: bilibiliUid, imageUrl: avatarUrl }
}
function ofType<T extends { type: RecommendationType }>(value: T, type: RecommendationType): T {
  if (value.type !== type) throw new ApiError({ errorCode: 'INVALID_RESPONSE' })
  return value
}
export async function listRecommendationCategories(typed: boolean, signal?: AbortSignal): Promise<RecommendationCategory[]> {
  return typed ? list(`${recommendationPublicBase}/categories`, 'RecommendationCategory', 'public', signal)
    : (await listCreatorCategories(signal)).map(legacyCategory)
}
export async function listRecommendations(type: RecommendationType, categoryId: number | null, typed: boolean, signal?: AbortSignal): Promise<RecommendationCard[]> {
  requireRecommendationType(type, typed)
  return typed ? (await list(`${recommendationPublicBase}?type=${type}${categoryId ? `&categoryId=${categoryId}` : ''}`, 'RecommendationCard', 'public', signal)).map(value => ofType(value, type))
    : (await listCreators(categoryId, signal)).map(legacyCard)
}
export async function getRecommendationMetadata(type: RecommendationType, typed: boolean, signal?: AbortSignal): Promise<RecommendationMetadata> {
  requireRecommendationType(type, typed)
  if (typed) return ofType(await json(`${recommendationAdminBase}/metadata?type=${type}`, 'RecommendationMetadata', 'admin', { signal }), type)
  const { categories, levels, avatarUploadsAvailable } = await getCreatorMetadata(signal)
  return { type: 'UP', categories: categories.map(legacyCategory), levels, imageUploadsAvailable: avatarUploadsAvailable }
}
export async function getRecommendationDetail(id: number, type: RecommendationType, typed: boolean, signal?: AbortSignal): Promise<RecommendationDetail> {
  requireRecommendationType(type, typed)
  return typed ? ofType(await json(`${recommendationAdminBase}/${id}?type=${type}`, 'RecommendationDetail', 'admin', { signal }), type)
    : legacyDetail(await getCreatorDetail(id, signal))
}
export function saveRecommendation(id: number | null, value: RecommendationSaveRequest, image: File | null, typed: boolean, signal?: AbortSignal): Promise<RecommendationDetail> {
  if (!recommendationInputValid(value) || (id === null) !== (value.expectedVersion === null)
    || (value.imageAction === 'REPLACE') !== Boolean(image)) throw new ApiError({ errorCode: 'CREATOR_INVALID_REQUEST' })
  requireRecommendationType(value.type, typed)
  if (!typed) {
    const { type: _type, externalId, imageAction, ...rest } = value
    return saveCreator(id, { ...rest, bilibiliUid: externalId, avatarAction: imageAction }, image, signal).then(legacyDetail)
  }
  const form = new FormData()
  form.append('payload', new Blob([JSON.stringify(value)], { type: 'application/json' }))
  if (image) form.append('image', image)
  return json(`${recommendationAdminBase}${id ? `/${id}` : ''}`, 'RecommendationDetail', 'admin', { method: id ? 'PUT' : 'POST', body: form, signal }).then(detail => ofType(detail, value.type))
}
export function removeRecommendation(id: number, type: RecommendationType, expectedVersion: number, typed: boolean, signal?: AbortSignal) {
  requireRecommendationType(type, typed)
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0) throw new ApiError({ errorCode: 'CREATOR_INVALID_REQUEST' })
  return typed ? request(`${recommendationAdminBase}/${id}?type=${type}&expectedVersion=${expectedVersion}`, 'admin', { method: 'DELETE', signal }, async () => undefined)
    : removeCreator(id, expectedVersion, signal)
}
export function addRecommendationCategory(type: RecommendationType, name: string, typed: boolean, signal?: AbortSignal): Promise<RecommendationCategory> {
  requireRecommendationType(type, typed)
  const value = { type, name: name.trim() }
  if (!validators.recommendationCategoryRequestValidator(value)) throw new ApiError({ errorCode: 'CREATOR_INVALID_REQUEST' })
  return typed ? json(`${recommendationAdminBase}/categories`, 'RecommendationCategory', 'admin', body('POST', value, signal)).then(category => ofType(category, type))
    : addCreatorCategory(value.name, signal).then(legacyCategory)
}
export function removeRecommendationCategory(id: number, type: RecommendationType, typed: boolean, signal?: AbortSignal) {
  requireRecommendationType(type, typed)
  return typed ? request(`${recommendationAdminBase}/categories/${id}?type=${type}`, 'admin', { method: 'DELETE', signal }, async () => undefined)
    : removeCreatorCategory(id, signal)
}
export const recommendationImageUrl = creatorAvatarUrl
