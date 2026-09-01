import type {
  ApiErrorApplicationModel,
  ApiErrorInit,
  ApplicationErrorCode,
  JsonObject,
} from '../types/api.js'
import { isContractCode, isRecord } from '../types/guards.js'
import { validateApiError } from '../api/contract-runtime.js'

const STATUS_FALLBACK: Readonly<Record<number, string>> = Object.freeze({
  400: 'INVALID_REQUEST', 401: 'AUTH_UNAUTHENTICATED', 403: 'AUTH_FORBIDDEN',
  404: 'RESOURCE_NOT_FOUND', 405: 'METHOD_NOT_ALLOWED', 413: 'UPLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE', 429: 'RATE_LIMITED', 500: 'INTERNAL_ERROR',
  502: 'UPSTREAM_UNAVAILABLE', 503: 'SERVICE_UNAVAILABLE', 504: 'UPSTREAM_TIMEOUT',
})

const RETRYABLE_CODES: ReadonlySet<string> = new Set([
  'NETWORK_ERROR', 'RATE_LIMITED', 'REPLAY_BUSY', 'PROCESSING_QUEUE_FULL',
  'EXPORT_QUEUE_FULL', 'AI_REVIEW_BUSY', 'AI_QUEUE_FULL', 'AI_RATE_LIMITED',
  'AI_UPSTREAM_TIMEOUT', 'AI_UPSTREAM_UNAVAILABLE', 'UPSTREAM_TIMEOUT',
  'UPSTREAM_UNAVAILABLE', 'SERVICE_UNAVAILABLE', 'INTERNAL_ERROR',
])
const NON_RETRYABLE_CODES: ReadonlySet<string> = new Set([
  'AUTH_UNAUTHENTICATED', 'AUTH_FORBIDDEN', 'AI_TIMEOUT', 'AI_CANCELLED',
  'AI_NOT_CONFIGURED', 'REQUEST_ABORTED',
])

function fallbackCode(status: number | null): string {
  return (status !== null ? STATUS_FALLBACK[status] : undefined)
    || (status ? `HTTP_${status}` : 'NETWORK_ERROR')
}

function fallbackRetryable(code: string, status: number | null): boolean {
  if (NON_RETRYABLE_CODES.has(code)) return false
  return RETRYABLE_CODES.has(code) || status === 429 || (status !== null && status >= 500)
}

function safeDetails(details: unknown): JsonObject {
  return isRecord(details) ? details : {}
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function statusOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export class ApiError extends Error implements ApiErrorApplicationModel {
  readonly name = 'ApiError'
  readonly errorCode: ApplicationErrorCode
  /** Backward-compatible alias; new code should branch on errorCode. */
  readonly code: string
  readonly status: number | null
  readonly errorMsg: string | null
  readonly id: string | null
  /** Legacy request-header correlation, never the canonical body identifier. */
  readonly traceId: string | null
  readonly retryable: boolean
  readonly details: JsonObject
  readonly timestamp: string | null

  constructor(options: string | ApiErrorInit | null | undefined, legacyStatus: number | null = null) {
    const normalized: ApiErrorInit = typeof options === 'string'
      ? { errorCode: options, status: legacyStatus }
      : options || {}
    const errorCode = isContractCode(normalized.errorCode)
      ? normalized.errorCode
      : isContractCode(normalized.code)
        ? normalized.code
        : fallbackCode(statusOrNull(normalized.status))
    super(errorCode, normalized.cause instanceof Error ? { cause: normalized.cause } : undefined)
    this.errorCode = errorCode as ApplicationErrorCode
    this.code = errorCode
    this.status = statusOrNull(normalized.status)
    this.errorMsg = stringOrNull(normalized.errorMsg)
    this.id = stringOrNull(normalized.id)
    this.traceId = stringOrNull(normalized.traceId)
    this.retryable = typeof normalized.retryable === 'boolean'
      ? normalized.retryable
      : fallbackRetryable(errorCode, this.status)
    this.details = safeDetails(normalized.details)
    this.timestamp = stringOrNull(normalized.timestamp)
  }
}

interface ResponseBody {
  body: unknown
  malformed: boolean
}

function header(response: Pick<Response, 'headers'>, name: string): string | null {
  return typeof response.headers?.get === 'function' ? response.headers.get(name) : null
}

async function responseBody(response: Pick<Response, 'headers'> & Partial<Pick<Response, 'text' | 'json'>>): Promise<ResponseBody> {
  const contentType = header(response, 'Content-Type') || ''
  const expectsJson = /(?:^|[+/])json(?:;|$)/i.test(contentType)
  if (typeof response.text === 'function') {
    const raw = await response.text()
    if (!raw) return { body: null, malformed: false }
    try {
      return { body: JSON.parse(raw) as unknown, malformed: false }
    } catch {
      const legacyCode = /^[A-Z][A-Z0-9_]*$/.test(raw.trim()) ? { code: raw.trim() } : null
      return { body: legacyCode, malformed: expectsJson && !legacyCode }
    }
  }
  if (typeof response.json === 'function') {
    try {
      return { body: await response.json() as unknown, malformed: false }
    } catch {
      return { body: null, malformed: expectsJson }
    }
  }
  return { body: null, malformed: false }
}

/** Canonical body first, then legacy `{error}`, then stable status/proxy fallback. */
export async function apiErrorFromResponse(response: Response): Promise<ApiError> {
  const status = Number.isFinite(response.status) ? response.status : null
  const { body, malformed } = await responseBody(response)
  const wire = !malformed ? validateApiError(body).data : null
  const legacy = !malformed && isRecord(body)
    && (isContractCode(body.code) || isContractCode(body.error))
  let candidate: string
  if (malformed || (isRecord(body) && 'errorCode' in body && !wire)) {
    candidate = 'MALFORMED_ERROR_RESPONSE'
  } else if (wire) {
    candidate = wire.errorCode
  } else if (legacy) {
    candidate = (body.code || body.error) as string
  } else {
    candidate = fallbackCode(status)
  }
  const bodyRecord: JsonObject = isRecord(body) ? body : {}
  return new ApiError({
    errorCode: candidate,
    status,
    errorMsg: bodyRecord.errorMsg,
    id: bodyRecord.id,
    traceId: bodyRecord.traceId || header(response, 'X-Request-ID'),
    retryable: bodyRecord.retryable,
    details: bodyRecord.details,
    timestamp: bodyRecord.timestamp,
  })
}

/** Normalize fetch rejection, abort, legacy Error and already-canonical ApiError. */
export function normalizeApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error
  if (isRecord(error) && error.name === 'AbortError') {
    return new ApiError({ code: 'REQUEST_ABORTED', status: null, retryable: false, cause: error })
  }
  if (error instanceof TypeError) {
    return new ApiError({ code: 'NETWORK_ERROR', status: null, retryable: true, cause: error })
  }
  const errorRecord = isRecord(error) ? error : {}
  const message = error instanceof Error ? error.message : errorRecord.message
  const stableCode = isContractCode(errorRecord.errorCode) ? errorRecord.errorCode
    : isContractCode(errorRecord.code) ? errorRecord.code
      : isContractCode(message) ? message : 'UNKNOWN_ERROR'
  return new ApiError({
    errorCode: stableCode,
    status: errorRecord.status,
    errorMsg: errorRecord.errorMsg,
    id: errorRecord.id,
    traceId: errorRecord.traceId,
    retryable: errorRecord.retryable,
    details: errorRecord.details,
    cause: error,
  })
}

