/**
 * 规范投影（v2 数据集）Worker 的消息协议（主线程 ↔ canonical.worker.ts）。
 *
 * 为什么必须放进 Worker：`parseLocalPlayback` 在**主线程**要跑 3 次 Rust 解析
 * （result / playback / aiReview，其中 playback_json 是本仓库最大的切面 JSON）+ 整场
 * JS 投影（`toBattlePlaybackDataset`）+ 地图概览。它由工作台在**场景就绪后异步补齐**，
 * 于是"播放正常一小段时间后整页卡住数百 ms~数秒"——用户实测的卡死即此处。
 * 放进 Worker 后主线程只收一条 structured clone 的结果。
 */
import type { AgentPlaybackFacet } from '../api/agent-replay-facets.js'
import type { LocalPlayback } from './playback/index.js'

export interface CanonicalRequest {
  /** 请求标识（同一 Worker 串行处理，回包按 id 对应） */
  id: number
  /** 回放原始字节（.wotbreplay 内容） */
  bytes: ArrayBuffer
  /**
   * 场景侧**已解析**的 playback facet（`loadScene` 的产物）。传入后 Worker 的
   * `parseLocalPlayback` 跳过 `parseAgentPlaybackFromBytes`——同一回放不在
   * Worker 里二次解析（review blocker：canonical 不得重复 parsePlayback）。
   */
  playback?: AgentPlaybackFacet
}

export type CanonicalMessage =
  | { type: 'done'; id: number; playback: LocalPlayback }
  | { type: 'error'; id: number; error: string }
