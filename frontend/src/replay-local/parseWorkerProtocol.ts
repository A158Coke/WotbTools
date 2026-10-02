/** 解析 Worker 的消息协议（主线程 ↔ parse.worker.ts）。 */
import type { AgentBattleResult } from '../api/agent-replay-facets.js'

export interface ParseRequest {
  files: Array<{ name: string; bytes: ArrayBuffer }>
}

/** 单个文件的解析结果：result 与 error 二选一 */
export interface ParsedReplayFile {
  name: string
  result: AgentBattleResult | null
  error: string | null
}

export type ParseMessage =
  | { type: 'file'; index: number; file: ParsedReplayFile }
  | { type: 'done' }
  /** WASM 装载失败等整体错误：不是某个文件的问题，整批不可用 */
  | { type: 'fatal'; error: string }
