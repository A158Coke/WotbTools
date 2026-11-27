import type * as THREE from 'three'
import type { TankArmorConfig, TankArmorData } from './armorPlateModel.js'
import type { TankMechanic } from '../tankMechanics'

export type Vec3 = [number, number, number]

export type NullableVec3 = Vec3 | null

export interface RenderPose {
  pos: Vec3
  ang: Vec3
  latency: number
  dist_to_judgment: number
}

export interface PoseTickSample {
  pos: Vec3
  yaw: number
  roll: number
  pitch?: number | null
  dt?: number
  render?: boolean
}

export type TimelineTuple = [number, number]

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

export interface TerrainImpact {
  impact_point: Vec3
  terminal_dir: Vec3
  material?: string | number | null
}

export type EquipmentSpec = Record<string, number | boolean | null>

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
  via?: Vec3[] | null
  aim_point?: Vec3 | null
  launch_point_rel?: Vec3 | null
  shooter_aim?: {
    turret_rel_yaw: number
    state_before?: number | null
    state_after?: number | null
  } | null
  __worldMirrored?: boolean
  [key: string]: unknown
}

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

export interface YawLimits {
  min: number
  max: number
}

export interface TankConfig extends TankArmorConfig {
  label?: string
  turret_name?: string
  caliber?: number
  yaw_limits?: YawLimits | null
  pitch_limits?: PitchLimits | null
  shells?: ShellSpec[]
  shell_global_ids?: number[] | null
}

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

export interface ArmorModelDecl extends NonNullable<TankArmorData['armor_model']> {
  turret?: { plates?: Record<string, number | null>; spaced?: readonly (string | number)[] | null } | null
}

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

export interface TankData extends TankArmorData {
  tank_id?: number
  name?: string
  tier?: number
  type?: string
  nation?: string
  configs?: TankConfig[]
  mechanics?: TankMechanic[] | null
  model_url?: string | null
  visual_model_url: string
  armor_model?: ArmorModelDecl | null
  collision_boxes?: CollisionBoxes | null
  turret_traverse_left?: number | null
  turret_traverse_right?: number | null
  initial_turret_rotation?: { yaw: number; pitch: number; roll: number } | null
}

export interface ArmorStateDecl {
  states: Array<{ id: number; label?: string }>
  [key: string]: unknown
}

export interface SegmentRay {
  origin: THREE.Vector3
  dir: THREE.Vector3
  far: number
}

export interface WorldTickCtx {
  launch?: THREE.Vector3 | null
  lvDir?: THREE.Vector3 | null
  lvSpd?: number | null
  rayFar: number
}

export interface ShotCtx {
  shot?: ReplayShot | null
  segArmorGroup?: number
  segShellId?: number
  segResult?: number
  eqShooter?: EquipmentSpec | null
  eqTarget?: EquipmentSpec | null
  fragValidated?: boolean | null
}

export interface ArmorDebugRecord {
  card?: string
  chancePct?: number
  chancePartial?: boolean
  [key: string]: unknown
}

export interface WorldSegMk {
  update(visible: boolean): void
  p1: THREE.Object3D
  p2: THREE.Object3D
}

export interface ArmorRicochetProbe {
  info(): Record<string, unknown>
  predict(x: number, y: number): unknown
}

declare global {
  interface Window {
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
    __debugOn?: boolean
    __debugSetVisible?: ((visible: boolean) => void) | null
    __hitMarker?: THREE.Object3D | null
    __armorDebugLast?: ArmorDebugRecord
    __heCardDebug?: Record<string, unknown> | null
    __armorRicochet?: ArmorRicochetProbe | null
    __DBG__?: Record<string, unknown> | null
    __LOAD__?: string | null
    __dbgGroup?: THREE.Group | null
    __endMarker?: THREE.Object3D | null
  }
}
