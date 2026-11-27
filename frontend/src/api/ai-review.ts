import type {
  AiReviewLocale,
  AiReviewProjection,
  AiReviewRequest,
} from '../types/ai-review.js'
import { authedReplayPost, type ReplayAuthSession } from './replay-capabilities.js'

export const AI_REVIEWS_PATH = '/api/ai/reviews'

export interface AiReviewRequestInput extends AiReviewProjection {
  locale: AiReviewLocale
  correlationId: string
}

export function buildAiReviewRequest(input: AiReviewRequestInput): AiReviewRequest {
  return {
    locale: input.locale,
    correlationId: input.correlationId,
    battle: input.battle,
    projection: input.projection,
  }
}

export function openAiReviewStream(
  auth: ReplayAuthSession,
  request: AiReviewRequest,
  signal?: AbortSignal,
): Promise<Response> {
  return authedReplayPost(auth, AI_REVIEWS_PATH, request, { signal, gzip: true })
}

export function cancelAiReviewUrl(correlationId: string): string {
  return `${AI_REVIEWS_PATH}/${encodeURIComponent(correlationId)}/cancel`
}

export async function cancelAiReview(
  auth: ReplayAuthSession,
  correlationId: string,
): Promise<void> {
  if (!correlationId) return
  try {
    await authedReplayPost(auth, cancelAiReviewUrl(correlationId), undefined, {
      allowNoContent: true,
      keepalive: true,
    })
  } catch {
    // best-effort：取消是通知，不是必须成功的事务。
  }
}
