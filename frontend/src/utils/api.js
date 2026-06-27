export async function healthCheck() {
  const r = await fetch('/api/health')
  if (!r.ok) throw new Error('Health check failed: HTTP ' + r.status)
  return r.json()
}

export async function preview(body) {
  const r = await fetch('/api/preview', { method: 'POST', body })
  if (!r.ok) throw new Error('解析失败: HTTP ' + r.status)
  return r.json()
}

export async function downloadBlob(mode, body) {
  const r = await fetch(`/api/export?mode=${encodeURIComponent(mode)}`, { method: 'POST', body })
  if (!r.ok) throw new Error('导出失败: HTTP ' + r.status)
  const blob = await r.blob()
  const cd = r.headers.get('Content-Disposition') || ''
  return { blob, disposition: cd }
}

export async function shutdown() {
  await fetch('/api/shutdown', { method: 'POST' })
}

// 排行榜 (仅在线版 postgres profile; 离线版无这些端点)
export async function ratingLeaderboard(body) {
  const r = await fetch('/api/rating', { method: 'POST', body })
  if (!r.ok) throw new Error('Rating failed: HTTP ' + r.status)
  return r.json()
}

export async function ratingConfig() {
  const r = await fetch('/api/rating')
  if (!r.ok) throw new Error('Rating config failed: HTTP ' + r.status)
  return r.json()
}

export async function leaderboardTopDamage(limit = 50) {
  const r = await fetch(`/api/leaderboard/top-damage?limit=${encodeURIComponent(limit)}`)
  if (!r.ok) throw new Error('排行榜加载失败: HTTP ' + r.status)
  return r.json()
}

export async function leaderboardTopDamageByTank(tankId, limit = 50) {
  const r = await fetch(`/api/leaderboard/tanks/${encodeURIComponent(tankId)}/top-damage?limit=${encodeURIComponent(limit)}`)
  if (!r.ok) throw new Error('排行榜加载失败: HTTP ' + r.status)
  return r.json()
}

export async function leaderboardUpload(file) {
  const fd = new FormData()
  fd.append('file', file)
  const r = await fetch('/api/leaderboard/upload', { method: 'POST', body: fd })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || '上传失败: HTTP ' + r.status)
  return data
}

// Profile (后端可能未实现，404/401 静默返回 null)
export async function getMe(token) {
  const r = await fetch('/api/me', { headers: token ? { Authorization: `Bearer ${token}` } : {} })
  if (!r.ok) return null
  return r.json()
}

export async function getWotbAccount(token) {
  const r = await fetch('/api/me/wotb-account', { headers: token ? { Authorization: `Bearer ${token}` } : {} })
  if (!r.ok) return null
  return r.json()
}

export async function getMyRecords(token) {
  const r = await fetch('/api/me/leaderboard-records', { headers: token ? { Authorization: `Bearer ${token}` } : {} })
  if (!r.ok) return []
  return r.json()
}
