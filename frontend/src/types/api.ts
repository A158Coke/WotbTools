/** Transport and canonical error contracts. */

import type { components } from '../api/generated/http-contract.js'

export type JsonObject = Record<string, unknown>

export type KnownErrorCode = components['schemas']['ApiErrorCode']

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

