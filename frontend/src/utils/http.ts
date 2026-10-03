import { Feature } from '../app/featureCapabilities.js'
import { useFeatureGate } from '../composables/useFeatureGate.js'
import { resolveApiUrl, isAndroidRuntime } from '../platform/runtime.js'
import type {
  ApiErrorApplicationModel,
  ApiErrorInit,
  ApiErrorWirePayload,
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

interface CanonicalApiErrorBody {
  wire: ApiErrorWirePayload | null
  malformed: boolean
}

function parseCanonicalApiErrorBody(body: unknown, httpStatus: number | null): CanonicalApiErrorBody {
  if (!isRecord(body) || !('errorCode' in body)) return { wire: null, malformed: false }
  const wire = validateApiError(body).data
  return wire && wire.status === httpStatus
    ? { wire, malformed: false }
    : { wire: null, malformed: true }
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
  const canonical = !malformed ? parseCanonicalApiErrorBody(body, status) : { wire: null, malformed: false }
  const legacy = !malformed && !canonical.malformed && isRecord(body)
    && (isContractCode(body.code) || isContractCode(body.error))
  let candidate: string
  if (malformed || canonical.malformed) {
    candidate = 'MALFORMED_ERROR_RESPONSE'
  } else if (canonical.wire) {
    candidate = canonical.wire.errorCode
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

/**
 * REST 前缀 → 功能 id 的**纯映射**（无 Vue、无 connectivity、无副作用，可确定性单测）。
 *
 * 前缀边界必须按 segment 判定：`/api/admin/users-evil` 不是 `/api/admin/users` 的子资源，
 * 因此 `startsWith` 式的字符串前缀在这里是错的，用「等于自身 或 后接 `/`」。
 * 判定顺序从最具体到最一般，`/api/admin/hof` 先于 `/api/hof`、`/api/admin/users` 先于 `/api/users`。
 *
 * 未登记的前缀返回 null（**不** fail-closed 成某个功能）：未知路由由后端 404 表达，
 * 不该被这里伪造成「功能不可用」。
 */
const API_PATH_FEATURES: readonly (readonly [string, string])[] = Object.freeze([
  ['/api/admin/users', Feature.ADMIN_USERS],
  ['/api/admin/hof', Feature.HALL_OF_FAME],
  ['/api/users', Feature.ACCOUNT_PROFILE],
  ['/api/hof', Feature.HALL_OF_FAME],
  ['/api/ai', Feature.AI_REVIEW],
].map(pair => Object.freeze(pair) as readonly [string, string]))

export function featureForApiPath(pathname: string): string | null {
  const path = typeof pathname === 'string' ? pathname : ''
  for (const [prefix, feature] of API_PATH_FEATURES) {
    if (path === prefix || path.startsWith(`${prefix}/`)) return feature
  }
  return null
}

/**
 * Fetch wrapper guaranteeing transport failures are also canonical ApiError instances.
 *
 * 连通性门禁的分工（review P2）：
 *  - **业务策略的 owner 是页面 / 组件**：页面用 `useFeatureGate()` + `Feature.*` 决定是否发起动作，
 *    并给出中性状态与提示（见 ProfilePage / AdminUsersPage）。这是唯一的功能准入 SSOT。
 *  - **这里的 transport 映射只是 defense-in-depth**：万一某个页面漏了门禁，Android 运行时也
 *    不会把请求发到一个已知不可达的后端；它**不**参与产品决策，也**不**负责提示文案。
 */
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  try {
    const resolved = resolveApiUrl(input)
    if (isAndroidRuntime()) {
      const url = new URL(typeof resolved === 'string' ? resolved : resolved instanceof URL ? resolved.href : resolved.url, window.location.href)
      const feature = featureForApiPath(url.pathname)
      if (feature && !useFeatureGate().requireFeature(feature)) {
        throw new ApiError({ code: 'NETWORK_ERROR', retryable: true })
      }
    }
    // Native Bearer owns Android authentication; never send cross-origin cookies.
    return isAndroidRuntime()
      ? await fetch(resolved, { ...init, credentials: 'omit' })
      : init === undefined ? await fetch(resolved) : await fetch(resolved, init)
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
  const status = xhr.status || null
  const canonical = !malformed ? parseCanonicalApiErrorBody(body, status) : { wire: null, malformed: false }
  let code: string
  if (malformed || canonical.malformed) {
    code = 'MALFORMED_ERROR_RESPONSE'
  } else if (canonical.wire) {
    code = canonical.wire.errorCode
  } else if (isContractCode(record.code)) {
    code = record.code
  } else if (isContractCode(record.error)) {
    code = record.error
  } else {
    code = fallbackCode(status)
  }
  return new ApiError({
    errorCode: code,
    status,
    errorMsg: record.errorMsg,
    id: record.id,
    traceId: record.traceId || xhr.getResponseHeader?.('X-Request-ID'),
    retryable: record.retryable,
    details: record.details,
    timestamp: record.timestamp,
  })
}
