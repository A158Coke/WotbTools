export class ApiError extends Error {
  constructor(code, status) {
    super(code)
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }
}

export async function apiErrorFromResponse(response) {
  let code = `HTTP_${response.status}`
  try {
    const body = await response.json()
    const candidate = body?.error || body?.code
    if (typeof candidate === 'string' && candidate) code = candidate
  } catch {
    // Non-JSON error responses use the stable HTTP_<status> fallback.
  }
  return new ApiError(code, response.status)
}
