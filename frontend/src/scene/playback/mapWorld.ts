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
import type { Texture, ShaderMaterial } from 'three'
import { playableBounds } from '../../data/playableBounds.js'
import { treeFrame } from '../destructibles.js'
import { writeHiddenInstance, fallMatrix } from '../sceneryInstancing.js'
import { clearSceneryMatCache } from '../sceneryMaterials.js'
import {
  applyMapLighting as applyMapLightingCore,
  resetMapLighting as resetMapLightingCore,
  updateDynamicLights as updateDynamicLightsCore,
} from '../mapLighting.js'
import { buildDecalMeshes } from './deferredDecals.js'
import { createMapWorldTerrain } from './mapWorldTerrain.js'
import { createMapWorldLoader, type MapWorldLoaderState } from './mapWorldLoader.js'
import type { MapLightingData } from '../mapLighting.js'
import type { GroundLayersField } from '../sceneryAssembly.js'
import type { HeightMetaSurface, MapMetaSurface, DestructRuntime, DestructState, WorldPlaybackData, MapWorldStore, MapWorldDeps } from './mapWorldLoadState.js'
export type { HeightMetaSurface, MapMetaSurface, DestructRuntime, DestructState, WorldPlaybackData, MapWorldStore, MapWorldDeps }


export interface BoundaryBandHost {
  build(bounds: unknown, thick: number): void
  clear(): void
}

