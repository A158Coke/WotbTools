// 录像者 Sniper 视角的单目标穿深着色。装甲规则与着色器全部复用装甲查看器
// （viewer/armorPlateModel.js + viewer/armorShaders.js），本模块只负责：资格判定、
// 选目标、把 armor 网格摆到**画面上那台车的实际姿态**，以及在主渲染之后叠加 pass。
//
// 主渲染完全不动：关闭/不满足资格时零额外 pass。叠加顺序：
//   ① 间隙甲状态/厚度 RT（标准深度）
//   ② 清深度后重画不透明世界的深度——装甲网格在视觉外壳内侧，若沿用主渲染深度，
//      目标自己的车模会把装甲挡住；重画时排除目标，遮挡就只来自真实世界几何
//   ③ primary 排除深度 + 着色
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { Box3, BufferGeometry, Camera, Frustum, Group, Material, Mesh, Object3D, PerspectiveCamera, Scene, Sphere, WebGLRenderer } from 'three'
import type { AgentAuthorShellEvent, AgentPlaybackShot, AgentVehicleTrack } from '../../api/agent-replay-facets.js'
import { dynamicDeclarationByTankId } from '../../data/armorStates.js'
import { createArmorShaderContext, standardDepthMaterial } from '../viewer/armorShaders.js'
import {
  applyArmorConfigVisible, armorPivots, calibratedPenMul, collectArmorPrefixes,
  ENHANCED_ARMOR_THICK_MUL, gunMaskOriginModel, installArmorPivots, partitionArmorMeshes,
  plateThickness, populatePrimaryArmorScene, populateSpacedArmorScene, populateSpacedStateScene,
  retagSpacedSections, rolledPenetration, selectExternalMeshes, shellAngles, shellTypeOf,
  tagArmorPlates, tagModuleMeshes, useFaceNormals,
} from '../viewer/armorPlateModel.js'

/** 重画世界深度专用 layer（0 = 默认，1 = 开镜隐藏本车）。 */
const OCCLUDER_LAYER = 2

/** 装甲 RT 分配粒度（px，向上取整）：按目标矩形分配时避免逐像素反复重建。 */
export const RT_BUCKET_PX = 64

/** RT 边长：px 向上取整到 RT_BUCKET_PX 的倍数，钳到 ≤ drawing buffer 上限且 ≥1（零尺寸 RT 非法）。 */
export function bucketedRtSize(px: number, cap: number): number {
  return Math.min(Math.max(Math.ceil(px / RT_BUCKET_PX) * RT_BUCKET_PX, 1), Math.max(1, Math.floor(cap)))
}

/** 目标屏幕矩形（GL 像素，含 margin）在整幅画面里的归一化矩形 → spacedRect uniform
 *  （x0,y0,w,h，原点左下）。全屏时 = (0,0,1,1)，与装甲查看器（不设该 uniform）同口径。 */
export function spacedRectOf(px: number, py: number, pw: number, ph: number, fullW: number, fullH: number, out: THREE.Vector4): THREE.Vector4 {
  return out.set(px / fullW, py / fullH, pw / fullW, ph / fullH)
}
const EQ_CALIBRATED_SHELLS = 103
const EQ_ENHANCED_ARMOR = 110
/** 炮管任意朝向下 GLB 根到车模最远点的上界（最长的车连炮管约 12 m）。 */
const VEHICLE_PICK_RADIUS_M = 15
/** 裁剪矩形外扩的像素：包住光栅化取整，矩形边上不留缝。 */
const SCISSOR_MARGIN_PX = 2
const ARMOR_LOAD_ATTEMPTS = 3
const ARMOR_LOAD_RETRY_MS = 5000

/**
 * 加载失败的有限重试：临时错误（断网、503）过后还能恢复，永久错误（404、坏文件）试满就停，
 * 不会每帧重新下载。`succeed` 清掉记录，一次成功后不再占用次数。
 */
export interface LoadRetry {
  allowed(key: string | number): boolean
  fail(key: string | number): void
  succeed(key: string | number): void
}

export function createLoadRetry({
  attempts = ARMOR_LOAD_ATTEMPTS, delayMs = ARMOR_LOAD_RETRY_MS, now = () => performance.now(),
}: { attempts?: number; delayMs?: number; now?: () => number } = {}): LoadRetry {
  const failures = new Map<string | number, { count: number; retryAt: number }>()
  return {
    allowed(key: string | number): boolean {
      const failure = failures.get(key)
      return !failure || (failure.count < attempts && now() >= failure.retryAt)
    },
    fail(key: string | number): void {
      const count = (failures.get(key)?.count ?? 0) + 1
      failures.set(key, { count, retryAt: now() + delayMs })
    },
    succeed(key: string | number): void { failures.delete(key) },
  }
}

/** 时刻 t 的当前弹种（`timeline` 时间升序）；首条之前未知，返回 null。 */
export function authorShellAt(timeline: readonly AgentAuthorShellEvent[] | null | undefined, t: number): number | null {
  if (!timeline || !timeline.length || !(t >= timeline[0].t)) return null
  let lo = 0, hi = timeline.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (timeline[mid].t <= t) lo = mid
    else hi = mid - 1
  }
  return timeline[lo].shell_id
}

/** 配置弹表里的弹种（caliber 取弹体，缺失回退该炮口径）；不在表内返回 null。 */
export interface MountedShell {
  shell: AgentPlaybackShot | Record<string, unknown>
  caliber: number
}

/** 资产包 configs[] 条目中本模块消费的字段（mountedShell / armorHighlightBlock）。 */
export interface HighlightConfig {
  shell_global_ids?: number[]
  caliber?: number
  shells?: Array<Record<string, unknown> & { caliber?: number; penetration?: number; penetration_far?: number; damage?: number; explosion_radius?: number }>
  [key: string]: unknown
}

