const STATUS_FALLBACK = Object.freeze({
  400: 'INVALID_REQUEST',
  401: 'AUTH_UNAUTHENTICATED',
  403: 'AUTH_FORBIDDEN',
  404: 'RESOURCE_NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  413: 'UPLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  429: 'RATE_LIMITED',
  500: 'INTERNAL_ERROR',
  502: 'UPSTREAM_UNAVAILABLE',
  503: 'SERVICE_UNAVAILABLE',
  504: 'UPSTREAM_TIMEOUT',
})

const RETRYABLE_CODES = new Set([
  'NETWORK_ERROR', 'RATE_LIMITED', 'REPLAY_BUSY', 'PROCESSING_QUEUE_FULL',
  'EXPORT_QUEUE_FULL', 'AI_REVIEW_BUSY', 'AI_QUEUE_FULL', 'AI_RATE_LIMITED',
  'AI_UPSTREAM_TIMEOUT', 'AI_UPSTREAM_UNAVAILABLE',
  'UPSTREAM_TIMEOUT', 'UPSTREAM_UNAVAILABLE', 'SERVICE_UNAVAILABLE', 'INTERNAL_ERROR',
])
const NON_RETRYABLE_CODES = new Set([
  'AUTH_UNAUTHENTICATED', 'AUTH_FORBIDDEN', 'AI_TIMEOUT', 'AI_CANCELLED',
  'AI_NOT_CONFIGURED', 'REQUEST_ABORTED',
])

function fallbackCode(status) {
  return STATUS_FALLBACK[status] || (status ? `HTTP_${status}` : 'NETWORK_ERROR')
}

function fallbackRetryable(code, status) {
  if (NON_RETRYABLE_CODES.has(code)) return false
  return RETRYABLE_CODES.has(code) || status === 429 || status >= 500
}

function contractCode(value) {
  return typeof value === 'string' && /^[A-Z][A-Z0-9_]*$/.test(value) ? value : null
}

function safeDetails(details) {
  return details && typeof details === 'object' && !Array.isArray(details) ? details : {}
}

export class ApiError extends Error {
  constructor(options, legacyStatus = null) {
    const normalized = typeof options === 'string'
      ? { code: options, status: legacyStatus }
      : (options || {})
    const code = normalized.code || fallbackCode(normalized.status)
    super(code, normalized.cause ? { cause: normalized.cause } : undefined)
    this.name = 'ApiError'
    this.code = code
    this.status = Number.isFinite(normalized.status) ? normalized.status : null
    this.messageKey = typeof normalized.messageKey === 'string' ? normalized.messageKey : null
    this.traceId = typeof normalized.traceId === 'string' && normalized.traceId ? normalized.traceId : null
    this.retryable = typeof normalized.retryable === 'boolean'
      ? normalized.retryable
      : fallbackRetryable(code, this.status)
    this.details = safeDetails(normalized.details)
  }
}

async function responseBody(response) {
  const contentType = header(response, 'Content-Type') || ''
  const expectsJson = /(?:^|[+/])json(?:;|$)/i.test(contentType)
  if (typeof response.text === 'function') {
    const raw = await response.text()
    if (!raw) return { body: null, malformed: false }
    try {
      return { body: JSON.parse(raw), malformed: false }
    } catch {
      const legacyCode = /^[A-Z][A-Z0-9_]*$/.test(raw.trim()) ? { code: raw.trim() } : null
      return { body: legacyCode, malformed: expectsJson && !legacyCode }
    }
  }
  if (typeof response.json === 'function') {
    try {
      return { body: await response.json(), malformed: false }
    } catch {
      return { body: null, malformed: expectsJson }
    }
  }
  return { body: null, malformed: false }
}

function header(response, name) {
  return typeof response?.headers?.get === 'function' ? response.headers.get(name) : null
}

/** Canonical body first, then legacy `{error}`, then stable status/proxy fallback. */
export async function apiErrorFromResponse(response) {
  const status = Number.isFinite(response?.status) ? response.status : null
  const { body, malformed } = await responseBody(response)
  const candidate = malformed
    ? 'MALFORMED_ERROR_RESPONSE'
    : contractCode(body?.code) || contractCode(body?.error) || fallbackCode(status)
  return new ApiError({
    code: candidate,
    status,
    messageKey: body?.messageKey,
    traceId: body?.traceId || header(response, 'X-Request-ID'),
    retryable: body?.retryable,
    details: body?.details,
  })
}

/** Normalize fetch rejection, abort, legacy Error and already-canonical ApiError. */
export function normalizeApiError(error) {
  if (error instanceof ApiError) return error
  if (error?.name === 'AbortError') {
    return new ApiError({ code: 'REQUEST_ABORTED', status: null, retryable: false, cause: error })
  }
  if (error instanceof TypeError) {
    return new ApiError({ code: 'NETWORK_ERROR', status: null, retryable: true, cause: error })
  }
  const stableCode = typeof error?.code === 'string'
    ? error.code
    : (/^[A-Z][A-Z0-9_]*$/.test(error?.message || '') ? error.message : 'UNKNOWN_ERROR')
  return new ApiError({
    code: stableCode,
    status: error?.status,
    messageKey: error?.messageKey,
    traceId: error?.traceId,
    retryable: error?.retryable,
    details: error?.details,
    cause: error,
  })
}

/** Phase-1 adapter for existing Processing/Export Job FAILED payloads. */
export function normalizeJobError(job) {
  const nested = job?.error && typeof job.error === 'object' ? job.error : null
  const code = contractCode(nested?.code) || contractCode(job?.errorCode) || 'JOB_FAILED'
  return new ApiError({
    code,
    status: null,
    messageKey: nested?.messageKey,
    traceId: nested?.traceId,
    retryable: nested?.retryable ?? false,
    details: nested?.details,
  })
}

export async function requireOk(response) {
  if (!response.ok) throw await apiErrorFromResponse(response)
  return response
}

/** Fetch wrapper guaranteeing transport failures are also canonical ApiError instances. */
export async function apiFetch(input, init) {
  try {
    return init === undefined ? await fetch(input) : await fetch(input, init)
  } catch (error) {
    throw normalizeApiError(error)
  }
}

/** XHR non-2xx response using the same canonical/legacy/status precedence. */
export function apiErrorFromXhr(xhr) {
  let body = null
  let malformed = false
  try {
    body = JSON.parse(xhr.responseText || '')
  } catch {
    const raw = (xhr.responseText || '').trim()
    if (/^[A-Z][A-Z0-9_]*$/.test(raw)) body = { code: raw }
    else malformed = !!raw && /(?:^|[+/])json(?:;|$)/i.test(xhr.getResponseHeader?.('Content-Type') || '')
  }
  const code = malformed ? 'MALFORMED_ERROR_RESPONSE' : contractCode(body?.code)
    || contractCode(body?.error)
    || fallbackCode(xhr.status)
  return new ApiError({
    code,
    status: xhr.status || null,
    messageKey: body?.messageKey,
    traceId: body?.traceId || xhr.getResponseHeader?.('X-Request-ID'),
    retryable: body?.retryable,
    details: body?.details,
  })
}