export function createMapWorld(deps: MapWorldDeps) {
  let mapPlane: THREE.Mesh | null = null;
  let mapTexture: Texture | null = null, mapMetaInfo: MapMetaSurface | null = null;          // 底图贴图 + 铺设参数
  // 分层地表（客户端 tilemask-fp.sl 实时合成）：{layers: 合成参数, texs: {cm,tile,mask,hmap}}。
  // 缺失（未导出/404）时回退整图烘焙底图
  let groundLayers: { layers: GroundLayersField['layers']; texs: Record<string, Texture> } | null = null;
  let terrainMesh: THREE.Mesh | null = null, heightField: Float32Array | null = null, heightMeta: HeightMetaSurface | null = null;  // 3D 地形
  let waterTexDispose: { dispose(): void } | null = null;   // 水面海岸线用的高度场纹理（会话 teardown 释放）
  let mapScenery: THREE.Object3D | null = null;                              // 静态场景 GLB（建筑等）
  let decalGroup: ReturnType<typeof buildDecalMeshes> | null = null;         // 投影贴花（decals.json；见 deferredDecals.ts）
  let decalAtlas: THREE.Texture | null = null;                               // 贴花图集（会话 teardown 释放）
  let grassLayer: { group: THREE.Group; materials: THREE.ShaderMaterial[]; dispose(): void } | null = null
  let grassProtoScene: THREE.Object3D | null = null;                          // 草原型 GLB（几何所有权）
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
  let waterMeshes: THREE.Object3D[] = [];
  let waterLevel: number | null = null;
  let WORLD_CENTER: { cx: number; cz: number; ext: number } = { cx: 0, cz: 0, ext: 300 };
  // 动画混合层材质（uTime 每帧写回放秒数；随 mapScenery dispose，会话失效）
  let animLayerMats: ShaderMaterial[] = [];
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

  // 可玩范围解析（边界几何由客户端 MapBorderRenderObject 随 scenery.glb 导出；
  // 旧程序化边界带 2026-11-17 已按用户裁示删除）

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
    WORLD_CENTER = { cx, cz, ext };
    deps.buildWorldCameraPlacement(WORLD_CENTER)
  }
  const mapLoadState: MapWorldLoaderState = {
    get mapPlane() { return mapPlane }, set mapPlane(value) { mapPlane = value },
    get terrainMesh() { return terrainMesh }, set terrainMesh(value) { terrainMesh = value },
    get mapScenery() { return mapScenery }, set mapScenery(value) { mapScenery = value },
    get decalGroup() { return decalGroup }, set decalGroup(value) { decalGroup = value },
    get decalAtlas() { return decalAtlas }, set decalAtlas(value) { decalAtlas = value },
    get grassLayer() { return grassLayer }, set grassLayer(value) { grassLayer = value },
    get grassProtoScene() { return grassProtoScene }, set grassProtoScene(value) { grassProtoScene = value },
    get terrainRefineMask() { return terrainRefineMask }, set terrainRefineMask(value) { terrainRefineMask = value },
    get destruct() { return destruct }, set destruct(value) { destruct = value },
    get destructPickList() { return destructPickList }, set destructPickList(value) { destructPickList = value },
    get meshOwner() { return meshOwner }, set meshOwner(value) { meshOwner = value },
    get mapTexture() { return mapTexture }, set mapTexture(value) { mapTexture = value },
    get mapMetaInfo() { return mapMetaInfo }, set mapMetaInfo(value) { mapMetaInfo = value },
    get heightField() { return heightField }, set heightField(value) { heightField = value },
    get heightMeta() { return heightMeta }, set heightMeta(value) { heightMeta = value },
    get waterTexDispose() { return waterTexDispose }, set waterTexDispose(value) { waterTexDispose = value },
    get occlGrid() { return occlGrid }, set occlGrid(value) { occlGrid = value },
    get annotationSurfaceGrid() { return annotationSurfaceGrid }, set annotationSurfaceGrid(value) { annotationSurfaceGrid = value },
    get groundLayers() { return groundLayers }, set groundLayers(value) { groundLayers = value },
    get currentMapKey() { return currentMapKey }, set currentMapKey(value) { currentMapKey = value },
    get currentMapBases() { return currentMapBases }, set currentMapBases(value) { currentMapBases = value },
    get envTexture() { return envTexture }, set envTexture(value) { envTexture = value },
    get envMultiplier() { return envMultiplier }, set envMultiplier(value) { envMultiplier = value },
    get animLayerMats() { return animLayerMats }, set animLayerMats(value) { animLayerMats = value },
    get waterMeshes() { return waterMeshes }, set waterMeshes(value) { waterMeshes = value },
    get waterLevel() { return waterLevel }, set waterLevel(value) { waterLevel = value },
    get groundMesh() { return groundMesh }, set groundMesh(value) { groundMesh = value },
    get WORLD_CENTER() { return WORLD_CENTER }, set WORLD_CENTER(value) { WORLD_CENTER = value },
  }
  const terrain = createMapWorldTerrain(deps, mapLoadState)
  const { sampleHeight, sampleRenderedTerrainHeight, annotationSurfaceHeightAt, terrainSpanOf, maybeRebuildTerrainLod, rebuildGround, groundY, terrainCounters, resetTerrainCounters } = terrain
  const { loadMapImage } = createMapWorldLoader(deps, mapLoadState, {
    resetTerrainLifecycle: terrain.resetTerrainLifecycle, invalidateTerrainLod: terrain.invalidateTerrainLod,
    applyMapLighting, rebuildGround, terrainSpanOf, maybeRebuildTerrainLod, sampleHeight,
  })



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
    if (decalGroup) { scene?.remove(decalGroup.group); decalGroup.dispose(); decalGroup = null; }
    if (decalAtlas) { decalAtlas.dispose(); decalAtlas = null; }
    if (grassLayer) { scene?.remove(grassLayer.group); grassLayer.dispose(); grassLayer = null; }
    if (grassProtoScene) { disposeObject3D(grassProtoScene); grassProtoScene = null; }
    annotationSurfaceGrid = null;
    occlGrid = null;   // 标签遮挡候选格属会话场景，随会话释放（与 annotationSurfaceGrid 同纪律）
    terrain.disposeTerrain();
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
    waterMeshes = [];
    waterLevel = null;
  }

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
    waterMeshes: () => waterMeshes,
    waterLevel: () => waterLevel,
    /** 草层根（反射 pass 剔除；未加载为 null） */
    grassRoot: () => grassLayer?.group ?? null,
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
    // 动态光源池逐帧换绑（相机近邻；142 盏数据因此都能在靠近时亮起）
    tickDynamicLights: (camPos: { x: number; y: number; z: number } | null | undefined) => {
      const scene = deps.getScene();
      if (scene) updateDynamicLightsCore(scene, camPos);
    },
    occlGrid: () => occlGrid,
    annotationSurfaceGrid: () => annotationSurfaceGrid,
    envTexture: () => envTexture,
    envMultiplier: () => envMultiplier,
  };
}
