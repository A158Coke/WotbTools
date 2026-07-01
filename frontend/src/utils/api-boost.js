
// ========== Boost / ==========
import { useAuth } from '../composables/useAuth.js'

async function boostHeaders() {
  const { token, ensureToken } = useAuth()
  await ensureToken(30)
  const t = token()
  return t ? { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` } : { 'Content-Type': 'application/json' }
}

async function boostHandle(r) {
  if (r.status === 401) {
    const { login } = useAuth()
    login()
    throw new Error('请先登录')
  }
  if (!r.ok) {
    let msg = `HTTP ${r.status}`
    try { const e = await r.json(); msg = e.message || e.error || msg } catch {}
    throw new Error(msg)
  }
  return r.json()
}

export async function boostOptions() {
  return boostHandle(await fetch('/api/boost/options'))
}

export async function boostCreateRequest(body) {
  return boostHandle(await fetch('/api/boost/requests', { method: 'POST', headers: await boostHeaders(), body: JSON.stringify(body) }))
}

export async function boostListMyRequests() {
  return boostHandle(await fetch('/api/boost/requests/my', { headers: await boostHeaders() }))
}

export async function boostCancelRequest(id) {
  return boostHandle(await fetch(`/api/boost/requests/my/${encodeURIComponent(id)}/cancel`, { method: 'PATCH', headers: await boostHeaders() }))
}

export async function adminBoostRequests(params = {}) {
  const qs = new URLSearchParams(params).toString()
  return boostHandle(await fetch(`/api/admin/boost/requests${qs ? '?' + qs : ''}`, { headers: await boostHeaders() }))
}

export async function adminBoostRequest(id) {
  return boostHandle(await fetch(`/api/admin/boost/requests/${encodeURIComponent(id)}`, { headers: await boostHeaders() }))
}

export async function adminBoostUpdateStatus(id, body) {
  return boostHandle(await fetch(`/api/admin/boost/requests/${encodeURIComponent(id)}/status`, { method: 'PATCH', headers: await boostHeaders(), body: JSON.stringify(body) }))
}

export async function adminBoostAssign(id, body) {
  return boostHandle(await fetch(`/api/admin/boost/requests/${encodeURIComponent(id)}/assignments`, { method: 'POST', headers: await boostHeaders(), body: JSON.stringify(body) }))
}

export async function adminBoostUnassign(id, body) {
  return boostHandle(await fetch(`/api/admin/boost/requests/${encodeURIComponent(id)}/assignments/current/unassign`, { method: 'PATCH', headers: await boostHeaders(), body: JSON.stringify(body || {}) }))
}

export async function adminBoostBoosterList(params = {}) {
  const qs = new URLSearchParams(params).toString()
  return boostHandle(await fetch(`/api/admin/boost/boosters${qs ? '?' + qs : ''}`, { headers: await boostHeaders() }))
}

export async function adminBoostBoosterCreate(body) {
  return boostHandle(await fetch('/api/admin/boost/boosters', { method: 'POST', headers: await boostHeaders(), body: JSON.stringify(body) }))
}

export async function adminBoostBoosterUpdate(id, body) {
  return boostHandle(await fetch(`/api/admin/boost/boosters/${encodeURIComponent(id)}`, { method: 'PATCH', headers: await boostHeaders(), body: JSON.stringify(body) }))
}

export async function adminBoostBoosterAvailability(id, body) {
  return boostHandle(await fetch(`/api/admin/boost/boosters/${encodeURIComponent(id)}/availability`, { method: 'PATCH', headers: await boostHeaders(), body: JSON.stringify(body) }))
}

export async function adminBoostBoosterDelete(id) {
  return boostHandle(await fetch(`/api/admin/boost/boosters/${encodeURIComponent(id)}`, { method: 'DELETE', headers: await boostHeaders() }))
}

// ========== My Booster Profile ==========
export async function getMyBoosterProfile() {
  return boostHandle(await fetch('/api/boost/boosters/my', { headers: await boostHeaders() }))
}

// ========== Admin Users ==========
async function adminHandle(r) {
  if (r.status === 401 || r.status === 403) {
    let msg = 'Access denied'
    try { const e = await r.json(); msg = e.error || msg } catch {}
    throw new Error(msg)
  }
  if (!r.ok) {
    let msg = `HTTP ${r.status}`
    try { const e = await r.json(); msg = e.message || e.error || msg } catch {}
    throw new Error(msg)
  }
  return r.json()
}

export async function adminSearchUsers(query = '', limit = 50) {
  const params = new URLSearchParams()
  if (query) params.set('query', query)
  params.set('limit', String(limit))
  return adminHandle(await fetch(`/api/admin/users?${params}`, { headers: await boostHeaders() }))
}

export async function adminGetUser(keycloakUserId) {
  return adminHandle(await fetch(`/api/admin/users/${encodeURIComponent(keycloakUserId)}`, { headers: await boostHeaders() }))
}

export async function adminDeleteUser(keycloakUserId) {
  return adminHandle(await fetch(`/api/admin/users/${encodeURIComponent(keycloakUserId)}?confirm=true`, { method: 'DELETE', headers: await boostHeaders() }))
}

// ========== User Profile ==========
export async function getUserProfile() {
  return boostHandle(await fetch('/api/users/profile', { headers: await boostHeaders() }))
}

export async function createUserProfile() {
  return boostHandle(await fetch('/api/users/profile', { method: 'POST', headers: await boostHeaders() }))
}

export async function updateUserWotbAccount(body) {
  return boostHandle(await fetch('/api/users/wotb-account', { method: 'PATCH', headers: await boostHeaders(), body: JSON.stringify(body) }))
}

export async function deleteUserWotbAccount() {
  return boostHandle(await fetch('/api/users/wotb-account', { method: 'DELETE', headers: await boostHeaders() }))
}

export async function getUserLeaderboardRecords() {
  const r = await fetch('/api/users/profile/records', { headers: await boostHeaders() })
  if (r.status === 401) return []
  if (!r.ok) return []
  return r.json()
}
