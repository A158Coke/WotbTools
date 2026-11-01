import type { components } from './generated/http-contract.js'
import { createSiteFeedbackResponseValidator, adminSiteFeedbackPageValidator, adminSiteFeedbackDetailValidator } from './generated/contract-validators.js'
import { request } from './ai-review-feedback.js'
import { ApiError } from '../utils/http.js'

type Request = components['schemas']['CreateSiteFeedbackRequest']
type Created = components['schemas']['CreateSiteFeedbackResponse']
export type SiteFeedbackPage = components['schemas']['AdminSiteFeedbackPage']
export type SiteFeedbackDetail = components['schemas']['AdminSiteFeedbackDetail']
export type SiteFeedbackItem = components['schemas']['AdminSiteFeedbackListItem']
export type SiteFeedbackReason = components['schemas']['SiteFeedbackReason']
export const siteFeedbackReasons: readonly SiteFeedbackReason[] = Object.freeze([
  'BUG', 'FEATURE_REQUEST', 'DATA_ERROR', 'USABILITY', 'OTHER',
])

export async function createSiteFeedback(body: Request): Promise<Created> {
  const value = await request('/api/site-feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!createSiteFeedbackResponseValidator(value)) throw new ApiError({ errorCode: 'INVALID_RESPONSE', retryable: false })
  return value as Created
}

export async function listSiteFeedback(page: number, reason: SiteFeedbackReason | ''): Promise<SiteFeedbackPage> {
  const params = new URLSearchParams({ page: String(page), size: '25' })
  if (reason) params.set('reason', reason)
  const value = await request(`/api/admin/site-feedback?${params}`)
  if (!adminSiteFeedbackPageValidator(value)) throw new ApiError({ errorCode: 'INVALID_RESPONSE', retryable: false })
  return value as SiteFeedbackPage
}

export async function getSiteFeedback(id: string): Promise<SiteFeedbackDetail> {
  const value = await request(`/api/admin/site-feedback/${encodeURIComponent(id)}`)
  if (!adminSiteFeedbackDetailValidator(value)) throw new ApiError({ errorCode: 'INVALID_RESPONSE', retryable: false })
  return value as SiteFeedbackDetail
}

export async function deleteSiteFeedback(id: string): Promise<void> {
  const value = await request(`/api/admin/site-feedback/${encodeURIComponent(id)}`, { method: 'DELETE' })
  if (value !== null) throw new ApiError({ errorCode: 'INVALID_RESPONSE', retryable: false })
}
