// 车辆运行时的类型面（RuntimeVehicle/def/悬挂部件/Glb 缓存/deps/handle）——自
// vehicleRuntime.ts 出仓（2026-11-21 #LOC 结构拆分：代码与搬移前逐字一致；公共入口仍由
// vehicleRuntime re-export）。
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

/** 车辆定义面（位姿列 PoseDef + 渲染运行时消费的字段；其余字段走索引签名）。 */
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

/** 分离炮塔轨道（DATA.detached_turrets 条目；位姿采样面见 trackInterp.sampleDetachedPose）。 */
export interface DetachedTurretTrack {
  vehicle_eid: number
  coverage: ArrayLike<number>
  pose_kf: Record<'t' | 'pos' | 'yaw' | 'pitch' | 'roll', ArrayLike<number>>
  [key: string]: unknown
}

/** 分离炮塔运行时（低模代理 + GLB 克隆双形态；宿主击毁着色/可见性共用同一事实）。 */
export interface DetachedTurret {
  track: DetachedTurretTrack
  root: THREE.Group
  proxy: THREE.Group
  proxyVisual: TankDestroyedVisual
  glb: THREE.Object3D | null
  glbVisual: TankDestroyedVisual | null
}

/** 每车「最近一次采样」缓存（applyPose 一帧内多通道采样记忆化，见 poseStash 注释）。 */
export interface TickPose {
  t: number; x: number; y: number; z: number; yaw: number; pitch: number; roll: number; turretAbs: number; gunPitch: number
}

/** 悬挂负重轮运行时（解算状态逐轮持有；见 collectSuspensionParts）。 */
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

/** 悬挂单条履带运行时（链路解算 + 逐顶点形变 + 花纹滚动状态）。 */
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
  /** 悬空段边界（挂接点 ∪ 链点 flag 的升序索引）；null = 沿用历史的「相邻挂接点」口径 */
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

/** 悬挂单侧（轮 + 带；halfW/beltW 为履带印宽度解析的消费面）。 */
export interface SuspensionSide {
  wheels: SuspensionWheelPart[]
  tracks: SuspensionTrackPart[]
  wheelDelta: Float64Array
  halfW: number
  beltW: number
  prev: THREE.Vector3 | null
}

/** collectSuspensionParts 产物（v.suspParts；数据缺失 → null 回落刚体）。 */
export interface SuspensionParts {
  sides: Partial<Record<'L' | 'R', SuspensionSide>>
  disposables: Array<{ dispose(): void }>
  bend: { upper_factor?: number; length_power?: number } | null
}

/** 车辆运行时对象（v；宿主与 treadRuntime 经同一形状消费）。 */
export interface RuntimeVehicle {
  def: RuntimeVehicleDef
  group: THREE.Group
  turretG: THREE.Group
  gunPivot: THREE.Group
  meshHull: THREE.Mesh
  hullGroup: THREE.Group
  /** 原语义：字段在首次赋值前**不存在**（undefined），不得初始化为 null——契约测试锁定。 */
  glb?: THREE.Object3D | null
  glbParts?: GlbParts | null
  suspParts?: SuspensionParts | null
  tickPose?: TickPose | null
  detachedTurrets: DetachedTurret[]
  proxyVisual: TankDestroyedVisual | null
  glbVisual: TankDestroyedVisual | null
  labelAnchor: THREE.Vector3
  labelOccluded?: boolean
  /**
   * 最后已知位姿（可视性诚实呈现，语义见 scene/playback/lastKnown.ts）：applyPose 逐帧维护，
   * **在场时刻恒 null**（正常呈现）；不在场 = 末段末采样（协议 AoI 判别，纯函数），memo 按 t。
   * labelsRuntime 读它做幽灵名牌锚点；呈现开关 = store.lastKnownOn（只门控呈现，不改计算）。
   */
  lastKnownPose: LastKnownPose | null; lastReplaced?: boolean
  /** 上次 lastKnownPose 计算的回放时刻（memo 键；NaN = 尚未计算） */
  lastKnownAt: number
  /** 最后已知位置的半透明低模代理（盒体几何复用 trackGeo；teardown 随 dispose 释放） */
  lastKnownProxy: THREE.Mesh | null
  /** 履带印路径累积态（左右各一条；builtT = 已铺到的回放时刻，-∞ = 待全量重算） */
  trail: { L: TrailState; R: TrailState; builtT: number } | null
  tread: TreadRuntimeParams | null
  treadMesh: THREE.Mesh | null
  tankData?: GlbStaticData | null
  [key: string]: unknown
}

/** 履带印逐车参数（treadRuntime 写入；本模块只透传/读 width/space/texture/texScale）。 */
export interface TreadRuntimeParams {
  texture: string
  width: number
  space: number
  authoredWidth: boolean
  texScale: number
  [key: string]: unknown
}