/** Phase-1 adapter for existing Processing/Export Job FAILED payloads. */
export function normalizeJobError(job: unknown): ApiError {
  const record = isRecord(job) ? job : {}
  const nested = isRecord(record.error) ? record.error : {}
  const code = isContractCode(nested.errorCode) ? nested.errorCode
    : isContractCode(nested.code) ? nested.code
      : isContractCode(record.errorCode) ? record.errorCode : 'JOB_FAILED'
  return new ApiError({
    errorCode: code,
    status: null,
    errorMsg: nested.errorMsg,
    id: nested.id,
    traceId: nested.traceId,
    retryable: nested.retryable ?? false,
    details: nested.details,
  })
}

export async function requireOk(response: Response): Promise<Response> {
  if (!response.ok) throw await apiErrorFromResponse(response)
  return response
}

/** Fetch wrapper guaranteeing transport failures are also canonical ApiError instances. */
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  try {
    return init === undefined ? await fetch(input) : await fetch(input, init)
  } catch (error) {
    throw normalizeApiError(error)
  }
}

export interface XhrErrorResponse {
  status: number
  responseText?: string
  getResponseHeader?: (name: string) => string | null
}

/** XHR non-2xx response using the same canonical/legacy/status precedence. */
export function apiErrorFromXhr(xhr: XhrErrorResponse): ApiError {
  let body: unknown = null
  let malformed = false
  try {
    body = JSON.parse(xhr.responseText || '') as unknown
  } catch {
    const raw = (xhr.responseText || '').trim()
    if (/^[A-Z][A-Z0-9_]*$/.test(raw)) body = { code: raw }
    else malformed = !!raw && /(?:^|[+/])json(?:;|$)/i.test(xhr.getResponseHeader?.('Content-Type') || '')
  }
  const record = isRecord(body) ? body : {}
  const code = malformed ? 'MALFORMED_ERROR_RESPONSE' : isContractCode(record.errorCode)
    ? record.errorCode : isContractCode(record.code) ? record.code
      : isContractCode(record.error) ? record.error : fallbackCode(xhr.status || null)
  return new ApiError({
    errorCode: code,
    status: xhr.status || null,
    errorMsg: record.errorMsg,
    id: record.id,
    traceId: record.traceId || xhr.getResponseHeader?.('X-Request-ID'),
    retryable: record.retryable,
    details: record.details,
    timestamp: record.timestamp,
  })
}
