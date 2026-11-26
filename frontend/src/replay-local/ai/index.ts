
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
    result, playback, aiReview, engine: { release: fp.tag, commit: fp.upstream_commit },
  })
  if (!projection) throw new AiProjectionUnavailableError()
  return { battle: toBattleFacts(result) as unknown as AiReviewBattle, projection }
}
