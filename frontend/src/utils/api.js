import { apiErrorFromResponse } from './http.js'

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

export async function leaderboardUpload(file) {
  const fd = new FormData()
  fd.append('file', file)
  const r = await requireOk(await fetch('/api/leaderboard/upload', { method: 'POST', body: fd }))
  return r.json()
}
