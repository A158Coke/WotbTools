/**
 * AI Review transport（`/api/ai/**`）——独立无状态 ai-service 的 wire 边界。
 *
 * 契约 SSOT：`contracts/http/openapi.yaml`（`AiReviewRequestV1` / `x-sse-events` /
 * `AiReviewErrorCode`）。端点：`POST /api/ai/reviews`（SSE）与
 * `POST /api/ai/reviews/{correlationId}/cancel`。
 *
 * 边界：
 *  - `/api/replay/*`（Dataset / Playback / MapOverview）由 `replay-capabilities.ts` 拥有；
 *    `/api/ai/**` 由本模块拥有。两者共用 `authedReplayPost` 的 bearer 约定，
 *    组件不得自行拼 endpoint、鉴权头或错误解析。
 *  - 请求体只承载**客户端投影**（`battle` + `reconstruction`）；本模块既不接收、
 *    也不序列化整份 canonical replay——投影由本地解析层产出。
 *  - SSE 流解析留在 `utils/aiReviewSse.ts`；本模块只负责打开响应与显式取消。
 */
import type {
  AiReviewLocale,
  AiReviewProjection,
  AiReviewRequestV1,
} from '../types/ai-review.js'
import { authedReplayPost, type ReplayAuthSession } from './replay-capabilities.js'

export const AI_REVIEWS_PATH = '/api/ai/reviews'

export interface AiReviewRequestInput extends AiReviewProjection {
  locale: AiReviewLocale
  correlationId: string
}

/** 组装 wire 请求；`schemaVersion` 恒为契约常量 1。 */
export function buildAiReviewRequest(input: AiReviewRequestInput): AiReviewRequestV1 {
  return {
    schemaVersion: 1,
    locale: input.locale,
    correlationId: input.correlationId,
    battle: input.battle,
    reconstruction: input.reconstruction,
  }
}

/** 打开 AI Review SSE 响应（调用方负责读取 body 与分发事件）。 */
export function openAiReviewStream(
  auth: ReplayAuthSession,
  request: AiReviewRequestV1,
  signal?: AbortSignal,
): Promise<Response> {
  return authedReplayPost(auth, AI_REVIEWS_PATH, request, { signal })
}

/** 取消端点 URL：`correlationId` 是 path 参数，不再是 query 参数。 */
export function cancelAiReviewUrl(correlationId: string): string {
  return `${AI_REVIEWS_PATH}/${encodeURIComponent(correlationId)}/cancel`
}

/**
 * 显式取消（按钮 / 卸载 / 前端超时的 best-effort 通知）。
 *
 * 404 表示该 correlationId 已无进行中的 review（正常竞态），与网络失败一样不得
 * 变成用户可见错误，因此统一吞掉。
 */
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
