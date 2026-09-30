import type { ApiErrorApplicationModel, ServerErrorCode } from './api.js'
import type { components } from '../api/generated/http-contract.js'

export type AiReviewCapability =
  | 'AVAILABLE'
  | 'AVAILABLE_WITH_LIMITED_TIMELINE'
  | 'UNAVAILABLE'

export type TeamAiReviewResult = components['schemas']['TeamAiReviewResult']
export type TeamAiPlayerIdentity = components['schemas']['TeamAiPlayerIdentity']

export type AiReviewRequestV1 = components['schemas']['AiReviewRequestV1']
export type AiReviewBattle = components['schemas']['AiReviewBattle']
export type AiReviewReconstruction = components['schemas']['AiReviewReconstruction']
export type AiReviewLocale = AiReviewRequestV1['locale']

/**
 * 客户端 AI 投影：本地解析层（canonical ParsedReplay 的客户端投影）产出的契约字段子集，
 * 只含 `battle` + `reconstruction`——`metadata` / `streamHeader` / `diagnostics` 按契约
 * 永不进入 HTTP（见 docs/architecture/ai-review.md 字段一致性表）。
 */
export interface AiReviewProjection {
  battle: AiReviewBattle
  reconstruction: AiReviewReconstruction
}

/** 契约 locale 白名单（`AiReviewRequestV1.locale` enum 的运行时镜像）。 */
export const AI_REVIEW_LOCALES: readonly AiReviewLocale[] = ['zh-CN', 'en-US', 'ru-RU']

/** 把 UI locale 收敛到契约 enum；未知值回退 zh-CN，与后端 UNKNOWN_LOCALE 防线一致。 */
export function toAiReviewLocale(value: unknown): AiReviewLocale {
  return AI_REVIEW_LOCALES.includes(value as AiReviewLocale) ? (value as AiReviewLocale) : 'zh-CN'
}

export interface AiReviewResult {
  /** Text path retained for player reviews and older deployed backends. */
  analysis?: string | null
  /** Older SSE payloads omit this field when the pre-battle call is unavailable. */
  preBattleSection?: string | null
  /** The current SSE writer may omit capability; the AnalyzeResponse still owns its contract. */
  capability?: AiReviewCapability
  /** Structured Team Review v0.5. */
  teamReview?: TeamAiReviewResult
  /** Authoritative playerKey → nickname/tank display mapping. */
  teamPlayers?: TeamAiPlayerIdentity[]
}

export interface AiReviewRunState {
  controller: AbortController
  correlationId: string
  startedAt: number
  timeoutTimer: ReturnType<typeof setTimeout> | null
  cancelRequested: boolean
  timedOut: boolean
}

export interface AiReviewStageEvent {
  type: 'call1_start' | 'call1_done' | 'evidence_done'
}

export interface AiReviewTokenEvent {
  type: 'call2_token'
  delta: string
}

export interface AiReviewDoneEvent {
  type: 'done'
  result: AiReviewResult
}

export interface AiReviewErrorEvent {
  type: 'error'
  /** Canonical diagnostic id; for SSE AI failures this is the request correlation id. */
  id: string | null
  code: ServerErrorCode
  errorMsg: string | null
}

export type AiReviewEvent =
  | AiReviewStageEvent
  | AiReviewTokenEvent
  | AiReviewDoneEvent
  | AiReviewErrorEvent

/** Runtime boundary for the stable capability values emitted by AnalyzeResponse. */
export function isAiReviewCapability(value: unknown): value is AiReviewCapability {
  return value === 'AVAILABLE'
    || value === 'AVAILABLE_WITH_LIMITED_TIMELINE'
    || value === 'UNAVAILABLE'
}

/** Keep the imported API error shape available to callers without coupling SSE payloads to it. */
export type AiReviewApiError = ApiErrorApplicationModel