export function mountedShell(cfg: HighlightConfig | null | undefined, shellId: number | null): MountedShell | null {
  const i = (cfg?.shell_global_ids ?? []).indexOf(shellId as number)
  const shell = i >= 0 ? cfg?.shells?.[i] : null
  if (!shell) return null
  const caliber = [shell.caliber, cfg?.caliber].find((v) => typeof v === 'number' && Number.isFinite(v) && v > 0) ?? 0
  return { shell, caliber }
}

/**
 * 资格判定：返回第一个不满足的原因码，全部满足返回 null。每一项都是「证据不足就不显示」，
 * 不存在回退分支——颜色本身就是结论，错的配置/弹种只会给出错的结论。
 */
export function armorHighlightBlock({ targetTankId, targetConfig, authorConfig, shellId, targetEquipment, authorEquipment }: {
  targetTankId: number | null | undefined
  targetConfig: unknown
  authorConfig: unknown
  shellId: number | null
  targetEquipment: unknown
  authorEquipment: unknown
}): string | null {
  if (dynamicDeclarationByTankId(targetTankId)) return 'dynamic_armor'
  if (!targetConfig) return 'target_config_unknown'
  if (!authorConfig) return 'author_config_unknown'
  if (shellId == null) return 'shell_unknown'
  const mounted = mountedShell(authorConfig as HighlightConfig, shellId)
  if (!mounted) return 'shell_not_mounted'
  if (!shellTypeOf(mounted.shell as { type?: unknown })) return 'shell_type_unknown'
  if (!(mounted.caliber > 0)) return 'caliber_unknown'
  if (!Array.isArray(targetEquipment) || !Array.isArray(authorEquipment)) return 'equipment_unknown'
  return null
}

const _aimNdc = new THREE.Vector3()
/**
 * 屏幕准星那条线的方向：相机 → Type39 瞄准点。进入录像者视角的过渡期相机朝向与它不同，
 * 准星才是画面上指着的地方。瞄准点投影不到（与准星隐藏同判据）时返回 null。
 */
export function reticleAimDirection(camera: Camera, aimPoint: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 | null {
  _aimNdc.copy(aimPoint).project(camera)
  if (![_aimNdc.x, _aimNdc.y, _aimNdc.z].every((n) => Number.isFinite(n) && Math.abs(n) <= 1)) return null
  out.subVectors(aimPoint, camera.position)
  return out.lengthSq() > 0 ? out.normalize() : null
}

function collectVisibleMeshes(node: Object3D, out: Mesh[]): void {
  if (!node.visible) return
  const mesh = node as Mesh
  if (mesh.isMesh) out.push(mesh)
  for (const child of node.children) collectVisibleMeshes(child, out)
}

/**
 * 顶点被改写后调用（悬挂形变）。这里只打标记、由拾取时重算：直接置空 bounds 会让视锥剔除
 * 每帧为所有行驶中的车遍历顶点，而 Mesh.raycast 的粗筛用的正是这份 bounds。
 */
export function markPickBoundsStale(geometry: BufferGeometry): void {
  geometry.userData.pickBoundsStale = true
}

const _pickBox = new THREE.Box3()
const _pickCenter = new THREE.Vector3()
/**
 * 单趟顶点遍历求 AABB，再令球 = AABB 中心 + 半对角线（保守球，只会多测三角形、不会漏命中）。
 * three 自带的 computeBoundingBox + computeBoundingSphere 合计 3 次全顶点遍历；悬挂形变的
 * 履带每次拾取都要重算，这里是拾取路径上最热的逐顶点成本。
 */
function refreshPickBounds(geometry: BufferGeometry): void {
  if (!geometry.userData.pickBoundsStale) return
  const pos = geometry.getAttribute('position')
  if (!pos || 'isInterleavedBufferAttribute' in pos) {
    geometry.computeBoundingBox()
    geometry.computeBoundingSphere()
    geometry.userData.pickBoundsStale = false
    return
  }
  const a = pos.array as ArrayLike<number>
  const count = pos.count
  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  for (let i = 0; i < count; i++) {
    const x = a[i * 3], y = a[i * 3 + 1], z = a[i * 3 + 2]
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
    if (z < minZ) minZ = z
    if (z > maxZ) maxZ = z
  }
  if (minX > maxX) { minX = maxX = 0; minY = maxY = 0; minZ = maxZ = 0 }
  _pickBox.min.set(minX, minY, minZ)
  _pickBox.max.set(maxX, maxY, maxZ)
  if (geometry.boundingBox) geometry.boundingBox.copy(_pickBox)
  else geometry.boundingBox = _pickBox.clone()
  _pickCenter.addVectors(_pickBox.min, _pickBox.max).multiplyScalar(0.5)
  const half = _pickCenter.distanceTo(_pickBox.max)
  if (geometry.boundingSphere) {
    geometry.boundingSphere.center.copy(_pickCenter)
    geometry.boundingSphere.radius = half
  } else {
    geometry.boundingSphere = new THREE.Sphere(_pickCenter.clone(), half)
  }
  geometry.userData.pickBoundsStale = false
}

const _pickRaycaster = new THREE.Raycaster()
const _pickMeshes: Mesh[] = []
const _pickHits: THREE.Intersection[] = []
const _pickRoot = new THREE.Vector3()
const _pickOffset = new THREE.Vector3()
const _pickSphere = new THREE.Sphere()
const _pickFrustum = new THREE.Frustum()
const _pickViewProjection = new THREE.Matrix4()
const _pickCandidates: Array<{ v: AimedVehicleCandidate | null; lower: number }> = []
const _pickPool: Array<{ v: AimedVehicleCandidate | null; lower: number }> = []
let _pickPoolUsed = 0
/**
 * 视线最先碰到的车辆：对当前帧可见网格精确求交，炮塔转动、炮管俯仰都按实际姿态算。
 * 先按 GLB 根到视线的距离粗筛（半径与姿态无关），离视线远的车不重算 bounds、不逐网格求交；
 * Mesh.raycast 自带逐网格包围球/盒粗筛。只是选目标，遮挡由深度 pass 决定。
 *
 * 性能：候选车按「根包围球沿视线的最近可能距离」升序求交；已得到最近命中后，
 * 后续候选的最近可能距离更大即可停止——精确剪枝，不改变「最近命中」语义。
 * 传入 camera 时再按视锥剔除（包围球包含整台车，屏幕准星命中必然在视锥内）。
 */
/** aimedVehicle 的车辆候选（场景侧 vehicles 视图：GLB 根 + 身份/资产面）。 */
export interface AimedVehicleCandidate {
  glb: Group
  def: AgentVehicleTrack | { eid?: number; tank_id?: number | null; equipment?: unknown }
  tankData?: unknown
  group?: Object3D
  /** GLB 装配部件姿态（poseT/poseG/gunNodes；syncPose 与 armor 网格跟随消费） */
  glbParts?: { poseT: THREE.Matrix4; poseG: THREE.Matrix4; gunNodes: Object3D[] }
}

export function aimedVehicle(origin: THREE.Vector3, direction: THREE.Vector3, vehicles: AimedVehicleCandidate[], camera: PerspectiveCamera | null = null): AimedVehicleCandidate | null {
  _pickRaycaster.set(origin, direction)
  if (camera) {
    _pickViewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    _pickFrustum.setFromProjectionMatrix(_pickViewProjection, camera.coordinateSystem)
  }
  _pickCandidates.length = 0
  _pickPoolUsed = 0
  for (const v of vehicles) {
    _pickRoot.setFromMatrixPosition(v.glb.matrixWorld)
    if (_pickRaycaster.ray.distanceSqToPoint(_pickRoot) > VEHICLE_PICK_RADIUS_M ** 2) continue
    if (camera) {
      _pickSphere.center.copy(_pickRoot)
      _pickSphere.radius = VEHICLE_PICK_RADIUS_M
      if (!_pickFrustum.intersectsSphere(_pickSphere)) continue
    }
    const along = _pickOffset.subVectors(_pickRoot, origin).dot(_pickRaycaster.ray.direction)
    const c = _pickPool[_pickPoolUsed] || (_pickPool[_pickPoolUsed] = { v: null as AimedVehicleCandidate | null, lower: 0 })
    _pickPoolUsed++
    c.v = v
    c.lower = Math.max(0, along - VEHICLE_PICK_RADIUS_M)
    _pickCandidates.push(c)
  }
  _pickCandidates.sort((a, b) => a.lower - b.lower)
  let best: AimedVehicleCandidate | null = null, bestDistance = Infinity
  for (const cand of _pickCandidates) {
    const v = cand.v
    const lower = cand.lower
    if (!v || lower > bestDistance) continue
    _pickMeshes.length = 0
    _pickHits.length = 0
    collectVisibleMeshes(v.glb, _pickMeshes)
    for (const mesh of _pickMeshes) {
      refreshPickBounds(mesh.geometry)
      mesh.raycast(_pickRaycaster, _pickHits)
    }
    for (const hit of _pickHits) {
      if (hit.distance < bestDistance) { best = v; bestDistance = hit.distance }
    }
  }
  return best
}

const _rectCorner = new THREE.Vector3()
/**
 * 世界包围盒的屏幕矩形（NDC，已钳到视口）。盒子穿过近裁剪面时投影不可靠，退回整屏；
 * 完全在视口外返回 null。
 */
export function screenRect(box: Box3, camera: PerspectiveCamera): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (let i = 0; i < 8; i++) {
    _rectCorner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z)
    _rectCorner.applyMatrix4(camera.matrixWorldInverse)
    if (_rectCorner.z >= -camera.near) return { x0: -1, y0: -1, x1: 1, y1: 1 }
    _rectCorner.applyMatrix4(camera.projectionMatrix)
    x0 = Math.min(x0, _rectCorner.x); x1 = Math.max(x1, _rectCorner.x)
    y0 = Math.min(y0, _rectCorner.y); y1 = Math.max(y1, _rectCorner.y)
  }
  const rect = { x0: Math.max(x0, -1), y0: Math.max(y0, -1), x1: Math.min(x1, 1), y1: Math.min(y1, 1) }
  return rect.x1 > rect.x0 && rect.y1 > rect.y0 ? rect : null
}

