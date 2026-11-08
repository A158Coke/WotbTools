// 世界 / 地形 / 地图资产 owner（#820 Step 2，自 initPlayback 闭包出仓）：
// buildWorld / loadMapImage / sampleHeight / 地形 LOD / rebuildGround / 可破坏物状态
// 推进 / 逐图光照宿主接线。代码与搬移前逐字一致；闭包读数改经 deps 注入
//（getter 快照），后续拆分落位后由宿主改接线，本模块不再变化。
//
// 世界事实（高度场/地形网格/场景 GLB/遮挡候选格）的唯一 owner 在本模块：
// 渲染、相机钳制、贴地、拾取诊断、遮挡与 annotation 重投影全部消费同一份，
// 不允许副本状态。会话 teardown（dispose）由本模块一次性完成原 teardownSession
// 的地图资产段（对象清单与顺序逐字保留）。
import * as THREE from 'three'
import type { Scene, PerspectiveCamera, WebGLRenderer, Texture, ShaderMaterial,
               DirectionalLight, HemisphereLight } from 'three'
import { mapStaticUrl, resolveMapKey } from '../replaySource.js'
import { mapBases } from '../../data/mapBases.js'
import { playableBounds } from '../../data/playableBounds.js'
import {
  CLIENT_NORMAL_CAMERA_FOV_H,
  terrainLodState, terrainLodStale, terrainSurfaceHeightAt,
} from '../terrainMesh.js'
import { treeFrame } from '../destructibles.js'
import type { DestructibleFoldState } from '../destructibles.js'
import { writeHiddenInstance, fallMatrix } from '../sceneryInstancing.js'
import { clearSceneryMatCache } from '../sceneryMaterials.js'
import { loadTerrain, buildGroundGeometry, makeGroundMaterial,
         groundLayerKeys, setupGroundTextures } from '../groundPass.js'
import { applyMapLighting as applyMapLightingCore, resetMapLighting as resetMapLightingCore } from '../mapLighting.js'
import type { MapLightingData } from '../mapLighting.js'
import { assembleMapScenery } from './mapAssets.js'
import type { ParsedGltf, GroundLayersField } from '../sceneryAssembly.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { ASSET_CONCURRENCY, mapLimit } from './util.js'
import { BOUNDARY_THICK } from './boundary.js'
import { assetProvider } from '../assetProvider.js'
import { createLoadProgress } from '../loadProgress.js'
import { createPerf } from './perf.ts'

type PerfHandle = ReturnType<typeof createPerf>

/** catch (e) 的诊断取值面：`e && e.message ? e.message : e` 的窄化等价体（运行时逐值一致）。 */
interface ErrorLike { message?: unknown }
function errorMessage(e: unknown): unknown {
  return (e as ErrorLike) && (e as ErrorLike).message ? (e as ErrorLike).message : e;
}

/** ?debug 诊断钩子（window.__terrain / __gdbg / __destructStage；宿主 JS 域裸写）。 */
const debugWindow = (typeof window !== 'undefined' ? window : {}) as Window & {
  __terrain?: THREE.Mesh | null
  __gdbg?: { layers: boolean; texs: string[]; meta: boolean; sizeM: number | null }
  __destructStage?: string
}

// groundPass.js（JS，参数由缺省值推断出过窄字面量型）的调用面签名：仅收紧 TS 视角，
// 运行时仍直接转发到原函数，逐参数逐值一致。
interface GroundGeometryArgs {
  field: Float32Array | null
  n: number
  span: number
  cam: { x: number; y: number; z: number }
  fovY: number
  aspect: number
  hFovDeg: number | null
  refineMask: unknown
  cx: number
  cz: number
  onDiagnostics: ((d: Record<string, unknown>) => void) | null | undefined
}
const buildGroundGeometryTyped = buildGroundGeometry as (a: GroundGeometryArgs) => THREE.BufferGeometry

const makeGroundMaterialTyped = makeGroundMaterial as (a: {
  layers: unknown
  texs: Record<string, Texture> | null
  size: number
  cx: number
  cz: number
  mapTexture: Texture | null
}) => THREE.Material

const loadTerrainTyped = loadTerrain as (a: {
  binUrl: string | null
  metaUrl: string | null
  fetchFn: (u: string) => Promise<Response>
  stale: () => boolean
  onDiagnostics?: ((d: Record<string, unknown>) => void) | null
}) => {
  field: Float32Array | null
  meta: HeightMetaSurface | null
  metaStatus: number | null
  binStatus: number | null
}

/** terrain.json sidecar 元数据（groundPass.loadTerrain 产物；本模块消费的字段面）。 */
interface HeightMetaSurface {
  size?: number
  span?: number
  zmax?: number
  terrainLayout?: unknown
  playableBounds?: { xMin: number; xMax: number; yMin: number; yMax: number } | null
}

/** X-Map-Meta 铺设参数（底图响应头 JSON；本模块消费的字段面）。 */
interface MapMetaSurface {
  size_m?: number
  x?: number
  z?: number
  rot90?: number
  flip_x?: boolean
}

/** 可破坏物运行时（assembleMapScenery 产物；槽位/槽位矩阵形状见 mapAssets.js 装配）。 */
interface DestructRuntime {
  states: DestructibleFoldState[]
  ptr: number
  lastT: number
  animating?: boolean
}

/** 推进循环视角的折叠状态面：DestructibleFoldState + 装配/推进保证存在的字段
 *  （树的 pivotPos/fallQuat 由 mapAssets 装配段回填；applied 是本循环写入的游标标记）。 */
