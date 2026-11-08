// 车辆运行时 owner（#820 结构拆分，2026-11-05 自 initPlayback 闭包出仓）：
// 低模车体装配（buildVehicles）、位姿采样缓存（poseStash / posAt / yawAt / …）、
// GLB 真实车模装载与开关（loadGlb / applyGlbToggle）、悬挂求解（collectSuspensionParts /
// suspensionStep）、GLB 逐帧姿态（poseGlb / poseGlbRig / glbTurretMatrix / glbGunWorld）、
// 飞炮塔分离呈现（detachmentAppliesNow / applyDetachedTurrets）、击毁着色应用（applyPose）
// 与车辆会话 teardown（dispose：车辆循环 + GLB 模板缓存释放）的唯一归属。
// 代码与搬移前逐字一致；闭包读数改经 deps 注入（getter 快照）。canonical 生命事实
//（sceneLifeAt / visibleAt / hpAt）仍归宿主，本模块经 deps 消费；履带印逐车装配块
//（原 buildVehicles 的 tread 段）经 deps.treadAttachVehicle 委托给 treadRuntime，
// buildVehicles 保持 tread-free。
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import {
  poseFromYPR, yprScene, cloneDetachedTurret, neutralizeDefaultMetalness, dropDuplicateGunMasks,
} from '../glbRig.js'
import { collectGlbParts } from './glbParts.js'
import type { GlbParts, GlbStaticData } from './glbParts.js'
import { resolveMountedConfig } from '../reloadBar.js'
import type { TankJsonLike } from '../reloadBar.js'
import {
  applyTankDestroyedVisual, destroyedVisualAmount, disposeTankDestroyedVisual, prepareTankDestroyedVisual,
} from '../tankDestroyedVisual.js'
import type { DestroyedLifeEvidence, TankDestroyedVisual } from '../tankDestroyedVisual.js'
import { sampleDetachedPose } from '../trackInterp.js'
import { sampleVehiclePoseGame } from '../../replay-local/pose/vehiclePose.js'
import type { PoseGrid, PoseDef, VehiclePoseGame } from '../../replay-local/pose/vehiclePose.js'
import {
  clampTravel, rateLimitTravel, spinStep, treadScrollStep, groundDropLocal,
  attachChainToWheels, solveChain, vertexChainParams, applyChainToVertices, chainChanged, chainDrift, sideTravel,
  parseWheelNodeName, parseTrackNodeName, wheelRadiusFromExtents,
  applyWheelSpin, measureBeltUvSlope, chainBottomRunDir, writeUvOffsetV,
} from '../suspension.js'
import { markPickBoundsStale } from './armorHighlight.js'
import { measureShadowFootprint } from './tankContactShadows.js'
import type { TankContactShadows } from './tankContactShadows.js'
import { ASSET_CONCURRENCY, mapLimit } from './util.js'
import { assetProvider } from '../assetProvider.js'
import { createTrailState } from '../treadMarks.js'
import type { TrailState } from '../treadMarks.js'

/** 资产平面 suspension/{tank_id}.json 的消费面（缺失/404 → null，整车回落刚体）。 */
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
  store: { glbOn: boolean }
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

