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

/** 名人堂统一公开查询：battleType(RANDOM|RATING|缺省 All) / tankId / nickname / page / size。 */
export async function hofList(params = {}) {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, v)
  }
  const q = qs.toString()
  const r = await requireOk(await fetch(`/api/hof${q ? '?' + q : ''}`))
  return r.json()
}

/**
 * 名人堂上传（需登录）：携带 Bearer token；401 时跳转登录页（登录后回到 ?view=hof）。
 */
export async function hofUpload(file) {
  const { token, ensureToken, login } = useAuth()
  await ensureToken(30)
  const fd = new FormData()
  fd.append('file', file)
  const r = await fetch('/api/hof/upload', {
    method: 'POST',
    headers: token() ? { Authorization: `Bearer ${token()}` } : {},
    body: fd,
  })
  if (r.status === 401) {
    login('hof')
    throw new ApiError('AUTH_REQUIRED', 401)
  }
  // requireOk 是 async 函数（返回 Promise）：必须先 await 再读 body，否则 Promise.json 抛 TypeError
  await requireOk(r)
  return r.json()
}

/**
 * 名人堂回放下载（需登录）：authenticated fetch → blob → createObjectURL → 触发下载 → revoke。
 * 禁止 <a href> 裸链（SPA 不会自动携带 Authorization: Bearer）。
 */
export async function hofDownload(id) {
  const { token, ensureToken, login } = useAuth()
  await ensureToken(30)
  const r = await fetch(`/api/hof/${encodeURIComponent(id)}/replay`, {
    headers: token() ? { Authorization: `Bearer ${token()}` } : {},
  })
  if (r.status === 401) {
    login('hof')
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

// ── 名人堂管理后台（/api/admin/hof/**，需 HoF-admin 或 wotbtools-admin）────────────────

async function hofAdminRequest(url, options = {}) {
  const { token, ensureToken, login } = useAuth()
  await ensureToken(30)
  const headers = { ...(options.headers || {}) }
  if (token()) headers.Authorization = `Bearer ${token()}`
  const r = await fetch(url, { ...options, headers })
  if (r.status === 401) {
    login('hof-admin')
    throw new ApiError('AUTH_REQUIRED', 401)
  }
  await requireOk(r)
  return r
}

/** 管理列表：nickname / accountId / arenaId / uploadedBy / battleType / tankId / replayAvailable / sort / 分页。 */
export async function hofAdminList(params = {}) {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, v)
  }
  const q = qs.toString()
  const r = await hofAdminRequest(`/api/admin/hof${q ? '?' + q : ''}`)
  return r.json()
}

/** 管理操作日志（只读）。 */
export async function hofAdminAudit(params = {}) {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, v)
  }
  const q = qs.toString()
  const r = await hofAdminRequest(`/api/admin/hof/audit${q ? '?' + q : ''}`)
  return r.json()
}

/** Hard delete 记录（audit + delete 单事务；最后引用清理物理文件）。 */
export async function hofAdminDelete(id) {
  await hofAdminRequest(`/api/admin/hof/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

/** 管理后台下载 replay（复用统一下载机制）。 */
export async function hofAdminDownload(id) {
  const r = await hofAdminRequest(`/api/admin/hof/${encodeURIComponent(id)}/replay`)
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