import type { components } from './generated/http-contract.js'
// 用户域 transport（profile / wotb-account）。
import { useAuth } from '../composables/useAuth.js'
import { apiErrorFromResponse, apiFetch } from '../utils/http.js'

async function userJsonHeaders(): Promise<Record<string, string>> {
  const { token, ensureToken } = useAuth()
  await ensureToken(30)
  const accessToken = token()
  return accessToken ? { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` } : { 'Content-Type': 'application/json' }
}

async function userHandle(r: Response) {
  if (r.status === 401) {
    const { login } = useAuth()
    login()
    throw await apiErrorFromResponse(r)
  }
  if (!r.ok) throw await apiErrorFromResponse(r)
  if (r.status === 204) return null
  return r.json()
}

export async function getUserProfile(): Promise<components['schemas']['UserProfile'] | null> {
  return userHandle(await apiFetch('/api/users/profile', { headers: await userJsonHeaders() }))
}

/** canonical owner 是全局 business bootstrap（useBusinessUserBootstrap），页面不自行调用。 */
export async function ensureUserProfile(): Promise<components['schemas']['UserProfile'] | null> {
  return userHandle(await apiFetch('/api/users/profile', { method: 'PUT', headers: await userJsonHeaders() }))
}

export async function updateUserWotbAccount(body) {
  return userHandle(await apiFetch('/api/users/wotb-account', { method: 'PATCH', headers: await userJsonHeaders(), body: JSON.stringify(body) }))
}

export async function deleteUserWotbAccount() {
  return userHandle(await apiFetch('/api/users/wotb-account', { method: 'DELETE', headers: await userJsonHeaders() }))
}

export async function verifyUserWotbAccountFromReplay(recorderAccountId: number) {
  return userHandle(await apiFetch('/api/users/wotb-account/verify-replay', {
    method: 'POST', headers: await userJsonHeaders(), body: JSON.stringify({ recorderAccountId }),
  }))
}

export async function syncUserWotbAccountFromLogin() {
  return userHandle(await apiFetch('/api/users/wotb-account/from-login', { method: 'PUT', headers: await userJsonHeaders() }))
}

export async function getUserHofRecords() {
  return userHandle(await apiFetch('/api/users/profile/records', { headers: await userJsonHeaders() }))
}
