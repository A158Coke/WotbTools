import { gzipSync, strToU8 } from 'fflate'
import { ApiError, apiErrorFromResponse, apiFetch } from '../utils/http.js'

export interface ReplayAuthSession {
  token: () => string
  ensureToken: (minValidity?: number) => Promise<boolean>
}

export async function optionalBearer(auth: ReplayAuthSession): Promise<Record<string, string>> {
  const valid = await auth.ensureToken(30)
  const accessToken = valid ? auth.token() : ''
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : {}
}

export async function authedReplayPost(
  auth: ReplayAuthSession,
  url: string,
  body: unknown,
  options: {
    signal?: AbortSignal
    allowNoContent?: boolean
    keepalive?: boolean
    optionalAuth?: boolean
    gzip?: boolean
  } = {},
): Promise<Response> {
  let authHeader: Record<string, string>
  if (options.optionalAuth) {
    authHeader = await optionalBearer(auth)
  } else {
    const valid = await auth.ensureToken(30)
    if (!valid) {
      throw new ApiError({ code: 'AUTH_UNAUTHENTICATED', status: 401, retryable: false })
    }
    const accessToken = auth.token()
    authHeader = accessToken ? { Authorization: `Bearer ${accessToken}` } : {}
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...authHeader,
  }
  const json = JSON.stringify(body)
  let payload: BodyInit = json
  if (options.gzip) {
    payload = new Blob([gzipSync(strToU8(json), { level: 6 })], { type: 'application/json' })
    headers['Content-Encoding'] = 'gzip'
  }

  const response = await apiFetch(url, {
    method: 'POST',
    headers,
    body: payload,
    signal: options.signal,
    keepalive: options.keepalive,
  })

  if (response.status === 204 && options.allowNoContent) return response
  if (!response.ok) throw await apiErrorFromResponse(response)
  return response
}