export function createVehicleRuntime(deps: VehicleRuntimeDeps): VehicleRuntimeHandle {
  let V: RuntimeVehicle[] = [];      // 车辆运行时 {def, group, turretG, gunPivot, labelAnchor, meshHull, glb}
  let glbCache = new Map<number, Promise<GlbCacheEntry | null>>(), glbOn = false;
  let suspDt = 0;          // 本帧 dt（0 = seek/跳变 ⇒ 行程限速退化为吸附）
  let suspSnap = false;    // 本 tick 为跳变（seek）：行程吸附、侧位移不积分

  const wrapPi = (a: number) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

  // 位姿求值：**唯一实现**在 `replay-local/pose/vehiclePose.ts`（2D 俯视与 3D 场景共用）——
  // 含 `pose_kf` 关键帧优先 / 10Hz 网格回退、以及炮塔绝对角 → 相对角的换算。
  // 本处只施加「场景系 = 游戏系 x 取负」的帧变换（符号约定见 glbRig.js 头注释）；
  // 车体侧倾 hull_roll 取自原始 type=10 volatile（滤波层不输出侧倾），旧产物缺列 → 0。
  const poseOf = (v: RuntimeVehicle, t: number) => sampleVehiclePoseGame(
    v.def, deps.poseGrid, t, _poseOut, deps.visByEid().get(v.def.eid) ?? v.def.coverage,
  );
  // 位姿采样复用对象（每帧多车高频调用，零分配）
  const _poseOut: VehiclePoseGame = {
    x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, turretAbs: 0, turretRel: 0, gunPitch: 0,
  };
  // 每车「最近一次采样」缓存：applyPose 一帧内经 yawAt/hullPitchAt/rollAt/turretAbsAt/
  // gunPitchAt/posAt 对同一 (v, T) 触发 13 次全通道采样（网格插值 + 闭包分配 ×13 ≈ 纯
  // 重复）。采样是纯函数（grid/def/VIS_BY_EID 均只在数据/会话边界重建，tick 内不变），
  // 按 (车, t) 记忆后一帧只采一次；flushMuzzles 等以任意 t 摆位姿的调用点自动因 t 不匹配
  // 重采样，语义不变。
  function poseStash(v: RuntimeVehicle, t: number) {
    const s = v.tickPose || (v.tickPose = { t: NaN, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, turretAbs: 0, gunPitch: 0 });
    if (s.t !== t) {
      const p = poseOf(v, t);
      s.t = t;
      s.x = p.x; s.y = p.y; s.z = p.z;
      s.yaw = p.yaw; s.pitch = p.pitch; s.roll = p.roll;
      s.turretAbs = p.turretAbs; s.gunPitch = p.gunPitch;
    }
    return s;
  }
  function posAt(v: RuntimeVehicle, t: number, out: THREE.Vector3) {
    const p = poseStash(v, t);
    out.set(-p.x, p.y, p.z);
    return out;
  }
  function yawAt(v: RuntimeVehicle, t: number) { return poseStash(v, t).yaw; }
  function hullPitchAt(v: RuntimeVehicle, t: number) { return poseStash(v, t).pitch; }
  function turretAbsAt(v: RuntimeVehicle, t: number) { return poseStash(v, t).turretAbs; }
  function gunPitchAt(v: RuntimeVehicle, t: number) { return poseStash(v, t).gunPitch; }
  const rollAt = (v: RuntimeVehicle, t: number) => poseStash(v, t).roll;

  function buildVehicles() {
    const data = deps.getData();
    if (!data) return;
    const scene = deps.getScene();
    if (!scene) return;
    // 低模车体：俯视六边形轮廓（平尾 + 尖首）挤压成棱柱，配合尾部散热格栅——
    // 炮管之外的第二重车头方向提示（GLB 关闭时的代理模型）
    const hullProfile = new THREE.Shape();
    hullProfile.moveTo(-1.6, -3.1);   // 左后
    hullProfile.lineTo(1.6, -3.1);    // 右后（尾部平直）
    hullProfile.lineTo(1.6, 1.15);    // 右舷
    hullProfile.lineTo(0, 3.1);       // 车首尖点（+z = 车头，与炮管同向）
    hullProfile.lineTo(-1.6, 1.15);   // 左舷
    hullProfile.closePath();
    const hullGeo = new THREE.ExtrudeGeometry(hullProfile, { depth: 1.05, bevelEnabled: false });
    hullGeo.rotateX(Math.PI / 2);     // 轮廓 y（车首方向）→ 世界 +z，挤出方向翻向 −y
    hullGeo.translate(0, 1.45, 0);    // 车体占 y ∈ [0.40, 1.45]（顶面接炮塔底）
    const trackGeo = new THREE.BoxGeometry(3.6, 0.75, 6.5);
    const turretGeo = new THREE.BoxGeometry(2.35, 0.85, 3.3);
    const gunGeo = new THREE.CylinderGeometry(0.14, 0.18, 5.4, 8);
    const grilleGeo = new THREE.BoxGeometry(2.0, 0.4, 0.5);
    for (const def of data.vehicles) {
      const color = deps.teamColor({ def });
      const g = new THREE.Group(); g.userData.eid = def.eid;
      const hull = new THREE.Mesh(hullGeo, new THREE.MeshLambertMaterial({ color }));
      const tracks = new THREE.Mesh(trackGeo, new THREE.MeshLambertMaterial({ color: 0x333a44 })); tracks.position.y = 0.42;
      const grille = new THREE.Mesh(grilleGeo, new THREE.MeshLambertMaterial({ color: 0x272e38 })); grille.position.set(0, 1.62, -2.8);
      const turretG = new THREE.Group(); turretG.position.y = 1.85;
      const turret = new THREE.Mesh(turretGeo, new THREE.MeshLambertMaterial({ color: new THREE.Color(color).multiplyScalar(1.15) }));
      turret.position.z = -0.25;
      const gunPivot = new THREE.Group(); gunPivot.position.set(0, 0.05, 1.5);
      const gun = new THREE.Mesh(gunGeo, new THREE.MeshLambertMaterial({ color: 0x59636f }));
      gun.rotation.x = Math.PI / 2; gun.position.z = 2.4;
      gunPivot.add(gun); turretG.add(turret); turretG.add(gunPivot);
      // 低模侧同构：履带盒留组根、hull/grille/turretG 收进 __hullGroup（悬挂挂点，恒单位）
      const hullG = new THREE.Group(); hullG.name = '__hullGroup';
      hullG.add(hull); hullG.add(grille); hullG.add(turretG);
      g.add(tracks); g.add(hullG);
      if (def.is_author) {
        const ring = new THREE.Mesh(new THREE.RingGeometry(3.6, 4.3, 32),
          new THREE.MeshBasicMaterial({ color: 0xe8b23c, side: THREE.DoubleSide, transparent: true,
                                        opacity: .85, toneMapped: false }));
        ring.rotation.x = -Math.PI / 2; ring.position.y = 0.06;
        ring.userData.keepWithGlb = true;   // GLB 模式下保留作者标记环
        g.add(ring);
      }
      const v: RuntimeVehicle = { def, group: g, turretG, gunPivot, meshHull: hull, hullGroup: hullG,
        detachedTurrets: [], proxyVisual: null, glbVisual: null,
        labelAnchor: new THREE.Vector3(), trail: null, tread: null, treadMesh: null };
      // Capture clean proxy materials before the vehicle receives its wreck shader.
      v.detachedTurrets = (data.detached_turrets || []).filter(track => track.vehicle_eid === def.eid).map(track => {
        const root = new THREE.Group(); root.userData.eid = def.eid;
        const proxy = turretG.clone();
        proxy.position.set(0, 0, 0); proxy.quaternion.identity();
        // turretG is constructed immediately above as [turret mesh, gunPivot].
        proxy.children[1].rotation.x = -gunPitchAt(v, track.pose_kf.t[0]);
        root.add(proxy); root.visible = false; scene.add(root);
        return { track, root, proxy, proxyVisual: prepareTankDestroyedVisual(proxy), glb: null, glbVisual: null };
      });
      v.proxyVisual = prepareTankDestroyedVisual(g, { cloneMaterials: false });
      v.labelAnchor = new THREE.Vector3();
      // 履带印路径累积态（左右各一条；builtT = 已铺到的回放时刻，-∞ = 待全量重算）
      v.trail = { L: createTrailState(), R: createTrailState(), builtT: -Infinity };
      v.tread = null; v.treadMesh = null;
      // 履带印逐车装配（owner = treadRuntime；本模块保持 tread-free，#820 Step 4）
      if (deps.quality().treadMarks) deps.treadAttachVehicle(v);
      scene.add(g);
      V.push(v);
      setLowPoly(v, true);
    }
  }

  // ---------- GLB 真实车模 ----------
  // 姿态处理与装甲查看器 world 模式（poseFromYPR / poseShooterTurretGun）同构：
  // - GLB 内部系 x右/y前/z上（models.pb 原点已按 (x,z,y) 校正到该系）；根位姿 = qYaw·qPitch·qRoll·qFrame，
  //   qFrame = Ry(π)·Rx(−π/2) 的 z-up→y-up 帧变换；yaw 传镜像值（−游戏 yaw），pitch 原值，roll 滤波层恒 0；
  // - 炮塔/炮管 = 烘焙矩阵绕枢轴旋转：炮塔 Rz(−rel)（镜像系）@ tP=track+turret，炮管 Rx(俯仰)@ gP=tP+gun_origin；
  // - 部件数据（model_origins / configs[].gun_origin / initial_turret_rotation）来自资产平面 tank/{id}.json
  //  （WotBTools client-only：dump-tank-data 物化，与上游 /api/tank/{id} 同一形状）。

  async function loadGlb(tankId: number): Promise<GlbCacheEntry | null> {
    // 捕获当前会话的缓存实例：会话结束后迟到的完成写入旧 Map（已脱离新会话），
    // 不污染新会话缓存；teardown 时在册的 Promise 已被挂 then(dispose)——迟到
    // 模板到达即销毁，teardown 后才创建的残余随旧 Map GC
    const cache = glbCache;
    if (cache.has(tankId)) return cache.get(tankId)!;
    const p = (async (): Promise<GlbCacheEntry | null> => {
      try {
        const [glbBytes, sd, susp] = await Promise.all([
          assetProvider.bytes(`/glb/${tankId}/model.glb`),
          assetProvider.json<GlbStaticData | null>(`/tank/${tankId}.json`).catch(() => null),
          // 逐车悬挂数据（additive：tools/export_tank_suspension.py 产物；缺失/404 → null，
          // 整车回落刚体——与"该车客户端无悬挂数据"同路）
          assetProvider.json<SuspensionJson | null>(`/suspension/${tankId}.json`).catch(() => null),
        ]);
        // GLTFLoader.parse：bytes 经 provider（storage/network 与场景解耦），
        // GLB 自包含无外部资源，resourcePath 无关紧要
        const model = await new Promise<THREE.Object3D | null>((res) =>
          new GLTFLoader().parse(glbBytes.buffer as ArrayBuffer, '', (g) => res(g.scene), () => res(null)));
        if (!model) {
          console.warn('[playback] 坦克 GLB 解析返回空 tank_id=' + tankId)
          return null
        }
        model.scale.setScalar(1);
        // 老式车（无 metallicRoughness 贴图）金属度归零——否则无环境贴图下发黑；
        // 在模板上做一次，逐车 clone 共享材质即随带（见 glbRig.js）
        neutralizeDefaultMetalness(model);
        // 同名几何副本去重：Maus 的根级 mask_01 与 gun_01_mask 是同一块炮盾（实测唯一一台），
        // rig 不摆位 mask_NN → 炮塔转走后它会留在原地（见 glbRig.dropDuplicateGunMasks）
        dropDuplicateGunMasks(model);
        // hide_elements 拆件全部渲染（与装甲检视器同规则；位于部件子树内，姿态随父节点自动跟随）
        // 缓存模板 + 部件数据（sd）；每车实例化时 clone 并重收集节点引用
        //（同 tank_id 多车共用一个实例会互相抢对象、位姿互覆盖）
        return { template: model, sd, susp };
      } catch (e) {
        // 静默失败是"切真实车模后没有车"这类报障无从定位的根因（2026-10-09 实测）：
        // 资产 404 / 解析异常 / 模板处理抛错都落在这里，必须留痕（含 tank_id 与原始错误）
        console.warn('[playback] 坦克 GLB 加载失败 tank_id=' + tankId + ':', e)
        return null
      }
    })();
    cache.set(tankId, p);
    // 负结果不入缓存：失败（404/解析失败）只影响本次，资产补位后下次切换即可重试——
    // 缓存 null 会毒化整个会话（transient 缺资产被永久记住）
    p.then((entry) => { if (!entry) cache.delete(tankId); }).catch(() => cache.delete(tankId));
    return p;
  }

  // ---------- 悬挂求解（轮/带逐帧解算，客户端同构） ----------
  // 依据：上游 `docs/tank-suspension-client-re.md` §六（第二轮反汇编）。与客户端逐条对应：
  //   · 负重轮（`chassis_wheel_{L,R}_NN`，yaml `wheels` 记录 1:1）= **纯竖直平移**，夹到
  //     `[pz−b, pz+a]`、按 `wheelsReactionSpeed` 限速、首次可见直接吸附；`flag=0`
  //     （诱导/主动/托带轮）不参与贴地解算（但照常自转）。
  //   · 自转 = 绕轮节点**局部 X 轴** `θ += −Δs_侧 / r`；Δs_侧 = 该侧履带接触线中心的纵向
  //     位移（左右各算 ⇒ 转向差速自动成立）。
  //   · 履带（`chassis_track_{L,R}`，多段模型为 `…_NN`）= 静止折线（链路）→ 逐轮偏移 →
  //     悬空段垂弧 → 铺地，随后**逐顶点形变**（只动模型 +z）+ 花纹 V 滚动
  //     （每米速率 = **网格实测**沿带 dV/ds × 底段走向；客户端形式常数
  //     `textureScale/chunkLength` 实测偏快 3.4~19×，见 collectSuspensionParts 内注释）。
  // 半径/挂点/链长由模型现算（客户端亦从骨骼现算）；数据缺失/命名不符/轮数不匹配 →
  // 返回 null，整车回落刚体（fail-closed，与数据面无 suspension 块的车同路）。
  const SUSP_AXIS = new THREE.Vector3(0, 0, 1);      // 模型 +z（上）——行程方向
  const SUSP_SPIN_AXIS = new THREE.Vector3(1, 0, 0); // 轮局部 X（车宽）——自转轴（客户端同款）
  const _spQ = new THREE.Quaternion(), _spQ2 = new THREE.Quaternion();
  const _spV = new THREE.Vector3(), _spP = new THREE.Vector3(), _spC = new THREE.Vector3();
  const _spUp = new THREE.Vector3(), _spFwd = new THREE.Vector3();
  const _spUpW = new THREE.Vector3(), _spBox = new THREE.Box3(), _spBox2 = new THREE.Box3();

  function collectSuspensionParts(root: THREE.Object3D, susp: SuspensionJson | null, tankId: number): SuspensionParts | null {
    if (!susp || !Array.isArray(susp.wheels) || !susp.chains) return null;
    const chainsBySide = { L: susp.chains.left, R: susp.chains.right };
    if (!Array.isArray(chainsBySide.L) || !Array.isArray(chainsBySide.R)) return null;
    root.updateMatrixWorld(true);          // clone 未入 scene：matrixWorld 即"相对模型根"
    const disposables: Array<{ dispose(): void }> = [];
    const sides: Partial<Record<'L' | 'R', SuspensionSide>> = {};
    for (const side of ['L', 'R'] as const) {
      const wheelNodes: Array<[number, THREE.Object3D]> = [];
      const trackNodes: Array<[number, THREE.Object3D]> = [];
      root.traverse((n) => {
        const wp = parseWheelNodeName(n.name);
        if (wp && wp.side === side) wheelNodes.push([wp.index, n]);
        const tp = parseTrackNodeName(n.name);
        if (tp && tp.side === side) trackNodes.push([tp.segment, n]);
      });
      wheelNodes.sort((a, b) => a[0] - b[0]);
      trackNodes.sort((a, b) => a[0] - b[0]);
      const chains = chainsBySide[side];
      // 客户端断言 `wheelInfos.size() == suspension.wheels.size()`：轮数不符即 fail-closed
      if (!wheelNodes.length || wheelNodes.length !== susp.wheels.length) return null;
      if (!trackNodes.length || trackNodes.length !== chains.length) return null;
      const wheels: SuspensionWheelPart[] = [];
      for (const [idx, node] of wheelNodes) {
        const rec = susp.wheels[idx - 1];
        if (!Array.isArray(rec) || rec.length < 3) return null;
        const flag = rec[0], up = rec[1], down = rec[2];
        _spBox.makeEmpty();
        node.traverse((o) => {
          const mesh = o as THREE.Mesh
          if (!(mesh as THREE.Mesh).isMesh || !mesh.geometry) return;
          if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
          if (mesh.geometry.boundingBox) {
            _spBox.union(_spBox2.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld));
          }
        });
        if (_spBox.isEmpty()) return null;
        const ctr = _spBox.getCenter(new THREE.Vector3());
        const size = _spBox.getSize(new THREE.Vector3());
        const radius = wheelRadiusFromExtents(size.y, size.z);
        const travelAxis = SUSP_AXIS.clone().applyQuaternion(node.quaternion.clone().invert());
        const upHull = SUSP_AXIS.clone().applyQuaternion(node.quaternion);
        // 导出器把轮几何烘进顶点、节点留在原点（实测平移/旋转皆 identity）：直接给节点写
        // 旋转会绕**整车原点**转（轮公转 = 观感"旋转混乱"）。故按轮心做枢轴补偿——
        // 与炮塔/炮管同一套"节点原点 + 显式枢轴"约定（见 model_origins 那条链）。
        const pivot = node.parent ? node.parent.worldToLocal(ctr.clone()) : ctr.clone();
        const restPivotRot = pivot.clone().applyQuaternion(node.quaternion);
        wheels.push({
          node, flag,
          up: flag ? up : 0, down: flag ? down : 0,     // flag=0：不参与贴地（客户端同款）
          radius, centerHull: ctr, travelAxis, upHull, pivot, restPivotRot,
          restPos: node.position.clone(), restQuat: node.quaternion.clone(),
          travel: 0, spin: 0,
        });
      }
      const tracks: SuspensionTrackPart[] = [];
      for (let ti = 0; ti < trackNodes.length; ti++) {
        const node = trackNodes[ti][1];
        const chain = chains[ti];
        if (!Array.isArray(chain) || chain.length < 4) return null;
        _spBox.makeEmpty();
        const meshes: THREE.Mesh[] = [];
        node.traverse((o) => {
          const mesh = o as THREE.Mesh
          if (!mesh.isMesh || !mesh.geometry) return;
          meshes.push(mesh);
          if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
          if (mesh.geometry.boundingBox) {
            _spBox.union(_spBox2.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld));
          }
        });
        if (!meshes.length || _spBox.isEmpty()) return null;
        const lateral = _spBox.getCenter(new THREE.Vector3()).x;   // 履带中心线（模型系横向）
        const beltW = _spBox.getSize(new THREE.Vector3()).x;        // 履带条宽（回落实测宽度用）
        const chain2: Array<[number, number]> = chain.map((pt): [number, number] => [pt[0], pt[1]]);   // [纵向 y, 高度 z]
        const restZ = chain.map((pt) => pt[1]);
        // 段弧长（花纹速率与顶点弧长参数用）
        const segArc: number[] = [];
        const cumArc = [0];
        for (let i = 0; i + 1 < chain2.length; i++) {
          segArc.push(Math.hypot(chain2[i + 1][0] - chain2[i][0], chain2[i + 1][1] - chain2[i][1]));
          cumArc.push(cumArc[cumArc.length - 1] + segArc[i]);
        }
        const uvSamples: Array<[number, number]> = [];
        const wheelCfg = wheels.map((w) => ({
          longitudinal: w.centerHull.y, centerZ: w.centerHull.z, radius: w.radius,
        }));
        const attach = attachChainToWheels(chain2, wheelCfg);
        const parts: SuspensionTrackPart['parts'] = [];
        for (const mesh of meshes) {
          mesh.geometry = mesh.geometry.clone();      // 形变逐车独立（模板几何共享）
          disposables.push(mesh.geometry);
          const posAttr = mesh.geometry.getAttribute('position') as THREE.BufferAttribute | null;
          if (!posAttr) continue;
          const basePos = new Float32Array(posAttr.array);
          const nv = basePos.length / 3;
          // 顶点 → 链路映射在**模型根系**里做（链路即模型根系的纵剖面折线）
          const rootPos = new Float32Array(basePos.length);
          const m = mesh.matrixWorld;
          for (let vi = 0; vi < nv; vi++) {
            _spV.set(basePos[vi * 3], basePos[vi * 3 + 1], basePos[vi * 3 + 2]).applyMatrix4(m);
            rootPos[vi * 3] = _spV.x; rootPos[vi * 3 + 1] = _spV.y; rootPos[vi * 3 + 2] = _spV.z;
          }
          const params = vertexChainParams(rootPos, chain2);
          // 位移方向：模型根 +z 在该网格局部系里的方向（网格可能带旋转）
          const localAxis = SUSP_AXIS.clone().applyQuaternion(mesh.quaternion.clone().invert());
          const uvAttr = mesh.geometry.getAttribute('uv') as THREE.BufferAttribute | null;
          const uvBase = uvAttr ? new Float32Array(uvAttr.array) : null;
          // 花纹速率样本：[沿带弧长, V]（沿带弧长由顶点→链路映射给出）
          if (uvAttr) {
            for (let vi = 0; vi < nv; vi++) {
              const sg = params.seg[vi];
              const arc = cumArc[sg] + params.t[vi] * segArc[sg];
              uvSamples.push([arc, uvAttr.array[vi * 2 + 1]]);
            }
          }
          parts.push({ mesh, posAttr, basePos, params, axis3: [localAxis.x, localAxis.y, localAxis.z],
                       uvAttr, uvBase, appliedUv: 0 });
        }
        if (!parts.length) return null;
        // 花纹滚动速率：**网格实测**沿带 dV/ds（客户端形式 textureScale/chunkLength 实测偏快
        // 3.4~19×——那条常数在客户端自己的 shader V 空间里，与导出网格的图集式 per-link V
        // 不同量纲）。方向：ΔV = dir·k·Δs，dir = 链路底段走向（材料在底段向后流），
        // k 的符号自带模型的 V 朝向 ⇒ 两个符号方向都自动正确（见 suspension.js 推导）。
        const uvFit = measureBeltUvSlope(uvSamples);
        const dvPerM = uvFit.ok ? chainBottomRunDir(chain2) * uvFit.slope : 0;
        if (!uvFit.ok) {
          console.warn('[playback] 履带 UV 沿带斜率不可测（花纹停滚）tank=' + (tankId || '?')
            + ' pairs=' + uvFit.pairs);
        }
        tracks.push({
          node, parts, chain: chain2, restZ, attach, wheelCfg, lateral, beltW,
          groundDrop: new Float64Array(chain2.length),
          chainZ: new Float64Array(chain2.length),
          appliedChainZ: null,    // 已下发的解算链（顶点输出的唯一形状输入，见 suspensionStep）
          normalChainZ: null,     // 上次**重算法线**时的链（法线闸门逐点比较用）
          dvPerM, uv: 0,
        });
      }
      // 侧接触线横向偏移：履带中心线 |x| 的均值；同时累计履带条宽（beltW 均值）
      let sum = 0, wsum = 0;
      for (const tg of tracks) { sum += Math.abs(tg.lateral); wsum += tg.beltW || 0; }
      sides[side] = {
        wheels, tracks, wheelDelta: new Float64Array(wheels.length),
        halfW: tracks.length ? sum / tracks.length : 0,
        beltW: tracks.length ? wsum / tracks.length : 0, prev: null,
      };
    }
    return {
      sides, disposables, bend: susp.track_bending || null,
    };
  }

  // 逐帧：贴地（轮）→ 自转 → 链路解算 → 逐顶点形变 + 花纹滚动
  function suspensionStep(v: RuntimeVehicle) {
    const sp = v.suspParts;
    if (!sp || !v.glb) return;
    _spQ.copy(v.glb.quaternion);                       // 车体系（模型系）→ 世界
    _spUp.set(0, 0, 1).applyQuaternion(_spQ);          // 车体 up 的世界向量
    const upY = _spUp.y;
    _spFwd.set(0, 1, 0).applyQuaternion(_spQ);         // 车体前向（世界）
    const snap = suspSnap;
    const dt = suspDt;
    const reaction = Number.isFinite(v.def && v.def.suspReaction) ? v.def.suspReaction! : 1.0;
    for (const key of ['L', 'R'] as const) {
      const side = sp.sides[key];
      if (!side) continue;
      // 该侧履带接触线中心（世界）：车体系 (±halfW, 0, 0)
      _spP.set(key === 'L' ? -side.halfW : side.halfW, 0, 0).applyQuaternion(_spQ).add(v.glb.position);
      let dS = 0;
      if (side.prev && !snap) {
        dS = sideTravel(side.prev.x, side.prev.z, _spP.x, _spP.z, _spFwd.x, _spFwd.z);
      }
      if (!side.prev) side.prev = new THREE.Vector3();
      side.prev.copy(_spP);
      // 逐轮：贴地行程 + 自转
      for (let wi = 0; wi < side.wheels.length; wi++) {
        const w = side.wheels[wi];
        if (w.flag) {
          _spC.copy(w.centerHull).applyQuaternion(_spQ).add(v.glb.position);
          const terr = deps.sampleHeight(_spC.x, _spC.z);
          _spUpW.copy(w.upHull).applyQuaternion(_spQ);
          const upw = Math.abs(_spUpW.y) > 0.25 ? _spUpW.y : 0;
          if (upw) {
            const wantWorld = (terr + w.radius) - _spC.y;      // 世界竖直差
            const wantLocal = clampTravel(wantWorld / upw, w.up, w.down);
            w.travel = rateLimitTravel(w.travel, wantLocal, reaction, dt, snap);
          } else {
            w.travel = 0;
          }
        } else {
          w.travel = 0;                                        // 非负重轮：保持装定位
        }
        if (dS) w.spin = spinStep(w.spin, dS, w.radius);
        // 自转（绕轮局部 X）+ 枢轴补偿（导出的轮节点在原点，几何烘进顶点；见 applyWheelSpin）
        _spQ2.setFromAxisAngle(SUSP_SPIN_AXIS, w.spin);
        applyWheelSpin(w.node, w.restPos, w.restQuat, w.pivot, w.restPivotRot,
                       _spQ2, w.travelAxis, w.travel);
        side.wheelDelta[wi] = w.travel;
      }
      // 履带：链路解算 + 形变 + 花纹
      for (const tg of side.tracks) {
        const n = tg.chain.length;
        for (let i = 0; i < n; i++) {
          _spP.set(tg.lateral, tg.chain[i][0], tg.chain[i][1]).applyQuaternion(_spQ).add(v.glb.position);
          const terr = deps.sampleHeight(_spP.x, _spP.z);
          tg.groundDrop[i] = groundDropLocal(terr, _spP.y, upY);
        }
        solveChain(tg.chainZ, tg.chain, tg.attach, side.wheelDelta, tg.groundDrop, tg.wheelCfg, sp.bend);
        // 花纹：每米 V 变化 = 网格实测 dV/ds（见收集期注释）
        const uv = (dS && tg.dvPerM)
          ? (tg.uv = treadScrollStep(tg.uv, dS, tg.dvPerM))
          : tg.uv;
        // 顶点输出 = f(chainZ, basePos, params, restZ, axis)（纯函数）⇒ **按解算链**判定是否下发：
        // 只比形变最大幅度会漏"幅度相同、分布不同"的形变（2026-10-10 review P2：把 0.1 的形变
        // 从一处挪到另一处时 max 不变、顶点已变但 `version` 仍是 1，GPU 停在旧形状；法线同理）。
        // 逐链路点（~40）比较比逐顶点指纹便宜且**恰好充分**：链相同 ⇒ 顶点逐点相同。
        const chainMoved = snap || !tg.appliedChainZ || chainChanged(tg.appliedChainZ, tg.chainZ);
        if (chainMoved) {
          // 法线闸门：与**上次重算法线时的链**逐点比较取最大偏差（2026-10-10 review 复审 P2——
          // dmax/dmean 这类累计统计量表达不了空间分布：把 0.1 m 的形变从一处挪到另一处时两者
          // 都不变，法线却必须重算）。2 cm 阈值仍是成本刹车：行驶中偏差累积到 2 cm 才重算一次，
          // 而非逐帧重算（逐帧 = 每车每帧一次全顶点遍历）。
          const dNorm = (snap || !tg.normalChainZ) ? Infinity : chainDrift(tg.normalChainZ, tg.chainZ);
          const redoNormals = dNorm > 0.02;
          for (const gp of tg.parts) {
            applyChainToVertices(gp.posAttr.array as Float32Array, gp.basePos, gp.params,
                                 tg.chainZ, tg.restZ, gp.axis3);
            gp.posAttr.needsUpdate = true;
            markPickBoundsStale(gp.mesh.geometry);
            if (redoNormals) {
              gp.mesh.geometry.computeVertexNormals();
              const na = gp.mesh.geometry.getAttribute('normal');
              if (na) na.needsUpdate = true;
            }
          }
          if (redoNormals) {
            if (!tg.normalChainZ) tg.normalChainZ = new Float64Array(n);
            tg.normalChainZ.set(tg.chainZ);
          }
          if (!tg.appliedChainZ) tg.appliedChainZ = new Float64Array(n);
          tg.appliedChainZ.set(tg.chainZ);
        }
        // 花纹与形变解耦：UV 只随累计滚动量变（链静止时也照样滚），故独立于上面的形变闸门
        for (const gp of tg.parts) {
          if (gp.uvAttr && gp.uvBase && Math.abs(uv - gp.appliedUv) > 1e-3) {
            gp.appliedUv = uv;
            // 取模只作用于**偏移**（整带同相）：逐顶点取模会破坏跨 wrap 图元的 UV 插值
            // （长直段被拉成"没有纹理"，见 writeUvOffsetV 注释）
            writeUvOffsetV(gp.uvAttr.array, gp.uvBase, uv);
            gp.uvAttr.needsUpdate = true;
          }
        }
      }
    }
  }

  // GLB 位姿模块级 scratch：本函数每车每帧执行，原实现每次分配 ~20 个矩阵/欧拉/四元数
  // （14 车 × 60fps 的 GC 抖动源）。语义与逐次分配完全一致，只是复用容器。
  const _glbQuat = new THREE.Quaternion();
  const _glbEuler = new THREE.Euler();
  const _mRot = new THREE.Matrix4(), _mTmpA = new THREE.Matrix4(), _mTmpB = new THREE.Matrix4();
  const _mTmpC = new THREE.Matrix4(), _mTmpD = new THREE.Matrix4(), _mT = new THREE.Matrix4();
  const _mG = new THREE.Matrix4(), _mAcc = new THREE.Matrix4();

  // GLB 根位姿 = poseFromYPR(−yaw, pitch, roll)（共享 rig，见 scene/glbRig.js）——
  // **车体位姿照回放记录摆**（客户端同构：车体收记录的 yaw/pitch/roll + y）。
  // ⚠️ 2026-10-10：曾试过"根吃地形局部平面 + 车体吃限幅残差"的近似，观感被判"怪"且与客户端
  // 结构相反（客户端：车体 = 记录位姿；轮/带由 `Suspension*System` 按模型几何解算——逆向证据见
  // 上游 docs/tank-suspension-client-re.md），已整段回退。`__hullGroup` 保留但**恒归单位**：
  // 它是下一步"逐轮贴地 + 履带分段"的挂点，现在不参与摆放。
  function poseGlb(v: RuntimeVehicle) {
    poseGlbRig(v, deps.getT(), v.group.position);
    // 悬挂：轮带宽高/自转/履带形变（客户端同构；v.suspParts 缺失 = 整车刚体）。只读根位姿。
    suspensionStep(v);
  }
  // 根位姿 + 炮塔 / 炮管：t 时刻的纯函数（不碰悬挂积分状态）。开火定位炮口时临时摆到 t_fire
  // 量完再摆回 T（见 flushMuzzles）。
  function poseGlbRig(v: RuntimeVehicle, t: number, pos: THREE.Vector3) {
    if (!v.glb) return;
    v.glb.position.copy(pos);
    v.glb.quaternion.copy(poseFromYPR(-yawAt(v, t), hullPitchAt(v, t), -rollAt(v, t), _glbQuat));
    const p = v.glbParts;
    if (p && p.hullGroup) {
      p.hullGroup.quaternion.identity();
      p.hullGroup.position.set(0, 0, 0);
    }
    if (!p) return;
    const gr = gunPitchAt(v, t);           // glb 系 Rx(θ)：θ>0 = 前向(+Y)抬向 +Z = 仰角
    const mT = glbTurretMatrix(v, p, t);
    const mG = _mG.copy(_mT).multiply(_mTmpB.makeTranslation(p.gP[0], p.gP[1], p.gP[2]))
      .multiply(_mTmpC.makeRotationX(gr))
      .multiply(_mTmpD.makeTranslation(-p.gP[0], -p.gP[1], -p.gP[2]));
    p.poseT.copy(mT);
    p.poseG.copy(mG);
    const tn = p.turretNode;
    if (tn) {
      // 回转炮塔：横转（含 itr 补偿）写炮塔节点；炮管随父链继承横转。
      tn.updateMatrix();
      if (!tn.userData.__bake) { tn.userData.__bake = tn.matrix.clone(); tn.matrixAutoUpdate = false; }
      tn.matrix.copy(_mAcc.copy(mT).multiply(tn.userData.__bake as THREE.Matrix4));
    }
    // 固定战斗室（turretNode=null，歼击车）：炮管组直接吃 mG——mG = mT·Rx(gr)，
    // 已含绕 tP 的横转（itr 补偿在内）与绕 gP 的俯仰，与客户端「TD 炮塔 = 炮管」同构。
    for (const gn of p.gunNodes) {
      gn.updateMatrix();
      if (!gn.userData.__bake) { gn.userData.__bake = gn.matrix.clone(); gn.matrixAutoUpdate = false; }
      gn.matrix.copy(_mAcc.copy(mG).multiply(gn.userData.__bake as THREE.Matrix4));
    }
    // 世界矩阵不在此强制刷新：renderer.render 的 scene.updateMatrixWorld() 从根向下传播足矣。
    // v.glb 根 matrixAutoUpdate=true → updateMatrix 置脏 → force 覆盖 matrixAutoUpdate=false
    // 的炮塔/炮管节点，本行是每车全树一遍纯重复的 compose+multiply（14 车 ×60fps）。
    // tick 与 render 之间唯一的车辆世界矩阵读者是开火定位炮口（flushMuzzles），它自己
    // tick 把射手一台摆到 t_fire、刷新、量完再摆回 T 并刷新；标签投影用位姿，
    // 只打静态场景网格。
  }
  /** 炮塔节点的枢轴旋转矩阵（模型系）：炮塔横转绕 tP，含 itr 补偿。 */
  function glbTurretMatrix(v: RuntimeVehicle, p: GlbParts, t: number) {
    const rel = wrapPi(turretAbsAt(v, t) - yawAt(v, t));
    const tr = -rel;                       // 镜像系节点旋转角 = −rel
    if (p.itr) {
      // Euler 序 'ZYX'：yaw (Z) 最外层 → pitch/roll 补偿在炮塔局部系内执行。
      // 'XYZ' 会把 pitch 放在全局系，炮塔转开 90° 时 pitch 变成侧倾。
      _glbEuler.set(-THREE.MathUtils.degToRad(p.itr.pitch || 0), -THREE.MathUtils.degToRad(p.itr.roll || 0),
                    tr - THREE.MathUtils.degToRad(p.itr.yaw || 0), 'ZYX');
      _mRot.makeRotationFromEuler(_glbEuler);
    } else {
      _mRot.makeRotationZ(tr);
    }
    return _mT.makeTranslation(p.tP[0], p.tP[1], p.tP[2]).multiply(_mRot)
      .multiply(_mTmpA.makeTranslation(-p.tP[0], -p.tP[1], -p.tP[2]));
  }
  /**
   * 本车配置的真实炮位与炮管方向（世界系），与 poseGlbRig 走同一条变换链；低模代理
   * 没有 itr 补偿，不能代表渲染出的炮管。没有 GLB 时返回 false，由调用方退回低模枢轴。
   */
  function glbGunWorld(v: RuntimeVehicle, pos: THREE.Vector3, dir: THREE.Vector3): boolean {
    const p = v.glb ? v.glbParts : null;
    const parent = p && (p.turretNode ?? p.gunNodes[0])?.parent;
    if (!parent) return false;
    parent.updateWorldMatrix(true, false);
    const turret = glbTurretMatrix(v, p, deps.getT());
    const pitch = gunPitchAt(v, deps.getT());        // 模型前向 +Y，绕 X 俯仰，见 poseGlbRig
    dir.set(0, Math.cos(pitch), Math.sin(pitch)).transformDirection(turret).transformDirection(parent.matrixWorld);
    pos.set(p!.gP[0], p!.gP[1], p!.gP[2]).applyMatrix4(turret).applyMatrix4(parent.matrixWorld);
    return true;
  }
  async function applyGlbToggle(on: boolean) {
    const gen = deps.sessionGen();
    glbOn = on;
    deps.store.glbOn = on;
    const scene = deps.getScene();
    if (on) {
      if (!scene) return;
      // 有限并发加载（上限 4）：单个大模型慢解析不阻塞其余车辆，又不会让 14 台车
      // 的主线程 GLTF 解析同时排队。每车 clone 独立实例。
      // generation guard：回放替换后迟到的完成不得挂载到新会话场景
      await mapLimit(V.filter(v => v.def.tank_id > 0), ASSET_CONCURRENCY, async (v) => {
        if (!v.glb) {
          const loaded = await loadGlb(v.def.tank_id);
          if (gen !== deps.sessionGen()) return;   // 迟到：模板留在旧缓存对象里随 GC 回收
          if (loaded && glbOn && !v.glb) {
            const inst = loaded.template.clone();
            inst.scale.setScalar(1);
            // 炮塔/主炮变体（dense 节点索引）按**实际搭载配置**选：facet 的 turret_index/
            // gun_index 只有服务器路径产出；WASM 客户端产物用同一三级证据链
            // （comp locals → 发射弹种 → 初始血量，resolveMountedConfig）联表 tank 数据
            // 派生——多炮坦克各炮 GLB 节点组不同（实测同队两台 B-C 25t 分别 100/105mm），
            // 不钉定会整场显示顶级炮。sd 拉取失败 → 回退 facet 字段 → 顶级。
            const mounted = loaded.sd ? resolveMountedConfig(v.def, loaded.sd as TankJsonLike) : null;
            const parts = collectGlbParts(inst, loaded.sd, mounted
              ? { turret_index: (mounted as { turret_index?: number | null }).turret_index ?? null, gun_index: (mounted as { gun_index?: number | null }).gun_index ?? null }
              : { turret_index: v.def.turret_index ?? null, gun_index: v.def.gun_index ?? null });
            if (!parts) {
              // 部位/枢轴链不全（sd 缺失等）：不受姿的 GLB 会停在世界原点被地形埋住，
              // 看起来就是"没加载出来"——此时保持代理车（失败可见，且与日志对应）
              console.warn('[playback] GLB 部位不全，保留代理车 tank_id=' + v.def.tank_id)
              return
            }
            v.glb = inst;                       // 通过部位检查后才落库（否则会卡在半装载态）
            v.glbParts = parts;
            deps.contactShadows()?.setFootprint(v, measureShadowFootprint(inst));   // 受姿前一次性实测
            deps.contactShadows()?.attachModel(v, inst);   // 轮廓投影（渲染器带 stencil 时）
            v.tankData = loaded.sd;             // Sniper 穿深着色的配置/弹表来源
            // 悬挂部件（轮/带）逐车收集：几何逐车 clone（模板共享），数据缺 → null 回落刚体
            v.suspParts = collectSuspensionParts(inst, loaded.susp, v.def.tank_id);
            v.def.suspReaction = loaded.susp ? loaded.susp.wheels_reaction_speed ?? null : null;
            v.glb.visible = v.group.visible && !deps.classIconsVisible();
            scene.add(v.glb);
            // Clone before shader patching: templates keep shared textures/geometry only.
            // The material module composes the existing tank ambient-light isolation.
            for (const head of v.detachedTurrets) {
              head.glb = cloneDetachedTurret(inst, parts, gunPitchAt(v, head.track.pose_kf.t[0]));
              head.glbVisual = prepareTankDestroyedVisual(head.glb);
              head.root.add(head.glb);
            }
            v.glbVisual = prepareTankDestroyedVisual(v.glb);
            applyPose(v);   // late attach while paused must reflect the current replay time
            deps.invalidate();
          }
        }
        if (v.glb) setLowPoly(v, false);
      });
    } else {
      for (const v of V) {
        if (v.glb) {
          for (const head of v.detachedTurrets) {
            if (head.glb) head.root.remove(head.glb);
            disposeTankDestroyedVisual(head.glbVisual);
            head.glb = null; head.glbVisual = null;
          }
          scene?.remove(v.glb);            // borrowed geometry/textures stay with the template
          disposeTankDestroyedVisual(v.glbVisual);
          v.glbVisual = null;
          // 悬挂求解为逐车 clone 的履带几何（见 collectSuspensionParts 的 disposables）
          // ——清引用前必须释放，否则反复开关 GLB 逐次累积 GPU 缓冲（2026-10-10 review P2）。
          if (v.suspParts && v.suspParts.disposables) {
            for (const g of v.suspParts.disposables) g.dispose();
          }
          v.glb = null; v.glbParts = null; v.suspParts = null;
        }
        setLowPoly(v, true);
        applyDetachedTurrets(v);
      }
    }
  }
  // 低模显隐（标签与作者标记环除外；GLB 根在 scene 上不经过 group）
  function setLowPoly(v: RuntimeVehicle, show: boolean) {
    for (const c of v.group.children) {
      c.visible = c.userData.keepWithGlb ? deps.showMarkerStatus() : show && !deps.classIconsVisible();
    }
    // 车体收在 `__hullGroup` 包装内（悬挂挂点），上面的循环只切到包装层；
    // 而契约按 `meshHull.visible` 读低模显隐（class-icon 用例断言此标志），故同步自身。
    if (v.meshHull) v.meshHull.visible = show && !deps.classIconsVisible();
  }

  const detachedPose: { x: number; y: number; z: number; yaw: number; pitch: number; roll: number } = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0 };
  /**
   * 分离事实是否属于**当前这一世**（issue #622 review P2）：复活模式下车会带着炮塔复活——上一世的
   * 飞头不应让新车继续无炮塔。分离从 detached 轨道首帧起生效，到该车**下一次复活**为止（规则与
   * `defLifeAt` 同一份上游字段，原始时钟域）；复活后的新死亡若再飞头，会有新的 detached 轨道
   * （新首帧）重新接管。飞头实体自身的渲染不受此判据影响（它有自己的 coverage 与位姿轨道）。
   */
  function detachmentAppliesNow(v: RuntimeVehicle, head: DetachedTurret) {
    const T = deps.getT();
    const startRaw = head.track.pose_kf.t[0];
    if (!(T >= startRaw)) return false;
    for (const r of v.def.resurrection_times || []) {
      if (r > startRaw && r <= T + 1e-6) return false;
    }
    return true;
  }
  function applyDetachedTurrets(v: RuntimeVehicle) {
    const T = deps.getT();
    let separated = false;
    for (const head of v.detachedTurrets) {
      const known = T >= head.track.pose_kf.t[0];
      separated ||= known && detachmentAppliesNow(v, head);
      head.root.visible = known && !deps.classIconsVisible() && sampleDetachedPose(head.track, T, detachedPose);
      if (head.root.visible) {
        head.root.position.set(detachedPose.x, detachedPose.y, detachedPose.z);
        yprScene(detachedPose.yaw, detachedPose.pitch, detachedPose.roll, head.root.quaternion);
      }
      head.proxy.visible = !head.glb;
      if (head.glb) head.glb.visible = true;
      // Detachment is itself known destruction evidence for this part, even if
      // canonical vehicle life is still loading. Rewind simply hides the part.
      const amount = destroyedVisualAmount({ lifeState: 'DESTROYED', destroyedKnownAtSec: head.track.pose_kf.t[0] }, T);
      applyTankDestroyedVisual(head.proxyVisual, amount);
      applyTankDestroyedVisual(head.glbVisual, amount);
    }
    v.turretG.visible = !separated;
    if (v.glbParts) {
      // 固定战斗室（turretNode=null，歼击车）没有炮塔节点可摘——脱落时只藏炮管组
      //（TD 的炮架横转就是它的「炮塔」，脱落件一并带走）。
      if (v.glbParts.turretNode) v.glbParts.turretNode.visible = !separated;
      for (const node of v.glbParts.gunNodes) node.visible = !separated;
    }
  }

  // applyPose 的零分配采样 scratch（原宿主 tmpV 同款，本模块独立持有）
  const tmpV = new THREE.Vector3();

  function applyPose(v: RuntimeVehicle) {
    applyDetachedTurrets(v);
    const T = deps.getT();
    const life = deps.sceneLifeAt(v, T);
    const dead = life?.lifeState === 'DESTROYED';
    const amount = destroyedVisualAmount(life, T);
    applyTankDestroyedVisual(v.proxyVisual, amount);
    applyTankDestroyedVisual(v.glbVisual, amount);
    // 死亡后模型不消失：coverage 在阵亡处截止，但残骸应留在最后已知位置
    // （posAt 对越界时间钳位到最后采样，即阵亡点），与游戏内残骸留场行为一致
    const vis = deps.visibleAt(v, T) || dead;
    v.group.visible = vis;
    if (v.glb) v.glb.visible = vis && !deps.classIconsVisible();
    if (!vis) {
      syncContactShadow(v);
      // 悬挂积分复位：不可见期间不累积侧位移（复现时首帧吸附，不跳变）
      if (v.suspParts) {
        for (const k of ['L', 'R'] as const) if (v.suspParts.sides[k]) v.suspParts.sides[k]!.prev = null;
      }
      return;
    }
    posAt(v, T, tmpV);
    v.group.position.copy(tmpV);
    if (v.glb) poseGlb(v);
    // 低模位姿（GLB 显示时保留低模位姿更新，切回低模无跳变）：与 GLB 侧同口径 = **记录位姿**
    v.group.rotation.order = 'YXZ';
    v.group.rotation.y = -yawAt(v, T);
    v.group.rotation.x = hullPitchAt(v, T);
    v.group.rotation.z = -rollAt(v, T);   // 横滚（符号约定见 rollAt 注释）
    if (v.hullGroup) {
      v.hullGroup.quaternion.identity();
      v.hullGroup.position.set(0, 0, 0);
    }
    const rel = wrapPi(turretAbsAt(v, T) - yawAt(v, T));
    v.turretG.rotation.y = -rel;
    v.gunPivot.rotation.x = -gunPitchAt(v, T);
    syncContactShadow(v);
  }

  /** 阴影只读已变换完成的场景位姿（posAt 已含镜像）；车辆不可见或被类型图标替代时隐藏。 */
  function syncContactShadow(v: RuntimeVehicle) {
    const shadows = deps.contactShadows();
    if (!shadows) return;
    const p = v.group.position;
    shadows.update(v, p.x, p.z, v.group.rotation.y,
      v.group.visible && !deps.classIconsVisible() && v.def.eid !== deps.scopedHiddenEid());
  }

  function vehicleByEid(eid: number) { return V.find((x) => x.def.eid === eid); }

  /** 会话 teardown：车辆循环 + GLB 模板缓存释放（原 teardownSession 的车辆段逐字保留；
   *  履带印逐车回收归 treadRuntime.dispose（宿主先调它，保持原相对顺序）。 */
  function dispose() {
    const scene = deps.getScene();
    for (const v of V) {
      for (const head of v.detachedTurrets) {
        scene?.remove(head.root);
        disposeTankDestroyedVisual(head.proxyVisual);
        disposeTankDestroyedVisual(head.glbVisual);
      }
      if (v.glb) scene?.remove(v.glb);          // only material clones are instance-owned
      disposeTankDestroyedVisual(v.glbVisual);
      v.glbVisual = null;
      // 悬挂求解为逐车 clone 的履带几何（唯一持有者）：显式释放
      if (v.suspParts && v.suspParts.disposables) {
        for (const g of v.suspParts.disposables) g.dispose();
      }
      v.suspParts = null;
      if (v.group) { scene?.remove(v.group); deps.disposeObject3D(v.group); }
    }
    V = [];
    // GLB 模板缓存（session-scoped）：unique shared resources dispose 一次并清缓存。
    // 未决 Promise 逐个挂 then(dispose)——迟到模板到达即销毁（未渲染未上传 GPU，
    // 不泄漏）；teardown 之后才创建的迟到 Promise 不在册，随旧缓存对象 GC
    for (const p of glbCache.values()) {
      p.then((entry) => { if (entry && entry.template) deps.disposeObject3D(entry.template); })
        .catch(() => {});
    }
    glbCache = new Map();
  }

  return {
    getVehicles: () => V,
    buildVehicles,
    syncContactShadow,
    loadGlb,
    applyGlbToggle,
    glbOn: () => glbOn,
    setLowPoly,
    applyPose,
    applyDetachedTurrets,
    poseGlbRig,
    glbGunWorld,
    posAt, yawAt, hullPitchAt, turretAbsAt, gunPitchAt, rollAt,
    vehicleByEid,
    frameTiming: (dt, snap) => { suspDt = dt; suspSnap = snap; },
    markSeekSnap: () => { suspSnap = true; suspDt = 0; },
    clearSnap: () => { suspSnap = false; },
    dispose,
  };
}
