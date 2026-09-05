import type { ApiErrorApplicationModel, ServerErrorCode } from './api.js'
import type { components } from '../api/generated/http-contract.js'

export type AiReviewCapability =
  | 'AVAILABLE'
  | 'AVAILABLE_WITH_LIMITED_TIMELINE'
  | 'UNAVAILABLE'

export type TeamAiReviewResult = components['schemas']['TeamAiReviewResult']

export interface AiReviewResult {
  /** Text path retained for player reviews and older deployed backends. */
  analysis?: string | null
  /** Older SSE payloads omit this field when the pre-battle call is unavailable. */
  preBattleSection?: string | null
  /** The current SSE writer may omit capability; the AnalyzeResponse still owns its contract. */
  capability?: AiReviewCapability
  /** Structured Team Review v0.5; mutually exclusive with the text-only production path. */
  teamReview?: TeamAiReviewResult
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
