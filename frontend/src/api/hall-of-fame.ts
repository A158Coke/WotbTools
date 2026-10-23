import type { components } from './generated/http-contract.js'
import { ApiError, apiErrorFromResponse, apiFetch, requireOk } from '../utils/http.js'
import { Feature } from '../app/featureCapabilities.js'
import { useFeatureGate } from '../composables/useFeatureGate.js'
import { useAuth } from '../composables/useAuth.js'
import { appendReplayFacts, replayFactsJson } from '../replay-local/submissionFacts.js'
import * as validators from './generated/contract-validators.js'

type Schemas = components['schemas']
type HallOfFamePage = Schemas['HallOfFamePage']
type BulkDeleteModerationRequest = Schemas['BulkDeleteModerationRequest']

async function readHofJson<T>(response: Response, validate: (value: unknown) => boolean): Promise<T> {
  let value: unknown
  try {
    value = await response.json()
  } catch (error) {
    if (error instanceof SyntaxError) throw new ApiError({ errorCode: 'INVALID_RESPONSE', retryable: false })
    throw error
  }
  if (!validate(value)) throw new ApiError({ errorCode: 'INVALID_RESPONSE', retryable: false })
  return value as T
}

function requireHofOnline() {
  if (!useFeatureGate().requireFeature(Feature.HALL_OF_FAME)) {
    throw new ApiError({ errorCode: 'NETWORK_ERROR', status: 0, retryable: true })
  }
}

function withQuery(path: string, params: Record<string, string | number | boolean | null | undefined> = {}) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') query.set(key, value as string)
  }
  const serialized = query.toString()
  return serialized ? `${path}?${serialized}` : path
}

