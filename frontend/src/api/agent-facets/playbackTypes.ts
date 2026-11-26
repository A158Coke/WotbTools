


export interface AgentPlaybackMeta {
  map_id: number
  map_name: string
  winner_team: number
  friendly_team: number
  author_eid: number
  t_start: number
  samples: number
  duration: number
}

export interface AgentPoseKeyframes {
  t: number[]
  pos: number[]
  yaw: number[]
  pitch: number[]
  roll?: number[]
}

export interface AgentDetachedTurretTrack {
  eid: number
  vehicle_eid: number
  coverage: number[]
  pose_kf: AgentPoseKeyframes & { roll: number[] }
}

export interface AgentVehicleTrack {
  eid: number
  account_id: number
  nickname: string
  tank_id: number
  tank_name: string
  team: number
  is_author: boolean
  max_hp: number
  pos: number[]
  hull_yaw: number[]
  hull_pitch: number[]
  hull_roll?: number[]
  turret_yaw: number[]
  gun_pitch: number[]
  hp: Array<[number, number]>
  death_t: number | null
  killer_eid: number
  death_times?: number[]
  resurrection_times?: number[]
  shell_ids: number[]
  turret_index: number | null
  gun_index: number | null
  config_idx?: number | null
  burst_size?: number | null
  turret_local?: number | null
  gun_local?: number | null
  coverage: number[]
  pose_kf?: AgentPoseKeyframes
  loadout_items?: number[][]
  equipment?: number[]
  loadout?: AgentVehicleLoadout | null
}

export interface AgentLoadoutItem {
  index: number
  kind: 'consumable' | 'provision' | 'ability'
  wire_code: number
  state: number
  payload_raw: number[]
  logical_id?: string | null
}

export interface AgentVehicleLoadout {
  equipment: number[]
  equipment_count: number
  equipment_ids: number[]
  items: number[][]
  consumables: AgentLoadoutItem[]
  abilities: AgentLoadoutItem[]
  provisions: AgentLoadoutItem[]
}

export interface AgentConsumableEvent {
  clock: number
  eid: number
  wire_code: number
  logical_item_id?: string | null
  state: number
  state_name?: string
  duration_s?: number | null
  ends_at?: number | null
  ever_activated?: boolean
  slot?: number | null
  body_clock: number
  param: number
}

export interface AgentModuleCrewState {
  clock: number
  vehicle_eid: number
  state_code: number
  component_code: number
  component: string
  state: string
  related_eid: number
}

export interface AgentVehicleEquipment {
  calibrated_shells?: boolean
  enhanced_armor?: boolean
  improved_pitch_limits?: boolean
  raw?: number[]
}

export interface AgentPlaybackShot {
  t_fire: number
  shooter_eid: number
  target_eid?: number
  from: [number, number, number]
  to: [number, number, number]
  flight_secs: number
  via?: [number, number, number][]
  leg_secs?: number[]
  shell_speed: number
  hit: boolean
  ricochet: boolean
  game_hit_result: number
  damage: number
  is_kill: boolean
  is_author: boolean
  shell_kind?: string
  shooter_name?: string
  target_name?: string
}

export interface AgentKillEvent {
  t: number
  killer_eid: number
  victim_eid: number
  cause: number
  assister_eid?: number
  death_reason?: number
}

export interface AgentAoiPresence {
  eid: number
  t_in: number
  t_out?: number
  hp_raw?: number
}

export interface AgentSupremacyBaseTransition {
  clock: number
  base_id: number
  owner_team?: number | null
  capturing_team?: number | null
  capture_progress?: number | null
}

export interface AgentSupremacyPointsSample {
  clock: number
  team: number
  points: number
}

export interface AgentAssaultBaseTransition {
  clock: number
  progress: number
}

export interface AgentReloadEvent {
  clock: number
  eid: number
  phase: number
  duration_s: number | null
  count: number | null
}

export interface AgentReloadEffectiveEvent {
  clock: number
  eid: number
  duration_s: number
}

export interface AgentArmorStateTrack {
  eid: number
  t: number[]
  state: number[]
}

export interface AgentAuthorShellEvent {
  t: number
  shell_id: number
}

export interface AgentDestructibleArea {
  eid: number
  x: number
  z: number
}

export interface AgentDestructibleEvent {
  clock: number; area_eid: number; prop: number; slot: number
  fall_dir: number; body_len: number; args: number[]
}

export interface AgentPlaybackFacet {
  version: number
  meta: AgentPlaybackMeta
  vehicles: AgentVehicleTrack[]
  shots: AgentPlaybackShot[]
  kills: AgentKillEvent[]
  periods: Array<{ clock: number; period: number; remaining_s: number; duration_s: number }>
  visibility: AgentAoiPresence[]
  supremacy_bases?: AgentSupremacyBaseTransition[]
  supremacy_points?: AgentSupremacyPointsSample[]
  assault_objective_present?: boolean
  assault_bases?: AgentAssaultBaseTransition[]
  consumables?: AgentConsumableEvent[]
  module_crew_states?: AgentModuleCrewState[]
  reloads?: AgentReloadEvent[]
  reload_effective?: AgentReloadEffectiveEvent[]
  author_shell_timeline?: AgentAuthorShellEvent[]
  armor_states?: AgentArmorStateTrack[]
  detached_turrets?: AgentDetachedTurretTrack[]
  destructible_areas?: AgentDestructibleArea[]
  destructible_events?: AgentDestructibleEvent[]
  chat_channels?: AgentChatChannel[]
  chat_messages?: AgentChatMessageEvent[]
  notifications?: AgentNotificationEvent[]
  chat_events?: AgentChatEvent[]
  module_damage_events?: AgentModuleDamageEvent[]
  damage_events?: AgentDamageEvent[]
  markers?: AgentBattleMarkerEvent[]
}

export interface AgentDamageEvent {
  t: number
  victim_eid: number
  damage: number
  hp: number
  source_eid: number
  cause: number
}

export type AgentChatEventKind = 'message' | 'command' | 'join' | 'leave' | 'channel_created' | 'other'

export interface AgentChatEvent {
  t: number
  kind: AgentChatEventKind
  raw_type: number
  channel: number
  sender: string
  text?: string
  command?: number
  target?: number
  command_name?: string
}

export interface AgentModuleDamageEvent {
  clock: number
  victim_eid: number
  component_code: number
  component: string
  state_code: number
  state: 'damaged' | 'critical' | 'no_change' | 'unknown'
}

export interface AgentChatChannel {
  channel_name: string
  id: number
  db_id?: number
  owner?: number
  flags?: number
  is_system?: boolean
  is_read_only?: boolean
  is_secured?: boolean
}

export interface AgentChatMessageEvent {
  t: number
  tag: number
  seq: number
  text: string
}

export interface AgentNotificationEvent {
  t: number
  subject: number
  code: number
}

export interface AgentBattleMarkerEvent {
  t: number
  entity_id: number
  account_id: number
  marker_type: number
  at?: [number, number, number]
  target_eid?: number
}
