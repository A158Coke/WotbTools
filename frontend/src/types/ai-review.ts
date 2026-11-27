import type { ApiErrorApplicationModel, ServerErrorCode } from './api.js'
import type { components } from '../api/generated/http-contract.js'

export type AiReviewCapability =
  | 'AVAILABLE'
  | 'AVAILABLE_WITH_LIMITED_TIMELINE'
  | 'UNAVAILABLE'

export type TeamAiReviewResult = components['schemas']['TeamAiReviewResult']
export type TeamAiPlayerIdentity = components['schemas']['TeamAiPlayerIdentity']

export type AiReviewRequest = components['schemas']['AiReviewRequest']
export type AiReviewBattle = components['schemas']['AiReviewBattle']
export type ClientAiReviewProjection = components['schemas']['ClientAiReviewProjection']
export type AiReviewLocale = AiReviewRequest['locale']

export interface AiReviewProjection {
  battle: AiReviewBattle
  projection: ClientAiReviewProjection
}

export const AI_REVIEW_LOCALES: readonly AiReviewLocale[] = ['zh-CN', 'en-US', 'ru-RU']

export function toAiReviewLocale(value: unknown): AiReviewLocale {
  return AI_REVIEW_LOCALES.includes(value as AiReviewLocale) ? (value as AiReviewLocale) : 'zh-CN'
}

export interface AiReviewResult {
  analysis?: string | null
  preBattleSection?: string | null
  capability?: AiReviewCapability
  teamReview?: TeamAiReviewResult
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

export type AiFailureKind =
  | 'busy'
  | 'not_configured'
  | 'timeout'
  | 'upstream'
  | 'malformed'
  | 'cancelled'
  | 'client'

export interface AiFailure {
  kind: AiFailureKind
  code: string
  id: string
  message: string
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
  id: string | null
  code: ServerErrorCode
  errorMsg: string | null
}

export type AiReviewEvent =
  | AiReviewStageEvent
  | AiReviewTokenEvent
  | AiReviewDoneEvent
  | AiReviewErrorEvent

export function isAiReviewCapability(value: unknown): value is AiReviewCapability {
  return value === 'AVAILABLE'
    || value === 'AVAILABLE_WITH_LIMITED_TIMELINE'
    || value === 'UNAVAILABLE'
}

export type AiReviewApiError = ApiErrorApplicationModel
