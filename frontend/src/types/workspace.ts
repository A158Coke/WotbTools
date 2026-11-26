import type { ComputedRef, Ref } from 'vue'
import type { Battle, ReplayResult, SourceId } from './replay.js'

export type ReplayCapability = 'data' | 'playback' | '3d' | 'events' | 'shots' | 'ai'
const REPLAY_CAPABILITIES: readonly string[] = Object.freeze(['data', 'playback', '3d', 'events', 'shots', 'ai'])
export function toReplayCapability(value: unknown): ReplayCapability {
  return typeof value === 'string' && REPLAY_CAPABILITIES.includes(value) ? (value as ReplayCapability) : 'data'
}
export type DataViewMode = 'SUMMARY' | 'SINGLE'

export type ReplayAnalysisFailure = 'ENGINE_UNAVAILABLE' | 'NO_VALID_REPLAYS' | 'UNKNOWN'

export interface ReplayAnalysis {
  phase: 'idle' | 'parsing' | 'ready' | 'failed' | 'cancelled'
  done: number
  total: number
  failure: ReplayAnalysisFailure | null
}

export interface ReplayWorkspaceState {
  files: Ref<File[]>
  resp: Ref<ReplayResult | null>
  analysis: Ref<ReplayAnalysis>
  currentBattleId: Ref<SourceId | null>
  parsedBattles: ComputedRef<Battle[]>
  dataViewMode: Ref<DataViewMode>
  activeWorkspaceTab: Ref<ReplayCapability>
}
