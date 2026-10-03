import type { ComputedRef, Ref } from 'vue'
import type { Battle, ReplayResult, SourceId } from './replay.js'

// 工作台能力：数据 / AI 复盘 / 2D 回放 / 3D 回放 / 射击分析。
// 五种能力都在工作台内渲染（各自一个 pane），URL view 经 replayInitialCapability 映射。
export type ReplayCapability = 'data' | 'ai' | 'playback' | '3d' | 'shots'
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