const _cropMatrix = new THREE.Matrix4()
const _viewProjection = new THREE.Matrix4()
/** 只包住 `rect` 的视锥：屏幕矩形外的物体不可能挡住矩形内的像素。 */
export function cropFrustum(camera: PerspectiveCamera, rect: { x0: number; y0: number; x1: number; y1: number }, out: Frustum): Frustum {
  const w = rect.x1 - rect.x0, h = rect.y1 - rect.y0
  _cropMatrix.set(
    2 / w, 0, 0, -(rect.x1 + rect.x0) / w,
    0, 2 / h, 0, -(rect.y1 + rect.y0) / h,
    0, 0, 1, 0,
    0, 0, 0, 1,
  )
  _viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
  return out.setFromProjectionMatrix(_cropMatrix.multiply(_viewProjection), camera.coordinateSystem)
}

const _occluderSphere = new THREE.Sphere()
const _occluderOffset = new THREE.Vector3()
/** `view` = {frustum, origin, forward, maxDepth}：物体落在目标屏幕矩形外或完全在目标之后就挡不住它。 */
/** 遮挡剔除的视锥视图（cropFrustum 产出 + 目标深度上界）。 */
export interface OccluderView {
  frustum: Frustum
  origin: THREE.Vector3
  forward: THREE.Vector3
  maxDepth: number
}

