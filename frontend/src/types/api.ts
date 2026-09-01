/** Transport and canonical error contracts. */

import type { components } from '../api/generated/http-contract.js'

export type JsonObject = Record<string, unknown>

export type ApiErrorWirePayload = components['schemas']['ApiError']

export type KnownServerErrorCode = components['schemas']['ApiErrorCode']

/** Validated but not yet registered server codes stay distinguishable from known codes. */
export type UnknownErrorCode = string & { readonly __brand: 'UnknownErrorCode' }
export type ServerErrorCode = KnownServerErrorCode | UnknownErrorCode

/** Browser/application failures; never part of the HTTP server error registry. */
export type ClientErrorCode =
  | 'NETWORK_ERROR'
  | 'REQUEST_ABORTED'
  | 'MALFORMED_ERROR_RESPONSE'
  | 'UNKNOWN_ERROR'
  | `HTTP_${number}`

export type ApplicationErrorCode = ServerErrorCode | ClientErrorCode

/** Application error model after the HTTP wire adapter has parsed a response. */
export interface ApiErrorApplicationModel {
  id: string | null
  errorCode: ApplicationErrorCode
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

