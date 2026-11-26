import type { AgentBattleResult } from '../api/agent-replay-facets.js'

export interface ParseRequest {
  files: Array<{ name: string; bytes: ArrayBuffer }>
}

export interface ParsedReplayFile {
  name: string
  result: AgentBattleResult | null
  error: string | null
}

export type ParseMessage =
  | { type: 'file'; index: number; file: ParsedReplayFile }
  | { type: 'done' }
  | { type: 'fatal'; error: string }
