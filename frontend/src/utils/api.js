import { apiErrorFromResponse, apiFetch, requireOk } from './http.js'
import { useAuth } from '../composables/useAuth.js'
// Replay Processing/Export implementations live in the typed API boundary.
export {
  createProcessingJob,
  getProcessingJob,
  cancelProcessingJob,
  getProcessingJobResult,
  createExportJob,
  getExportJob,
  cancelExportJob,
  downloadExportJob,
} from '../api/replay.js'

function withQuery(path, params = {}) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') query.set(key, value)
  }
  const serialized = query.toString()
  return serialized ? `${path}?${serialized}` : path
}

async function downloadResponse(response, fallbackName) {
  const blob = await response.blob()
  const disposition = response.headers.get('Content-Disposition') || ''
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filenameFromDisposition(disposition) || fallbackName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

/** 名人堂统一公开查询：nation / vehicleType / tier / tankId 可独立使用并取交集。 */

/**
 * Historical Rating V2 gray analysis for an existing READY processing dataset.
 * The endpoint is admin-only; 401 returns the user to the hidden deep link.
 */
export async function ratingV2Admin(jobId) {
  const { token, ensureToken, login } = useAuth()
  await ensureToken(30)
  const r = await apiFetch(`/api/admin/rating-v2/processing-jobs/${encodeURIComponent(jobId)}`, {
    method: 'POST',
    headers: token() ? { Authorization: `Bearer ${token()}` } : {},
  })
  if (r.status === 401) {
    login('rating-v2')
    throw await apiErrorFromResponse(r)
  }
  await requireOk(r)
  return r.json()
}

export async function hofList(params = {}) {
  const r = await requireOk(await apiFetch(withQuery('/api/hof', params)))
  return r.json()
}

/** 公开单场车辆选项：当前名人堂实际存在的车辆及稳定分类码。 */
export async function hofVehicleOptions() {
  const r = await requireOk(await apiFetch('/api/hof/vehicle-options'))
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
  const r = await apiFetch('/api/hof/upload', {
    method: 'POST',
    headers: token() ? { Authorization: `Bearer ${token()}` } : {},
    body: fd,
  })
  if (r.status === 401) {
    login('hof')
    throw await apiErrorFromResponse(r)
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
  const r = await apiFetch(`/api/hof/${encodeURIComponent(id)}/replay`, {
    headers: token() ? { Authorization: `Bearer ${token()}` } : {},
  })
  if (r.status === 401) {
    login('hof')
    throw await apiErrorFromResponse(r)
  }
  if (!r.ok) throw await apiErrorFromResponse(r)
  await downloadResponse(r, `replay-${id}.wotbreplay`)
}

// ── 名人堂管理后台（/api/admin/hof/**，需 HoF-admin 或 wotbtools-admin）────────────────

async function hofAdminRequest(url, options = {}) {
  const { token, ensureToken, login } = useAuth()
  await ensureToken(30)
  const headers = { ...(options.headers || {}) }
  if (token()) headers.Authorization = `Bearer ${token()}`
  const r = await apiFetch(url, { ...options, headers })
  if (r.status === 401) {
    login('hof-admin')
    throw await apiErrorFromResponse(r)
  }
  await requireOk(r)
  return r
}

/** 管理列表：nation / vehicleType / tier / tankId 与其他治理条件组合搜索。 */
export async function hofAdminList(params = {}) {
  const r = await hofAdminRequest(withQuery('/api/admin/hof', params))
  return r.json()
}

/** 管理筛选车辆：只返回当前名人堂已有车辆的业务可读属性。 */
export async function hofAdminVehicleOptions() {
  const r = await hofAdminRequest('/api/admin/hof/vehicle-options')
  return r.json()
}

/** 管理操作日志（只读）。 */
export async function hofAdminAudit(params = {}) {
  const r = await hofAdminRequest(withQuery('/api/admin/hof/audit', params))
  return r.json()
}

/** Hard delete 记录（audit + delete 单事务；最后引用清理物理文件）。 */
export async function hofAdminDelete(id) {
  await hofAdminRequest(`/api/admin/hof/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

/** 管理后台下载 replay（复用统一下载机制）。 */
export async function hofAdminDownload(id) {
  const r = await hofAdminRequest(`/api/admin/hof/${encodeURIComponent(id)}/replay`)
  await downloadResponse(r, `replay-${id}.wotbreplay`)
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
  const r = await apiFetch(url, { ...options, headers })
  if (r.status === 401) {
    login('hof')
    throw await apiErrorFromResponse(r)
  }
  await requireOk(r)
  return r
}

/** 百场公开排行榜（匿名）：nation / vehicleType / vehicleId 可选并取交集。 */
export async function hofHundredList(params = {}) {
  const r = await requireOk(await apiFetch(withQuery('/api/hof/hundred', params)))
  return r.json()
}

/**
 * 百场提交（需登录，multipart）：
 * formData 包含 vehicleId / averageDamage / battleCount / screenshot(base64) / replays(×5)。
 */
export async function hofHundredSubmit(formData) {
  const { token, ensureToken, login } = useAuth()
  await ensureToken(30)
  const r = await apiFetch('/api/hof/hundred/submissions', {
    method: 'POST',
    headers: token() ? { Authorization: `Bearer ${token()}` } : {},
    body: formData,
  })
  if (r.status === 401) {
    login('hof')
    throw await apiErrorFromResponse(r)
  }
  await requireOk(r)
  return r.json()
}

/**
 * 百场 WG 官方 API 认证提交（需登录，JSON）：
 * body 包含 vehicleId / averageDamage / battleCount，不上传截图或回放。
 */
export async function hofHundredSubmitWargaming(body) {
  const r = await hofAuthRequest('/api/hof/hundred/submissions/wargaming', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
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

/** 百场审核列表：status / nation / vehicleType / vehicleId 可独立使用并取交集。 */
export async function hofAdminHundredList(params = {}) {
  const r = await hofAdminRequest(withQuery('/api/admin/hof/hundred/submissions', params))
  return r.json()
}

/** 百场审核详情（proofScreenshot 仅 PENDING 返回；终态已清理）。 */
export async function hofAdminHundredDetail(id) {
  const r = await hofAdminRequest(`/api/admin/hof/hundred/submissions/${encodeURIComponent(id)}`)
  return r.json()
}

/** 百场审核证据列表（admin-only）：slot/originalFilename/fileSize/arenaId/sha256。旧记录可能为空。 */
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
  await downloadResponse(r, `replay-${replayId}.wotbreplay`)
}

/** APPROVE：管理员只改变状态，成绩由后端的冻结 submission 值决定。 */
export async function hofAdminHundredApprove(id) {
  const r = await hofAdminRequest(`/api/admin/hof/hundred/submissions/${encodeURIComponent(id)}/approve`, {
    method: 'POST',
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

// ── 名人堂「三环」（/api/hof/mark3，人工审核）────────────────────────────

/** 三环公开排行榜（匿名）：nation / vehicleType / vehicleId 可选并取交集。 */
export async function hofMark3List(params = {}) {
  const r = await requireOk(await apiFetch(withQuery('/api/hof/mark3', params)))
  return r.json()
}

/**
 * 三环提交（需登录，multipart）：
 * formData 包含 vehicleId / battleCount / averageDamage / winRate /
 * proofScreenshots(×1–2 base64) / replays(×5)。
 */
export async function hofMark3Submit(formData) {
  const r = await hofAuthRequest('/api/hof/mark3/submissions', { method: 'POST', body: formData })
  return r.json()
}

/** 用户撤销自己的 PENDING 三环 submission。 */
export async function hofMark3Cancel(id) {
  const r = await hofAuthRequest(`/api/hof/mark3/submissions/${encodeURIComponent(id)}/cancel`, { method: 'POST' })
  return r.json()
}

/** 个人中心三环状态：{current, pending, rejected}。 */
export async function hofMark3MyStatus() {
  const r = await hofAuthRequest('/api/users/mark3/status')
  return r.json()
}

// ── 三环管理后台（/api/admin/hof/mark3/**，HoF-admin / wotbtools-admin）──

/** 三环审核列表：status / nation / vehicleType / vehicleId 可独立使用并取交集。 */
export async function hofAdminMark3List(params = {}) {
  const r = await hofAdminRequest(withQuery('/api/admin/hof/mark3/submissions', params))
  return r.json()
}

/** 三环审核详情（proofScreenshots 仅 PENDING 返回；终态已清理）。 */
export async function hofAdminMark3Detail(id) {
  const r = await hofAdminRequest(`/api/admin/hof/mark3/submissions/${encodeURIComponent(id)}`)
  return r.json()
}

/** 三环审核证据列表（admin-only）：slot/originalFilename/fileSize/arenaId/sha256。 */
export async function hofAdminMark3Replays(submissionId) {
  const r = await hofAdminRequest(`/api/admin/hof/mark3/submissions/${encodeURIComponent(submissionId)}/replays`)
  return r.json()
}

/** 下载单个三环审核回放（admin-only）。 */
export async function hofAdminMark3ReplayDownload(submissionId, replayId) {
  const r = await hofAdminRequest(
    `/api/admin/hof/mark3/submissions/${encodeURIComponent(submissionId)}/replays/${encodeURIComponent(replayId)}`
  )
  await downloadResponse(r, `replay-${replayId}.wotbreplay`)
}

/** APPROVE：管理员只改变状态，三环数据由后端冻结的 submission 值决定。 */
export async function hofAdminMark3Approve(id) {
  const r = await hofAdminRequest(`/api/admin/hof/mark3/submissions/${encodeURIComponent(id)}/approve`, {
    method: 'POST',
  })
  return r.json()
}

/** REJECT：{rejectReason, rejectReasonText?}（原因强制）。 */
export async function hofAdminMark3Reject(id, body) {
  const r = await hofAdminRequest(`/api/admin/hof/mark3/submissions/${encodeURIComponent(id)}/reject`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  return r.json()
}

/** 删除 CURRENT：{deleteReason, deleteReasonText?}（原因强制）。 */
export async function hofAdminMark3Delete(id, body) {
  const r = await hofAdminRequest(`/api/admin/hof/mark3/submissions/${encodeURIComponent(id)}/delete`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  return r.json()
}