interface DestructState extends DestructibleFoldState {
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
export interface BoundaryBandHost {
  build(bounds: unknown, thick: number): void
  clear(): void
}

export function createMapWorld(deps: MapWorldDeps, boundaryBand: BoundaryBandHost) {
  const store = deps.store
  let mapPlane: THREE.Mesh | null = null;
  let mapTexture: Texture | null = null, mapMetaInfo: MapMetaSurface | null = null;          // 底图贴图 + 铺设参数
  // 分层地表（客户端 tilemask-fp.sl 实时合成）：{layers: 合成参数, texs: {cm,tile,mask,hmap}}。
  // 缺失（未导出/404）时回退整图烘焙底图
  let groundLayers: { layers: GroundLayersField['layers']; texs: Record<string, Texture> } | null = null;
  let terrainMesh: THREE.Mesh | null = null, heightField: Float32Array | null = null, heightMeta: HeightMetaSurface | null = null;  // 3D 地形
  let waterTexDispose: { dispose(): void } | null = null;   // 水面海岸线用的高度场纹理（会话 teardown 释放）
  let mapScenery: THREE.Object3D | null = null;                              // 静态场景 GLB（建筑等）
  // 贴地薄构件走廊掩码（terrainMesh.buildRefineMask 产物；随场景 GLB 一起失效）：
  // 语义判据 = 材质 extras.decal（客户端 MATERIAL_DECAL，"objects colored with landscape"——
  // 铁轨基板/压顶/铺装）。这些件只有 ~0.3 m 厚、净空常仅 3–30 cm，远视距会被自适应粗格插值
  // 抬过顶面盖住（2026-10-14 用户报障"拉远后部分铁轨被白色盖住"：250 m 机位实测 rails_003
  // 39.7% / rails_002 6.7% 的钢条顶点被盖）。2026-10-11 撤销的"让位掩码/脚印细分"是**改高度值**
  // 或全局改判据；这里是用户 2026-10-14 重新裁定的 B 方案：**只对走廊块强制细分**——不改任何
  // 高度值、廊外层级与客户端口径逐字节一致（回归锁见 terrainMesh.test.js）。
  let terrainRefineMask: unknown = null;
  // 可破坏地形（契约 additive：destructible_areas/events + map/destructibles.json）。
  // scenery = { states, appliedPtr, lastT, meshIdx }；Pivot 挂在 gltf.scene 内随
  // mapScenery 一起 dispose（会话生命周期同场景 GLB，无独立 teardown）。
  let destruct: DestructRuntime | null = null;
  let destructPickList: unknown[] | null = null;   // 拾取用全量实例清单（destructibles.json instances，与事件无关）
  let meshOwner: Map<string, unknown> | Record<string, unknown> | null = null;          // mesh → 实例 精确归属（buildMeshOwnerMap，拾取主路径）
  let groundMesh: THREE.Mesh | null = null, gridHelper: THREE.GridHelper | null = null;           // buildWorld 的占位地面/网格（会话拥有）
  let currentMapKey: string | null = null;        // 资产面 map key（playableBounds 表索引）
  let currentMapBases: unknown = null;
  let WORLD_CENTER: { cx: number; cz: number; ext: number } = { cx: 0, cz: 0, ext: 300 };
  // 动画混合层材质（uTime 每帧写回放秒数；随 mapScenery dispose，会话失效）
  let animLayerMats: ShaderMaterial[] = [];
  let terrainLodPrev: unknown = null, terrainLodAt = 0;
  let perfTerrainChecks = 0, perfTerrainRebuilds = 0;
  // 场景遮挡候选格（**性能关键**）：早先对整个 `mapScenery` 做**递归全量**射线检测，
  // 会遍历**整张场景 GLB**（本工程实测 3000+ 节点、含全部树卡片批次）——
  // 单次可达数十~数百毫秒。它在"标签可见 + 正在播放"时按轮转触发，于是表现为
  // **打起来后间歇性整页卡死**（暂停时 `updateLabels` 不跑 → 立刻不卡，恢复播放过一会再卡）。
  // 现在改为：加载场景时把每个可见静态网格按**世界位置 + 包围球半径**登记进粗格
  // （16m），检测时只对"相机→锚点线段经过的格子"里的网格做 raycast。
  //（登记循环随场景装配块在 playback/mapAssets.js，格长常量 OCCL_CELL 亦在其内）
  /** 场景遮挡候选（加载期构建；null = 未建/旧路径） */
  let occlGrid: Map<string, unknown[]> | null = null;
  // 3D annotation 的 scenery 候选格（装配期构建；与 occlGrid 同粒度，不依赖节点名）。
  let annotationSurfaceGrid: unknown = null;

  function setMapKey(key: string | null) { currentMapKey = key; }
  let envTexture: Texture | null = null;                   // 逐图 IBL 环境贴图（scene.environment；会话拥有）
  let envMultiplier = 1;                   // 逐图 ibl.environmentMultiplier → scene.environmentIntensity

  // ---------- 点击拾取 ctx 的世界事实（getter 快照） ----------

  // 地图边界带（几何在 playback/boundary.js 工厂；本处只留可玩范围解析）

  // 优先 terrain meta 的 playableBounds（打包器从场景 MapBorderComponent 提取，新地图自带）；
  // 否则回退 mapCode 表。两者皆缺 → null（不画，不用车辆范围猜）
  const boundsByMap = playableBounds as Record<string, { xMin: number; xMax: number; yMin: number; yMax: number } | undefined>;
  function playableBoundsFor() {
    const pb = (heightMeta && heightMeta.playableBounds) || (currentMapKey ? boundsByMap[currentMapKey] : undefined);
    if (!pb) return null;
    const sxMin = -pb.xMax, sxMax = -pb.xMin;   // 场景为 x 镜像系
    return { cx: (sxMin + sxMax) / 2, cz: (pb.yMin + pb.yMax) / 2,
             hx: (sxMax - sxMin) / 2, hz: (pb.yMax - pb.yMin) / 2 };
  }

  function buildBoundary(bounds: unknown, thick: number) { boundaryBand.build(bounds, thick); }

  function buildWorld() {
    const DATA_ = deps.getData()
    if (!DATA_) return
    // 数据范围（直接取自 DATA；去 2% 离群后取整百）。注意必须在 buildVehicles 之前也可用——
    // 运行时数组 V 此时尚未填充
    const xs: number[] = [], zs: number[] = [];
    for (const def of DATA_.vehicles)
      for (let i = 0; i < def.pos.length; i += 9) { xs.push(def.pos[i]); zs.push(def.pos[i+2]); }
    xs.sort((a,b)=>a-b); zs.sort((a,b)=>a-b);
    const q = (a: number[], f: number) => a.length ? a[Math.floor((a.length-1) * f)] : 0;
    const ex = Math.max(q(xs, .98) - q(xs, .02), 200) * 0.65;
    const ez = Math.max(q(zs, .98) - q(zs, .02), 200) * 0.65;
    const m = Math.max(ex, ez);
    let ext = isFinite(m) && m > 0 ? Math.ceil(m / 50) * 50 : 300;
    let cx = -((q(xs, .98) + q(xs, .02)) / 2), cz = (q(zs, .98) + q(zs, .02)) / 2;   // 云心后备：x 要镜像（场景系 x = -回放 x）
    // 相机中心用**地图可玩矩形**（车辆云心只作后备）——交火偏一侧的图（如运河）云心
    // 会大幅偏离地图中心：俯视/初始机位对不准，钳制框还会把跟随目标拽离坦克。
    // currentMapKey 由 startPlayback 在 buildWorld 之前解析（loadMapImage 幂等重用）。
    const pb = playableBoundsFor();
    if (pb) {
      cx = pb.cx; cz = pb.cz;
      const me = Math.ceil(Math.max(pb.hx, pb.hz) * 1.15 / 50) * 50;
      if (me > ext) ext = me;
    }

    const scene = deps.getScene()
    if (!scene) return
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(ext * 2 + 100, ext * 2 + 100),
      new THREE.MeshLambertMaterial({ color: 0x202a36 }));
    ground.rotation.x = -Math.PI / 2; ground.position.set(cx, 0, cz);
    // 占位地面平面**不再显示**：它只是"地图资产尚未加载"时的深色底板，与真实
    // terrainMesh/mapPlane 同处 y=0，会与水面的透明层叠在一起（透出暗色底，掩盖
    // 水的 alpha/mask 效果）。对象仍保留并入 scene——bbox 拟合（roots 列表）与拾取
    // 过滤（terrainMesh || groundMesh）都引用它，且 three.js 的射线检测不看 visible，
    // 故隐藏不改变任何交互行为。
    ground.visible = false;
    scene.add(ground);
    groundMesh = ground;
    const grid = new THREE.GridHelper(ext * 2 + 100, Math.floor((ext * 2 + 100) / 50), 0x3a4a5e, 0x273140);
    grid.position.set(cx, 0.02, cz);
    // 占位网格同样**不再显示**：它位于 y=0.02，正好压在水面（y=0）之上——会在地表、
    // 半透明水面（透出的是它而不是水下的地形/alpha 效果）以及地图外沿都画出一层蓝灰线。
    // 与上面的占位地面同口径：对象仍保留入 scene（拾取过滤 isWaterNode/terrainMesh 与
    // bbox 拟合都按对象引用走，不看 visible），只是不参与绘制。
    grid.visible = false;
    scene.add(grid);
    gridHelper = grid;
    // 边界只按权威可玩范围画（见 buildBoundary 的 fail-closed 说明）：此处地图资产
    // 尚未加载，命中 mapCode 表则先画，否则不画；rebuildGround 再按 terrain meta 重建
    buildBoundary(playableBoundsFor(), BOUNDARY_THICK);
    WORLD_CENTER = { cx, cz, ext };
    deps.buildWorldCameraPlacement(WORLD_CENTER)
  }

