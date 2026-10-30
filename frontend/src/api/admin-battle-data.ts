import type { components } from './generated/http-contract.js'
import { battleDataAdminSummaryValidator, battleDataAdminPageValidator, battleDataAdminDetailValidator } from './generated/contract-validators.js'
import { Feature } from '../app/featureCapabilities.js'
import { useFeatureGate } from '../composables/useFeatureGate.js'
import { useAuth } from '../composables/useAuth.js'
import { ApiError, apiErrorFromResponse, apiFetch } from '../utils/http.js'

type Schemas = components['schemas']
export type Summary = Schemas['BattleDataAdminSummary']
export type BattlePage = Schemas['BattleDataAdminPage']
export type BattleDetail = Schemas['BattleDataAdminDetail']
export type Query = Record<string, string | number | null | undefined>

async function request<T>(path: string, query: Query, validate: (value: unknown) => boolean): Promise<T> {
  const gate = useFeatureGate()
  if (!gate.requireFeature(Feature.ADMIN_BATTLE_DATA)) throw new ApiError({ code: 'NETWORK_ERROR', retryable: true })
  const auth = useAuth()
  await auth.initPromise
  if (!auth.authenticated.value || !(await auth.ensureToken(30)) || !auth.token()) {
    throw new ApiError({ code: 'AUTH_UNAUTHENTICATED', status: 401, retryable: false })
  }
  if (!gate.requireFeature(Feature.ADMIN_BATTLE_DATA)) throw new ApiError({ code: 'NETWORK_ERROR', retryable: true })
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) if (value !== null && value !== undefined && value !== '') params.set(key, String(value))
  const response = await apiFetch(`${path}${params.size ? `?${params}` : ''}`, {
    headers: { Authorization: `Bearer ${auth.token()}` },
    cache: 'no-store',
  })
  if (!response.ok) throw await apiErrorFromResponse(response)
  let value: unknown
  try { value = await response.json() } catch (cause) { throw new ApiError({ errorCode: 'INVALID_RESPONSE', retryable: false, cause }) }
  if (!validate(value)) throw new ApiError({ errorCode: 'INVALID_RESPONSE', retryable: false })
  return value as T
}
export const getSummary = (query: Query) => request<Summary>('/api/admin/battle-data/summary', query, battleDataAdminSummaryValidator)
export const getBattles = (query: Query) => request<BattlePage>('/api/admin/battle-data/battles', query, battleDataAdminPageValidator)
export const getBattle = (id: string) => request<BattleDetail>(`/api/admin/battle-data/battles/${encodeURIComponent(id)}`, {}, battleDataAdminDetailValidator)
