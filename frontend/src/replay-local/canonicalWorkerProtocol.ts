import type { AgentPlaybackFacet } from '../api/agent-replay-facets.js'
import type { LocalPlayback } from './playback/index.js'

export interface CanonicalRequest {
  id: number
  bytes: ArrayBuffer
  playback?: AgentPlaybackFacet
}

export type CanonicalMessage =
  | { type: 'done'; id: number; playback: LocalPlayback }
  | { type: 'error'; id: number; error: string }
