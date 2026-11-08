// 坦克查看器 owner 模块共享的领域与 window 钩子契约（#820 拆分后的类型边界）。
//
// 只放跨 owner 复用的数据类型与浏览器调试钩子声明，不持有运行时状态、不做数据转换。
// 数据面形状与 tank/{id}.json、agent shot 交接 payload 对齐；装甲相关类型直接复用
// armorPlateModel.TankArmorData / TankArmorConfig（同一份消费字段定义）。
import type * as THREE from 'three'
import type { TankArmorConfig, TankArmorData } from './armorPlateModel.js'

/** 世界系/模型系三元组（x, y, z）。 */
export type Vec3 = [number, number, number]

/** 可空的三元组输入（URL/JSON 解码结果）。 */
export type NullableVec3 = Vec3 | null

/** 一帧渲染位姿（agent 交接 payload 中的 render/tick 样本）。 */
export interface RenderPose {
  pos: Vec3
  ang: Vec3
  /** 渲染锚点相对判定时刻的滞后（秒）。 */
  latency: number
  /** 渲染位与判定位之间的距离（米）。 */
  dist_to_judgment: number
}

/** 逐 tick 位姿样本。 */
export interface PoseTickSample {
  pos: Vec3
  yaw: number
  roll: number
  pitch?: number | null
  dt?: number
  /** 由渲染锚点补入的采样（滑块零点优先使用）。 */
  render?: boolean
}

/** 炮塔/炮管相对角时间线的一个 [dt, rad] 采样。 */
export type TimelineTuple = [number, number]

/** shot.quality 中客户端消费的降级标记。 */
export interface ShotQuality {
  gun_pitch_degraded?: string[] | null
  shell_from_terrain?: boolean | null
  shell_from_broadcast?: boolean | null
  shooter_pitch_from_velocity?: boolean | null
  shooter_pos_from_muzzle?: boolean | null
  target_dead?: boolean | null
  target_anchor_src?: 'nearest' | 'extrapolated' | 'filtered' | string | null
  turret_degraded?: string[] | null
  dmg_unattributed?: boolean | null
}

/** 脱靶弹着地形信息。 */
export interface TerrainImpact {
  impact_point: Vec3
  terminal_dir: Vec3
  material?: string | number | null
}

/** 装备效果载荷（弹/装甲/俯仰装置；回放交接原样透传）。 */
export type EquipmentSpec = Record<string, number | boolean | null>

/** 一次射击复现的交接 payload（Agent → viewer，字段见 agentData.fetchReplayShots）。 */
export interface ReplayShot {
  index: number
  target_tank_id?: number | null
  target_name?: string | null
  target_pos?: Vec3 | null
  target_ang?: Vec3 | null
  target_render?: RenderPose | null
  target_render_timeline?: Array<PoseTickSample & Record<number, number>> | null
  target_tick_samples?: PoseTickSample[] | null
  target_turret_yaw?: number | null
  target_gun_pitch?: number | null
  target_armor_state?: number | null
  target_equipment?: EquipmentSpec | null
  shooter_pos?: Vec3 | null
  shooter_ang?: Vec3 | null
  shooter_render?: RenderPose | null
  shooter_render_timeline?: Array<PoseTickSample & Record<number, number>> | null
  target_turret_timeline?: TimelineTuple[] | null
  target_gun_timeline?: TimelineTuple[] | null
  shooter_turret_timeline?: TimelineTuple[] | null
  shooter_gun_timeline?: TimelineTuple[] | null
  shooter_tick_samples?: PoseTickSample[] | null
  shooter_turret_yaw?: number | null
  shooter_gun_pitch?: number | null
  shooter_config_idx?: number | null
  shooter_equipment?: EquipmentSpec | null
  shooter_name?: string | null
  shooter_team?: string | null
  is_author?: boolean | null
  launch_velocity?: Vec3 | null
  ball_a?: Vec3 | null
  ball_b?: Vec3 | null
  tick_samples?: PoseTickSample[] | null
  damage?: number | null
  shell_id?: number | null
  shell_kind?: string | null
  shell_slot?: number | null
  shell?: ShellSpec | null
  segment?: unknown
  crit_modules?: number | null
  destroyed_modules?: number | null
  hit_flags?: number | null
  hit_token?: string | null
  server_part_index?: number | null
  game_hit_result?: number | null
  armor_group?: number | null
  quality?: ShotQuality | null
  terrain_impact?: TerrainImpact | null
  /** 折线中间点（mirrorShotData 同链镜像）。 */
  via?: Vec3[] | null
  aim_point?: Vec3 | null
  launch_point_rel?: Vec3 | null
  shooter_aim?: {
    turret_rel_yaw: number
    state_before?: number | null
    state_after?: number | null
  } | null
  /** 世界镜像幂等标记（viewerMath.mirrorShotData 写入）。 */
  __worldMirrored?: boolean
  [key: string]: unknown
}

/** 乘员/装备俯仰限制（tankSetup.pitchAtBearing 消费的扇区形状）。 */
export interface PitchSector {
  min: number
  max: number
  range: number
}

export interface PitchLimits {
  min: number
  max: number
  transition?: number | null
  front?: PitchSector | null
  back?: PitchSector | null
}

/** 炮塔水平射界（度，左负右正）。 */
export interface YawLimits {
  min: number
  max: number
}

/** 当前配置（tank/{id}.json configs[]）中 viewer 消费的字段。 */
export interface TankConfig extends TankArmorConfig {
  label?: string
  turret_name?: string
  caliber?: number
  yaw_limits?: YawLimits | null
  pitch_limits?: PitchLimits | null
  shells?: ShellSpec[]
  shell_global_ids?: number[] | null
}

