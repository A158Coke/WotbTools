import * as THREE from 'three'
import type { GlbParts, GlbStaticData } from './glbParts.js'
import type { DestroyedLifeEvidence, TankDestroyedVisual } from '../tankDestroyedVisual.js'
import type { LastKnownPose } from './lastKnown.js'
import type { PoseGrid, PoseDef } from '../../replay-local/pose/vehiclePose.js'
import type { TankContactShadows } from './tankContactShadows.js'
import type { TrailState } from '../treadMarks.js'

export interface SuspensionJson {
  wheels: number[][]
  chains: { left: number[][][]; right: number[][][] }
  track_bending?: { upper_factor?: number; length_power?: number } | null
  wheels_reaction_speed?: number | null
  [key: string]: unknown
}

export interface RuntimeVehicleDef extends PoseDef {
  eid: number
  account_id: number
  tank_id: number
  team?: number | null
  coverage?: number[]
  death_t: number | null
  death_times?: number[]
  resurrection_times?: number[]
  suspReaction?: number | null
  turret_index?: number | null
  gun_index?: number | null
  is_author?: boolean
  nickname?: string
  tank_name?: string
  max_hp?: number
  hp?: Array<[number, number]>
  equipment?: unknown
  [key: string]: unknown
}

export interface DetachedTurretTrack {
  vehicle_eid: number
  coverage: ArrayLike<number>
  pose_kf: Record<'t' | 'pos' | 'yaw' | 'pitch' | 'roll', ArrayLike<number>>
  [key: string]: unknown
}

export interface DetachedTurret {
  track: DetachedTurretTrack
  root: THREE.Group
  proxy: THREE.Group
  proxyVisual: TankDestroyedVisual
  glb: THREE.Object3D | null
  glbVisual: TankDestroyedVisual | null
}

export interface TickPose {
  t: number; x: number; y: number; z: number; yaw: number; pitch: number; roll: number; turretAbs: number; gunPitch: number
}

export interface SuspensionWheelPart {
  node: THREE.Object3D
  flag: number
  up: number
  down: number
  radius: number
  centerHull: THREE.Vector3
  travelAxis: THREE.Vector3
  upHull: THREE.Vector3
  pivot: THREE.Vector3
  restPivotRot: THREE.Vector3
  restPos: THREE.Vector3
  restQuat: THREE.Quaternion
  travel: number
  spin: number
}

export interface SuspensionTrackPart {
  node: THREE.Object3D
  parts: Array<{
    mesh: THREE.Mesh
    posAttr: THREE.BufferAttribute
    basePos: Float32Array
    params: { seg: Int32Array; t: Float32Array }
    axis3: [number, number, number]
    uvAttr: THREE.BufferAttribute | null
    uvBase: Float32Array | null
    appliedUv: number
  }>
  chain: Array<[number, number]>
  restZ: number[]
  attach: Int32Array
  spans: number[] | null
  wheelCfg: Array<{ longitudinal: number; centerZ: number; radius: number }>
  lateral: number
  beltW: number
  groundDrop: Float64Array
  chainZ: Float64Array
  appliedChainZ: Float64Array | null
  normalChainZ: Float64Array | null
  dvPerM: number
  uv: number
}

export interface SuspensionSide {
  wheels: SuspensionWheelPart[]
  tracks: SuspensionTrackPart[]
  wheelDelta: Float64Array
  halfW: number
  beltW: number
  prev: THREE.Vector3 | null
}

export interface SuspensionParts {
  sides: Partial<Record<'L' | 'R', SuspensionSide>>
  disposables: Array<{ dispose(): void }>
  bend: { upper_factor?: number; length_power?: number } | null
}

export interface RuntimeVehicle {
  def: RuntimeVehicleDef
  group: THREE.Group
  turretG: THREE.Group
  gunPivot: THREE.Group
  meshHull: THREE.Mesh
  hullGroup: THREE.Group
  glb?: THREE.Object3D | null
  glbParts?: GlbParts | null
  suspParts?: SuspensionParts | null
  tickPose?: TickPose | null
  detachedTurrets: DetachedTurret[]
  proxyVisual: TankDestroyedVisual | null
  glbVisual: TankDestroyedVisual | null
  labelAnchor: THREE.Vector3
  labelOccluded?: boolean
  lastKnownPose: LastKnownPose | null; lastReplaced?: boolean
  lastKnownAt: number
  lastKnownProxy: THREE.Mesh | null
  trail: { L: TrailState; R: TrailState; builtT: number } | null
  tread: TreadRuntimeParams | null
  treadMesh: THREE.Mesh | null
  tankData?: GlbStaticData | null
  [key: string]: unknown
}

export interface TreadRuntimeParams {
  texture: string
  width: number
  space: number
  authoredWidth: boolean
  texScale: number
  [key: string]: unknown
}

export interface VehicleRuntimeData {
  vehicles: RuntimeVehicleDef[]
  detached_turrets?: DetachedTurretTrack[] | null
  [key: string]: unknown
}

export interface GlbCacheEntry {
  template: THREE.Object3D
  sd: GlbStaticData | null
  susp: SuspensionJson | null
}

export interface VehicleRuntimeDeps {
  store: { glbOn: boolean; lastKnownOn: boolean }
  destroyed(): boolean
  sessionGen(): number
  getScene(): THREE.Scene | null
  getT(): number
  getData(): VehicleRuntimeData | null
  teamColor(v: { def: RuntimeVehicleDef }): number
  quality(): { treadMarks?: boolean }
  classIconsVisible(): boolean
  showMarkerStatus(): boolean
  invalidate(): void
  onModelChanged?(eid: number): void
  visibleAt(v: RuntimeVehicle, t: number): boolean
  replacedAt?(eid: number, t: number): boolean
  sceneLifeAt(v: RuntimeVehicle, t: number): DestroyedLifeEvidence | null
  sampleHeight(x: number, z: number): number
  treadAttachVehicle(v: RuntimeVehicle): void
  disposeObject3D(root: unknown): void
  poseGrid: PoseGrid
  visByEid(): Map<number, number[]>
  contactShadows(): TankContactShadows | null
  scopedHiddenEid(): number
  perfAdd?(key: string, ms: number, count?: number): void
}

export interface VehicleRuntimeHandle {
  getVehicles(): RuntimeVehicle[]
  buildVehicles(): void
  loadGlb(tankId: number): Promise<GlbCacheEntry | null>
  applyGlbToggle(on: boolean): Promise<void>
  glbOn(): boolean
  setLowPoly(v: RuntimeVehicle, show: boolean): void
  applyPose(v: RuntimeVehicle): void
  applyDetachedTurrets(v: RuntimeVehicle): void
  poseGlbRig(v: RuntimeVehicle, t: number, pos: THREE.Vector3): void
  glbGunWorld(v: RuntimeVehicle, pos: THREE.Vector3, dir: THREE.Vector3): boolean
  posAt(v: RuntimeVehicle, t: number, out: THREE.Vector3): THREE.Vector3
  yawAt(v: RuntimeVehicle, t: number): number
  hullPitchAt(v: RuntimeVehicle, t: number): number
  turretAbsAt(v: RuntimeVehicle, t: number): number
  gunPitchAt(v: RuntimeVehicle, t: number): number
  rollAt(v: RuntimeVehicle, t: number): number
  vehicleByEid(eid: number): RuntimeVehicle | undefined
  frameTiming(dt: number, snap: boolean): void
  markSeekSnap(): void
  clearSnap(): void
  dispose(): void
  syncContactShadow(v: RuntimeVehicle): void
}

