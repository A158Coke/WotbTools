

export interface AgentResultPlayer {
  account_id: number
  nickname: string
  team: number
  platoon_id?: number
  clan_tag?: string
  tank_id: number
  tank_name: string
  base_xp: number
  credits_earned: number
  n_shots: number
  n_hits_dealt: number
  n_penetrations_dealt: number
  damage_dealt: number
  damage_blocked: number
  damage_assisted_1: number
  damage_assisted_2: number
  n_hits_received: number
  n_penetrations_received: number
  n_enemies_damaged: number
  n_enemies_destroyed: number
  mm_rating?: number
  display_rating?: number
  death_reason?: number
  survived?: boolean
  life_time_secs?: number
  n_enemies_spotted?: number
  destruction_assistance?: number
  gun_marks?: number
  killer_id?: number
  xp?: number
  credits?: number
  result_id?: number
  killer_account_id?: number
  damage_received?: number | null
  victory_points_earned?: number | null
  victory_points_seized?: number | null
  hitpoints_left?: number | null
  rank?: number | null
  [key: string]: unknown
}

export interface AgentBattleResult {
  file_name: string
  timestamp: number
  datetime: string
  room_type: string
  arena_id?: string | null
  arena_bonus_type?: number | null
  finish_reason?: number | null
  result_duration_secs?: number | null
  client_version?: string | null
  map_id: number
  map_name: string
  map_key?: string | null
  roster_complete?: boolean | null
  author_vehicle_codename?: string | null
  battle_duration_secs: number
  winner_team: number
  author_account_id: number
  author_nickname: string
  author_tank_id: number
  author_tank_name: string
  author_team: number
  author_won: boolean
  author: Record<string, unknown>
  players: AgentResultPlayer[]
  [key: string]: unknown
}

export interface AgentAuthorInitialPosition {
  author_eid: number
  clock: number
  position: [number, number, number]
}

export interface AgentRecorderCamera {
  version: 1
  author_eid: number
  aim: { t: number[]; yaw: number[]; pitch: number[]; ray_x: number[]; ray_y: number[]; ray_z: number[] }
  mode: { t: number[]; raw: number[] }
  zoom: { t: number[]; raw: number[] }
  bloom: { t: number[]; raw: number[] }
  client_options: { backward_zoom: boolean | null }
}