const _occluderBox = new THREE.Box3()
const _occluderHalf = new THREE.Vector3()
export function canOccludeTarget(object: Object3D, view: OccluderView): boolean {
  if (object.frustumCulled === false) return true
  const withGeometry = object as Object3D & Partial<Mesh> & { boundingSphere?: Sphere | null }
  // 悬挂形变后的 bounds 只在拾取时刷新，友军履带等非候选车辆可能还是旧值，不能据此剔除
  if (withGeometry.geometry?.userData?.pickBoundsStale) return true
  // InstancedMesh 批次优先用批次世界 AABB（refreshBatchSphere 产出的 userData.occluderBox，
  // 局部系批次盒——宫格批次的包围球是整格尺寸，远目标长视锥会把整批实例拉进遮挡集；
  // AABB 是保守包围，只少画不漏画。可破坏物批次（实例矩阵运行期会变）置 null 回退球。
  const occluderBox = (object.userData as { occluderBox?: THREE.Box3 | null } | undefined)?.occluderBox
  if (occluderBox) {
    _occluderBox.copy(occluderBox).applyMatrix4(object.matrixWorld)
    if (!view.frustum.intersectsBox(_occluderBox)) return false
    _occluderHalf.subVectors(_occluderBox.max, _occluderBox.min).multiplyScalar(0.5)
    const depth = _occluderOffset
      .set(
        (_occluderBox.min.x + _occluderBox.max.x) / 2,
        (_occluderBox.min.y + _occluderBox.max.y) / 2,
        (_occluderBox.min.z + _occluderBox.max.z) / 2,
      )
      .sub(view.origin)
      .dot(view.forward)
      - _occluderHalf.x * Math.abs(view.forward.x)
      - _occluderHalf.y * Math.abs(view.forward.y)
      - _occluderHalf.z * Math.abs(view.forward.z)
    return depth <= view.maxDepth
  }
  // InstancedMesh 的包围球在对象上，几何上的只是单个实例；未算出时不能回落到几何
  const sphere = withGeometry.boundingSphere !== undefined ? withGeometry.boundingSphere : withGeometry.geometry?.boundingSphere
  if (!sphere) return true
  _occluderSphere.copy(sphere).applyMatrix4(object.matrixWorld)
  if (!view.frustum.intersectsSphere(_occluderSphere)) return false
  const depth = _occluderOffset.subVectors(_occluderSphere.center, view.origin).dot(view.forward)
  return depth - _occluderSphere.radius <= view.maxDepth
}

/** 能挡住炮弹视线的世界几何：不透明、写深度，且不是植被（树丛不挡弹）。 */
export function isSolidOccluder(object: Object3D): boolean {
  const mesh = object as Mesh
  const materials = Array.isArray(mesh.material) ? mesh.material : (mesh.material ? [mesh.material] : [])
  return materials.every((m) => !!m && !m.transparent && m.depthWrite !== false && !(m as Material & { uniforms?: Record<string, unknown> }).uniforms?.uFoliageClip)
}

/** 炮塔/炮管 armor 网格跟随的姿态：与 glbParts 的 poseT/poseG 一一对应。 */
export function armorPosePart(name: string): 'turret' | 'gun' | 'hull' {
  if (/^turret_\d+/.test(name)) return 'turret'
  if (/^gun_\d+/.test(name)) return 'gun'
  return 'hull'
}

/** armor 世界矩阵 = GLB 根 × 部件姿态 × armor 静止矩阵（画面上的车摆在哪，装甲就在哪）。 */
export function armorWorldMatrix(root: THREE.Matrix4, pose: THREE.Matrix4, rest: THREE.Matrix4, out: THREE.Matrix4): THREE.Matrix4 {
  return out.copy(root).multiply(pose).multiply(rest)
}

function shellUniforms(shell: AgentPlaybackShot | Record<string, unknown>, caliber: number) {
  const type = shellTypeOf(shell as { type?: unknown })
  const isHE = type === 'he'
  const isExplosive = isHE || type === 'heat'
  return { type, isHE, isExplosive, caliber, ...shellAngles(shell as { normalization?: number | null; ricochet?: number | null }, isExplosive) }
}

/** render(frame) 的装配参数（宿主 renderArmorHighlight 现取现传）。 */
export interface ArmorHighlightPerfStats {
  pickMs: number
  stateMs: number
  thicknessMs: number
  occluderMs: number
  colorMs: number
  calls: number
  /** passBegin 的工作字段（perfFrame 读取前由 renderArmorHighlight 每帧清零） */
  _t0: number
}

export interface ArmorHighlightFrame {
  scene: Scene
  camera: PerspectiveCamera
  vehicle: AimedVehicleCandidate & { def: { eid: number; tank_id?: number | null; equipment?: unknown } }
  tankData: { model_url?: string | null; [key: string]: unknown }
  config: unknown
  shell: AgentPlaybackShot | Record<string, unknown>
  caliber: number
  penMul: number
  thickMul: number
  onReady: () => void
  /** ?perf 逐 pass 计时（仅 PERF 传入；调用方已关闭 info.autoReset 并逐帧 reset） */
  stats?: ArmorHighlightPerfStats
  /** 语义化遮挡根（issue #850 F）：地形/场景 GLB/占位地面/每车低模组、GLB/飞炮塔 */
  occluderRoots?: Object3D[]
}

