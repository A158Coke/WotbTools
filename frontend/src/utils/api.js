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

// ── 名人堂「百场」（/api/hof/hundred）────────────────────────────────────

/** 已登录通用请求（401 → 跳转登录后回到 ?view=hof）。 */
async function hofAuthRequest(url, options = {}) {
  const { token, ensureToken, login } = useAuth()
  await ensureToken(30)
  const headers = { ...(options.headers || {}) }
  if (token()) headers.Authorization = `Bearer ${token()}`
  const r = await fetch(url, { ...options, headers })
  if (r.status === 401) {
    login('hof')
    throw new ApiError('AUTH_REQUIRED', 401)
  }
  await requireOk(r)
  return r
}

/** 百场公开排行榜（匿名）：vehicleId 必传，单车辆独立排行。 */
export async function hofHundredList(params = {}) {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, v)
  }
  const q = qs.toString()
  const r = await requireOk(await fetch(`/api/hof/hundred${q ? '?' + q : ''}`))
  return r.json()
}

/**
 * 百场提交（需登录，multipart）：
 * formData 包含 vehicleId / averageDamage / battleCount / screenshot(base64) / replays(×5)。
 */
export async function hofHundredSubmit(formData) {
  const { token, ensureToken, login } = useAuth()
  await ensureToken(30)
  const r = await fetch('/api/hof/hundred/submissions', {
    method: 'POST',
    headers: token() ? { Authorization: `Bearer ${token()}` } : {},
    body: formData,
  })
  if (r.status === 401) {
    login('hof')
    throw new ApiError('AUTH_REQUIRED', 401)
  }
  await requireOk(r)
  return r.json()
}

/** 用户撤销自己的 PENDING submission。 */
export async function hofHundredCancel(id) {
  const r = await hofAuthRequest(`/api/hof/hundred/submissions/${encodeURIComponent(id)}/cancel`, { method: 'POST' })
  return r.json()
}

/** 个人中心百场状态：{current, pending, rejected}。 */
export async function hofHundredMyStatus() {
  const r = await hofAuthRequest('/api/users/hundred/status')
  return r.json()
}

// ── 百场管理后台（/api/admin/hof/hundred/**，HoF-admin / wotbtools-admin）──

/** 百场审核列表：status 过滤（PENDING/CURRENT/...）。 */
export async function hofAdminHundredList(params = {}) {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, v)
  }
  const q = qs.toString()
  const r = await hofAdminRequest(`/api/admin/hof/hundred/submissions${q ? '?' + q : ''}`)
  return r.json()
}

/** 百场审核详情（PENDING 时含 proofScreenshot）。 */
/** 百场审核详情（PENDING 时含 proofScreenshot）。 */
export async function hofAdminHundredDetail(id) {
  const r = await hofAdminRequest(`/api/admin/hof/hundred/submissions/${encodeURIComponent(id)}`)
  return r.json()
}

/** 百场审核证据列表（admin-only）：slot/originalFilename/fileSize/arenaId/sha256。旧 PENDING → 空数组。 */
export async function hofAdminHundredReplays(submissionId) {
  const r = await hofAdminRequest(`/api/admin/hof/hundred/submissions/${encodeURIComponent(submissionId)}/replays`)
  return r.json()
}

/**
 * 下载单个审核回放（admin-only）：authenticated fetch → blob → createObjectURL → 触发下载。
 * 禁止裸 <a href>（SPA 不会自动携带 Authorization: Bearer）。
 */
export async function hofAdminHundredReplayDownload(submissionId, replayId) {
  const r = await hofAdminRequest(
    `/api/admin/hof/hundred/submissions/${encodeURIComponent(submissionId)}/replays/${encodeURIComponent(replayId)}`
  )
  const blob = await r.blob()
  const cd = r.headers.get('Content-Disposition') || ''
  const name = filenameFromDisposition(cd) || `replay-${replayId}.wotbreplay`
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** APPROVE：{approvedAverageDamage, approvedBattleCount}。 */
export async function hofAdminHundredApprove(id, body) {
  const r = await hofAdminRequest(`/api/admin/hof/hundred/submissions/${encodeURIComponent(id)}/approve`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  return r.json()
}

/** REJECT：{rejectReason, rejectReasonText?}（原因强制）。 */
export async function hofAdminHundredReject(id, body) {
  const r = await hofAdminRequest(`/api/admin/hof/hundred/submissions/${encodeURIComponent(id)}/reject`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  return r.json()
}

/** 删除 CURRENT：{deleteReason, deleteReasonText?}（原因强制）。 */
export async function hofAdminHundredDelete(id, body) {
  const r = await hofAdminRequest(`/api/admin/hof/hundred/submissions/${encodeURIComponent(id)}/delete`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  return r.json()
}
