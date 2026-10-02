import { ApiError, apiErrorFromResponse, apiFetch } from '../utils/http.js'

export interface ReplayAuthSession {
  token: () => string
  ensureToken: (minValidity?: number) => Promise<boolean>
}

/**
 * 可选 Bearer：已登录则保鲜 token 并附带；未登录（或刷新失败）返回空 header，以匿名身份请求。
 * 回放解析 / 汇总 / 导出 / 2D 回放都在本机完成（服务器没有 parser），这里只服务仍需服务端的调用。
 */
export async function optionalBearer(auth: ReplayAuthSession): Promise<Record<string, string>> {
  const valid = await auth.ensureToken(30)
  const accessToken = valid ? auth.token() : ''
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : {}
}

/**
 * Bearer 鉴权 POST：`ensureToken` 保鲜 + canonical `ApiError` 归一。
 * `/api/ai/**` transport 共用，组件不得复制此逻辑。
 * `optionalAuth`：匿名可用的端点未登录时不抛错、不带 header。
 */
export async function authedReplayPost(
  auth: ReplayAuthSession,
  url: string,
  body: unknown,
  options: { signal?: AbortSignal; allowNoContent?: boolean; keepalive?: boolean; optionalAuth?: boolean } = {},
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

  const response = await apiFetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: options.signal,
    keepalive: options.keepalive,
  })

  if (response.status === 204 && options.allowNoContent) return response
  if (!response.ok) throw await apiErrorFromResponse(response)
  return response
}