export function createArmorHighlight({ renderer, assetProvider }: {
  renderer: WebGLRenderer
  /** logical asset API（scene/assetProvider 的结构面） */
  assetProvider: { bytes(path: string): Promise<Uint8Array> }
}): { render(frame: ArmorHighlightFrame): void; prefetch(vehicles: AimedVehicleCandidate[]): void; prewarm(camera: PerspectiveCamera): void; releaseRenderTargets(): void; dispose(): void } {
  const shaders = createArmorShaderContext()
  const templates = new Map<number, Promise<Object3D | null>>()    // tankId → Promise<armor 模板 | null>
  const targets = new Map<number, { glb: Group; armor: BuiltTarget | null }>()      // eid → 已构建的目标（外部模块引用该车的 GLB 实例）
  const pending = new Set<number>()
  const templateRetry = createLoadRetry()
  const excludeMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, depthTest: true, depthWrite: true })
  const occluderMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide })
  const depthMaterials = {
    omit: standardDepthMaterial(),
    spacedOmit: standardDepthMaterial(THREE.DoubleSide),
    externalDepth: standardDepthMaterial(),
  }
  let stateRT: THREE.WebGLRenderTarget | null = null, spacedRT: THREE.WebGLRenderTarget | null = null
  const size = new THREE.Vector2()
  const clearColor = new THREE.Color()
  const world = new THREE.Vector3()
  const clipMatrix = new THREE.Matrix4()
  const identity = new THREE.Matrix4()
  const clipNormal = new THREE.Vector3(0, 1, 0)
  const clipPoint = new THREE.Vector3()
  const armorBox = new THREE.Box3()
  const armorSphere = new THREE.Sphere()
  const scissor = new THREE.Vector4()
  const savedScissor = new THREE.Vector4()
  const occluderView = {
    frustum: new THREE.Frustum(), origin: new THREE.Vector3(), forward: new THREE.Vector3(), maxDepth: 0,
  }
  // 辅助 RT pass 的视口偏移相机（主相机的拷贝 + setViewOffset 到目标矩形）；color pass 仍用主相机。
  const armorCamera = new THREE.PerspectiveCamera()
  const spacedRect = new THREE.Vector4(0, 0, 1, 1)
  /** ?perf 逐 pass 计时：renderer.render 返回 ≠ GPU 完成，这些是 CPU submit 时间。 */
  function passBegin(stats: ArmorHighlightPerfStats | null): number {
    if (!stats) return 0
    stats._t0 = performance.now()
    return renderer.info.render.calls
  }
  function passEnd(stats: ArmorHighlightPerfStats | null, key: 'stateMs' | 'thicknessMs' | 'occluderMs' | 'colorMs', beginCalls: number): void {
    if (!stats) return
    stats[key] += performance.now() - stats._t0
    stats.calls += renderer.info.render.calls - beginCalls
  }

  function loadTemplate(tankId: number, url: string): Promise<Object3D | null> {
    const cached = templates.get(tankId)
    if (cached) return cached
    const promise: Promise<Object3D | null> = assetProvider.bytes(url)
      .then((bytes) => new Promise<Object3D | null>((resolve) => {
        new GLTFLoader().parse(bytes.buffer as ArrayBuffer, '', (gltf) => resolve(gltf.scene), () => resolve(null))
      }))
      .then((model) => { if (model) useFaceNormals(model); return model })
      .catch((error) => { console.warn('[playback] armor 模型加载失败 tank_id=' + tankId + ':', error); return null })
      .then((model) => {
        if (model) templateRetry.succeed(tankId)
        else { templates.delete(tankId); templateRetry.fail(tankId) }
        return model
      })
    templates.set(tankId, promise)
    return promise
  }

/** 已构建的目标（三个辅助场景 + 克隆清单 + gun_mask 裁切面）。 */
interface BuiltTarget {
  state: Scene
  thickness: Scene
  color: Scene
  clones: Mesh[]
  clipPlane: THREE.Plane | null
  maskOrigin: number | null
}

