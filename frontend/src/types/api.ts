
import type { components } from '../api/generated/http-contract.js'

export type JsonObject = Record<string, unknown>

export type ApiErrorWirePayload = components['schemas']['ApiError']

export type KnownServerErrorCode = components['schemas']['ApiErrorCode']

export type UnknownErrorCode = string & { readonly __brand: 'UnknownErrorCode' }
export type ServerErrorCode = KnownServerErrorCode | UnknownErrorCode

export type ClientErrorCode =
  | 'NETWORK_ERROR'
  | 'REQUEST_ABORTED'
  | 'MALFORMED_ERROR_RESPONSE'
  | 'UNKNOWN_ERROR'
  | `HTTP_${number}`

export type ApplicationErrorCode = ServerErrorCode | ClientErrorCode

export interface ApiErrorApplicationModel {
  id: string | null
  errorCode: ApplicationErrorCode
  errorMsg: string | null
  status: number | null
  retryable: boolean
  details: JsonObject
  timestamp: string | null
  traceId?: string | null
}

export interface ApiErrorInit {
  errorCode?: string
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

