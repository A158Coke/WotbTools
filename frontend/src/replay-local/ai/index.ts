/**
 * AI 复盘的本地输入：.wotbreplay → 上游 WASM（parseResult + parsePlayback + parseAiReview）
 * → 结算事实 `battle` + client canonical AI projection。文件不出本机，服务器只收投影。
 */

import {
  loadAgentWasmFingerprint,
  parseAgentAiReviewFromBytes,
  parseAgentPlaybackFromBytes,
  parseAgentResultFromBytes,
} from '../../api/agent-replay-facets.js'
import type { AiReviewBattle, AiReviewProjection } from '../../types/ai-review.js'
import { toBattleFacts } from '../battleFacts.js'
import { toClientAiReviewProjection } from './toClientAiReviewProjection.js'

export { toClientAiReviewProjection, UNAVAILABLE_EVIDENCE, type ClientAiReviewProjection } from './toClientAiReviewProjection.js'

/** 时间轴不可用（无法建立 canonical facts）——AI 复盘不可执行，不是解析失败 */
export class AiProjectionUnavailableError extends Error {
  constructor() {
    super('ai projection unavailable: battle timeline could not be established')
    this.name = 'AiProjectionUnavailableError'
  }
}

export async function buildLocalAiReviewInput(input: Blob | Uint8Array): Promise<AiReviewProjection> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(await input.arrayBuffer())
  const result = await parseAgentResultFromBytes(bytes)
  const playback = await parseAgentPlaybackFromBytes(bytes)
  const aiReview = await parseAgentAiReviewFromBytes(bytes)
  const fp = await loadAgentWasmFingerprint()
  const projection = toClientAiReviewProjection({
    result, playback, aiReview, engine: { release: fp?.tag ?? 'unknown', commit: fp?.upstream_commit ?? 'unknown' },
  })
  if (!projection) throw new AiProjectionUnavailableError()
  return { battle: toBattleFacts(result) as unknown as AiReviewBattle, projection }
}
