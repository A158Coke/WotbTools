import type { components } from './generated/http-contract.js'
import { ApiError, apiErrorFromResponse, apiFetch, normalizeApiError, requireOk } from '../utils/http.js'
import { Feature } from '../app/featureCapabilities.js'
import { useFeatureGate } from '../composables/useFeatureGate.js'
import { useAuth } from '../composables/useAuth.js'
import { appendReplayFacts, replayFactsJson } from '../replay-local/submissionFacts.js'
import * as validators from './generated/contract-validators.js'

type Schemas = components['schemas']
type ResourceId = string | number
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

export async function hofVehicleOptions(): Promise<Schemas['HofVehicleOption'][]> {
  requireHofOnline()
  const r = await requireOk(await apiFetch('/api/hof/vehicle-options'))
  return readHofJson<Schemas['HofVehicleOption'][]>(r, value => Array.isArray(value) && value.every(item => validators.hofVehicleOptionValidator(item)))
}

export async function hofUpload(file: Blob): Promise<Schemas['HofUploadResponse']> {
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
  await requireOk(r)
  return readHofJson<Schemas['HofUploadResponse']>(r, validators.hofUploadResponseValidator)
}

export async function hofDownload(id: ResourceId) {
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


type BackgroundRead = { signal: AbortSignal; bearer: string }

export async function getHofPendingTotals(signal: AbortSignal): Promise<{ hundred: number; mark3: number }> {
  const auth = useAuth()
  const gate = useFeatureGate()
  const epoch = auth.authEpoch()
  const subject = auth.tokenParsed.value?.sub
  function checkScope() {
    if (signal.aborted || epoch !== auth.authEpoch() || subject !== auth.tokenParsed.value?.sub) throw new ApiError('REQUEST_ABORTED')
    if (!subject || !auth.initialized.value || auth.authInitState.value !== 'authenticated' || !auth.authenticated.value || !auth.isHofAdmin.value) {
      throw new ApiError('AUTH_FORBIDDEN')
    }
    const availability = gate.availability(Feature.HALL_OF_FAME)
    if (availability.pending || !availability.available) throw new ApiError('NETWORK_ERROR')
  }
  checkScope()
  const refreshed = await auth.ensureToken(30)
  checkScope()
  const bearer = auth.token()
  if (!refreshed || !bearer) throw new ApiError('AUTH_UNAUTHENTICATED')

  const params = { status: 'PENDING', page: 1, size: 1 }
  const background = { signal, bearer }
  async function readTotal(request: Promise<{ totalItems: number }>) {
    try {
      const { totalItems } = await request
      if (!Number.isSafeInteger(totalItems) || totalItems < 0) throw new ApiError('INVALID_RESPONSE')
      return totalItems
    } catch (value) {
      const error = normalizeApiError(value)
      // 鉴权失败须立即交给调用方冻结；普通失败等待另一端，以免遮住同批 401/403。
      if (error.status === 401 || error.status === 403) throw error
      return error
    }
  }
  const [hundred, mark3] = await Promise.all([
    readTotal(hofAdminHundredList(params, background)),
    readTotal(hofAdminMark3List(params, background)),
  ])
  checkScope()
  if (hundred instanceof ApiError) throw hundred
  if (mark3 instanceof ApiError) throw mark3
  return { hundred, mark3 }
}

async function hofAdminRequest(url: string, options: RequestInit = {}, background?: BackgroundRead) {
  if (background) {
    return requireOk(await apiFetch(url, {
      signal: background.signal, headers: { Authorization: `Bearer ${background.bearer}` },
    }, 'silent'))
  }
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

export async function hofAdminList(params = {}): Promise<Schemas['HofAdminPage']> {
  const r = await hofAdminRequest(withQuery('/api/admin/hof', params))
  return readHofJson<Schemas['HofAdminPage']>(r, validators.hofAdminPageValidator)
}

export async function hofAdminVehicleOptions(): Promise<Schemas['HofVehicleOption'][]> {
  const r = await hofAdminRequest('/api/admin/hof/vehicle-options')
  return readHofJson<Schemas['HofVehicleOption'][]>(r, value => Array.isArray(value) && value.every(item => validators.hofVehicleOptionValidator(item)))
}

export async function hofAdminAudit(params = {}): Promise<Schemas['HofAdminAuditPage']> {
  const r = await hofAdminRequest(withQuery('/api/admin/hof/audit', params))
  return readHofJson<Schemas['HofAdminAuditPage']>(r, validators.hofAdminAuditPageValidator)
}

export async function hofAdminDelete(id: ResourceId) {
  await hofAdminRequest(`/api/admin/hof/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export async function hofAdminBulkDeleteRecords(ids: Schemas['BulkDeleteRecordsRequest']['ids']): Promise<Schemas['BulkDeleteResult']> {
  const r = await hofAdminRequest('/api/admin/hof/records/bulk-delete', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }),
  })
  return readHofJson<Schemas['BulkDeleteResult']>(r, validators.bulkDeleteResultValidator)
}

export async function hofAdminDownload(id: ResourceId) {
  const r = await hofAdminRequest(`/api/admin/hof/${encodeURIComponent(id)}/replay`)
  await downloadResponse(r, `replay-${id}.wotbreplay`)
}

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

export async function hofHundredList(params = {}): Promise<Schemas['HundredLeaderboardPage']> {
  requireHofOnline()
  const r = await requireOk(await apiFetch(withQuery('/api/hof/hundred', params)))
  return readHofJson<Schemas['HundredLeaderboardPage']>(r, validators.hundredLeaderboardPageValidator)
}

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

export async function hofHundredCancel(id: ResourceId): Promise<Schemas['HundredSubmissionSummary']> {
  const r = await hofAuthRequest(`/api/hof/hundred/submissions/${encodeURIComponent(id)}/cancel`, { method: 'POST' })
  return readHofJson<Schemas['HundredSubmissionSummary']>(r, validators.hundredSubmissionSummaryValidator)
}

export async function hofHundredMyStatus(): Promise<Schemas['HundredUserStatus']> {
  const r = await hofAuthRequest('/api/users/hundred/status')
  return readHofJson<Schemas['HundredUserStatus']>(r, validators.hundredUserStatusValidator)
}


export async function hofAdminHundredList(params = {}, background?: BackgroundRead): Promise<Schemas['HundredAdminPage']> {
  const r = await hofAdminRequest(withQuery('/api/admin/hof/hundred/submissions', params), {}, background)
  return readHofJson<Schemas['HundredAdminPage']>(r, validators.hundredAdminPageValidator)
}

export async function hofAdminHundredDetail(id: ResourceId): Promise<Schemas['HundredAdminDetail']> {
  const r = await hofAdminRequest(`/api/admin/hof/hundred/submissions/${encodeURIComponent(id)}`)
  return readHofJson<Schemas['HundredAdminDetail']>(r, validators.hundredAdminDetailValidator)
}

export async function hofAdminHundredReplays(submissionId: ResourceId): Promise<Schemas['HundredReplayEvidence'][]> {
  const r = await hofAdminRequest(`/api/admin/hof/hundred/submissions/${encodeURIComponent(submissionId)}/replays`)
  return readHofJson<Schemas['HundredReplayEvidence'][]>(r, value =>
    Array.isArray(value) && value.every(item => validators.hundredReplayEvidenceValidator(item)))
}

export async function hofAdminHundredReplayDownload(submissionId: ResourceId, replayId: ResourceId) {
  const r = await hofAdminRequest(
    `/api/admin/hof/hundred/submissions/${encodeURIComponent(submissionId)}/replays/${encodeURIComponent(replayId)}`
  )
  await downloadResponse(r, `replay-${replayId}.wotbreplay`)
}

export async function hofAdminHundredApprove(id: ResourceId): Promise<Schemas['HundredSubmissionSummary']> {
  const r = await hofAdminRequest(`/api/admin/hof/hundred/submissions/${encodeURIComponent(id)}/approve`, {
    method: 'POST',
  })
  return readHofJson<Schemas['HundredSubmissionSummary']>(r, validators.hundredSubmissionSummaryValidator)
}

export async function hofAdminHundredReject(id: ResourceId, body: Schemas['HundredRejectRequest']): Promise<Schemas['HundredSubmissionSummary']> {
  const r = await hofAdminRequest(`/api/admin/hof/hundred/submissions/${encodeURIComponent(id)}/reject`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  return readHofJson<Schemas['HundredSubmissionSummary']>(r, validators.hundredSubmissionSummaryValidator)
}

export async function hofAdminHundredDelete(id: ResourceId, body: Schemas['HundredDeleteRequest']): Promise<Schemas['HundredSubmissionSummary']> {
  const r = await hofAdminRequest(`/api/admin/hof/hundred/submissions/${encodeURIComponent(id)}/delete`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  return readHofJson<Schemas['HundredSubmissionSummary']>(r, validators.hundredSubmissionSummaryValidator)
}

export async function hofAdminBulkDeleteHundred(ids: BulkDeleteModerationRequest['ids'], body: Omit<BulkDeleteModerationRequest, 'ids'>): Promise<Schemas['BulkDeleteResult']> {
  const r = await hofAdminRequest('/api/admin/hof/hundred/submissions/bulk-delete', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids, ...body }),
  })
  return readHofJson<Schemas['BulkDeleteResult']>(r, validators.bulkDeleteResultValidator)
}


export async function hofMark3List(params = {}): Promise<Schemas['Mark3LeaderboardPage']> {
  requireHofOnline()
  const r = await requireOk(await apiFetch(withQuery('/api/hof/mark3', params)))
  return readHofJson<Schemas['Mark3LeaderboardPage']>(r, validators.mark3LeaderboardPageValidator)
}

export async function hofMark3Submit(formData: FormData): Promise<Schemas['Mark3CreateResult']> {
  requireHofOnline()
  await appendReplayFacts(formData)
  requireHofOnline()
  const r = await hofAuthRequest('/api/hof/mark3/submissions', { method: 'POST', body: formData })
  return readHofJson<Schemas['Mark3CreateResult']>(r, validators.mark3CreateResultValidator)
}

export async function hofMark3Cancel(id: ResourceId): Promise<Schemas['Mark3SubmissionSummary']> {
  const r = await hofAuthRequest(`/api/hof/mark3/submissions/${encodeURIComponent(id)}/cancel`, { method: 'POST' })
  return readHofJson<Schemas['Mark3SubmissionSummary']>(r, validators.mark3SubmissionSummaryValidator)
}

export async function hofMark3MyStatus(): Promise<Schemas['Mark3UserStatus']> {
  const r = await hofAuthRequest('/api/users/mark3/status')
  return readHofJson<Schemas['Mark3UserStatus']>(r, validators.mark3UserStatusValidator)
}


export async function hofAdminMark3List(params = {}, background?: BackgroundRead): Promise<Schemas['Mark3AdminPage']> {
  const r = await hofAdminRequest(withQuery('/api/admin/hof/mark3/submissions', params), {}, background)
  return readHofJson<Schemas['Mark3AdminPage']>(r, validators.mark3AdminPageValidator)
}

export async function hofAdminMark3Detail(id: ResourceId): Promise<Schemas['Mark3AdminDetail']> {
  const r = await hofAdminRequest(`/api/admin/hof/mark3/submissions/${encodeURIComponent(id)}`)
  return readHofJson<Schemas['Mark3AdminDetail']>(r, validators.mark3AdminDetailValidator)
}

export async function hofAdminMark3Replays(submissionId: ResourceId): Promise<Schemas['Mark3ReplayEvidence'][]> {
  const r = await hofAdminRequest(`/api/admin/hof/mark3/submissions/${encodeURIComponent(submissionId)}/replays`)
  return readHofJson<Schemas['Mark3ReplayEvidence'][]>(r, value => Array.isArray(value) && value.every(item => validators.mark3ReplayEvidenceValidator(item)))
}

export async function hofAdminMark3ReplayDownload(submissionId: ResourceId, replayId: ResourceId) {
  const r = await hofAdminRequest(
    `/api/admin/hof/mark3/submissions/${encodeURIComponent(submissionId)}/replays/${encodeURIComponent(replayId)}`
  )
  await downloadResponse(r, `replay-${replayId}.wotbreplay`)
}

export async function hofAdminMark3Approve(id: ResourceId): Promise<Schemas['Mark3SubmissionSummary']> {
  const r = await hofAdminRequest(`/api/admin/hof/mark3/submissions/${encodeURIComponent(id)}/approve`, {
    method: 'POST',
  })
  return readHofJson<Schemas['Mark3SubmissionSummary']>(r, validators.mark3SubmissionSummaryValidator)
}

export async function hofAdminMark3Reject(id: ResourceId, body: Schemas['Mark3RejectRequest']): Promise<Schemas['Mark3SubmissionSummary']> {
  const r = await hofAdminRequest(`/api/admin/hof/mark3/submissions/${encodeURIComponent(id)}/reject`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  return readHofJson<Schemas['Mark3SubmissionSummary']>(r, validators.mark3SubmissionSummaryValidator)
}

export async function hofAdminMark3Delete(id: ResourceId, body: Schemas['Mark3DeleteRequest']): Promise<Schemas['Mark3SubmissionSummary']> {
  const r = await hofAdminRequest(`/api/admin/hof/mark3/submissions/${encodeURIComponent(id)}/delete`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  return readHofJson<Schemas['Mark3SubmissionSummary']>(r, validators.mark3SubmissionSummaryValidator)
}

export async function hofAdminBulkDeleteMark3(ids: BulkDeleteModerationRequest['ids'], body: Omit<BulkDeleteModerationRequest, 'ids'>): Promise<Schemas['BulkDeleteResult']> {
  const r = await hofAdminRequest('/api/admin/hof/mark3/submissions/bulk-delete', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids, ...body }),
  })
  return readHofJson<Schemas['BulkDeleteResult']>(r, validators.bulkDeleteResultValidator)
}

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
