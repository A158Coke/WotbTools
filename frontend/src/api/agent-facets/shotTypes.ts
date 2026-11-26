
import type { AgentVehicleEquipment } from './playbackTypes.js'


export interface AgentShellData {
  type: string
  penetration: number
  damage: number
  module_damage: number
  explosion_radius: number
}

export type AgentShellTable = Record<string, AgentShellData>

export interface AgentShotReplay {
  index: number
  time_s: number
  damage: number
  target_name: string
  target_eid?: number
  is_kill: boolean
  shooter_eid: number
  shooter_name?: string
  is_author?: boolean
  shooter_pos: number[]
  shooter_ang: number[]
  target_pos: number[]
  target_ang: number[]
  target_turret_yaw: number
  shooter_turret_yaw: number
  ball_a: number[]
  ball_b: number[]
  launch_velocity: number[]
  hit_flags: number
  shell_id: number
  shell_kind?: string
  shell_slot?: number
  shooter_shell_idx?: number
  shooter_shell_cfg_idx?: number
  shell?: AgentShellData
  armor_group: number
  game_hit_result: number
  target_tank_id?: number
  shooter_tank_id?: number
  target_config_idx?: number
  shooter_config_idx?: number
  shooter_equipment?: AgentVehicleEquipment
  target_equipment?: AgentVehicleEquipment
  quality?: Record<string, unknown>
  [key: string]: unknown
}