/** 弹种参数（/api/shells 与 tank/{id}.json shells[] 同形状）。 */
export interface ShellSpec {
  name?: string
  type?: string
  type_id?: number | null
  caliber?: number | null
  damage?: number | null
  penetration?: number | null
  penetration_far?: number | null
  normalization?: number | null
  module_damage?: number | null
  ricochet?: number | null
  explosion_radius?: number | null
  [key: string]: unknown
}

/** 装甲模型声明（tank/{id}.json armor_model + config 派生）。 */
export interface ArmorModelDecl extends NonNullable<TankArmorData['armor_model']> {
  turret?: { plates?: Record<string, number | null>; spaced?: readonly (string | number)[] | null } | null
}

/** 部件碰撞盒（min/max 为模型系量化前的米制 AABB）。 */
export interface CollisionBox {
  min: Vec3
  max: Vec3
}

export interface CollisionBoxes {
  chassis?: CollisionBox
  hull?: CollisionBox
  turret?: CollisionBox
  gun?: CollisionBox
  [key: string]: CollisionBox | undefined
}

/** 单车数据（/api/tank/{id} / 资产包 tank/{id}.json）。 */
export interface TankData extends TankArmorData {
  tank_id?: number
  name?: string
  tier?: number
  type?: string
  nation?: string
  configs?: TankConfig[]
  model_url?: string | null
  visual_model_url: string
  armor_model?: ArmorModelDecl | null
  collision_boxes?: CollisionBoxes | null
  turret_traverse_left?: number | null
  turret_traverse_right?: number | null
  initial_turret_rotation?: { yaw: number; pitch: number; roll: number } | null
}

/** 动态装甲声明（collisionView resolveArmorStateDecl 解析结果）。 */
export interface ArmorStateDecl {
  states: Array<{ id: number; label?: string }>
  [key: string]: unknown
}

/** segment 判定射线（世界系）。 */
export interface SegmentRay {
  origin: THREE.Vector3
  dir: THREE.Vector3
  far: number
}

/** 实时炮口射线上下文（dataLoader 重跑权威判定时读取）。 */
export interface WorldTickCtx {
  launch?: THREE.Vector3 | null
  lvDir?: THREE.Vector3 | null
  lvSpd?: number | null
  rayFar: number
}

/** 片元交叉验证上下文（judgment/heatmap 消费）。 */
export interface ShotCtx {
  shot?: ReplayShot | null
  segArmorGroup?: number
  segShellId?: number
  segResult?: number
  eqShooter?: EquipmentSpec | null
  eqTarget?: EquipmentSpec | null
  fragValidated?: boolean
}

/** 射击调试面板记录（trajectoryCard 写入；允许不同模式扩展字段）。 */
export interface ArmorDebugRecord {
  card?: string
  chancePct?: number
  chancePartial?: boolean
  [key: string]: unknown
}

/** 世界 segment 标记句柄。 */
export interface WorldSegMk {
  update(visible: boolean): void
  p1: THREE.Object3D
  p2: THREE.Object3D
}

/** CPU 跳弹探针（diagnosticProbe 在 window.__armorRicochet 暴露的调试面）。 */
export interface ArmorRicochetProbe {
  info(): Record<string, unknown>
  predict(x: number, y: number): unknown
}

declare global {
  interface Window {
    // ---- 射击复现世界模式 ----
    __worldPan?: boolean
    __worldPenMode?: boolean
    __worldIsHE?: boolean
    __worldShellId?: number | null
    __worldShellSlot?: number | null
    __worldAnno?: THREE.Group | null
    __worldSegGroup?: THREE.Group | null
    __worldSegMk?: WorldSegMk | null
    __worldImpactMk?: THREE.Object3D | null
    __worldTickCtx?: WorldTickCtx | null
    __shotCtx?: ShotCtx
    __shotIsHit?: boolean
    __segRay?: SegmentRay | null
    __segBoxMissing?: boolean
    __segDiag?: Record<string, unknown> | null
    __fireGunDegT?: number
    // ---- 射手/受击方锚点与炮口 ----
    __shooterData?: TankData | null
    __shooterFix?: THREE.Vector3 | null
    __shooterModel?: THREE.Object3D | null
    __shooterGunNode?: THREE.Object3D | null
    __shooterMuzzleMk?: THREE.Mesh | null
    __shooterMuzzleLine?: THREE.Line | null
    __launchPointMk?: THREE.Object3D | null
    __shooterAnchor?: { mk: THREE.Mesh; color: string } | null
    __victimAnchor?: { mk: THREE.Mesh; color: string } | null
    __updateAnchorMarkers?: (() => void) | null
    __updateMuzzleMarker?: (() => void) | null
    __moveAnno?: THREE.Group | null
    __moveArrow?: THREE.ArrowHelper | null
    __moveVecArrow?: THREE.ArrowHelper | null
    updateMoveArrow?: ((idx: number) => void) | null
    // ---- 调试/命中标记 ----
    __debugOn?: boolean
    __debugSetVisible?: ((visible: boolean) => void) | null
    __hitMarker?: THREE.Object3D | null
    __hitMarkerRing?: THREE.Object3D | null
    __armorDebugLast?: ArmorDebugRecord
    __heCardDebug?: Record<string, unknown> | null
    __armorRicochet?: ArmorRicochetProbe | null
    __DBG__?: Record<string, unknown> | null
    __LOAD__?: string | null
    __dbgGroup?: THREE.Group | null
    __endMarker?: THREE.Object3D | null
  }
}