  // ---------- 底图 + 3D 地形 ----------
  // 后端返回小地图贴图 + X-Map-Meta 铺设参数（size_m/x/z/rot90/flip_x）。
  // 方向约定：图上边 = 世界 +z，图右边 = 游戏 +x = 场景 −x（与 pos = (−x,y,z) 镜像自洽，
  // 故平面 rotation.z = π）。底图/高度场覆盖世界 [-300,+300]²（600m 方框，原点居中）。
  // terrain 端点返回 u16 LE 高度场（行 0=南，行主序）+ X-Terrain-Meta（size/zmax/span/terrainLayout，
  // 列口径见 terrainMesh.js `decodeTerrainField`）；
  // 有高度场时用起伏地形替换 2D 平面，404 时保持 2D。
  // SpeedTree 叶卡 billboard 材质（客户端 speedtree-materials-vp.sl 同构）：
  // POSITION=锚点 pivot，_corner=(角点偏移, pivot.w)。客户端每帧在【视空间】把
  // 角点偏移（旋转风摆相位后）加回锚点——叶卡恒面向相机，这是其树丛立体感的
  // 来源；静态渲染的展开角点则是"片层堆叠"观感的根因。COLOR_0=烘焙遮挡灰度：
  // 输出 = albedo × SH(标定 1.77) × (遮挡/遮挡均值)——按均值归一化保留内暗外亮
  // 的纵深变化，又不会把整体亮度压到校准水平之下（各图贴图明暗差异大，固定
  // 系数会把暗色贴图的灌木压成黑色）。风摆为动态效果，静态导出不参与。
  //
  // 场景 GLB 材质实例缓存（对齐上游）：同一（name,map,color,alphaTest,transparent,
  // opacity,occMean）复用同一材质对象。此前每个 mesh 各建一份——材质/着色器实例与
  // program 切换随 mesh 数线性膨胀，是场景侧最大的开销来源。
  // 生命周期：teardown 时随 mapScenery dispose 并清空本表（勿复用已 dispose 实例）。
  async function loadMapImage() {
    const DEBUG = deps.debug
    const perf = deps.perf()
    if (DEBUG) debugWindow.__destructStage = 'map-load';
    // 会话身份 guard：回放替换/销毁后，旧会话的地图资产续体一律失效——
    // 迟到的已加载纹理就地 dispose，不得写入新会话的共享状态或场景。
    // 用 sessionEpoch（不是 sessionGen）：新的 loadData / destroy 都会换掉身份，
    // 旧会话的资源续体因此无法再写共享 store。
    const epoch = deps.sessionEpoch();
    const diagnosticEpoch = perf?.epoch;
    const stale = () => deps.destroyed() || epoch !== deps.sessionEpoch();
    // ASYNC SESSION RULE: await into locals → revalidate ownership → dispose obsolete
    // local resources → only then publish session state or mutate the scene.
    const scene = deps.getScene()
    if (mapPlane) { scene?.remove(mapPlane); mapPlane = null; }
    if (terrainMesh) { scene?.remove(terrainMesh); terrainMesh = null; if (DEBUG) debugWindow.__terrain = null; }
    if (mapScenery) { scene?.remove(mapScenery); mapScenery = null; }
    terrainRefineMask = null;   // 走廊掩码属场景 GLB，随它失效
    destruct = null;
    destructPickList = null;
    meshOwner = null;
    mapTexture = null; mapMetaInfo = null; heightField = null; heightMeta = null;
    if (waterTexDispose) { waterTexDispose.dispose(); waterTexDispose = null; }
    terrainLodPrev = null;   // 会话场景失效：下一场首帧必重建地形 LOD
    occlGrid = null;   // 标签遮挡候选格属于会话场景，随场景一起失效
    annotationSurfaceGrid = null;   // 3D annotation 表面候选格同样属于会话场景
    groundLayers = null;
    const DATA_ = deps.getData()
    if (!DATA_ || !scene) return
    // 地面加载方式由画质档决定（低=小地图底图、中=高清烘焙底图、高=分层地表），3D 地形有高度场即开启
    // 地图端点用回放数字 id（与客户端 arenaTypeID → maps.yaml 同链）；
    // 显示名可能与解析器枚举名不一致，仅作后备
    const Q = deps.quality()
    const mid = DATA_.meta.map_id || 0;
    const mapq = mid ? ('id=' + mid) : ('name=' + encodeURIComponent(DATA_.meta.map_name || ''));
    // 静态资产面的 key 解析（必须在 mapq 构造之后——曾放在函数首行引用未初始化的
    // mapq，TDZ ReferenceError 让整个函数静默死亡，地图/地形/场景一个请求都不发，
    // 全画质档回退占位网格）
    const resolvedKey = await resolveMapKey(mapq).catch(() => null);
    if (stale()) return;
    currentMapKey = resolvedKey;
    store.mapKey = resolvedKey;
    const mapBasesTable = mapBases as Record<string, unknown>;
    currentMapBases = resolvedKey ? (mapBasesTable[resolvedKey] || null) : null;
    // 资产阶段进度（审计 3D-23）：按画质档实际会请求的段登记，每段完成（含缺失降级）计满；
    // 分层地表按纹理张数、场景 GLB 按字节推进。写入 store.assetProgress（0–1）
    const progress = createLoadProgress((snap) => { if (!stale()) store.assetProgress = snap.fraction; });
    // 资产完整性：404/解码失败可以让该进度段结束（loadProgress 的完成=结束），但必须写
    // assetIssues/assetDegraded，不能表现为“健康完成”。核心缺失（map/terrain/scenery/lighting）
    // 置 assetDegraded；分层/IBL/可破坏物等可选件只记录、不降级整场。
    const assetIssues: unknown[] = [];
    store.assetIssues = assetIssues;
    store.assetDegraded = false;
    const noteAsset = (key: string, status: string, detail: unknown = '', { optional = false }: { optional?: boolean } = {}) => {
      // 迟到请求（切换会话 / reset 后的 reject）不得把旧诊断写进新会话的 store。
      if (stale()) return;
      const issue = { key, status, detail: String(detail || '') };
      assetIssues.push(issue);
      store.assetIssues = assetIssues.slice();
      if (!optional) store.assetDegraded = true;
      console.warn(`[map-assets] ${key}: ${status}${detail ? ' — ' + detail : ''}`);
    };
    const mapUrlPlanned = mapStaticUrl('map', undefined, resolvedKey);
    if (mapUrlPlanned) progress.expect('map');
    if (mapStaticUrl('terrain', undefined, resolvedKey)) progress.expect('terrain');
    if (Q.groundLayers && mapStaticUrl('groundmeta', undefined, resolvedKey)) progress.expect('ground');
    if (Q.scenery && mapStaticUrl('scenery', undefined, resolvedKey)) progress.expect('scenery');
    try {
      // 地面贴图统一用**契约化的 `ground.webp`**（±300 全幅，与 2D 底图同源同框）。
      // 曾用客户端 HUD 小地图（资产面 res=mini）省流量：实测它覆盖约 620 m —— 比 ±300 契约框
      // **多出外围一圈**（水面/场景在 Landscape 框外侧），按 600 m 铺会把内容压缩约 3%、并把圈外
      // 内容摊进边界（2026-10-16 用户裁定：以 ±300 为准，外圈不呈现）。
      // client-only：仅资产平面静态路径；未配置基址/索引未命中 → 无底图（回退网格），
      // 不存在服务端回退
      const mapUrl = mapStaticUrl('map', undefined, resolvedKey);
      if (!mapUrl) {
        if (perf) for (const stage of ['map.fetch', 'map.body', 'map.texture-decode-aggregate']) perf.event({ stage, status: 'skipped' }, diagnosticEpoch);
        noteAsset('map', 'missing-url', resolvedKey ? 'ground.webp URL 为空' : '未解析到资产索引 key');
      } else {
        const mapFetchAt = perf ? performance.now() : 0;
        const resp = await assetProvider.fetch(mapUrl);
        if (perf && !stale()) perf.event({ stage: 'map.fetch', durationMs: performance.now() - mapFetchAt, status: resp.ok ? 'complete' : 'fallback' }, diagnosticEpoch);
        if (stale()) return;
        if (!resp.ok) {
          if (perf) for (const stage of ['map.body', 'map.texture-decode-aggregate']) perf.event({ stage, status: 'skipped' }, diagnosticEpoch);
          noteAsset('map', `http-${resp.status}`, 'ground.webp 获取失败');
        } else {
          const meta = JSON.parse(resp.headers.get('X-Map-Meta') || '{}');
          const mapBodyAt = perf ? performance.now() : 0;
          const blob = await resp.blob();
          if (perf && !stale()) perf.event({ stage: 'map.body', durationMs: performance.now() - mapBodyAt }, diagnosticEpoch);
          if (stale()) return;
          const url = URL.createObjectURL(blob);
          let texture: Texture | undefined;
          const mapDecodeAt = perf ? performance.now() : 0;
          try {
            texture = await new THREE.TextureLoader().loadAsync(url);
            if (perf && !stale()) perf.event({ stage: 'map.texture-decode-aggregate', durationMs: performance.now() - mapDecodeAt }, diagnosticEpoch);
          } finally {
            URL.revokeObjectURL(url);
          }
          if (stale()) { texture?.dispose(); return; }
          mapMetaInfo = meta;
          mapTexture = texture;
          mapTexture!.colorSpace = THREE.SRGBColorSpace;
          mapTexture!.anisotropy = Math.min(Q.anisotropy, deps.getRenderer()?.capabilities.getMaxAnisotropy() ?? 1);
          if (mapMetaInfo!.flip_x) { mapTexture!.wrapS = THREE.RepeatWrapping; mapTexture!.repeat.x = -1; mapTexture!.offset.x = 1; }
        }
      }
    } catch (e) { if (perf && !stale()) perf.event({ stage: 'map.load', status: 'fallback' }, diagnosticEpoch); noteAsset('map', 'failed', errorMessage(e)); }
    if (stale()) return;
    progress.complete('map');
    // 逐图光照（客户端 DirectionalLightComponent → lighting.json）：方向/色/强度 + 环境色。
    // 读不到（旧包/未配置资产面）→ 保留兜底灯光（不阻断）。太阳方向此前是硬编码的
    // (120,260,80)，与各图真实太阳无关——删掉 flatShading（改用 authored 法线）后定向光
    // 第一次真正塑形，方向错误立刻显形（面向太阳的面反而暗，2026-10-09 用户报障）。
    try {
      const lmUrl = mapStaticUrl('lighting', undefined, resolvedKey);
      if (lmUrl) {
        const lresp = await assetProvider.fetch(lmUrl);
        if (stale()) return;
        if (lresp.ok) {
          const L = await lresp.json();
          if (stale()) return;
          applyMapLighting(L);
        } else {
          noteAsset('lighting', `http-${lresp.status}`, '保留兜底灯光');
        }
      }
    } catch (e) { noteAsset('lighting', 'failed', errorMessage(e)); }
    // 逐图 IBL（环境反射）：客户端 IBLComponent 的 specular 立方图（上游转等距柱状投影）。
    // 只影响 glTF PBR 材质（坦克）——自定义 ShaderMaterial（场景/地面/植被）不吃 enviroment。
    // `ibl.environmentMultiplier`（逐图 0.8–4.0）经 scene.environmentIntensity 施加（three r163+）。
    try {
      const iblUrl = mapStaticUrl('ibl', undefined, resolvedKey);
      if (iblUrl) {
        const iresp = await assetProvider.fetch(iblUrl);
        if (stale()) return;
        if (iresp.ok) {
          const blob = await iresp.blob();
          if (stale()) return;
          const url = URL.createObjectURL(blob);
          let tex: Texture | undefined;
          try {
            tex = await new THREE.TextureLoader().loadAsync(url);
          } finally { URL.revokeObjectURL(url); }
          if (stale()) { tex?.dispose(); return; }
          tex!.mapping = THREE.EquirectangularReflectionMapping;
          tex!.colorSpace = THREE.SRGBColorSpace;
          envTexture = tex!;
          // 场景可能尚未创建（渲染器/场景惰性，资产阶段可早于 initScene）→ 有则立即挂、
          // 无则留待 initScene 末尾补挂（两种时序都覆盖）
          if (scene) {
            scene.environment = tex;
            scene.environmentIntensity = envMultiplier;
          }
        } else {
          noteAsset('ibl', `http-${iresp.status}`, '不设环境贴图', { optional: true });
        }
      }
    } catch (e) { noteAsset('ibl', 'failed', errorMessage(e), { optional: true }); }
    try {
      // 3D 地形：仅资产平面静态路径 + terrain.json sidecar 尺度；无静态资产 → 保持 2D。
      // 读取与解码（span 自愈 / json-bin sha 配对 / 布局补正）在共享模块 groundPass.loadTerrain
      // ——俯视烘焙同一份；本处只做宿主接线（assetProvider/stale/会话写回）。
      // 米制高度场 = 场景系引擎顶点口径（见 terrainMesh.js `decodeTerrainField`）；
      // 网格 / sampleHeight / 拾取诊断 / 水面岸线全读这一份
      // loadTerrain 是 JS 模块（返回面无注解）：调用面签名见 loadTerrainTyped 别名
      const { field, meta: tmeta, metaStatus, binStatus } = await loadTerrainTyped({
        binUrl: mapStaticUrl('terrain', undefined, resolvedKey),
        metaUrl: mapStaticUrl('terrain-meta', undefined, resolvedKey),
        fetchFn: (u: string) => assetProvider.fetch(u),
        stale,
        onDiagnostics: perf ? (event: Record<string, unknown>) => { if (!stale()) perf.event(event, diagnosticEpoch); } : undefined,
      });
      if (stale()) return;
      // 只在完整元数据下发布 heightField：loadTerrain 已 fail-closed，这里再守一次
      // size/layout，防止任何未来调用把它改成“有 field 就发布”（sampleHeight 的 n
      // 必须有限；缺失曾让 fx/fy 变 NaN，坦克贴地/遮挡全部失效）。
      if (field && Number.isFinite(Number(tmeta?.size)) && tmeta?.terrainLayout !== undefined) {
        heightMeta = tmeta; heightField = field;
        // CAM 初始即 free；场景核先于异步地形初始化。发布高度场后一次性补齐初始相机约束。
        deps.constrainFreeCameraAltitude();
      } else if (field) {
        noteAsset('terrain', 'incomplete-meta', '忽略高度场（回退 2D）');
      } else if (metaStatus === 404 && binStatus === 404) {
        noteAsset('terrain', 'missing', 'terrain.json + terrain.u16.bin 均 404（2D 回退）');
      } else {
        noteAsset('terrain', 'unavailable', `meta=${metaStatus} bin=${binStatus}（回退 2D）`);
      }
    } catch (e) { if (perf && !stale()) perf.event({ stage: 'terrain.load', status: 'fallback' }, diagnosticEpoch); noteAsset('terrain', 'failed', errorMessage(e)); }
    if (stale()) return;
    progress.complete('terrain');
    // 客户端同款分层地表：colormap/lightmap/tile 细节/mask/(HeightBlend 高度图)，
    // tile 纹理前端按 textureTiling 平铺全分辨率采样——清晰度等同客户端，不受整图烘焙
    // 分辨率限制。任一分层缺失则整体回退烘焙底图。
    // 注意分层一律无 alpha（Chrome 把带 alpha 的 webp 预乘解码，GPU 侧会压暗
    // 近黑），第 4 通道在独立灰度图里（tile1/mask1/hmap1 的 R）。
    // 低/中档跳过分层地表：直接走整图烘焙底图（省 4–8 张纹理下载与显存）
    if (Q.groundLayers) try {
      const gmUrl = mapStaticUrl('groundmeta', undefined, resolvedKey);
      if (!gmUrl) {
        noteAsset('groundLayers', 'missing-url', '跳过分层地表（回退烘焙底图）', { optional: true });
      }
      else {
      const mresp = await assetProvider.fetch(gmUrl);
      if (stale()) return;
      if (mresp.ok) {
        const L = await mresp.json();
        if (stale()) return;
        // 纹理键集与上传契约在共享模块（groundPass：groundLayerKeys / setupGroundTextures）
        // ——俯视烘焙同一份；本处只做宿主 I/O（assetProvider/进度/stale）
        const need = groundLayerKeys(L);
        const texs: Record<string, Texture> = {};
        // 有限并发（4）：此前逐张 await 白等网络往返（6–8 张串行 = 6–8 个 RTT）。
        // 任一张失败仍整体回退（其余在飞的照常收下，失败分支统一 dispose）。
        let texDone = 0;
        const loaded = await mapLimit(need, ASSET_CONCURRENCY, async (k) => {
          if (stale()) return false;
          let okOne = false;
          try {
            const texUrl = mapStaticUrl('groundtex', k, resolvedKey);
            if (texUrl) {
              const r = await assetProvider.fetch(texUrl);
              if (stale()) return false;
              if (r.ok) {
                const blob = await r.blob();
                if (stale()) return false;
                const u = URL.createObjectURL(blob);
                let t: Texture | undefined;
                try {
                  t = await new THREE.TextureLoader().loadAsync(u);
                } finally {
                  URL.revokeObjectURL(u);
                }
                if (stale()) { t?.dispose(); }
                else { texs[k] = t!; okOne = true; }
              }
            }
          } catch { okOne = false; }
          progress.update('ground', ++texDone, need.length);
          return okOne;
        });
        if (stale()) {
          for (const k in texs) texs[k]?.dispose?.();
          return;
        }
        const ok = loaded.every(Boolean);
        if (!ok) noteAsset('groundLayers', 'incomplete', '部分分层纹理缺失（回退烘焙底图）', { optional: true });
        if (ok) {
          const ani = Math.min(Q.anisotropy, deps.getRenderer()?.capabilities.getMaxAnisotropy() ?? 1);
          // tile/hmap Repeat 平铺 + 全部各向异性（colormap/mask 也开：掠射角下不糊）——
          // 契约实现见 groundPass.setupGroundTextures（两侧同一份）
          setupGroundTextures(texs, ani);
          groundLayers = { layers: L, texs };
        } else {
          // 半途失效/缺失：已加载的分层纹理就地释放，不留悬挂 GPU 资源
          for (const k in texs) texs[k]?.dispose?.();
        }
      } else {
        noteAsset('groundLayers', `http-${mresp.status}`, 'ground.layers.json 获取失败（回退烘焙底图）', { optional: true });
      }
      }
    } catch (e) { noteAsset('groundLayers', 'failed', errorMessage(e), { optional: true }); }
    if (stale()) return;
    progress.complete('ground');
    // 诊断钩子：window.__gdbg 查看地表实际走的路径与已加载分层（仅 ?debug）
    if (DEBUG) debugWindow.__gdbg = { layers: !!groundLayers, texs: groundLayers ? Object.keys(groundLayers.texs) : [],
                                 meta: !!mapMetaInfo, sizeM: mapMetaInfo?.size_m ?? null };
    try {
      rebuildGround();
    } catch (e) {
      // 分层地表元数据形状错误（如缺 tiling）会在 groundShaderMaterial 抛错；这不是
      // 「无分层」而是资产故障——必须记降级，清掉坏层并用烘焙底图重试，且不能因此
      // 跳过后续场景 GLB。
      noteAsset('groundLayers', 'invalid', errorMessage(e));
      if (groundLayers) {
        for (const k in groundLayers.texs) groundLayers.texs[k]?.dispose?.();
        groundLayers = null;
      }
      try { rebuildGround(); } catch (e2) {
        console.warn('地面重建回退失败（保留 2D 底图）:', e2);
      }
    }
    // 静态场景模型（建筑/桥/岩石，tools/export_map_glb.py 预生成；缺失静默跳过）。
    // GLB 为游戏系（z 上、+y 北），qFrame = Ry(π)·Rx(-π/2)（YXZ 序）转到回放场景系——
    // 与坦克 GLB 同一帧变换，纯旋转无镜像，绕序天然正确。
    // 四档加载完整场景；流畅和均衡仍用烘焙底图，高档使用分层地表。
    if (Q.scenery) try {
      // 可破坏物清单（与场景 GLB 并行拉取；缺失时禁用该特性）
      // mapStaticUrl 返回完整 URL——assetProvider.json() 会再拼一次 base（逻辑路径专用），
      // 必须走透传的 fetch + resp.json()（与下方 terrain-meta 同款用法）
      const destructUrl = mapStaticUrl('destructibles', undefined, resolvedKey);
      const destructDocPromise = destructUrl
        ? assetProvider.fetch(destructUrl).then((r) => {
            if (!r.ok) noteAsset('destructibles', `http-${r.status}`, '可破坏物特性禁用', { optional: true });
            return r.ok ? r.json() : null;
          }).catch((e: unknown) => {
            noteAsset('destructibles', 'failed', errorMessage(e), { optional: true });
            return null;
          })
        : Promise.resolve(null);
      if (DEBUG) destructDocPromise.then((d) => { debugWindow.__destructStage = d ? 'doc-ok' : 'doc-missing'; });
      const sceneryUrl = mapStaticUrl('scenery', undefined, resolvedKey);
      if (!sceneryUrl) {
        noteAsset('scenery', 'missing-url', '未配置资产面/未命中索引（无场景 GLB）');
      }
      else {
      const gltf = await new Promise<ParsedGltf | null>((res) => {
        new GLTFLoader().load(sceneryUrl,
          (g) => res(g),
          (e) => { if (e) progress.update('scenery', e.loaded, e.lengthComputable ? e.total : 0); },
          () => res(null));
      });
      if (stale()) {
        if (gltf?.scene) deps.disposeObject3D(gltf.scene);
        return;
      }
      if (!gltf || !gltf.scene) noteAsset('scenery', 'failed', 'scenery.glb 加载/解析失败（建筑/场景缺失）');
      if (gltf && gltf.scene) {
        // 装配（变体裁剪 → 材质分派 → 合批 → 可破坏物槽位 → 矩阵冻结）在
        // playback/mapAssets.js（2026-10-24 Step A3 出仓；ctx 快照 + 增量 writes，
        // stale 语义与原闭包逐段赋值 + 中途 return 一致——见该模块头注释）
        const asm = await assembleMapScenery(gltf, {
          DATA: DATA_, Q, DEBUG,
          camera: deps.getCamera(), renderer: deps.getRenderer()!, scene, controls: deps.getControls(), terrainMesh,
          groundLayers, heightField, heightMeta, terrainSpan: terrainSpanOf(),
          stale, disposeObject3D: deps.disposeObject3D, noteAsset, sampleHeight,
          // 掩码先写入宿主绑定再重建 LOD（评审 P2：否则首次重建拿到空掩码、
          // terrainLodPrev 置当前后不再失效，走廊细分在初始视角丢失）
          onRefineMaskBuilt: (mask) => { terrainRefineMask = mask; terrainLodPrev = null; maybeRebuildTerrainLod(); },
          // 挂载即归属（评审 P1 复核）：destructibles 悬挂期间 reset/切场，
          // teardownSession 也能看到并释放这批资源（原闭包在此点即时赋值的语义）
          onSceneryMounted: (group, waterTex) => { mapScenery = group; if (waterTex) waterTexDispose = waterTex; },
          destructDocPromise,
        });
        // stale 判定先于一切 writes 发布（评审 P1：stale 结果不得写回宿主——
        // 会覆盖新会话的 mapScenery/动画材质/遮挡表；过期资源已由模块就地回收）
        if (asm.stale) return;
        const w = asm.writes;
        if ('waterTexDispose' in w) waterTexDispose = w.waterTexDispose!;
        if ('animLayerMats' in w) animLayerMats = w.animLayerMats!;
        if ('mapScenery' in w) mapScenery = w.mapScenery!;
        if ('terrainRefineMask' in w) terrainRefineMask = w.terrainRefineMask;
        if ('occlGrid' in w) occlGrid = w.occlGrid!;
        if ('annotationSurfaceGrid' in w) annotationSurfaceGrid = w.annotationSurfaceGrid;
        destructPickList = w.destructPickList!;
        meshOwner = w.meshOwner!;
        destruct = w.destruct!;
      }
      }
    } catch (e) {
      console.warn('场景模型加载失败（忽略）:', e);
      // 装配/变体裁剪/实例化等后续步骤抛错同样意味着建筑缺失，必须进入降级状态
      noteAsset('scenery', 'failed', errorMessage(e));
    }
    if (stale()) return;
    progress.complete('scenery');
  }

