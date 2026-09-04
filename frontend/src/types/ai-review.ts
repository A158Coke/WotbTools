import type { ApiErrorApplicationModel, ServerErrorCode } from './api.js'

export type AiReviewCapability =
  | 'AVAILABLE'
  | 'AVAILABLE_WITH_LIMITED_TIMELINE'
  | 'UNAVAILABLE'

export interface AiReviewResult {
  analysis: string
  /** Older SSE payloads omit this field when the pre-battle call is unavailable. */
  preBattleSection?: string | null
  /** The current SSE writer may omit capability; the AnalyzeResponse still owns its contract. */
  capability?: AiReviewCapability
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
  type: 'call1_start' | 'call1_done' | 'evidence_done' | 'autopsy_start' | 'autopsy_done'
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
  code: ServerErrorCode
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
