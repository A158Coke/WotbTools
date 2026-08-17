import { ApiError, apiErrorFromResponse } from './http.js'
import { useAuth } from '../composables/useAuth.js'

async function requireOk(response) {
  if (!response.ok) throw await apiErrorFromResponse(response)
  return response
}

export async function preview(body) {
  const r = await requireOk(await fetch('/api/preview', { method: 'POST', body }))
  return r.json()
}

export async function downloadBlob(mode, body) {
  const r = await requireOk(await fetch(`/api/export?mode=${encodeURIComponent(mode)}`, { method: 'POST', body }))
  const blob = await r.blob()
  const cd = r.headers.get('Content-Disposition') || ''
  return { blob, disposition: cd }
}

export async function ratingLeaderboard(body) {
  const r = await requireOk(await fetch('/api/rating', { method: 'POST', body }))
  return r.json()
}

export async function ratingConfig() {
  const r = await requireOk(await fetch('/api/rating'))
  return r.json()
}

export async function leaderboardTopDamage(page = 1, size = 50) {
  const r = await requireOk(await fetch(`/api/leaderboard/top-damage?page=${page}&size=${size}`))
  return r.json()
}

export async function leaderboardTopDamageByTank(tankId, page = 1, size = 50) {
  const r = await requireOk(await fetch(`/api/leaderboard/tanks/${encodeURIComponent(tankId)}/top-damage?page=${page}&size=${size}`))
  return r.json()
}

/**
 * 排行榜上传（需登录）：携带 Bearer token；401 时跳转登录页。
 */
export async function leaderboardUpload(file) {
  const { token, ensureToken, login } = useAuth()
  await ensureToken(30)
  const fd = new FormData()
  fd.append('file', file)
  const r = await fetch('/api/leaderboard/upload', {
    method: 'POST',
    headers: token() ? { Authorization: `Bearer ${token()}` } : {},
    body: fd,
  })
  if (r.status === 401) {
    login('leaderboard')
    throw new ApiError('AUTH_REQUIRED', 401)
  }
  return requireOk(r).json()
}

/**
 * 排行榜回放下载（需登录）：authenticated fetch → blob → createObjectURL → 触发下载 → revoke。
 * 禁止 <a href> 裸链（SPA 不会自动携带 Authorization: Bearer）。
 */
export async function leaderboardDownload(id) {
  const { token, ensureToken, login } = useAuth()
  await ensureToken(30)
  const r = await fetch(`/api/leaderboard/${encodeURIComponent(id)}/replay`, {
    headers: token() ? { Authorization: `Bearer ${token()}` } : {},
  })
  if (r.status === 401) {
    login('leaderboard')
    throw new ApiError('AUTH_REQUIRED', 401)
  }
  if (!r.ok) throw await apiErrorFromResponse(r)
  const blob = await r.blob()
  const cd = r.headers.get('Content-Disposition') || ''
  const name = filenameFromDisposition(cd) || `replay-${id}.wotbreplay`
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** 解析 Content-Disposition 的 filename*=UTF-8''...（RFC 5987）；退化回 filename="..."。 */
function filenameFromDisposition(cd) {
  const star = /filename\*=UTF-8''([^;]+)/i.exec(cd)
  if (star) {
    try {
      return decodeURIComponent(star[1])
    } catch {
      // fall through to plain filename
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(cd)
  return plain ? plain[1] : ''
}