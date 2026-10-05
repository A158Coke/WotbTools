import type { components } from './generated/http-contract.js'
import * as validators from './generated/contract-validators.js'
import { optionalBearer } from './replay-capabilities.js'
import { ApiError, apiFetch, requireOk } from '../utils/http.js'
import { useAuth } from '../composables/useAuth.js'
import { Feature } from '../app/featureCapabilities.js'
import { useFeatureGate } from '../composables/useFeatureGate.js'
import type { KeycloakTokenParsed } from 'keycloak-js'

type Schemas = components['schemas']
export type TournamentEvent = Schemas['TournamentEvent']
export type TournamentConfig = Schemas['TournamentConfig']
export type TournamentDayView = Schemas['TournamentDayView']
export type TournamentStandings = Schemas['TournamentStandings']
export type TournamentIncomingGroup = Schemas['TournamentIncomingGroup']
export type TournamentDraftRequest = Schemas['TournamentDraftRequest']
export type TournamentRecognitionResult = Schemas['TournamentRecognitionResult']
export type TournamentAudit = Schemas['TournamentAudit']
export type TournamentRuleRequest = Schemas['TournamentRuleRequest']
export type TournamentCreateRequest = Schemas['TournamentCreateRequest']
export const TOURNAMENT_REGIONS: TournamentEvent['region'][] = ['CN', 'ASIA', 'NA', 'EU']
export const TOURNAMENT_SEASONS: TournamentEvent['season'][] = ['SPRING', 'SUMMER', 'AUTUMN', 'WINTER', 'FIRE_CUP']

const base = '/api/admin/tournaments'
const eventPath = (id: number) => `${base}/${id}`
const dayPath = (id: number, round: number, day: number) => `${eventPath(id)}/rounds/${round}/days/${day}`

export function tournamentAdminAllowed(auth = useAuth()): boolean {
  const roles = (auth.tokenParsed.value as KeycloakTokenParsed | null)?.realm_access?.roles
  return auth.authenticated.value && Array.isArray(roles) && roles.includes('tournament-admin')
}

function requireOnline() {
  if (!useFeatureGate().requireFeature(Feature.TOURNAMENT_POINTS)) {
    throw new ApiError({ errorCode: 'NETWORK_ERROR', retryable: true })
  }
}

export function validateTournament<K extends keyof Schemas>(schema: K, data: unknown): Schemas[K] {
  const name = `${schema[0].toLowerCase()}${schema.slice(1)}Validator`
  const validate = validators[name] as ((value: unknown) => boolean) | undefined
  if (!validate?.(data)) throw new ApiError({ errorCode: 'INVALID_RESPONSE', retryable: false })
  return data as Schemas[K]
}

async function request(url: string, admin: boolean, options: RequestInit = {}): Promise<Response> {
  requireOnline()
  const auth = useAuth()
  const epoch = auth.authEpoch()
  if (admin && !tournamentAdminAllowed(auth)) throw new ApiError({ errorCode: 'AUTH_FORBIDDEN', status: 403 })
  const headers = admin ? await optionalBearer(auth) : {}
  if (admin && (!tournamentAdminAllowed(auth) || epoch !== auth.authEpoch())) {
    throw new ApiError({ errorCode: 'AUTH_FORBIDDEN', status: 403 })
  }
  requireOnline()
  const response = await requireOk(await apiFetch(url, { ...options, headers: { ...headers, ...options.headers } }))
  if (admin && (!tournamentAdminAllowed(auth) || epoch !== auth.authEpoch())) {
    throw new ApiError({ errorCode: 'REQUEST_ABORTED' })
  }
  return response
}

