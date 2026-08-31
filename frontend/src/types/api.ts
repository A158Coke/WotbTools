/** Transport and canonical error contracts. */

export type JsonObject = Record<string, unknown>

export type KnownErrorCode =
  | 'AUTH_UNAUTHENTICATED'
  | 'AUTH_FORBIDDEN'
  | 'INVALID_ARGUMENT'
  | 'MISSING_PARAM'
  | 'INVALID_REQUEST'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'METHOD_NOT_ALLOWED'
  | 'RESOURCE_NOT_FOUND'
  | 'REPLAY_BUSY'
  | 'PROCESSING_QUEUE_FULL'
  | 'EXPORT_QUEUE_FULL'
  | 'AI_REVIEW_BUSY'
  | 'AI_QUEUE_FULL'
  | 'AI_RATE_LIMITED'
  | 'AI_UPSTREAM_TIMEOUT'
  | 'AI_UPSTREAM_UNAVAILABLE'
  | 'AI_TIMEOUT'
  | 'AI_CANCELLED'
  | 'AI_NOT_CONFIGURED'
  | 'AI_INVALID_REQUEST'
  | 'AI_AUTHENTICATION_ERROR'
  | 'AI_CONTEXT_TOO_LARGE'
  | 'AI_EMPTY_RESPONSE'
  | 'AI_RESPONSE_INVALID'
  | 'AI_REVIEW_GROUNDING_FAILED'
  | 'AI_TIMELINE_UNUSABLE'
  | 'AI_PROMPT_MANDATORY_SECTION_TOO_LARGE'
  | 'JOB_NOT_FOUND'
  | 'SOURCE_NOT_FOUND'
  | 'SOURCE_NOT_READY'
  | 'SOURCE_PROCESSING_FAILED'
  | 'DATASET_UNAVAILABLE'
  | 'INTERNAL_ERROR'
  | 'NETWORK_ERROR'
  | 'REQUEST_ABORTED'
  | 'MALFORMED_ERROR_RESPONSE'
  | 'SERVICE_UNAVAILABLE'
  | 'UPSTREAM_UNAVAILABLE'
  | 'UPSTREAM_TIMEOUT'
  | 'RATE_LIMITED'
  | 'UNKNOWN_ERROR'

/** Validated but not yet registered server codes stay distinguishable from known codes. */
export type UnknownErrorCode = string & { readonly __brand: 'UnknownErrorCode' }
export type ErrorCode = KnownErrorCode | UnknownErrorCode

export interface ApiErrorPayload {
  id: string | null
  errorCode: ErrorCode
  errorMsg: string | null
  status: number | null
  retryable: boolean
  details: JsonObject
  timestamp: string | null
  /** Legacy response compatibility only; not part of the canonical body. */
  traceId?: string | null
}

export interface ApiErrorInit {
  errorCode?: string
  /** Legacy client alias retained while callers migrate. */
  code?: string
  id?: unknown
  errorMsg?: unknown
  status?: unknown
  retryable?: unknown
  details?: unknown
  timestamp?: unknown
  traceId?: unknown
  cause?: unknown
}

export interface ApiFetchInit extends RequestInit {}