  // 双线性采样世界 (x,z) 处高度（米）；无高度场/元数据不完整返回 0
  function sampleHeight(x: number, z: number) {
    if (!heightField || !heightMeta) return 0;
    const n = Number(heightMeta.size), span = Number(heightMeta.span);
    if (!Number.isInteger(n) || n < 2 || !Number.isFinite(span) || span <= 0) return 0;
    // 引擎口径（`Landscape::GetHeightAtPoint` 逐行）：`fx = hmSize·(x−min)/span` —— **除 size，
    // 不是 size−1**；整数部 = texel 下标、小数部 = 相邻 texel 间权重。此前用 `(n−1)`（等价于把
    // texel 当中心）⇒ 0.2% 水平拉伸：地图中部偏半格（0.59 m）、+x 边缘偏一整格（1.17 m）。
    // 挡土墙顶等"与某一 texel 等高"的结构在俯瞰下会把这点偏差放大成穿透（2026-10-09 报障）。
    const fx = (x / span + 0.5) * n, fy = (z / span + 0.5) * n;
    const x0 = Math.max(0, Math.min(n - 2, Math.floor(fx))), y0 = Math.max(0, Math.min(n - 2, Math.floor(fy)));
    const tx = Math.max(0, Math.min(1, fx - x0)), ty = Math.max(0, Math.min(1, fy - y0));
    // 直接下标（悬挂步每帧对每车 ~20 轮 + 2×40 链点 ≈ 3000 次调用，此前的逐调用
    // 闭包 `at` 与元数据 revalidate 是纯开销）
    const hf = heightField;
    const top = hf[y0 * n + x0] * (1 - tx) + hf[y0 * n + x0 + 1] * tx;
    const bot = hf[(y0 + 1) * n + x0] * (1 - tx) + hf[(y0 + 1) * n + x0 + 1] * tx;
    return top * (1 - ty) + bot * ty;
  }

