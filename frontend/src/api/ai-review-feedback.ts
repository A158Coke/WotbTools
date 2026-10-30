import type { components } from './generated/http-contract.js'
import { createAiReviewFeedbackResponseValidator, adminAiReviewFeedbackPageValidator, adminAiReviewFeedbackDetailValidator } from './generated/contract-validators.js'
import { useAuth } from '../composables/useAuth.js'
import { ApiError, apiErrorFromResponse, apiFetch } from '../utils/http.js'

type Request = components['schemas']['CreateAiReviewFeedbackRequest']
type Created = components['schemas']['CreateAiReviewFeedbackResponse']
type Page = components['schemas']['AdminAiReviewFeedbackPage']
type Detail = components['schemas']['AdminAiReviewFeedbackDetail']
export type FeedbackReason = components['schemas']['AiReviewFeedbackReason']
export const feedbackReasons: readonly FeedbackReason[] = Object.freeze([
  'FACT_ERROR', 'BAD_JUDGMENT', 'MISSED_KEY_POINT', 'TOO_AI_LIKE',
  'TOO_VAGUE', 'TOO_VERBOSE', 'UNHELPFUL_ADVICE', 'OTHER',
])

async function request(url: string, options: RequestInit = {}): Promise<unknown | null> {
  const { token, ensureToken } = useAuth()
  if (!(await ensureToken(30))) throw new ApiError({ errorCode: 'AUTH_UNAUTHENTICATED', status: 401, retryable: false })
  const headers = { ...(options.headers || {}) } as Record<string, string>
  if (token()) headers.Authorization = `Bearer ${token()}`
  const response = await apiFetch(url, { ...options, headers })
  if (!response.ok) throw await apiErrorFromResponse(response)
  if (response.status === 204) return null
  try { return await response.json() as unknown }
  catch (cause) { throw new ApiError({ errorCode: 'INVALID_RESPONSE', retryable: false, cause }) }
}

export async function createFeedback(body: Request): Promise<Created> {
  const value = await request('/api/ai-review-feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!createAiReviewFeedbackResponseValidator(value)) throw new ApiError({ errorCode: 'INVALID_RESPONSE', retryable: false })
  return value as Created
}

export async function listFeedback(page: number, reason: FeedbackReason | ''): Promise<Page> {
  const params = new URLSearchParams({ page: String(page), size: '25' })
  if (reason) params.set('reason', reason)
  const value = await request(`/api/admin/ai-review-feedback?${params}`)
  if (!adminAiReviewFeedbackPageValidator(value)) throw new ApiError({ errorCode: 'INVALID_RESPONSE', retryable: false })
  return value as Page
}

export async function getFeedback(id: string): Promise<Detail> {
  const value = await request(`/api/admin/ai-review-feedback/${encodeURIComponent(id)}`)
  if (!adminAiReviewFeedbackDetailValidator(value)) throw new ApiError({ errorCode: 'INVALID_RESPONSE', retryable: false })
  return value as Detail
}

export async function deleteFeedback(id: string): Promise<void> {
  const value = await request(`/api/admin/ai-review-feedback/${encodeURIComponent(id)}`, { method: 'DELETE' })
  if (value !== null) throw new ApiError({ errorCode: 'INVALID_RESPONSE', retryable: false })
}
