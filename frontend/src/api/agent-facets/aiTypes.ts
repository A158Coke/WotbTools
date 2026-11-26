

export interface AgentAiRosterEntry {
  eid: number
  account_id?: number
  nickname?: string
  team?: number
  tank_id?: number
  tank_name: string
  is_author: boolean
}

export interface AgentArenaPeriod {
  clock: number
  period: number
  remaining_s?: number
  duration_s?: number
  [key: string]: unknown
}

export const AI_HP_STATES = ['current', 'zero', 'terminal'] as const

export type AiHpStateField = (typeof AI_HP_STATES)[number]

export const AI_HP_STATE_SET: ReadonlySet<string> = new Set(AI_HP_STATES)

export type AiReviewValidationMode = 'current-producer' | 'legacy-compatible'

export type AgentAiEvent =
  | { type: 'spawn'; t: number; eid: number; max_hp: number }
  | {
    type: 'shot'; t: number; shooter_eid: number; target_eid?: number; hit: boolean; ricochet: boolean
    game_hit_result: number; damage: number; is_kill: boolean; is_author: boolean; shell_kind?: string
  }
  | { type: 'damage'; t: number; victim_eid: number; hp: number; hp_raw: number; hp_state?: AiHpStateField; source_eid: number; cause: number }
  | { type: 'kill'; t: number; killer_eid: number; victim_eid: number; cause: number; assister_eid?: number }
  | { type: 'visibility'; t_in: number; eid: number; t_out?: number; hp_raw?: number }
  | { type: 'health'; t: number; eid: number; hp_raw: number; hp_state?: AiHpStateField }
  | {
    type: 'hit_notice'; t: number; eid: number; payload_len: number
    shooter_eid?: number; victim_eid?: number; result?: number; secondary?: number
  }
  | { type: 'counter'; t: number; code: number; count: number; value: number }
  | { type: 'damage_tick'; t: number; eid: number; cumulative: number }

export interface AgentAiBattleHeader {
  start_time: number
  map_id: number
  map_name: string
  room_type: string
  winner: number
  duration_secs: number | null
  meta_duration_secs?: number
  periods: AgentArenaPeriod[]
}

export interface AgentRawPoseTrack {
  eid: number
  t: number[]
  x: number[]
  y: number[]
  z: number[]
  yaw: number[]
}

export interface AgentRawTurretTrack {
  eid: number
  t: number[]
  raw: number[]
}

export interface AgentAiReviewFacet {
  version: 1
  battle: AgentAiBattleHeader
  rosters: AgentAiRosterEntry[]
  events: AgentAiEvent[]
  settlements: unknown[]
  poses: AgentRawPoseTrack[]
  turrets: AgentRawTurretTrack[]
}

export const AI_REVIEW_CONTRACT_VERSION = 1
