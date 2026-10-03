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
 *  - 请求体只承载 **client canonical AI projection**（`battle` + `projection`，
 *    `replay-local/ai`）；本模块既不接收也不序列化 Agent 原始切面。请求体 gzip 压缩发送
 *    （`Content-Encoding: gzip`，服务端限额解压——服务器没有 parser，传的是投影不是回放）。
 *  - SSE 流解析留在 `utils/aiReviewSse.ts`；本模块只负责打开响应与显式取消。
 */
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

/** 组装 wire 请求（单一 DTO、单一端点，不做版本协商）。 */
export function buildAiReviewRequest(input: AiReviewRequestInput): AiReviewRequest {
  return {
    locale: input.locale,
    correlationId: input.correlationId,
    battle: input.battle,
    projection: input.projection,
  }
}

/** 打开 AI Review SSE 响应（调用方负责读取 body 与分发事件）。 */
export function openAiReviewStream(
  auth: ReplayAuthSession,
  request: AiReviewRequest,
  signal?: AbortSignal,
): Promise<Response> {
  return authedReplayPost(auth, AI_REVIEWS_PATH, request, { signal, gzip: true })
}

/** 取消端点 URL：`correlationId` 是 path 参数，不再是 query 参数。 */
export function cancelAiReviewUrl(correlationId: string): string {
  return `${AI_REVIEWS_PATH}/${encodeURIComponent(correlationId)}/cancel`
}

/**
 * 显式取消（按钮 / 卸载 / 前端超时的 best-effort 通知）。
 *
 * 当前 ai-service 对「已完成 / 已取消 / 未注册」也幂等返回 204；部署滚动期间旧实例仍可能
 * 返回 404。取消只是通知，兼容旧实例与网络失败时都不得变成用户可见错误。
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