async function downloadResponse(response: Response, fallbackName: string) {
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

/**
 * 名人堂统一公开查询：nation / vehicleType / tier / tankId 可独立使用并取交集。
 * 返回 generated `HallOfFamePage`；wire shape 在 transport 边界校验，调用方不再猜字段。
 * @param {Record<string, string | number | boolean | null | undefined>} [params]
 * @returns {Promise<HallOfFamePage>}
 */
export async function hofList(params = {}): Promise<HallOfFamePage> {
  requireHofOnline()
  const r = await requireOk(await apiFetch(withQuery('/api/hof', params)))
  return readHofJson<HallOfFamePage>(r, validators.hallOfFamePageValidator)
}

/** 公开单场车辆选项：当前名人堂实际存在的车辆及稳定分类码。 */
export async function hofVehicleOptions(): Promise<Schemas['HofVehicleOption'][]> {
  requireHofOnline()
  const r = await requireOk(await apiFetch('/api/hof/vehicle-options'))
  return readHofJson<Schemas['HofVehicleOption'][]>(r, value => Array.isArray(value) && value.every(item => validators.hofVehicleOptionValidator(item)))
}

/**
 * 名人堂上传（需登录）：携带 Bearer token；401 时跳转登录页（登录后回到 ?view=hof）。
 */
/**
 * 名人堂单场上传：本机解析回放得到结算事实（服务器没有 parser），事实 + 原始回放（证据附件）一并提交。
 */
export async function hofUpload(file): Promise<Schemas['HofUploadResponse']> {
  requireHofOnline()
  const { token, ensureToken, login } = useAuth()
  const facts = await replayFactsJson(file)
  requireHofOnline()
  await ensureToken(30)
  requireHofOnline()
  const fd = new FormData()
  fd.append('file', file)
  fd.append('facts', facts)
  const r = await apiFetch('/api/hof/upload', {
    method: 'POST',
    headers: token() ? { Authorization: `Bearer ${token()}` } : {},
    body: fd,
  })
  if (r.status === 401) {
    if (useFeatureGate().availability(Feature.HALL_OF_FAME).available) login('hof')
    throw await apiErrorFromResponse(r)
  }
  // requireOk 是 async 函数（返回 Promise）：必须先 await 再读 body，否则 Promise.json 抛 TypeError
  await requireOk(r)
  return readHofJson<Schemas['HofUploadResponse']>(r, validators.hofUploadResponseValidator)
}

/**
 * 名人堂回放下载（需登录）：authenticated fetch → blob → createObjectURL → 触发下载 → revoke。
 * 禁止 <a href> 裸链（SPA 不会自动携带 Authorization: Bearer）。
 */
export async function hofDownload(id) {
  requireHofOnline()
  const { token, ensureToken, login } = useAuth()
  await ensureToken(30)
  requireHofOnline()
  const r = await apiFetch(`/api/hof/${encodeURIComponent(id)}/replay`, {
    headers: token() ? { Authorization: `Bearer ${token()}` } : {},
  })
  if (r.status === 401) {
    if (useFeatureGate().availability(Feature.HALL_OF_FAME).available) login('hof')
    throw await apiErrorFromResponse(r)
  }
  if (!r.ok) throw await apiErrorFromResponse(r)
  await downloadResponse(r, `replay-${id}.wotbreplay`)
}

// ── 名人堂管理后台（/api/admin/hof/**，需 HoF-admin 或 wotbtools-admin）────────────────

async function hofAdminRequest(url: string, options: RequestInit = {}) {
  requireHofOnline()
  const { token, ensureToken, login } = useAuth()
  await ensureToken(30)
  requireHofOnline()
  const headers = { ...(options.headers || {}) } as Record<string, string>
  if (token()) headers.Authorization = `Bearer ${token()}`
  const r = await apiFetch(url, { ...options, headers })
  if (r.status === 401) {
    if (useFeatureGate().availability(Feature.HALL_OF_FAME).available) login('hof-admin')
    throw await apiErrorFromResponse(r)
  }
  await requireOk(r)
  return r
}

/** 管理列表：nation / vehicleType / tier / tankId 与其他治理条件组合搜索。 */
export async function hofAdminList(params = {}): Promise<Schemas['HofAdminPage']> {
  const r = await hofAdminRequest(withQuery('/api/admin/hof', params))
  return readHofJson<Schemas['HofAdminPage']>(r, validators.hofAdminPageValidator)
}

/** 管理筛选车辆：只返回当前名人堂已有车辆的业务可读属性。 */
export async function hofAdminVehicleOptions(): Promise<Schemas['HofVehicleOption'][]> {
  const r = await hofAdminRequest('/api/admin/hof/vehicle-options')
  return readHofJson<Schemas['HofVehicleOption'][]>(r, value => Array.isArray(value) && value.every(item => validators.hofVehicleOptionValidator(item)))
}

/** 管理操作日志（只读）。 */
export async function hofAdminAudit(params = {}): Promise<Schemas['HofAdminAuditPage']> {
  const r = await hofAdminRequest(withQuery('/api/admin/hof/audit', params))
  return readHofJson<Schemas['HofAdminAuditPage']>(r, validators.hofAdminAuditPageValidator)
}

/** Hard delete 记录（audit + delete 单事务；最后引用清理物理文件）。 */
export async function hofAdminDelete(id) {
  await hofAdminRequest(`/api/admin/hof/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

/**
 * 批量 hard delete 记录：单场删除语义不涉及 reason，只提交 ids。
 * 逐条独立事务 → 允许 partial success（{requested,deleted,failed,results:[{id,deleted,errorCode}]}）。
 */
export async function hofAdminBulkDeleteRecords(ids: Schemas['BulkDeleteRecordsRequest']['ids']): Promise<Schemas['BulkDeleteResult']> {
  const r = await hofAdminRequest('/api/admin/hof/records/bulk-delete', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }),
  })
  return readHofJson<Schemas['BulkDeleteResult']>(r, validators.bulkDeleteResultValidator)
}

/** 管理后台下载 replay（复用统一下载机制）。 */
export async function hofAdminDownload(id) {
  const r = await hofAdminRequest(`/api/admin/hof/${encodeURIComponent(id)}/replay`)
  await downloadResponse(r, `replay-${id}.wotbreplay`)
}

/** 解析 Content-Disposition 的 filename*=UTF-8''...（RFC 5987）；退化回 filename="..."。 */
function filenameFromDisposition(cd: string) {
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
async function hofAuthRequest(url: string, options: RequestInit = {}) {
  requireHofOnline()
  const { token, ensureToken, login } = useAuth()
  await ensureToken(30)
  requireHofOnline()
  const headers = { ...(options.headers || {}) } as Record<string, string>
  if (token()) headers.Authorization = `Bearer ${token()}`
  const r = await apiFetch(url, { ...options, headers })
  if (r.status === 401) {
    if (useFeatureGate().availability(Feature.HALL_OF_FAME).available) login('hof')
    throw await apiErrorFromResponse(r)
  }
  await requireOk(r)
  return r
}

/** 百场公开排行榜（匿名）：nation / vehicleType / vehicleId 可选并取交集。 */
export async function hofHundredList(params = {}): Promise<Schemas['HundredLeaderboardPage']> {
  requireHofOnline()
  const r = await requireOk(await apiFetch(withQuery('/api/hof/hundred', params)))
  return readHofJson<Schemas['HundredLeaderboardPage']>(r, validators.hundredLeaderboardPageValidator)
}

/**
 * 百场提交（需登录，multipart）：
 * formData 包含 vehicleId / averageDamage / battleCount / screenshot(base64) / replays(×5)。
 */
export async function hofHundredSubmit(formData: FormData): Promise<Schemas['HundredCreateResult']> {
  requireHofOnline()
  const { token, ensureToken, login } = useAuth()
  await appendReplayFacts(formData)
  requireHofOnline()
  await ensureToken(30)
  requireHofOnline()
  const r = await apiFetch('/api/hof/hundred/submissions', {
    method: 'POST',
    headers: token() ? { Authorization: `Bearer ${token()}` } : {},
    body: formData,
  })
  if (r.status === 401) {
    if (useFeatureGate().availability(Feature.HALL_OF_FAME).available) login('hof')
    throw await apiErrorFromResponse(r)
  }
  await requireOk(r)
  return readHofJson<Schemas['HundredCreateResult']>(r, validators.hundredCreateResultValidator)
}

/** 用户撤销自己的 PENDING submission。 */
export async function hofHundredCancel(id): Promise<Schemas['HundredSubmissionSummary']> {
  const r = await hofAuthRequest(`/api/hof/hundred/submissions/${encodeURIComponent(id)}/cancel`, { method: 'POST' })
  return readHofJson<Schemas['HundredSubmissionSummary']>(r, validators.hundredSubmissionSummaryValidator)
}

/** 个人中心百场状态：{current, pending, rejected}。 */
export async function hofHundredMyStatus(): Promise<Schemas['HundredUserStatus']> {
  const r = await hofAuthRequest('/api/users/hundred/status')
  return readHofJson<Schemas['HundredUserStatus']>(r, validators.hundredUserStatusValidator)
}

// ── 百场管理后台（/api/admin/hof/hundred/**，HoF-admin / wotbtools-admin）──

/** 百场审核列表：status / nation / vehicleType / vehicleId 可独立使用并取交集。 */
export async function hofAdminHundredList(params = {}): Promise<Schemas['HundredAdminPage']> {
  const r = await hofAdminRequest(withQuery('/api/admin/hof/hundred/submissions', params))
  return readHofJson<Schemas['HundredAdminPage']>(r, validators.hundredAdminPageValidator)
}

/** 百场审核详情（proofScreenshot 仅 PENDING 返回；终态已清理）。 */
export async function hofAdminHundredDetail(id): Promise<Schemas['HundredAdminDetail']> {
  const r = await hofAdminRequest(`/api/admin/hof/hundred/submissions/${encodeURIComponent(id)}`)
  return readHofJson<Schemas['HundredAdminDetail']>(r, validators.hundredAdminDetailValidator)
}

/** 百场审核证据列表（admin-only）：slot/originalFilename/fileSize/arenaId/sha256。旧记录可能为空。 */
export async function hofAdminHundredReplays(submissionId): Promise<Schemas['HundredReplayEvidence'][]> {
  const r = await hofAdminRequest(`/api/admin/hof/hundred/submissions/${encodeURIComponent(submissionId)}/replays`)
  return readHofJson<Schemas['HundredReplayEvidence'][]>(r, value =>
    Array.isArray(value) && value.every(item => validators.hundredReplayEvidenceValidator(item)))
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
export async function hofAdminHundredApprove(id): Promise<Schemas['HundredSubmissionSummary']> {
  const r = await hofAdminRequest(`/api/admin/hof/hundred/submissions/${encodeURIComponent(id)}/approve`, {
    method: 'POST',
  })
  return readHofJson<Schemas['HundredSubmissionSummary']>(r, validators.hundredSubmissionSummaryValidator)
}

/** REJECT：{rejectReason, rejectReasonText?}（原因强制）。 */
export async function hofAdminHundredReject(id, body: Schemas['HundredRejectRequest']): Promise<Schemas['HundredSubmissionSummary']> {
  const r = await hofAdminRequest(`/api/admin/hof/hundred/submissions/${encodeURIComponent(id)}/reject`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  return readHofJson<Schemas['HundredSubmissionSummary']>(r, validators.hundredSubmissionSummaryValidator)
}

/** 删除 CURRENT：{deleteReason, deleteReasonText?}（原因强制）。 */
export async function hofAdminHundredDelete(id, body: Schemas['HundredDeleteRequest']): Promise<Schemas['HundredSubmissionSummary']> {
  const r = await hofAdminRequest(`/api/admin/hof/hundred/submissions/${encodeURIComponent(id)}/delete`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  return readHofJson<Schemas['HundredSubmissionSummary']>(r, validators.hundredSubmissionSummaryValidator)
}

/** 批量删除 CURRENT：{ids, reason, reasonText?}；非 CURRENT 逐条失败于 HUNDRED_NOT_CURRENT。 */
export async function hofAdminBulkDeleteHundred(ids: BulkDeleteModerationRequest['ids'], body: Omit<BulkDeleteModerationRequest, 'ids'>): Promise<Schemas['BulkDeleteResult']> {
  const r = await hofAdminRequest('/api/admin/hof/hundred/submissions/bulk-delete', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids, ...body }),
  })
  return readHofJson<Schemas['BulkDeleteResult']>(r, validators.bulkDeleteResultValidator)
}

// ── 名人堂「三环」（/api/hof/mark3，人工审核）────────────────────────────

/** 三环公开排行榜（匿名）：nation / vehicleType / vehicleId 可选并取交集。 */
export async function hofMark3List(params = {}): Promise<Schemas['Mark3LeaderboardPage']> {
  requireHofOnline()
  const r = await requireOk(await apiFetch(withQuery('/api/hof/mark3', params)))
  return readHofJson<Schemas['Mark3LeaderboardPage']>(r, validators.mark3LeaderboardPageValidator)
}

/**
 * 三环提交（需登录，multipart）：
 * formData 包含 vehicleId / battleCount / averageDamage / winRate /
 * proofScreenshots(×1–2 base64) / replays(×5)。
 */
export async function hofMark3Submit(formData: FormData): Promise<Schemas['Mark3CreateResult']> {
  requireHofOnline()
  await appendReplayFacts(formData)
  requireHofOnline()
  const r = await hofAuthRequest('/api/hof/mark3/submissions', { method: 'POST', body: formData })
  return readHofJson<Schemas['Mark3CreateResult']>(r, validators.mark3CreateResultValidator)
}

/** 用户撤销自己的 PENDING 三环 submission。 */
export async function hofMark3Cancel(id): Promise<Schemas['Mark3SubmissionSummary']> {
  const r = await hofAuthRequest(`/api/hof/mark3/submissions/${encodeURIComponent(id)}/cancel`, { method: 'POST' })
  return readHofJson<Schemas['Mark3SubmissionSummary']>(r, validators.mark3SubmissionSummaryValidator)
}

/** 个人中心三环状态：{current, pending, rejected}。 */
export async function hofMark3MyStatus(): Promise<Schemas['Mark3UserStatus']> {
  const r = await hofAuthRequest('/api/users/mark3/status')
  return readHofJson<Schemas['Mark3UserStatus']>(r, validators.mark3UserStatusValidator)
}

// ── 三环管理后台（/api/admin/hof/mark3/**，HoF-admin / wotbtools-admin）──

/** 三环审核列表：status / nation / vehicleType / vehicleId 可独立使用并取交集。 */
export async function hofAdminMark3List(params = {}): Promise<Schemas['Mark3AdminPage']> {
  const r = await hofAdminRequest(withQuery('/api/admin/hof/mark3/submissions', params))
  return readHofJson<Schemas['Mark3AdminPage']>(r, validators.mark3AdminPageValidator)
}

/** 三环审核详情（proofScreenshots 仅 PENDING 返回；终态已清理）。 */
export async function hofAdminMark3Detail(id): Promise<Schemas['Mark3AdminDetail']> {
  const r = await hofAdminRequest(`/api/admin/hof/mark3/submissions/${encodeURIComponent(id)}`)
  return readHofJson<Schemas['Mark3AdminDetail']>(r, validators.mark3AdminDetailValidator)
}

/** 三环审核证据列表（admin-only）：slot/originalFilename/fileSize/arenaId/sha256。 */
export async function hofAdminMark3Replays(submissionId): Promise<Schemas['Mark3ReplayEvidence'][]> {
  const r = await hofAdminRequest(`/api/admin/hof/mark3/submissions/${encodeURIComponent(submissionId)}/replays`)
  return readHofJson<Schemas['Mark3ReplayEvidence'][]>(r, value => Array.isArray(value) && value.every(item => validators.mark3ReplayEvidenceValidator(item)))
}

/** 下载单个三环审核回放（admin-only）。 */
export async function hofAdminMark3ReplayDownload(submissionId, replayId) {
  const r = await hofAdminRequest(
    `/api/admin/hof/mark3/submissions/${encodeURIComponent(submissionId)}/replays/${encodeURIComponent(replayId)}`
  )
  await downloadResponse(r, `replay-${replayId}.wotbreplay`)
}

/** APPROVE：管理员只改变状态，三环数据由后端冻结的 submission 值决定。 */
export async function hofAdminMark3Approve(id): Promise<Schemas['Mark3SubmissionSummary']> {
  const r = await hofAdminRequest(`/api/admin/hof/mark3/submissions/${encodeURIComponent(id)}/approve`, {
    method: 'POST',
  })
  return readHofJson<Schemas['Mark3SubmissionSummary']>(r, validators.mark3SubmissionSummaryValidator)
}

/** REJECT：{rejectReason, rejectReasonText?}（原因强制）。 */
export async function hofAdminMark3Reject(id, body: Schemas['Mark3RejectRequest']): Promise<Schemas['Mark3SubmissionSummary']> {
  const r = await hofAdminRequest(`/api/admin/hof/mark3/submissions/${encodeURIComponent(id)}/reject`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  return readHofJson<Schemas['Mark3SubmissionSummary']>(r, validators.mark3SubmissionSummaryValidator)
}

/** 删除 CURRENT：{deleteReason, deleteReasonText?}（原因强制）。 */
export async function hofAdminMark3Delete(id, body: Schemas['Mark3DeleteRequest']): Promise<Schemas['Mark3SubmissionSummary']> {
  const r = await hofAdminRequest(`/api/admin/hof/mark3/submissions/${encodeURIComponent(id)}/delete`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  return readHofJson<Schemas['Mark3SubmissionSummary']>(r, validators.mark3SubmissionSummaryValidator)
}

/** 批量删除 CURRENT：{ids, reason, reasonText?}；非 CURRENT 逐条失败于 MARK3_NOT_CURRENT。 */
export async function hofAdminBulkDeleteMark3(ids: BulkDeleteModerationRequest['ids'], body: Omit<BulkDeleteModerationRequest, 'ids'>): Promise<Schemas['BulkDeleteResult']> {
  const r = await hofAdminRequest('/api/admin/hof/mark3/submissions/bulk-delete', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids, ...body }),
  })
  return readHofJson<Schemas['BulkDeleteResult']>(r, validators.bulkDeleteResultValidator)
}

/** 个人单场战绩归 HoF；保留用户资料路径既有的认证与登录目标。 */
export async function getUserHofRecords(): Promise<Schemas['PersonalHallOfFameRecord'][] | null> {
  const { token, ensureToken, login } = useAuth()
  await ensureToken(30)
  const accessToken = token()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`
  const r = await apiFetch('/api/users/profile/records', { headers })
  if (r.status === 401) {
    login()
    throw await apiErrorFromResponse(r)
  }
  await requireOk(r)
  if (r.status === 204) return null
  return readHofJson<Schemas['PersonalHallOfFameRecord'][]>(r, value =>
    Array.isArray(value) && value.every(item => validators.personalHallOfFameRecordValidator(item)))
}
