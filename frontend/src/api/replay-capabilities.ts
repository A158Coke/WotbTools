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

export type OptionalArtifact<T> =
  | { available: true; status: number; data: T }
  | { available: false; status: 204; data: null }

/**
 * 可选 Bearer：已登录则保鲜 token 并附带；未登录（或刷新失败）返回空 header，以匿名身份请求。
 * 赛果解析 / 导出 / 2D 回放端点对匿名开放，登录只用于 idempotency 分域与绑定账号验证。
 */
export async function optionalBearer(auth: ReplayAuthSession): Promise<Record<string, string>> {
  const valid = await auth.ensureToken(30)
  const accessToken = valid ? auth.token() : ''
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : {}
}

/**
 * Bearer 鉴权 POST：`ensureToken` 保鲜 + canonical `ApiError` 归一。
 * `/api/replay/*` 与 `/api/ai/**` 两个 transport 模块共用，组件不得复制此逻辑。
 * `optionalAuth`：匿名可用的端点（map-overview / battle-playback-v2）未登录时不抛错、不带 header。
 */
export async function authedReplayPost(
  auth: ReplayAuthSession,
  url: string,
  body: unknown,
  options: { signal?: AbortSignal; allowNoContent?: boolean; keepalive?: boolean; optionalAuth?: boolean } = {},
): Promise<Response> {
  let authHeader: Record<string, string>
  if (options.optionalAuth) {
    authHeader = await optionalBearer(auth)
  } else {
    const valid = await auth.ensureToken(30)
    if (!valid) {
      throw new ApiError({ code: 'AUTH_UNAUTHENTICATED', status: 401, retryable: false })
    }
    const accessToken = auth.token()
    authHeader = accessToken ? { Authorization: `Bearer ${accessToken}` } : {}
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...authHeader,
  }

  const response = await apiFetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: options.signal,
    keepalive: options.keepalive,
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
    optionalAuth: true,
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
    optionalAuth: true,
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