async function json<K extends keyof Schemas>(url: string, schema: K, admin = true, options: RequestInit = {}): Promise<Schemas[K]> {
  return validateTournament(schema, await (await request(url, admin, options)).json())
}
function body(method: string, value: unknown, signal?: AbortSignal): RequestInit {
  return { method, body: JSON.stringify(value), headers: { 'Content-Type': 'application/json' }, signal }
}
export async function listTournamentEvents(admin = false, signal?: AbortSignal): Promise<TournamentEvent[]> {
  const value: unknown = await (await request(admin ? base : '/api/tournaments', admin, { signal })).json()
  if (!Array.isArray(value)) throw new ApiError({ errorCode: 'INVALID_RESPONSE' })
  return value.map(event => validateTournament('TournamentEvent', event))
}
export const getTournamentStandings = (id: number, signal?: AbortSignal) => json(`/api/tournaments/${id}/standings`, 'TournamentStandings', false, { signal })
export const getTournamentConfig = (id: number, signal?: AbortSignal) => json(eventPath(id), 'TournamentConfig', true, { signal })
export const createTournament = (value: Schemas['TournamentCreateRequest'], signal?: AbortSignal) => json(base, 'TournamentConfig', true, body('POST', value, signal))
export const updateTournament = (id: number, value: Schemas['TournamentUpdateRequest'], signal?: AbortSignal) => json(eventPath(id), 'TournamentConfig', true, body('PUT', value, signal))
export const saveTournamentRules = (id: number, round: number, value: TournamentRuleRequest, signal?: AbortSignal) => json(`${eventPath(id)}/rounds/${round}`, 'TournamentConfig', true, body('PUT', value, signal))
export const getTournamentDay = (id: number, round: number, day: number, signal?: AbortSignal) => json(dayPath(id, round, day), 'TournamentDayView', true, { signal })
export const setTournamentExpectedGroups = (id: number, round: number, day: number, value: Schemas['TournamentExpectedGroupsRequest'], signal?: AbortSignal) => json(`${dayPath(id, round, day)}/expected-groups`, 'TournamentDayView', true, body('PUT', value, signal))
export const previewTournamentDay = (id: number, round: number, day: number, value: TournamentDraftRequest, signal?: AbortSignal) => json(`${dayPath(id, round, day)}/preview`, 'TournamentDayView', true, body('POST', value, signal))
export const saveTournamentDraft = (id: number, round: number, day: number, value: TournamentDraftRequest, signal?: AbortSignal) => json(`${dayPath(id, round, day)}/draft`, 'TournamentDayView', true, body('PUT', value, signal))
export const finalizeTournamentDay = (id: number, round: number, day: number, value: Schemas['TournamentFinalizeRequest'], signal?: AbortSignal) => json(`${dayPath(id, round, day)}/finalize`, 'TournamentDayView', true, body('POST', value, signal))
export const startTournamentCorrection = (id: number, round: number, day: number, value: Schemas['TournamentCorrectionRequest'], signal?: AbortSignal) => json(`${dayPath(id, round, day)}/correction`, 'TournamentDayView', true, body('POST', value, signal))
export const discardTournamentDraft = (id: number, round: number, day: number, value: Schemas['TournamentVersions'], signal?: AbortSignal) => json(`${dayPath(id, round, day)}/draft`, 'TournamentDayView', true, body('DELETE', value, signal))
export const clearTournamentPoints = (id: number, value: Schemas['TournamentClearRequest'], signal?: AbortSignal) => json(`${eventPath(id)}/clear-points`, 'TournamentStandings', true, body('POST', value, signal))
export async function deleteTournament(id: number, value: Schemas['TournamentDeleteRequest'], signal?: AbortSignal) {
  await request(eventPath(id), true, body('DELETE', value, signal))
}
export async function getTournamentAudit(id: number, signal?: AbortSignal): Promise<TournamentAudit[]> {
  const value: unknown = await (await request(`${eventPath(id)}/audit`, true, { signal })).json()
  if (!Array.isArray(value)) throw new ApiError({ errorCode: 'INVALID_RESPONSE' })
  return value.map(entry => validateTournament('TournamentAudit', entry))
}
export async function getTournamentEvidence(id: number, evidenceId: string, signal?: AbortSignal): Promise<Blob> {
  return (await request(`${eventPath(id)}/evidence/${encodeURIComponent(evidenceId)}`, true, { signal })).blob()
}
export async function recognizeTournamentImage(id: number, round: number, day: number, versions: Schemas['TournamentDraftRequest'], file: File, signal?: AbortSignal) {
  const permitBody = new FormData()
  permitBody.append('image', file)
  for (const key of ['expectedEventVersion', 'expectedDayVersion', 'expectedRulesVersion'] as const) permitBody.append(key, String(versions[key]))
  const permit = await json(`${dayPath(id, round, day)}/recognition-permits`, 'TournamentRecognitionPermit', true, { method: 'POST', body: permitBody, signal })
  const imageBody = new FormData()
  imageBody.append('image', file)
  imageBody.append('permit', permit.permit)
  // Multipart AI calls reuse the shared Bearer boundary without setting a JSON content type.
  const result = await json('/api/ai/tournament-groups/recognize', 'TournamentRecognitionResult', true, { method: 'POST', body: imageBody, signal })
  if (result.imageHash !== permit.imageHash) throw new ApiError({ errorCode: 'INVALID_RESPONSE' })
  return { result, evidenceId: permit.evidenceId }
}
