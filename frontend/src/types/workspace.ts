import type { ComputedRef, Ref } from 'vue'
import type { Battle, ReplayResult, SourceId } from './replay.js'

/** 回放工作台的五种能力（`3d` / `shots` 仍受 admin feature flag 约束）。 */
export type ReplayCapability = 'data' | 'playback' | '3d' | 'shots' | 'ai'
const REPLAY_CAPABILITIES: readonly string[] = Object.freeze(['data', 'playback', '3d', 'shots', 'ai'])
/** 未知 / 缺省能力统一落到 `data`（深链与外部输入的唯一规范化点）。 */
export function toReplayCapability(value: unknown): ReplayCapability {
  return typeof value === 'string' && REPLAY_CAPABILITIES.includes(value) ? (value as ReplayCapability) : 'data'
}
export type DataViewMode = 'SUMMARY' | 'SINGLE'

/**
 * 本地分析失败原因：
 * - ENGINE_UNAVAILABLE：回放引擎（WASM）装载失败，整批不可用；
 * - NO_VALID_REPLAYS：全部文件解析失败 / 去重后 0 场；
 * - UNKNOWN：计算阶段的意外错误。
 */
export type ReplayAnalysisFailure = 'ENGINE_UNAVAILABLE' | 'NO_VALID_REPLAYS' | 'UNKNOWN'

/** 本地分析状态（服务器没有 parser：没有上传 / 排队 / 轮询，只有解析进度） */
export interface ReplayAnalysis {
  phase: 'idle' | 'parsing' | 'ready' | 'failed' | 'cancelled'
  /** 已解析文件数 / 总文件数 */
  done: number
  total: number
  failure: ReplayAnalysisFailure | null
}

/** Public state contract exposed by the Replay Workspace/session owner. */
export interface ReplayWorkspaceState {
  files: Ref<File[]>
  resp: Ref<ReplayResult | null>
  analysis: Ref<ReplayAnalysis>
  currentBattleId: Ref<SourceId | null>
  parsedBattles: ComputedRef<Battle[]>
  dataViewMode: Ref<DataViewMode>
  activeWorkspaceTab: Ref<ReplayCapability>
}