function buildTarget(template: Object3D, vehicle: AimedVehicleCandidate, tankData: import('../viewer/armorPlateModel.js').TankArmorData, cfg: import('../viewer/armorPlateModel.js').TankArmorConfig): BuiltTarget | null {
    const pivots = armorPivots(tankData, cfg)
    if (!pivots) return null
    const model = template.clone(true)
    const thicknessOf = (section: string, plateId: string): number => plateThickness(tankData, cfg, section, plateId)
    tagArmorPlates(model, thicknessOf)
    applyArmorConfigVisible(model, cfg, collectArmorPrefixes(model))
    retagSpacedSections(model, tankData, cfg)
    model.traverse((node) => { const mesh = node as Mesh; if (mesh.isMesh && mesh.userData.armorSection === 'deco') mesh.visible = false })
    installArmorPivots(model, pivots)
    model.updateMatrixWorld(true)

    const moduleMeshes = tagModuleMeshes(vehicle.glb, thicknessOf)
    const glbParts = vehicle.glbParts
    const gunName = (glbParts?.gunNodes ?? []).map((n) => (n.name || '').match(/^gun_(\d+)$/)).find(Boolean)
    const { primary, spaced } = partitionArmorMeshes(model)
    const external = selectExternalMeshes(moduleMeshes, gunName ? parseInt(gunName[1], 10) : null, cfg)
    const meshes = { primary, spaced, external }
    const maskOrigin = gunMaskOriginModel(tankData, cfg)
    const clipPlane = maskOrigin == null ? null : new THREE.Plane()
    const materials = {
      ...depthMaterials, exclude: excludeMaterial,
      externalMaterial: shaders.externalMaterial, moduleStateMaterial: shaders.moduleStateMaterial,
      spacedMaterial: shaders.spacedMaterial, spacedStateMaterial: shaders.spacedStateMaterial,
      penetrationMaterial: shaders.penetrationMaterial,
    }
    const state = new THREE.Scene(), thickness = new THREE.Scene(), color = new THREE.Scene()
    populateSpacedStateScene(state, meshes, materials, 200, clipPlane)
    populateSpacedArmorScene(thickness, meshes, materials, 200, clipPlane)
    populatePrimaryArmorScene(color, meshes, materials)
    const clones: Mesh[] = []
    for (const scene of [state, thickness, color]) {
      scene.traverse((node) => {
        const meshNode = node as Mesh
        if (!meshNode.isMesh) return
        const src = meshNode.userData._src as Mesh
        node.userData._external = external.includes(src)
        node.userData._part = armorPosePart((src as Mesh).name || '')
        if (!node.userData._external) node.userData._rest = src.matrixWorld.clone()
        clones.push(node as Mesh)
      })
    }
    return { state, thickness, color, clones, clipPlane, maskOrigin }
  }

  /** 目标 armor 就绪则返回，否则懒加载（完成后 `onReady` 让场景补一帧）并返回 null。 */
  function targetArmor(vehicle: ArmorHighlightFrame['vehicle'], tankData: ArmorHighlightFrame['tankData'], cfg: import('../viewer/armorPlateModel.js').TankArmorConfig | null | undefined, onReady: () => void): BuiltTarget | null {
    const eid = vehicle.def.eid
    const known = targets.get(eid)
    if (known && known.glb === vehicle.glb) return known.armor
    if (known) { disposeTarget(known.armor); targets.delete(eid) }   // GLB 重建后外部模块引用已失效
    const tankId = vehicle.def.tank_id
    if (tankId == null || pending.has(eid) || !tankData.model_url || !templateRetry.allowed(tankId)) return null
    pending.add(eid)
    loadTemplate(tankId, tankData.model_url).then((template) => {
      pending.delete(eid)
      if (disposed || !vehicle.glb || !template) return
      targets.set(eid, { glb: vehicle.glb, armor: buildTarget(template, vehicle, tankData, cfg as import('../viewer/armorPlateModel.js').TankArmorConfig) })  // cfg 形状由 armorHighlightBlock 验证在场
      onReady()
    })
    return null
  }

  function syncPose(target: BuiltTarget, vehicle: ArmorHighlightFrame['vehicle']): void {
    const root = vehicle.glb.matrixWorld
    const { poseT, poseG } = (vehicle as { glbParts: { poseT: THREE.Matrix4; poseG: THREE.Matrix4 } }).glbParts
    for (const clone of target.clones) {
      if (clone.userData._external) { clone.matrix.copy(clone.userData._src.matrixWorld); continue }
      const part = clone.userData._part
      const pose = part === 'turret' ? poseT : part === 'gun' ? poseG : identity
      armorWorldMatrix(root, pose, clone.userData._rest, clone.matrix)
    }
    if (target.clipPlane && target.maskOrigin != null) {
      target.clipPlane.setFromNormalAndCoplanarPoint(clipNormal, clipPoint.set(0, target.maskOrigin, 0))
      target.clipPlane.applyMatrix4(clipMatrix.multiplyMatrices(root, poseG))
    }
  }

  function syncUniforms(target: BuiltTarget, camera: PerspectiveCamera, { shell, caliber, penMul, thickMul }: Pick<ArmorHighlightFrame, 'shell' | 'caliber' | 'penMul' | 'thickMul'>): void {
    const s = shellUniforms(shell, caliber)
    for (const clone of target.clones) {
      const u = (clone.material as Material & { uniforms?: Record<string, { value: unknown }> }).uniforms
      if (!u) continue
      if (u.thickness && clone.userData._baseThickness != null) u.thickness.value = clone.userData._baseThickness * thickMul
      if (u.penetration) {
        if (!clone.geometry.boundingSphere) clone.geometry.computeBoundingSphere()
        const sphere0 = clone.geometry.boundingSphere as THREE.Sphere
        world.copy(sphere0.center).applyMatrix4(clone.matrix)
        const distance = camera.position.distanceTo(world)
        u.penetration.value = rolledPenetration((shell as { penetration?: number }).penetration || 0, (shell as { penetration_far?: number }).penetration_far, distance, s.isHE) * penMul
      }
      if (u.caliber) u.caliber.value = s.caliber
      if (u.ricochet) u.ricochet.value = s.rico
      if (u.normalization) u.normalization.value = s.norm
      if (u.isExplosive) u.isExplosive.value = s.isExplosive
      if (u.canSplash) u.canSplash.value = s.isHE
      if (u.damage) u.damage.value = (shell as { damage?: number }).damage || 0
      if (u.explosionRadius) u.explosionRadius.value = (shell as { explosion_radius?: number }).explosion_radius || 0
      if (u.heatmapMask) u.heatmapMask.value = true   // 没有点击爆点：HE 只显示可直穿像素
    }
  }

  function ensureTargets(rtW: number, rtH: number): void {
    if (stateRT && stateRT.width >= rtW && stateRT.height >= rtH) return
    disposeTargets()
    const floatCapable = renderer.extensions.has('EXT_color_buffer_float')
      || renderer.extensions.has('EXT_color_buffer_half_float')
    const options = () => ({
      type: floatCapable ? THREE.HalfFloatType : THREE.UnsignedByteType,
      depthTexture: new THREE.DepthTexture(rtW, rtH),
    })
    stateRT = new THREE.WebGLRenderTarget(rtW, rtH, options())
    spacedRT = new THREE.WebGLRenderTarget(rtW, rtH, options())
  }

  function bindBuffers(target: BuiltTarget, camera: PerspectiveCamera, spacedRect: THREE.Vector4): void {
    const rt = stateRT as THREE.WebGLRenderTarget
    const spaced = spacedRT as THREE.WebGLRenderTarget
    const satGuard = rt.texture.type === THREE.HalfFloatType ? 0 : 1
    target.color.traverse((node) => {
      const meshNode = node as Mesh
      const u = meshNode.isMesh
        ? (meshNode.material as Material & { uniforms?: Record<string, { value: unknown }> }).uniforms
        : undefined
      if (!u || !u.spacedArmorBuffer) return
      u.spacedArmorBuffer.value = spaced.texture
      u.spacedStateBuffer.value = rt.texture
      u.spacedArmorDepth.value = spaced.depthTexture
      u.spacedSatGuard.value = satGuard
      u.inverseProjectionMatrix.value = camera.projectionMatrixInverse
      if (u.spacedRect) u.spacedRect.value = spacedRect.clone()
    })
  }

  /** 目标 armor 的世界包围盒（逐块按本帧姿态，炮塔转动后仍贴合）。 */
  function armorBounds(target: BuiltTarget): Box3 {
    armorBox.makeEmpty()
    for (const clone of target.clones) {
      if (!clone.geometry.boundingSphere) clone.geometry.computeBoundingSphere()
      const cloneSphere = clone.geometry.boundingSphere as THREE.Sphere
      armorSphere.copy(cloneSphere).applyMatrix4(clone.matrix)
      armorBox.expandByPoint(world.copy(armorSphere.center).addScalar(armorSphere.radius))
      armorBox.expandByPoint(world.copy(armorSphere.center).subScalar(armorSphere.radius))
    }
    return armorBox
  }

  /** NDC 矩形 → 绘制缓冲像素（外扩后钳到缓冲内）。 */
  function scissorRect(rect: { x0: number; y0: number; x1: number; y1: number }): THREE.Vector4 {
    const left = Math.max(Math.floor((rect.x0 + 1) / 2 * size.x) - SCISSOR_MARGIN_PX, 0)
    const bottom = Math.max(Math.floor((rect.y0 + 1) / 2 * size.y) - SCISSOR_MARGIN_PX, 0)
    const right = Math.min(Math.ceil((rect.x1 + 1) / 2 * size.x) + SCISSOR_MARGIN_PX, size.x)
    const top = Math.min(Math.ceil((rect.y1 + 1) / 2 * size.y) + SCISSOR_MARGIN_PX, size.y)
    return scissor.set(left, bottom, right - left, top - bottom)
  }

  /** 目标整棵子树不进遮挡集：否则目标车模自己挡住装甲。 */
  function markOccluders(camera: PerspectiveCamera, vehicle: ArmorHighlightFrame['vehicle'], view: OccluderView, roots: Object3D[]): number {
    // 语义化遮挡根（调用方给：地形/场景 GLB/占位地面/每车低模组、GLB/飞炮塔），不做全场景
    // traverseVisible——特效/轨迹/标注/基地/边界/天穹都是透明、非网格或无穷远，本来就
    // 挡不住弹道，从遍历里省掉（遮挡语义不变：墙体/车辆遮挡、树丛不遮挡）。
    let count = 0
    for (const root of roots) {
      if (!root || !root.visible) continue
      root.traverseVisible((object) => {
        const meshNode = object as Mesh
        if (!meshNode.isMesh) return
        if (object.layers.test(camera.layers) && isSolidOccluder(object) && canOccludeTarget(object, view)) {
          object.layers.enable(OCCLUDER_LAYER)
          count++
        } else object.layers.disable(OCCLUDER_LAYER)
      })
    }
    vehicle.glb.traverse((node) => node.layers.disable(OCCLUDER_LAYER))
    vehicle.group?.traverse((node) => node.layers.disable(OCCLUDER_LAYER))
    return count
  }

  function drawOccluderDepth(scene: Scene, camera: PerspectiveCamera, vehicle: ArmorHighlightFrame['vehicle'], view: OccluderView, roots: Object3D[]): void {
    const count = markOccluders(camera, vehicle, view, roots)
    // 零遮挡快速路径：走廊内没有任何能挡住目标的实体（开阔地直射的常见形态），
    // clearDepth 已把目标矩形深度清空——装甲不被任何世界几何挡住，跳过整个世界重绘。
    if (count === 0) return
    const mask = camera.layers.mask, background = scene.background
    camera.layers.set(OCCLUDER_LAYER)
    scene.background = null
    scene.overrideMaterial = occluderMaterial
    renderer.render(scene, camera)
    scene.overrideMaterial = null
    scene.background = background
    camera.layers.mask = mask
  }

  let disposed = false
  let rtShrinkStreak = 0
  /**
   * 主渲染之后调用。`frame` = {scene, camera, vehicle, tankData, config, shell, caliber,
   * penMul, thickMul, onReady}；目标 armor 未就绪时不画（本帧画面与关闭时相同）。
   */
  function render(frame: ArmorHighlightFrame): void {
    const { scene, camera, vehicle } = frame
    const stats = frame.stats ?? null
    if (stats) { stats.stateMs = 0; stats.thicknessMs = 0; stats.occluderMs = 0; stats.colorMs = 0; stats.calls = 0 }
    const target = targetArmor(vehicle, frame.tankData, frame.config as import('../viewer/armorPlateModel.js').TankArmorConfig | null, frame.onReady)
    if (!target) return
    renderer.getDrawingBufferSize(size)
    syncPose(target, vehicle)
    const bounds = armorBounds(target)
    const rect = screenRect(bounds, camera)
    if (!rect) return
    syncUniforms(target, camera, frame)

    // 所有叠加 pass 只碰目标的屏幕矩形；遮挡集只留能挡住它的物体，主渲染的画面不受影响
    cropFrustum(camera, rect, occluderView.frustum)
    occluderView.origin.copy(camera.position)
    camera.getWorldDirection(occluderView.forward)
    bounds.getBoundingSphere(armorSphere)
    occluderView.maxDepth = world.subVectors(armorSphere.center, camera.position).dot(occluderView.forward)
      + armorSphere.radius
    scissorRect(rect)

    // RT 只需罩住目标矩形（64px 取整、只增不减 + 收缩滞回）；两张辅助 RT 用视口偏移相机
    // 把该矩形拉伸到整张 RT（setViewOffset 只偏移投影 xy，NDC z 与主相机逐位一致）。
    // color pass 仍画回默认帧缓冲的目标矩形，buffer 采样经 spacedRect 从全画面 UV 映射回 RT 局部。
    const rtW = bucketedRtSize(scissor.z, size.x)
    const rtH = bucketedRtSize(scissor.w, size.y)
    if (stateRT && rtW * rtH * 4 <= stateRT.width * stateRT.height) {
      if (++rtShrinkStreak >= 90) { disposeTargets(); rtShrinkStreak = 0 }
    } else rtShrinkStreak = 0
    ensureTargets(rtW, rtH)
    shaders.resUniform.value.copy(size)
    spacedRectOf(scissor.x, scissor.y, scissor.z, scissor.w, size.x, size.y, spacedRect)
    armorCamera.copy(camera)
    armorCamera.setViewOffset(size.x, size.y, scissor.x, size.y - (scissor.y + scissor.w), scissor.z, scissor.w)
    armorCamera.updateProjectionMatrix()
    bindBuffers(target, camera, spacedRect)
    for (const rt of [stateRT, spacedRT]) {
      if (!rt) continue
      rt.scissor.set(0, 0, rtW, rtH)
      rt.scissorTest = false
    }

    const autoClear = renderer.autoClear, clipping = renderer.localClippingEnabled
    const shadows = renderer.shadowMap.autoUpdate, clearAlpha = renderer.getClearAlpha()
    const scissorTest = renderer.getScissorTest()
    renderer.getScissor(savedScissor)
    renderer.getClearColor(clearColor)
    renderer.localClippingEnabled = true
    renderer.shadowMap.autoUpdate = false
    renderer.setClearColor(0x000000, 0)
    renderer.autoClear = true
    let calls = passBegin(stats)
    renderer.setRenderTarget(stateRT)
    renderer.render(target.state, armorCamera)
    passEnd(stats, 'stateMs', calls)
    calls = passBegin(stats)
    renderer.setRenderTarget(spacedRT)
    renderer.render(target.thickness, armorCamera)
    passEnd(stats, 'thicknessMs', calls)
    renderer.setRenderTarget(null)
    const pixelRatio = renderer.getPixelRatio()
    renderer.setScissor(scissor.x / pixelRatio, scissor.y / pixelRatio, scissor.z / pixelRatio, scissor.w / pixelRatio)
    renderer.setScissorTest(true)
    renderer.autoClear = false
    renderer.clearDepth()
    calls = passBegin(stats)
    drawOccluderDepth(scene, camera, vehicle, occluderView, frame.occluderRoots ?? [scene])
    passEnd(stats, 'occluderMs', calls)
    calls = passBegin(stats)
    renderer.render(target.color, camera)
    passEnd(stats, 'colorMs', calls)
    renderer.setScissorTest(scissorTest)
    renderer.setScissor(savedScissor)
    renderer.autoClear = autoClear
    renderer.localClippingEnabled = clipping
    renderer.shadowMap.autoUpdate = shadows
    renderer.setClearColor(clearColor, clearAlpha)
  }

  function disposeTargets(): void {
    for (const rt of [stateRT, spacedRT]) {
      if (!rt) continue
      rt.depthTexture?.dispose()
      rt.dispose()
    }
    stateRT = spacedRT = null
  }

  /** 离开开镜/关闭开关时释放装甲 RT；下次命中目标时 `ensureTargets` 按需重建。 */
  function releaseRenderTargets(): void {
    disposeTargets()
    rtShrinkStreak = 0
  }

  /** 进开镜后后台预取本场敌方车型的 armor 模板（按 tank_id 去重，失败走同一重试表）。 */
  function prefetch(vehicles: AimedVehicleCandidate[]): void {
    for (const vehicle of vehicles) {
      const tankId = vehicle.def?.tank_id
      const url = (vehicle.tankData as { model_url?: string | null } | undefined)?.model_url
      if (!tankId || !url || templates.has(tankId) || !templateRetry.allowed(tankId)) continue
      loadTemplate(tankId, url)
    }
  }

  function disposeTarget(target: BuiltTarget | null): void {
    if (!target) return
    const released = new Set()
    for (const clone of target.clones) {
      if (released.has(clone.material)) continue
      released.add(clone.material)
      ;(clone.material as Material).dispose()
    }
  }

  function dispose(): void {
    disposed = true
    for (const target of targets.values()) disposeTarget(target.armor)
    targets.clear()
    for (const promise of templates.values()) {
      promise.then((model) => model?.traverse((node) => (node as Mesh).geometry?.dispose()))
    }
    templates.clear()
    disposeTargets()
    for (const material of [excludeMaterial, occluderMaterial, ...Object.values(depthMaterials)]) material.dispose()
    for (const material of warmMaterials ?? []) material.dispose()
    warmMaterials = null
    shaders.dispose()
  }

  let warmMaterials: Material[] | null = null
  /** 装甲材质变体预热：占位几何 + 每个运行期变体（含裁切/双面分支）提前 `renderer.compile`，
   *  把首次编译从「第一次瞄准新车型的那一帧」挪到加载阶段。预热材质必须持有引用不释放
   *  （program 缓存按 cacheKey 共享，材质释放会连同释放 program）。幂等。 */
  function prewarm(camera: PerspectiveCamera): void {
    if (warmMaterials || disposed) return
    if (typeof renderer.compile !== 'function') return
    try {
      const clipPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
      const clippedDepth = depthMaterials.externalDepth.clone()
      clippedDepth.side = THREE.DoubleSide
      clippedDepth.clippingPlanes = [clipPlane]
      warmMaterials = [
        excludeMaterial, occluderMaterial,
        depthMaterials.omit, depthMaterials.spacedOmit, depthMaterials.externalDepth, clippedDepth,
        shaders.penetrationMaterial(0), shaders.penetrationMaterial(60),
        shaders.spacedMaterial(0, 200, THREE.FrontSide), shaders.spacedMaterial(0, 200, THREE.DoubleSide),
        shaders.spacedStateMaterial(0, 200),
        shaders.externalMaterial(20, 200, null), shaders.externalMaterial(20, 200, clipPlane),
        shaders.moduleStateMaterial(null), shaders.moduleStateMaterial(clipPlane),
      ]
      const geo = new THREE.BoxGeometry(1, 1, 1)
      const scene = new THREE.Scene()
      for (const material of warmMaterials) {
        const mesh = new THREE.Mesh(geo, material)
        mesh.frustumCulled = false
        scene.add(mesh)
      }
      const wasClipping = renderer.localClippingEnabled
      renderer.localClippingEnabled = true
      try { renderer.compile(scene, camera) } finally { renderer.localClippingEnabled = wasClipping }
      scene.clear()
    } catch (e) {
      console.warn('[playback] armor 材质预热失败（忽略）:', e)
    }
  }

  return { render, prefetch, prewarm, releaseRenderTargets, dispose }
}

/** 回放 equipment 原值 → 着色系数（调用方已确认双方 equipment 在场）。 */
export function armorEquipmentCoeffs(shell: AgentPlaybackShot | Record<string, unknown>, authorEquipment: unknown, targetEquipment: unknown): { penMul: number; thickMul: number } {
  return {
    penMul: Array.isArray(authorEquipment) && authorEquipment.includes(EQ_CALIBRATED_SHELLS) ? calibratedPenMul(shellTypeOf(shell as { type?: unknown })) : 1.0,
    thickMul: Array.isArray(targetEquipment) && targetEquipment.includes(EQ_ENHANCED_ARMOR) ? ENHANCED_ARMOR_THICK_MUL : 1.0,
  }
}
