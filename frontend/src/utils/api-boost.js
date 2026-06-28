
// ========== Boost / ==========
import { useAuth } from '../composables/useAuth.js'

function boostHeaders() {
  const { token } = useAuth()
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
  return boostHandle(await fetch('/api/boost/requests', { method: 'POST', headers: boostHeaders(), body: JSON.stringify(body) }))
}

export async function boostListMyRequests() {
  return boostHandle(await fetch('/api/boost/requests/my', { headers: boostHeaders() }))
}

export async function boostCancelRequest(id) {
  return boostHandle(await fetch(`/api/boost/requests/my/${encodeURIComponent(id)}/cancel`, { method: 'PATCH', headers: boostHeaders() }))
}

export async function adminBoostRequests(params = {}) {
  const qs = new URLSearchParams(params).toString()
  return boostHandle(await fetch(`/api/admin/boost/requests${qs ? '?' + qs : ''}`, { headers: boostHeaders() }))
}

export async function adminBoostRequest(id) {
  return boostHandle(await fetch(`/api/admin/boost/requests/${encodeURIComponent(id)}`, { headers: boostHeaders() }))
}

export async function adminBoostUpdateStatus(id, body) {
  return boostHandle(await fetch(`/api/admin/boost/requests/${encodeURIComponent(id)}/status`, { method: 'PATCH', headers: boostHeaders(), body: JSON.stringify(body) }))
}

export async function adminBoostAssign(id, body) {
  return boostHandle(await fetch(`/api/admin/boost/requests/${encodeURIComponent(id)}/assignments`, { method: 'POST', headers: boostHeaders(), body: JSON.stringify(body) }))
}

export async function adminBoostUnassign(id, body) {
  return boostHandle(await fetch(`/api/admin/boost/requests/${encodeURIComponent(id)}/assignments/current/unassign`, { method: 'PATCH', headers: boostHeaders(), body: JSON.stringify(body || {}) }))
}

export async function adminBoostBoosterList(params = {}) {
  const qs = new URLSearchParams(params).toString()
  return boostHandle(await fetch(`/api/admin/boost/boosters${qs ? '?' + qs : ''}`, { headers: boostHeaders() }))
}

export async function adminBoostBoosterCreate(body) {
  return boostHandle(await fetch('/api/admin/boost/boosters', { method: 'POST', headers: boostHeaders(), body: JSON.stringify(body) }))
}

export async function adminBoostBoosterUpdate(id, body) {
  return boostHandle(await fetch(`/api/admin/boost/boosters/${encodeURIComponent(id)}`, { method: 'PATCH', headers: boostHeaders(), body: JSON.stringify(body) }))
}

export async function adminBoostBoosterAvailability(id, body) {
  return boostHandle(await fetch(`/api/admin/boost/boosters/${encodeURIComponent(id)}/availability`, { method: 'PATCH', headers: boostHeaders(), body: JSON.stringify(body) }))
}

// ========== User Profile ==========
export async function getUserProfile() {
  return boostHandle(await fetch('/api/users/profile', { headers: boostHeaders() }))
}

export async function updateUserProfile(body) {
  return boostHandle(await fetch('/api/users/profile', { method: 'PATCH', headers: boostHeaders(), body: JSON.stringify(body) }))
}

export async function updateUserWotbAccount(body) {
  return boostHandle(await fetch('/api/users/wotb-account', { method: 'PATCH', headers: boostHeaders(), body: JSON.stringify(body) }))
}

export async function deleteUserWotbAccount() {
  return boostHandle(await fetch('/api/users/wotb-account', { method: 'DELETE', headers: boostHeaders() }))
}
