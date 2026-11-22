/** Agent 回放数据契约 —— 射击复现通道类型（ShotReplay 透传形状）。
 *  拆分自 agent-replay-facets.ts；公共入口仍为 `../agent-replay-facets.ts`。 */

import type { AgentVehicleEquipment } from './playbackTypes.js'

// ---------- 射击复现通道（parseShotReplays；上游 shots 数组同构透传） ----------

/** 全局弹种反解表条目（dump-shell-kinds 产物值形状；tanks.pb 弹种项属性） */
export interface AgentShellData {
  type: string
  penetration: number
  damage: number
  module_damage: number
  explosion_radius: number
}

/** 全局弹种反解表：{全局弹种 id(十进制串): AgentShellData}（与回放 shell_id 同域） */
export type AgentShellTable = Record<string, AgentShellData>

/**
 * 单发射击复现数据（上游 replay-core ShotReplayData；字段语义见上游
 * crates/replay-core/src/replay/combat/shots.rs——本接口只标注消费面，
 * 未知键透传保留：3D 查看器消费弹道/锚点/时间线等全部字段）。
 */
export interface AgentShotReplay {
  index: number
  time_s: number
  damage: number
  target_name: string
  /** 受击方实体 id（作者 = method38 / 他人 = method8，服务器权威）。身份联表用
   * 此字段而非昵称反查——名字缺失/冲突时 target_name 不可作身份（上游 v0.1.9 起直传） */
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
  /** 弹道两点（回放世界系，米）：炮口发射位置 / 弹道终点 */
  ball_a: number[]
  ball_b: number[]
  launch_velocity: number[]
  /** 命中结果位图（0x0008 跳弹 / 0x0010 击穿 / 0x1000 HE 爆炸分支…） */
  hit_flags: number
  shell_id: number
  shell_kind?: string
  shell_slot?: number
  shooter_shell_idx?: number
  /** shooter_shell_idx 所属配置（build_configs 下标；弹表域钉死，多炮坦克不再错位） */
  shooter_shell_cfg_idx?: number
  /**
   * 发射弹种完整数据（shellsJson 注入后由 WASM 反解；dump-shell-kinds 富表条目）。
   * 值为射手配置弹表口径（tanks.pb 弹种项），徽标穿深/判定直接消费。
   */
  shell?: AgentShellData
  armor_group: number
  /** 0=无 1=未击穿 2=间隙止 3=有伤害 4=履带/模块 255=未获取 */
  game_hit_result: number
  target_tank_id?: number
  shooter_tank_id?: number
  target_config_idx?: number
  shooter_config_idx?: number
  /** Type5 配件串物化（上游 VehicleEquipment：calibrated_shells/enhanced_armor/improved_pitch_limits/raw；raw 变长、0=空槽垫底、空槽位置信息线上不存在） */
  shooter_equipment?: AgentVehicleEquipment
  target_equipment?: AgentVehicleEquipment
  /** 逐发质量标注（降级/陈旧/兜底路径，UI ⚠ 悬停依据） */
  quality?: Record<string, unknown>
  [key: string]: unknown
}
