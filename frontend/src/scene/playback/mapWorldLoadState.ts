// 地图资产装载管线共享状态面（st 快照接口）与调试钩子——自 mapWorldLoad.ts 出仓
//（2026-11-21 #LOC 结构拆分：代码与搬移前逐字一致）。
import * as THREE from 'three'
import type { Texture, ShaderMaterial, Scene, PerspectiveCamera, WebGLRenderer, DirectionalLight, HemisphereLight } from 'three'
import type { GroundLayersField } from '../sceneryAssembly.js'
import type { DestructibleFoldState } from '../destructibles.js'
import type { buildDecalMeshes } from './deferredDecals.js'
import type { createPerf } from './perf.ts'
type PerfHandle = ReturnType<typeof createPerf>

/** loadMapImage 读写的世界状态面（owner = 宿主 mapWorld 闭包；getter/setter 快照）。 */
export interface MapWorldLoadState {
  mapPlane: THREE.Mesh | null
  mapTexture: Texture | null
  mapMetaInfo: MapMetaSurface | null
  groundLayers: { layers: GroundLayersField['layers']; texs: Record<string, Texture> } | null
  terrainMesh: THREE.Mesh | null
  heightField: Float32Array | null
  heightMeta: HeightMetaSurface | null
  waterTexDispose: { dispose(): void } | null
  mapScenery: THREE.Object3D | null
  decalGroup: ReturnType<typeof buildDecalMeshes> | null
  decalAtlas: Texture | null
  grassLayer: { group: THREE.Group; materials: THREE.ShaderMaterial[]; dispose(): void } | null
  grassProtoScene: THREE.Object3D | null
  terrainRefineMask: unknown
  destruct: DestructRuntime | null
  destructPickList: unknown[] | null
  meshOwner: Map<string, unknown> | Record<string, unknown> | null
  currentMapKey: string | null
  currentMapBases: unknown
  waterMeshes: THREE.Object3D[]
  waterLevel: number | null
  animLayerMats: ShaderMaterial[]
  groundMesh: THREE.Mesh | null
  gridHelper: THREE.GridHelper | null
  occlGrid: Map<string, unknown[]> | null
  annotationSurfaceGrid: unknown
  WORLD_CENTER: { cx: number; cz: number; ext: number }
  envTexture: Texture | null
  envMultiplier: number
}



/** ?debug 诊断钩子（window.__terrain / __destructStage / __waterCoast / __gdbg 等；宿主 JS 域裸写口径）。 */
export const debugWindow = (typeof window !== 'undefined' ? window : {}) as Window & {
  __destructStage?: unknown
  __destructDebug?: unknown
  __terrain?: unknown
  __waterCoast?: unknown
  __waterMats?: unknown
  __waterMerged?: unknown
  __animLayerMats?: unknown
  __sceneryAniso?: unknown
  __terrainRefineMask?: unknown
  __prunedVariantNodes?: unknown
  __mapBorderNodes?: unknown
  __gdbg?: unknown
  __grass?: unknown
}

/** catch (e) 的诊断取值面：`e && e.message ? e.message : e` 的窄化等价体（运行时逐值一致）。 */
export function errorMessage(e: unknown): unknown {
  const err = e as { message?: unknown }
  return err && err.message ? err.message : e
}

// ---- mapWorld 宿主/装载共享类型（#LOC 结构拆分出仓；owner = 各消费模块） ----
/** terrain.json sidecar 元数据（groundPass.loadTerrain 产物；本模块消费的字段面）。 */
export interface HeightMetaSurface {
  size?: number
  span?: number
  zmax?: number
  terrainLayout?: unknown
  playableBounds?: { xMin: number; xMax: number; yMin: number; yMax: number } | null
}

/** X-Map-Meta 铺设参数（底图响应头 JSON；本模块消费的字段面）。 */
export interface MapMetaSurface {
  size_m?: number
  x?: number
  z?: number
  rot90?: number
  flip_x?: boolean
}

/** 可破坏物运行时（assembleMapScenery 产物；槽位/槽位矩阵形状见 mapAssets.js 装配）。 */
export interface DestructRuntime {
  states: DestructibleFoldState[]
  ptr: number
  lastT: number
  animating?: boolean
}

/** 推进循环视角的折叠状态面：DestructibleFoldState + 装配/推进保证存在的字段
 *  （树的 pivotPos/fallQuat 由 mapAssets 装配段回填；applied 是本循环写入的游标标记）。 */
export interface DestructState extends DestructibleFoldState {
  applied?: boolean
  pivotPos: { x: number; y: number; z: number }
  fallQuat: { w: number }
}

/** 本模块消费的回放数据面（buildWorld 车辆云心 + loadMapImage 元数据）。
 *  map_id 按 assembleMapScenery 的消费面口径（variant 裁剪）声明为必有 number。 */
export interface WorldPlaybackData {
  meta: { map_id: number; map_name?: string | null; t_start?: number }
  vehicles: Array<{ pos: number[] }>
}

/** 本模块读写的 store 字段面（store 唯一 owner 在宿主）。 */
export interface MapWorldStore {
  mapKey: string | null
  assetProgress: number | null
  assetIssues: unknown[]
  assetDegraded: boolean
}

export interface MapWorldDeps {
  store: MapWorldStore
  debug: boolean
  perf(): PerfHandle | null
  /** 会话身份（迟到守卫；owner 在 sessionLifecycle）。 */
  sessionEpoch(): number
  destroyed(): boolean
  getData(): WorldPlaybackData | null
  /** 画质档（宿主持有 QUALITY_PRESETS 解析结果）。 */
  quality(): { groundLayers?: boolean; scenery?: boolean; anisotropy: number }
  /** 草实例预算（QUALITY_FEATURES.grass.instances；0 = 不加载草层）。 */
  grassInstanceBudget(): number
  getScene(): Scene | null
  getCamera(): PerspectiveCamera | null
  getRenderer(): WebGLRenderer | null
  getControls(): { target: { x: number; y: number; z: number } } | null
  invalidate(): void
  disposeObject3D(root: unknown): void
  /** 高度场发布后的相机约束（宿主自由相机域）。 */
  constrainFreeCameraAltitude(): void
  /** 地表整体更换后的贴回链路（基地/出生点/annotation 重投影；宿主编排）。 */
  regroundBases(): void
  regroundSpawns(): void
  rebuildAnnotationProjection(): void
  /** 逐图光照应用/复位的渲染器目标（宿主 renderer 域持有灯光）。 */
  lightingTargets(): { renderer: WebGLRenderer | null; scene: Scene | null; sunLight: DirectionalLight | null; hemiLight: HemisphereLight | null; debug: boolean }
  /** buildWorld 的相机落位（初始机位/钳制；宿主相机域实现）。 */
  buildWorldCameraPlacement(center: { cx: number; cz: number; ext: number }): void
  /** 当前开镜隐藏 eid（0 = 未开镜；terrainHFovDeg 判据）。 */
  scopedHiddenEid(): number
  /** 地形 LOD 变化后的 annotation 高度刷新（宿主 annotation 域）。 */
  reprojectAnnotationHeights(): void
  /** 地表整体更换/LOD 重建后的接地阴影贴回（#907 主干随迁；宿主经 contactShadows 句柄）。 */
  onTerrainReground(): void
  /** 逐图光照应用后的接地阴影太阳同步（#907 主干随迁）。 */
  onLightingApplied(): void
}

/** 边界带宿主（几何工厂在 boundary.ts；本模块只负责按权威范围重建）。 */
