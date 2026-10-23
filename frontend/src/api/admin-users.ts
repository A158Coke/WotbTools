import type { components } from './generated/http-contract.js'
import { useAuth } from '../composables/useAuth.js'
import { apiErrorFromResponse, apiFetch } from '../utils/http.js'

/** 管理端 authed JSON 请求：401 交由调用方/上层按既有语义处理（不在这里 redirect）。 */
async function adminUsersRequest(url: string, options: RequestInit = {}) {
  const { token, ensureToken } = useAuth()
  await ensureToken(30)
  const headers = { ...(options.headers || {}) } as Record<string, string>
  if (token()) headers.Authorization = `Bearer ${token()}`
  const r = await apiFetch(url, { ...options, headers })
  if (!r.ok) throw await apiErrorFromResponse(r)
  if (r.status === 204) return null
  return r.json()
}

/** 管理端用户搜索（服务端分页，0-based page）。 */
export async function adminSearchUsers(query = '', { segment = 'keycloak', idpAlias = '', page = 0, size = 25 } = {}): Promise<components['schemas']['AdminUserPage'] | null> {
  const params = new URLSearchParams()
  if (query) params.set('query', query)
  if (segment) params.set('segment', segment)
  if (idpAlias && segment === 'keycloak') params.set('idpAlias', idpAlias)
  params.set('page', String(page))
  params.set('size', String(size))
  return adminUsersRequest(`/api/admin/users?${params}`)
}

export async function adminGetUser(keycloakUserId) {
  return adminUsersRequest(`/api/admin/users/${encodeURIComponent(keycloakUserId)}`)
}

export async function adminDeleteUsers(userIds: string[], confirm: unknown): Promise<components['schemas']['DeleteUsersResponse'] | null> {
  return adminUsersRequest(`/api/admin/users?confirm=${confirm === true}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(userIds),
  })
}
