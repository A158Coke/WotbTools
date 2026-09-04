import type { BattlePlaybackDataset } from '../types/playback-v2.js'
import { validateBattlePlaybackDataset } from './contract-runtime.js'
import { ApiError, apiErrorFromResponse, apiFetch } from '../utils/http.js'

export interface ReplayAuthSession {
  token: () => string
  ensureToken: (minValidity?: number) => Promise<boolean>
}

export interface ReplayDatasetRef {
  processingJobId: string
  sourceId: string
}

export interface AiReviewRequest extends ReplayDatasetRef {
  lang: string
  correlationId: string
}

export type OptionalArtifact<T> =
  | { available: true; status: number; data: T }
  | { available: false; status: 204; data: null }

async function authedReplayPost(
  auth: ReplayAuthSession,
  url: string,
  body: unknown,
  options: { signal?: AbortSignal; allowNoContent?: boolean } = {},
): Promise<Response> {
  const valid = await auth.ensureToken(30)
  if (!valid) {
    throw new ApiError({ code: 'AUTH_UNAUTHENTICATED', status: 401, retryable: false })
  }

  const accessToken = auth.token()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`

  const response = await apiFetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: options.signal,
  })

  if (response.status === 204 && options.allowNoContent) return response
  if (!response.ok) throw await apiErrorFromResponse(response)
  return response
}

/** Dataset-only MapOverview query. Never uploads the replay again. */
export async function fetchMapOverviewArtifact(
  auth: ReplayAuthSession,
  ref: ReplayDatasetRef,
  signal?: AbortSignal,
): Promise<OptionalArtifact<unknown>> {
  const response = await authedReplayPost(auth, '/api/replay/map-overview', ref, {
    signal,
    allowNoContent: true,
  })
  if (response.status === 204) return { available: false, status: 204, data: null }
  return { available: true, status: response.status, data: await response.json() as unknown }
}

/** Canonical V2 playback dataset query + runtime contract validation. */
export async function fetchBattlePlaybackDataset(
  auth: ReplayAuthSession,
  ref: ReplayDatasetRef,
  signal?: AbortSignal,
): Promise<OptionalArtifact<BattlePlaybackDataset>> {
  const response = await authedReplayPost(auth, '/api/replay/battle-playback-v2', ref, {
    signal,
    allowNoContent: true,
  })
  if (response.status === 204) return { available: false, status: 204, data: null }

  const body = await response.json() as unknown
  const validation = validateBattlePlaybackDataset(body)
  if (!validation.data) {
    // Diagnostic metadata only. Never log response payload, bearer token, or replay contents.
    console.warn('[playback-v2] contract validation failed', {
      processingJobId: ref.processingJobId,
      sourceId: ref.sourceId,
      diagnostics: validation.diagnostics.slice(0, 8),
    })
    throw new ApiError({
      code: 'INVALID_RESPONSE',
      status: response.status,
      retryable: false,
      details: { diagnostics: validation.diagnostics.slice(0, 8) },
    })
  }

  return { available: true, status: response.status, data: validation.data }
}

/** Opens the AI Review SSE response. Stream parsing remains a presentation/application concern. */
export function openAiReviewStream(
  auth: ReplayAuthSession,
  request: AiReviewRequest,
  signal?: AbortSignal,
): Promise<Response> {
  return authedReplayPost(auth, '/api/replay/analyze', request, { signal })
}

/** Best-effort cancellation for unload/button/timeout paths. */
export async function cancelAiReview(
  auth: Pick<ReplayAuthSession, 'token'>,
  correlationId: string,
): Promise<void> {
  if (!correlationId) return
  const accessToken = auth.token()
  const headers: Record<string, string> = accessToken ? { Authorization: `Bearer ${accessToken}` } : {}
  await apiFetch(`/api/replay/analyze/cancel?correlationId=${encodeURIComponent(correlationId)}`, {
    method: 'POST',
    headers,
    keepalive: true,
  })
}