  function sampleRenderedTerrainHeight(x: number, z: number) {
    const terrainBuild = terrainMesh?.geometry?.userData?.terrainBuild;
    if (!terrainBuild) return null;
    return terrainSurfaceHeightAt(terrainBuild, x, z);
  }

  // ---------- 3D annotation 的地表采样（采样优先级与渲染一致） ----------
  /**
   * 当前可见地表的 O(1) 采样（scene XZ）。优先级与渲染一致：
   * 当前 LOD terrain build → 高度场（带 span 边界）→ 平地面（mapPlane / groundMesh）。
   * 无地表时返回 null；ribbon 会断 strip，不拿 0 冒充地形。
   */
  function annotationSurfaceHeightAt(x: number, z: number) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return null
    const terrainBuild = terrainMesh && terrainMesh.geometry && terrainMesh.geometry.userData
      ? terrainMesh.geometry.userData.terrainBuild : null
    if (terrainBuild) {
      const y = terrainSurfaceHeightAt(terrainBuild, x, z)
      return Number.isFinite(y) ? y : null
    }
    if (heightField && heightMeta) {
      const n = Number(heightMeta.size)
      const span = Number(heightMeta.span)
      if (!Number.isInteger(n) || n < 2 || !Number.isFinite(span) || span <= 0) return null
      const half = span / 2
      if (x < -half || x >= half || z < -half || z >= half) return null
      const y = sampleHeight(x, z)
      return Number.isFinite(y) ? y : null
    }
    if (mapPlane) {
      // 2D 回退地面是有限 plan；不能把平面高度当成无限地图，否则能画到图外。
      const size = Number(mapMetaInfo?.size_m) || Number(heightMeta?.span) || 600
      const cx = Number(mapMetaInfo?.x) || 0
      const cz = Number(mapMetaInfo?.z) || 0
      const half = size / 2
      if (x < cx - half || x >= cx + half || z < cz - half || z >= cz + half) return null
      return mapPlane.position.y
    }
    if (groundMesh) {
      // placeholder ground 也是有限平面（buildWorld: ext*2+100）；不能当无限地面。
      const { cx, cz, ext } = WORLD_CENTER
      const half = ext + 50
      if (x < cx - half || x >= cx + half || z < cz - half || z >= cz + half) return null
      return groundMesh.position.y
    }
    return null
  }

  /** 地形世界跨度（渲染高度场的世界↔UV 换算也用同一式，杜绝与网格两处漂移）。 */
  function terrainSpanOf() {
    return mapMetaInfo?.size_m || heightMeta?.span || 600;
  }
  /** 构建/重建地形几何（客户端同构自适应细分）。实现与 UV 契约在共享模块 groundPass.js
   *  （buildGroundGeometry，俯视烘焙同一份）；本处只传相机/掩码等宿主参数。 */
  function terrainHFovDeg() {
    const camera = deps.getCamera()
    const scopedHidden = deps.scopedHiddenEid()
    if (!scopedHidden || !camera || !(camera.fov > 0) || !(camera.aspect > 0)) {
      return CLIENT_NORMAL_CAMERA_FOV_H;
    }
    return (2 * Math.atan(Math.tan((camera.fov * Math.PI) / 360) * camera.aspect) * 180) / Math.PI;
  }
  function buildTerrainGeometry() {
    const perf = deps.perf()
    const n = heightMeta?.size || 512;
    const span = terrainSpanOf();
    // 不传 tolScale = 1 = 客户端原口径（该参数仅供单测）
    const camera = deps.getCamera()
    return buildGroundGeometryTyped({
      field: heightField, n, span,                  // 真值场一份到底（渲染/查询同源，客户端同构）
      cam: camera ? camera.position : { x: 0, y: 320, z: 0 },   // 兜底：原生相机距离量级
      fovY: camera && Number.isFinite(camera.fov) ? (camera.fov * Math.PI) / 180 : 0.8,
      aspect: camera && Number.isFinite(camera.aspect) && camera.aspect > 0 ? camera.aspect : 16 / 9,
      // 阈值插值的 fov 按**客户端口径**传：引擎 `GetFOV()` 是相机配置的水平 fov、与画面宽高比无关
      // （宽高比只进投影项 tanFovY）。回放自由相机 = 客户端正常相机（无狙击镜档）⇒ 恒 normal。
      // 不传这个的话，窄画布会把「55° 竖直 × aspect」折算成小水平角、阈值滑向狙击镜档（放宽 ~1.8×）。
      hFovDeg: terrainHFovDeg(),
      // 贴地薄构件走廊（B）：只在这些块强制细分到最细层，廊外层级与客户端口径逐字节一致。
      refineMask: terrainRefineMask,
      onDiagnostics: perf ? (data: Record<string, unknown>) => perf.event({ stage: 'terrain-build', ...data }) : undefined,
      cx: mapMetaInfo?.x || 0, cz: mapMetaInfo?.z || 0,
    });
  }
  /** 相机姿态变化时重建地形几何（见 terrainMesh.js `terrainLodStale`——滞回输入与
   *  `buildAdaptiveTerrain` 的判据同源：相机位置/视距/FOV/aspect）。视距单向滞回（拉近立即细化、
   *  拉远 ≥40% 才允许变粗）+ 侧向绕转（≥5% 视距）与 FOV/aspect 变化按新相机位置重算，两次重建
   *  至少隔 120 ms。保证网格**永不比客户端判据（同一相机位置）允许的层级更粗**——否则粗格插值会
   *  把地形抬到贴地薄结构之上（2026-10-10 用户"铁轨被盖、转视角又正常"）。重建成本 ≈ 一次四叉
   *  遍历（~18 ms/帧预算内节流）。 */
  function maybeRebuildTerrainLod(now = performance.now()) {
    const perf = deps.perf()
    const camera = deps.getCamera()
    const controls = deps.getControls()
    if (perf) perfTerrainChecks++;
    if (!terrainMesh || !heightField || !camera || !controls) return;
    const cur = terrainLodState(camera, controls.target, camera.aspect);
    if (!terrainLodStale(terrainLodPrev, cur, now - terrainLodAt)) return;
    terrainLodPrev = cur;
    terrainLodAt = now;
    if (perf) perfTerrainRebuilds++;
    const old = terrainMesh.geometry;
    const perfRebuildAt = perf ? performance.now() : 0;
    terrainMesh.geometry = buildTerrainGeometry();
    old.dispose();
    // 当前 camera pose 触发的 LOD 几何将在本帧渲染；按新网格重新约束，避免旧 LOD
    // floor 与替换后的三角面之间留下一帧/停驻时的穿地。
    deps.constrainFreeCameraAltitude();
    deps.reprojectAnnotationHeights();
    deps.onTerrainReground();
    if (perf) perf.event({ stage: 'terrain-rebuild-inclusive', durationMs: performance.now() - perfRebuildAt });
  }

  // 依据 mapTexture/heightField 重建地面（2D 平面或 3D 地形二选一）
  // 地面材质（客户端 Landscape/tilemask-fp.sl 非 PBR 路径的实时合成：GLOBAL_TINT /
  // SCALED_TILES / HEIGHT_BLEND 逐分支离线核对）已迁至共享模块 groundPass.js
  // `groundShaderMaterial`——3D 运行时与俯视烘焙共用同一份。
  // 依据 mapTexture/heightField 重建地面（2D 平面或 3D 地形二选一）的宿主流程如下。

  function rebuildGround() {
    const scene = deps.getScene()
    if (!scene) return
    if (mapPlane) { scene.remove(mapPlane); mapPlane = null; }
    if (terrainMesh) { scene.remove(terrainMesh); terrainMesh = null; }
    if (!mapTexture && !heightField) return;
    const meta = mapMetaInfo || {};
    const size = meta.size_m || heightMeta?.span || 600;
    if (heightField) {
      // 3D 地形：**客户端同构自适应网格**（见 terrainMesh.js；`LandscapeSubdivision` 逐行核对：
      // 顶点用 `Heightmap::GetPoint(x, y)` 落在 texel **原位**、高度取 texel 值，不平滑）。
      //   · 顶点世界坐标 = `x_j = (j/n − 0.5)·span`、`z_i = (i/n − 0.5)·span`（列 ↔ 场景 x、
      //     行 ↔ 场景 z，与 `sampleHeight` 的参数化互为逆）；
      //   · 最粗层 8×8 四边形（每格 n/8 texel），只按「下一层真高度 vs 本层双线性」的误差
      //     **按视距**细分（容差 = min(3 m, 0.014·d·tan(fov/2))）——高度图的厘米~分米级毛刺
      //     根本不进网格；顶点按 (i,j) 去重（法线跨叶连续）；
      //   · 层级不同处按「最粗相邻叶所在层级的**边界直线**」取高度（细侧折线落在粗侧直线上，
      //     端点递归）⇒ 无 T 型接缝（2026-10-09 用户"这次引入了横竖条纹"）。
      // ⚠️ 此前用 `PlaneGeometry(seg) + sampleHeight` 双线性采样：顶点与 texel 网格**错位**，
      // 陡坡/切槽处地形面沿坡向外探出 0.5–1.3 m（实测等高线水平探出 +0.5–0.75 m、同点高度
      // +0.04 中位/+1.34 最大）；随后逐 texel 全画又让毛刺全在 ⇒ 与结构齐平的接缝上被顶出来
      // （2026-10-09 用户"不规则地形突出于石板面"；"客户端无论如何看都没问题"即本 LOD 口径
      // 的直接结果）。
      const geo = buildTerrainGeometry();
      // 分层地表（客户端 tilemask-fp.sl 实时合成，tile 原生分辨率平铺）优先；
      // 缺失时回退整图烘焙贴图（已含烘焙光照，不受光材质避免二次压暗；
      // toneMapped=false 保持烘焙色彩逐像素对齐客户端）。材质选择在共享模块
      // groundPass.makeGroundMaterial（俯视烘焙同一份）。
      // 几何已直接建在场景系（顶点 = texel 中心的世界坐标）⇒ 不再旋转/平移
      terrainMesh = new THREE.Mesh(geo, makeGroundMaterialTyped({
        layers: groundLayers && groundLayers.layers, texs: groundLayers && groundLayers.texs,
        size, cx: meta.x || 0, cz: meta.z || 0, mapTexture,
      }));
      scene.add(terrainMesh);
      deps.constrainFreeCameraAltitude();
      if (deps.debug) debugWindow.__terrain = terrainMesh;   // 诊断/测试钩子：地形网格身份（免按几何猜）
    } else if (mapTexture) {
      const mat = new THREE.MeshBasicMaterial({ map: mapTexture });
      mat.toneMapped = false;
      mapPlane = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
      mapPlane.rotation.set(-Math.PI / 2, 0, Math.PI + (meta.rot90 || 0) * Math.PI / 2);
      mapPlane.position.set(meta.x || 0, 0.04, meta.z || 0);
      scene.add(mapPlane);
    }
    // 边界按权威可玩范围重建（terrain meta 的 playableBounds 优先，否则 mapCode 表）；
    // 两者皆缺则不画（fail-closed，绝不用 terrain span 冒充战场边界）
    buildBoundary(playableBoundsFor(), BOUNDARY_THICK);
    // 地形异步就绪后把基地环带/HUD 与出生点标记重新贴回地表
    deps.regroundBases();
    deps.regroundSpawns();
    deps.onTerrainReground();   // 静止车辆的接地阴影也贴回新 LOD 网格（≤ 车辆数 × 25 次 O(1) 采样）
    // terrain 首次就绪 / 2D 回退切换：annotation 必须重投影到当前地表
    deps.rebuildAnnotationProjection();
  }

  function groundY(x: number, z: number) {
    return sampleHeight(x, z) + 0.12;
  }

  // 可破坏状态推进（回放时钟；seek 后退 = 全量重算，前进 = 游标泵）。
  // 实例化后不再有 pivot 节点：树倒写**逐实例矩阵**（T(p)·R·T(−p)·base，与旧 pivot
  // 装配逐值等价，见 sceneryInstancing.js），建筑换模在 base / 隐藏矩阵之间翻转实例
  // 矩阵。树只在自己倒伏窗口内写矩阵、终态后写一次不再碰（省去 700+ 次 compose）；
  // 实例矩阵上传按帧合并（同帧多树只触发一次所在批次的 needsUpdate）。
  const _tmpFallAxis = new THREE.Vector3();
  const _tmpInstM = new THREE.Matrix4();
  const _tmpFallQ = new THREE.Quaternion();
  function updateDestructibles(T: number) {
    if (!destruct) return;
    // 推进视角的窄化视图（DestructibleFoldState + applied 游标标记）；运行时同一份对象
    const states = destruct.states as DestructState[];
    if (T < destruct.lastT) {
      destruct.ptr = 0;   // seek 后退：全部回到未激活
      // 树终态缓存随回退**显式失效**。⚠️ 此处不得置 upright=true（评审 P1）：
      // upright 是「槽位已恢复直立」的标记，提前置 true 会让未激活分支跳过
      // base 矩阵恢复——树已倒下后回退到事件前，画面仍停在倒伏姿态。
      // 复位交给下方 !active 分支（upright=false 时才执行 base 写回 + fallQuat 复位）。
      for (const st of states) if (st.prop === 3) st.settled = false;
    }
    destruct.lastT = T;
    while (destruct.ptr < states.length && states[destruct.ptr].clock <= T) destruct.ptr++;
    destruct.animating = false;
    // 初值经并集断言（TS 对闭包内写入的 let 按初始化流窄化，纯 null 初值会让读取点窄成 never）
    let dirty = null as Set<THREE.InstancedMesh> | null;   // 本帧被写过的批次 → 一次性 needsUpdate（Set 去重多树同批次）
    const mark = (mesh: THREE.InstancedMesh) => { (dirty || (dirty = new Set())).add(mesh); };
    for (let i = 0; i < states.length; i++) {
      const st = states[i];
      const active = i < destruct.ptr;
      if (st.prop === 3) {
        if (!st.slots) continue;
        if (!active) {
          // 倒带复位：恢复 base（直立）。upright 标记免每帧重写（旧实现查四元数非零）。
          if (!st.upright) {
            for (const s of st.slots) { s.mesh.setMatrixAt(s.idx, s.base); mark(s.mesh); }
            st.fallQuat.w = 1;
            st.upright = true;
          }
          continue;
        }
        // 推进决策在 destructibles.treeFrame（纯函数，单测锁定倒带序列），此处只写
        // 实例矩阵与 fallQuat（settled 自校验的第二道防线用）。
        const f = treeFrame(st, true, T);
        if (f) {
          if (f.animating) destruct.animating = true;
          _tmpFallAxis.set(f.axis[0], f.axis[1], f.axis[2]);
          for (const s of st.slots) {
            fallMatrix(s.base, st.pivotPos.x, st.pivotPos.y, st.pivotPos.z, _tmpFallAxis, f.angle, _tmpInstM);
            s.mesh.setMatrixAt(s.idx, _tmpInstM);
            mark(s.mesh);
          }
          _tmpFallQ.setFromAxisAngle(_tmpFallAxis, f.angle);
          st.fallQuat.w = _tmpFallQ.w;
          st.upright = false;
        }
      } else {
        if (active === !!st.applied) continue;
        st.applied = active;
        // 完好态：存活期显示、摧毁后隐藏；损毁态相反（旧 visible 翻转 → 实例矩阵翻转）。
        for (const s of st.intactSlots || []) {
          if (active) writeHiddenInstance(s.mesh, s.idx); else s.mesh.setMatrixAt(s.idx, s.base);
          mark(s.mesh);
        }
        for (const s of st.deadSlots || []) {
          if (!active) writeHiddenInstance(s.mesh, s.idx); else s.mesh.setMatrixAt(s.idx, s.base);
          mark(s.mesh);
        }
      }
    }
    if (dirty) for (const mesh of dirty) mesh.instanceMatrix.needsUpdate = true;
  }

  // ---- 逐图光照（客户端 DirectionalLightComponent → map/<key>/lighting.json）----
  // 客户端静态场景是**烘焙光照图**（无实时定向光），实时定向光只服务动态物体；
  // 本渲染器尚无烘焙光照图（上游 docs/map-lighting-plan.md 期 2b），故用"该图真实太阳
  // 方向 + 色/强度"的定向光近似直接光，环境项用半球光承载 `sun.ambient`（客户端 ambColor）。
  // 方向语义：客户端给的是**传播**方向（源→地面，场景系）；three 的方向光从 position
  // 射向 target，故 position = −direction。强度按客户端公式直用：客户端
  // `diffuse = lightColor*intensity*NdotL/π`，three 物理光单位（r165+）同式。
  // 应用体见共享模块 mapLighting.js（SSOT，与俯视烘焙同一份——见该模块头部 2026-10-14 说明）：
  // 本页只保留本地签名与 envMultiplier 闭包回写（IBL 晚到的加载路径继续读该值）。
  function applyMapLighting(L: MapLightingData | null) {
    const { renderer, scene, sunLight, hemiLight, debug } = deps.lightingTargets()
    if (!sunLight || !hemiLight) return;
    envMultiplier = applyMapLightingCore({ renderer: renderer!, scene, sunLight, hemiLight, lighting: L, debug }).envMultiplier;
    deps.onLightingApplied();   // 接地阴影的太阳方向/强度随逐图光照同步（#907 主干随迁）
  }
  // 复位体见共享模块（含共享太阳 uniform 与曝光复位）；envMultiplier 闭包回写。
  function resetMapLighting() {
    const { renderer, scene, sunLight, hemiLight, debug } = deps.lightingTargets()
    resetMapLightingCore({ renderer: renderer!, scene, sunLight, hemiLight, debug });
    envMultiplier = 1;
  }

  /** 会话 teardown：地图资产段（对象清单与顺序逐字保留自原 teardownSession）。 */
  function dispose() {
    const scene = deps.getScene()
    const disposeObject3D = deps.disposeObject3D
    for (const o of [mapPlane, terrainMesh, mapScenery, groundMesh, gridHelper]) {
      if (o) { scene?.remove(o); disposeObject3D(o); }
    }
    mapPlane = null; terrainMesh = null; mapScenery = null; groundMesh = null; gridHelper = null;
    annotationSurfaceGrid = null;
    clearSceneryMatCache();   // 材质已随 mapScenery dispose，缓存须清空（勿复用已 dispose 实例）
    if (mapTexture) { mapTexture.dispose(); mapTexture = null; }
    // 逐图 IBL：先摘 scene.environment 再 dispose（three 的 PMREM 缓存随纹理释放）；
    // scene 可能尚未创建（teardown 可先于 initScene），故判空
    if (scene) {
      scene.environment = null;
      scene.environmentIntensity = 1;
    }
    if (envTexture) { envTexture.dispose(); envTexture = null; }
    if (groundLayers) { for (const k in groundLayers.texs) groundLayers.texs[k]?.dispose?.(); }
    groundLayers = null;
    heightField = null; heightMeta = null; mapMetaInfo = null;
    destruct = null;
    destructPickList = null;
    meshOwner = null;
    animLayerMats = [];
    currentMapKey = null;
    currentMapBases = null;
  }

  // perf 帧统计读取面（宿主 perfFrame 消费）
  function terrainCounters() { return { terrainChecks: perfTerrainChecks, terrainRebuilds: perfTerrainRebuilds }; }
  function resetTerrainCounters() { perfTerrainChecks = 0; perfTerrainRebuilds = 0; }

  return {
    setMapKey,
    setAnnotationSurfaceGrid(grid: unknown) { annotationSurfaceGrid = grid; },
    buildWorld,
    loadMapImage,
    sampleHeight,
    sampleRenderedTerrainHeight,
    annotationSurfaceHeightAt,
    terrainSpanOf,
    maybeRebuildTerrainLod,
    rebuildGround,
    groundY,
    updateDestructibles,
    applyMapLighting,
    resetMapLighting,
    dispose,
    terrainCounters,
    resetTerrainCounters,
    // getter 快照（其余模块消费的世界事实；不允许副本状态）
    mapKey: () => currentMapKey,
    mapBases: () => currentMapBases,
    mapPlane: () => mapPlane,
    mapTexture: () => mapTexture,
    mapMetaInfo: () => mapMetaInfo,
    groundLayers: () => groundLayers,
    terrainMesh: () => terrainMesh,
    heightField: () => heightField,
    heightMeta: () => heightMeta,
    waterTexDispose: () => waterTexDispose,
    mapScenery: () => mapScenery,
    terrainRefineMask: () => terrainRefineMask,
    destruct: () => destruct,
    destructPickList: () => destructPickList,
    meshOwner: () => meshOwner,
    groundMesh: () => groundMesh,
    gridHelper: () => gridHelper,
    worldCenter: () => WORLD_CENTER,
    animLayerMats: () => animLayerMats,
    occlGrid: () => occlGrid,
    annotationSurfaceGrid: () => annotationSurfaceGrid,
    envTexture: () => envTexture,
    envMultiplier: () => envMultiplier,
  };
}