/** 本模块消费的回放数据面（车队定义 + 分离炮塔轨道）。 */
export interface VehicleRuntimeData {
  vehicles: RuntimeVehicleDef[]
  detached_turrets?: DetachedTurretTrack[] | null
  [key: string]: unknown
}

/** GLB 模板缓存条目（session-scoped；teardown 一次性释放 unique shared resources）。 */
export interface GlbCacheEntry {
  template: THREE.Object3D
  sd: GlbStaticData | null
  susp: SuspensionJson | null
}

/** 宿主注入的依赖（getter 快照；语义见各字段处原文注释）。 */
export interface VehicleRuntimeDeps {
  /** 宿主 store 的 GLB 开关投影（applyGlbToggle 双写：内部态 + store）。 */
  store: { glbOn: boolean; lastKnownOn: boolean }
  /** 实例是否已 destroy。 */
  destroyed(): boolean
  /** 会话加载代数（applyGlbToggle 的迟到守卫；owner 在 sessionLifecycle）。 */
  sessionGen(): number
  getScene(): THREE.Scene | null
  /** 回放时钟（宿主唯一 owner；姿态/GUN 世界位姿按它采样）。 */
  getT(): number
  /** 当前会话回放数据（DATA 读取面；宿主唯一 owner）。 */
  getData(): VehicleRuntimeData | null
  /** 阵营色（HOST-owned：唯一事实源在宿主调色板）。 */
  teamColor(v: { def: RuntimeVehicleDef }): number
  /** 画质档（宿主持有 QUALITY_PRESETS 解析结果；本模块只读履带印开关）。 */
  quality(): { treadMarks?: boolean }
  /** 类型图标替换模式（宿主标签偏好派生）。 */
  classIconsVisible(): boolean
  /** 作者标记环显隐（宿主标签偏好）。 */
  showMarkerStatus(): boolean
  invalidate(): void
  /** 协议精确可见性（canonical 事实 owner = 宿主 visibleAt）。 */
  visibleAt(v: RuntimeVehicle, t: number): boolean
  /** 当前时刻的实体身份替换判据（同账号后继实体已接管；canonical 证据 owner = 宿主）。
   *  缺省时回退到 coverage 段序的纯函数判据（replacedBySuccessorAt）。 */
  replacedAt?(eid: number, t: number): boolean
  /** 场景死亡判据（canonical 事实 owner = 宿主 sceneLifeAt）。 */
  sceneLifeAt(v: RuntimeVehicle, t: number): DestroyedLifeEvidence | null
  /** 地形高度采样（owner = mapWorld）。 */
  sampleHeight(x: number, z: number): number
  /** 履带印逐车装配（treadRuntime.attachVehicle；宿主晚绑定注入）。 */
  treadAttachVehicle(v: RuntimeVehicle): void
  /** Object3D 子树递归 dispose（宿主实现）。 */
  disposeObject3D(root: unknown): void
  /** 共享位姿网格时间轴（宿主唯一 owner；按引用共享同一可变对象）。 */
  poseGrid: PoseGrid
  /** 协议精确 AoI 段（宿主唯一 owner 的 VIS_BY_EID 读取）。 */
  visByEid(): Map<number, number[]>
  /** 坦克接地阴影句柄（#907 主干随迁；null = 未启用，所有调用点空转）。 */
  contactShadows(): TankContactShadows | null
  /** 开镜隐藏的本车 eid（owner = cameraRuntime；阴影随开镜隐藏）。 */
  scopedHiddenEid(): number
  /** ?perf 车辆阶段归因（可选）：key 是 applyPose 内的子区间，父区间 vehiclePoseMs
   *  由调用方单独统计——父子不得相加；count 记录候选/绘制数量。生产评分不传入。 */
  perfAdd?(key: string, ms: number, count?: number): void
}

/** 车辆运行时对外句柄（宿主与 treadRuntime 的唯一消费面）。 */
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
  /** animate 逐帧：suspDt = dt; suspSnap = snap（原两行赋值的等价入口）。 */
  frameTiming(dt: number, snap: boolean): void
  /** seekTo：suspSnap = true; suspDt = 0（跳变：行程吸附、侧位移不积分）。 */
  markSeekSnap(): void
  /** tick 的 applyPose 循环消费掉 seek snap 后清位。 */
  clearSnap(): void
  /** 会话 teardown：车辆循环（分离炮塔/GLB/悬挂几何/低模组）+ GLB 模板缓存释放 + V = []。 */
  dispose(): void
  /** 阴影同步（宿主 setLabelPrefs 循环消费；实现见 syncContactShadow）。 */
  syncContactShadow(v: RuntimeVehicle): void
}

/** 最后已知代理的底盘盒中心相对记录位姿的抬升（= 低模履带盒在 group 内的 position.y，同高对齐）。 */
