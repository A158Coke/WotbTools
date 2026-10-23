import type { components, operations } from './generated/http-contract.js'
import { adminUserPageValidator, adminUserDetailValidator, deleteUsersResponseValidator } from './generated/contract-validators.js'
import { useAuth } from '../composables/useAuth.js'
import { ApiError, apiErrorFromResponse, apiFetch } from '../utils/http.js'

/** 管理端 authed JSON 请求：401 交由调用方/上层按既有语义处理（不在这里 redirect）。 */
async function adminUsersRequest(url: string, options: RequestInit = {}): Promise<unknown | null> {
  const { token, ensureToken } = useAuth()
  await ensureToken(30)
  const headers = { ...(options.headers || {}) } as Record<string, string>
  if (token()) headers.Authorization = `Bearer ${token()}`
  const r = await apiFetch(url, { ...options, headers })
  if (!r.ok) throw await apiErrorFromResponse(r)
  if (r.status === 204) return null
  try {
    const value: unknown = await r.json()
    if (value === null) throw new ApiError({ errorCode: 'INVALID_RESPONSE', retryable: false })
    return value
  } catch (cause) {
    if (cause instanceof SyntaxError) throw new ApiError({ errorCode: 'INVALID_RESPONSE', retryable: false, cause })
    throw cause
  }
}

/** 管理端用户搜索（服务端分页，0-based page）。 */
export async function adminSearchUsers(query = '', { segment = 'keycloak', idpAlias = '', page = 0, size = 25 }: NonNullable<operations['searchAdminUsers']['parameters']['query']> = {}): Promise<components['schemas']['AdminUserPage'] | null> {
  const params = new URLSearchParams()
  if (query) params.set('query', query)
  if (segment) params.set('segment', segment)
  if (idpAlias && segment === 'keycloak') params.set('idpAlias', idpAlias)
  params.set('page', String(page))
  params.set('size', String(size))
  const value = await adminUsersRequest(`/api/admin/users?${params}`)
  if (value === null) return null
  if (!adminUserPageValidator(value)) throw new ApiError({ errorCode: 'INVALID_RESPONSE', retryable: false })
  return value as components['schemas']['AdminUserPage']
}

export async function adminGetUser(keycloakUserId: string): Promise<components['schemas']['AdminUserDetail'] | null> {
  const value = await adminUsersRequest(`/api/admin/users/${encodeURIComponent(keycloakUserId)}`)
  if (value === null) return null
  if (!adminUserDetailValidator(value)) throw new ApiError({ errorCode: 'INVALID_RESPONSE', retryable: false })
  return value as components['schemas']['AdminUserDetail']
}

export async function adminDeleteUsers(userIds: operations['deleteAdminUsers']['requestBody']['content']['application/json'], confirm: unknown): Promise<components['schemas']['DeleteUsersResponse'] | null> {
  const value = await adminUsersRequest(`/api/admin/users?confirm=${confirm === true}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(userIds),
  })
  if (value === null) return null
  if (!deleteUsersResponseValidator(value)) throw new ApiError({ errorCode: 'INVALID_RESPONSE', retryable: false })
  return value as components['schemas']['DeleteUsersResponse']
}
