import * as THREE from 'three'
import type { Texture } from 'three'
import { CLIENT_NORMAL_CAMERA_FOV_H, terrainLodState, terrainLodPoseReason, terrainLodStaleReason, terrainSurfaceHeightAt } from '../terrainMesh.js'
import { buildGroundGeometry, groundGeometryFromData, makeGroundMaterial } from '../groundPass.js'
import { createTerrainLodScheduler } from './terrainLodScheduler.js'
import type { TerrainLodScheduler, TerrainLodJob, GroundGeometryData, TerrainSwapInfo } from './terrainLodScheduler.js'
import { createTerrainLodWake } from './terrainLodWake.js'
import type { MapWorldDeps, MapWorldLoadState } from './mapWorldLoadState.js'

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

const groundGeometryFromDataTyped = groundGeometryFromData as (d: GroundGeometryData) => THREE.BufferGeometry

const makeGroundMaterialTyped = makeGroundMaterial as (a: {
  layers: unknown
  texs: Record<string, Texture> | null
  size: number
  cx: number
  cz: number
  mapTexture: Texture | null
}) => THREE.Material


export type TerrainState = Pick<MapWorldLoadState, 'heightField' | 'heightMeta' | 'terrainMesh' | 'mapPlane' | 'mapMetaInfo' | 'groundMesh' | 'WORLD_CENTER' | 'terrainRefineMask' | 'mapTexture' | 'groundLayers'>
export function createMapWorldTerrain(deps: MapWorldDeps, st: TerrainState) {
  let terrainLodPrev: unknown = null, terrainLodAt = 0
  let terrainScheduler: TerrainLodScheduler<unknown> | null = null
  let terrainWorkerFailed = false, terrainSrcField: unknown = null, terrainSrcMask: unknown = null
  let perfTerrainChecks = 0, perfTerrainRebuilds = 0
  // 地形换装归因（仅 ?perf）：每次 adopt 记一代几何；逐帧计数由 perfProbe 读取。
  // 有界：只保留计数器与当前几何摘要，不累积历史对象。
  let perfGeometryGeneration = 0, perfGeometryCreated = 0, perfGeometryDisposed = 0
  let perfGeometrySummary: Record<string, number> = { generation: 0, vertices: 0, indices: 0, attributeBytes: 0, indexBytes: 0 }
  function describeGeometry(geometry: THREE.BufferGeometry) {
    let attributeBytes = 0
    // Interleaved attributes share one GPU buffer: count each backing array once.
    const seen = new Set<ArrayBufferLike>()
    for (const attribute of Object.values(geometry?.attributes ?? {})) {
      const array = (attribute as { array?: { byteLength?: number } }).array
      if (!array || seen.has(array as ArrayBufferLike)) continue
      seen.add(array as ArrayBufferLike)
      attributeBytes += array.byteLength ?? 0
    }
    return {
      generation: perfGeometryGeneration,
      vertices: geometry?.attributes?.position?.count ?? 0,
      indices: geometry?.index?.count ?? 0,
      attributeBytes,
      indexBytes: geometry?.index?.array?.byteLength ?? 0,
    }
  }
  /** 主线程 adopt 一代新地形几何：返回 generation / 旧 generation / 几何字节。 */
  function adoptGeometry(geometry: THREE.BufferGeometry) {
    const oldGeneration = perfGeometrySummary.generation
    perfGeometryCreated += 1
    perfGeometryGeneration += 1
    perfGeometrySummary = describeGeometry(geometry)
    return { ...perfGeometrySummary, oldGeneration, created: perfGeometryCreated, disposed: perfGeometryDisposed }
  }
  const terrainLodWake = createTerrainLodWake(() => deps.invalidate(), () => deps.destroyed())
  const debugWindow = (typeof window !== 'undefined' ? window : {}) as Window & { __terrain?: THREE.Mesh | null }
  // 双线性采样世界 (x,z) 处高度（米）；无高度场/元数据不完整返回 0
  function sampleHeight(x: number, z: number) {
    if (!st.heightField || !st.heightMeta) return 0;
    const n = Number(st.heightMeta.size), span = Number(st.heightMeta.span);
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
    const hf = st.heightField;
    const top = hf[y0 * n + x0] * (1 - tx) + hf[y0 * n + x0 + 1] * tx;
    const bot = hf[(y0 + 1) * n + x0] * (1 - tx) + hf[(y0 + 1) * n + x0 + 1] * tx;
    return top * (1 - ty) + bot * ty;
  }

  function sampleRenderedTerrainHeight(x: number, z: number) {
    const terrainBuild = st.terrainMesh?.geometry?.userData?.terrainBuild;
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
    const terrainBuild = st.terrainMesh && st.terrainMesh.geometry && st.terrainMesh.geometry.userData
      ? st.terrainMesh.geometry.userData.terrainBuild : null
    if (terrainBuild) {
      const y = terrainSurfaceHeightAt(terrainBuild, x, z)
      return Number.isFinite(y) ? y : null
    }
    if (st.heightField && st.heightMeta) {
      const n = Number(st.heightMeta.size)
      const span = Number(st.heightMeta.span)
      if (!Number.isInteger(n) || n < 2 || !Number.isFinite(span) || span <= 0) return null
      const half = span / 2
      if (x < -half || x >= half || z < -half || z >= half) return null
      const y = sampleHeight(x, z)
      return Number.isFinite(y) ? y : null
    }
    if (st.mapPlane) {
      // 2D 回退地面是有限 plan；不能把平面高度当成无限地图，否则能画到图外。
      const size = Number(st.mapMetaInfo?.size_m) || Number(st.heightMeta?.span) || 600
      const cx = Number(st.mapMetaInfo?.x) || 0
      const cz = Number(st.mapMetaInfo?.z) || 0
      const half = size / 2
      if (x < cx - half || x >= cx + half || z < cz - half || z >= cz + half) return null
      return st.mapPlane.position.y
    }
    if (st.groundMesh) {
      // placeholder ground 也是有限平面（buildWorld: ext*2+100）；不能当无限地面。
      const { cx, cz, ext } = st.WORLD_CENTER
      const half = ext + 50
      if (x < cx - half || x >= cx + half || z < cz - half || z >= cz + half) return null
      return st.groundMesh.position.y
    }
    return null
  }

  /** 地形世界跨度（渲染高度场的世界↔UV 换算也用同一式，杜绝与网格两处漂移）。 */
  function terrainSpanOf() {
    return st.mapMetaInfo?.size_m || st.heightMeta?.span || 600;
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
  /** 一次地形构建的相机侧参数（同步与 Worker 路径共用，逐值一致）。 */
  function terrainBuildRequest() {
    const camera = deps.getCamera()
    return {
      cam: camera ? { x: camera.position.x, y: camera.position.y, z: camera.position.z } : { x: 0, y: 320, z: 0 },   // 兜底：原生相机距离量级
      fovY: camera && Number.isFinite(camera.fov) ? (camera.fov * Math.PI) / 180 : 0.8,
      aspect: camera && Number.isFinite(camera.aspect) && camera.aspect > 0 ? camera.aspect : 16 / 9,
      // 阈值插值的 fov 按**客户端口径**传：引擎 `GetFOV()` 是相机配置的水平 fov、与画面宽高比无关
      // （宽高比只进投影项 tanFovY）。回放自由相机 = 客户端正常相机（无狙击镜档）⇒ 恒 normal。
      // 不传这个的话，窄画布会把「55° 竖直 × aspect」折算成小水平角、阈值滑向狙击镜档（放宽 ~1.8×）。
      hFovDeg: terrainHFovDeg() as number | null,
      measure: !!deps.perf(),
    }
  }
  function buildTerrainGeometry(reason = 'first', mode = 'sync') {
    const perf = deps.perf()
    const n = st.heightMeta?.size || 512;
    const span = terrainSpanOf();
    // 不传 tolScale = 1 = 客户端原口径（该参数仅供单测）
    const r = terrainBuildRequest()
    return buildGroundGeometryTyped({
      field: st.heightField, n, span,                  // 真值场一份到底（渲染/查询同源，客户端同构）
      cam: r.cam, fovY: r.fovY, aspect: r.aspect, hFovDeg: r.hFovDeg,
      // 贴地薄构件走廊（B）：只在这些块强制细分到最细层，廊外层级与客户端口径逐字节一致。
      refineMask: st.terrainRefineMask,
      onDiagnostics: perf ? (data: Record<string, unknown>) => perf.event({ stage: 'terrain-build', ...data, mode, reason }) : undefined,
      cx: st.mapMetaInfo?.x || 0, cz: st.mapMetaInfo?.z || 0,
    });
  }
  /** Worker 来源同步：高度场 / 走廊掩码的引用变了才重发（各自新代号，在途旧结果作废）。 */
  function syncTerrainWorkerSource(sch: TerrainLodScheduler<unknown>) {
    if (terrainSrcField !== st.heightField) {
      terrainSrcField = st.heightField; terrainSrcMask = st.terrainRefineMask
      sch.setSource({
        field: st.heightField as Float32Array, n: st.heightMeta?.size || 512, span: terrainSpanOf(),
        cx: st.mapMetaInfo?.x || 0, cz: st.mapMetaInfo?.z || 0, refineMask: st.terrainRefineMask,
      })
    } else if (terrainSrcMask !== st.terrainRefineMask) {
      terrainSrcMask = st.terrainRefineMask
      sch.setMask(st.terrainRefineMask)
    }
  }
  function ensureTerrainScheduler() {
    if (terrainScheduler || terrainWorkerFailed) return terrainScheduler
    terrainScheduler = createTerrainLodScheduler<unknown>({
      createWorker: () => (typeof Worker === 'undefined' ? null
        : new Worker(new URL('./terrainBuild.worker.ts', import.meta.url), { type: 'module' }) as never),
      onSwap: applyTerrainSwap,
      // 在途结果被 setMask / setSource / invalidate 作废后，宿主可能已停手：
      // 必须唤醒一帧重新按当前掩码与相机提交（调度器不自行重发）。
      onDiscard: () => deps.invalidate(),
      onWorkerLost: (_job, reason) => {
        terrainWorkerFailed = true
        terrainScheduler = null
        terrainSrcField = null; terrainSrcMask = null
        const perf = deps.perf()
        if (perf) perf.event({ stage: 'terrain-build', mode: 'sync-fallback', reason: 'worker-lost', detail: reason })
        // 异步失败可能发生在宿主停手之后：没有脏帧就不会有人跑到同步回退。显式唤醒一帧。
        deps.invalidate()
      },
    })
    return terrainScheduler
  }
  /** Worker 结果换装：主线程只做包装 + 换几何 + 后处理钩子。 */
  function applyTerrainSwap(data: GroundGeometryData, job: TerrainLodJob<unknown>, info: TerrainSwapInfo) {
    if (!st.terrainMesh || deps.destroyed()) return
    const perf = deps.perf()
    const t0 = performance.now()
    const old = st.terrainMesh.geometry
    const geometry = groundGeometryFromDataTyped(data)
    st.terrainMesh.geometry = geometry
    const adoption = perf ? adoptGeometry(geometry) : null
    old.dispose()
    if (perf) perfGeometryDisposed += 1
    // 过期判定相对「屏幕上那张网格」：换装时才更新为该结果对应的相机快照
    terrainLodPrev = job.snapshot
    terrainLodAt = performance.now()
    if (perf) perfTerrainRebuilds++
    deps.constrainFreeCameraAltitude()
    deps.reprojectAnnotationHeights()
    deps.onTerrainReground()
    // 当前相机若已不符合刚换上的快照（在途期间移动后停手），节流窗内不会再有提交：
    // 到期唤醒一帧，让最终姿态得到一次判定；已匹配则撤销旧的待唤醒。
    const camera = deps.getCamera()
    const controls = deps.getControls()
    if (camera && controls && terrainLodPoseReason(job.snapshot, terrainLodState(camera, controls.target, camera.aspect))) {
      terrainLodWake.scheduleElapsed(performance.now() - terrainLodAt)
    } else {
      terrainLodWake.cancel()
    }
    if (perf) {
      const swapMs = performance.now() - t0
      // owner/generation + buffer sizes + worker/swap phases: the per-frame probe adds
      // bufferData/bufferSubData counts/bytes for the same generation, so the upload can
      // be attributed to the frame that adopted the geometry (not folded into swapMs).
      perf.event({ stage: 'terrain-geometry', owner: 'mapWorldTerrain', mode: 'worker', reason: job.reason,
        ...adoption, disposed: perfGeometryDisposed, queueMs: info.queueMs, workerMs: info.workerMs, swapMs, at: performance.now() })
      perf.event({ stage: 'terrain-build', ...(data.diagnostics ?? {}), mode: 'worker', reason: job.reason, queueMs: info.queueMs, workerMs: info.workerMs, swapMs })
      perf.event({ stage: 'terrain-rebuild-inclusive', durationMs: swapMs })
    }
  }
  /** 相机姿态变化时重建地形几何（见 terrainMesh.js `terrainLodStale`——滞回输入与
   *  `buildAdaptiveTerrain` 的判据同源：相机位置/视距/FOV/aspect）。视距单向滞回（拉近立即细化、
   *  拉远 ≥40% 才允许变粗）+ 侧向绕转（≥5% 视距）与 FOV/aspect 变化按新相机位置重算，两次重建
   *  至少隔 120 ms。保证网格**永不比客户端判据（同一相机位置）允许的层级更粗**——否则粗格插值会
   *  把地形抬到贴地薄结构之上（2026-10-10 用户"铁轨被盖、转视角又正常"）。重建成本 ≈ 一次四叉
   *  遍历；实测整张网格（~15 万顶点）构建 240–570 ms（GeckoView 模拟器），所以运行期重建
   *  在 Worker 里跑、结果晚 ~0.25–0.5 s 换上（Worker 不可用时回退同步）。 */
  function maybeRebuildTerrainLod(now = performance.now()) {
    const perf = deps.perf()
    const camera = deps.getCamera()
    const controls = deps.getControls()
    if (perf) perfTerrainChecks++;
    if (!st.terrainMesh || !st.heightField || !camera || !controls) return;
    const cur = terrainLodState(camera, controls.target, camera.aspect);
    const reason = terrainLodStaleReason(terrainLodPrev, cur, now - terrainLodAt);
    if (!reason) return;
    // 异步路径：请求发给 Worker，网格在结果返回的那一帧换上（见 terrainLodScheduler.ts）
    const sch = ensureTerrainScheduler()
    if (sch) {
      syncTerrainWorkerSource(sch)
      if (sch.request({ request: terrainBuildRequest(), snapshot: cur, reason })) {
        // 已按当前姿态发出（或在途已有更新的任务）：待唤醒的最终姿态复查不再需要。
        terrainLodWake.cancel()
        return
      }
    }
    // 同步路径（Worker 不可用 / 出错的回退）：与异步前的行为逐字节一致
    terrainLodWake.cancel();
    terrainLodPrev = cur;
    terrainLodAt = now;
    if (perf) perfTerrainRebuilds++;
    const old = st.terrainMesh.geometry;
    const perfRebuildAt = perf ? performance.now() : 0;
    const geometry = buildTerrainGeometry(reason, 'sync-fallback');
    st.terrainMesh.geometry = geometry;
    const adoption = perf ? adoptGeometry(geometry) : null;
    old.dispose();
    if (perf) perfGeometryDisposed += 1;
    // 当前 camera pose 触发的 LOD 几何将在本帧渲染；按新网格重新约束，避免旧 LOD
    // floor 与替换后的三角面之间留下一帧/停驻时的穿地。
    deps.constrainFreeCameraAltitude();
    deps.reprojectAnnotationHeights();
    deps.onTerrainReground();
    if (perf) {
      const swapMs = performance.now() - perfRebuildAt;
      perf.event({ stage: 'terrain-geometry', owner: 'mapWorldTerrain', mode: 'sync-fallback', reason,
        ...(adoption ?? {}), disposed: perfGeometryDisposed, swapMs, at: performance.now() });
      perf.event({ stage: 'terrain-rebuild-inclusive', durationMs: swapMs });
    }
  }

  // 依据 mapTexture/heightField 重建地面（2D 平面或 3D 地形二选一）
  // 地面材质（客户端 Landscape/tilemask-fp.sl 非 PBR 路径的实时合成：GLOBAL_TINT /
  // SCALED_TILES / HEIGHT_BLEND 逐分支离线核对）已迁至共享模块 groundPass.js
  // `groundShaderMaterial`——3D 运行时与俯视烘焙共用同一份。
  // 依据 mapTexture/heightField 重建地面（2D 平面或 3D 地形二选一）的宿主流程如下。

  function rebuildGround() {
    const scene = deps.getScene()
    if (!scene) return
    if (st.mapPlane) { scene.remove(st.mapPlane); st.mapPlane = null; }
    if (st.terrainMesh) { scene.remove(st.terrainMesh); st.terrainMesh = null; }
    if (!st.mapTexture && !st.heightField) return;
    const meta = st.mapMetaInfo || {};
    const size = meta.size_m || st.heightMeta?.span || 600;
    if (st.heightField) {
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
      const buildStarted = deps.perf() ? performance.now() : 0;
      const geo = buildTerrainGeometry();
      // 分层地表（客户端 tilemask-fp.sl 实时合成，tile 原生分辨率平铺）优先；
      // 缺失时回退整图烘焙贴图（已含烘焙光照，不受光材质避免二次压暗；
      // toneMapped=false 保持烘焙色彩逐像素对齐客户端）。材质选择在共享模块
      // groundPass.makeGroundMaterial（俯视烘焙同一份）。
      // 几何已直接建在场景系（顶点 = texel 中心的世界坐标）⇒ 不再旋转/平移
      const perf = deps.perf();
      const adoption = perf ? adoptGeometry(geo) : null;
      st.terrainMesh = new THREE.Mesh(geo, makeGroundMaterialTyped({
        layers: st.groundLayers && st.groundLayers.layers, texs: st.groundLayers && st.groundLayers.texs,
        size, cx: meta.x || 0, cz: meta.z || 0, mapTexture: st.mapTexture,
      }));
      scene.add(st.terrainMesh);
      if (perf) perf.event({ stage: 'terrain-geometry', owner: 'mapWorldTerrain', mode: 'initial', reason: 'map-load',
        ...adoption, disposed: perfGeometryDisposed, swapMs: performance.now() - buildStarted, at: performance.now() });
      deps.constrainFreeCameraAltitude();
      if (deps.debug) debugWindow.__terrain = st.terrainMesh;   // 诊断/测试钩子：地形网格身份（免按几何猜）
    } else if (st.mapTexture) {
      const mat = new THREE.MeshBasicMaterial({ map: st.mapTexture });
      mat.toneMapped = false;
      st.mapPlane = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
      st.mapPlane.rotation.set(-Math.PI / 2, 0, Math.PI + (meta.rot90 || 0) * Math.PI / 2);
      st.mapPlane.position.set(meta.x || 0, 0.04, meta.z || 0);
      scene.add(st.mapPlane);
    }
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

  function terrainCounters() {
    return { terrainChecks: perfTerrainChecks, terrainRebuilds: perfTerrainRebuilds,
      terrainGeneration: perfGeometrySummary.generation, terrainGeometriesCreated: perfGeometryCreated,
      terrainGeometriesDisposed: perfGeometryDisposed, terrainVertices: perfGeometrySummary.vertices,
      terrainIndices: perfGeometrySummary.indices, terrainAttributeBytes: perfGeometrySummary.attributeBytes,
      terrainIndexBytes: perfGeometrySummary.indexBytes }
  }
  function resetTerrainCounters() {
    // 只重置采集区间计数；当前几何身份（generation / 摘要）必须保留：reset 时这块
    // 地形仍挂在场景里，清零会让后续帧报告第 0 代/零顶点，下一次换装又复用第 1 代，
    // terrain-attribution 会把 reset 前事件与 reset 后帧合并到同一桶。
    perfTerrainChecks = 0; perfTerrainRebuilds = 0; perfGeometryCreated = 0; perfGeometryDisposed = 0
  }
  function invalidateTerrainLod() { terrainLodPrev = null }
  function resetTerrainLifecycle() { terrainLodWake.cancel(); terrainScheduler?.invalidate() }
  function disposeTerrain() { terrainLodWake.cancel(); terrainScheduler?.dispose(); terrainScheduler = null }
  return { sampleHeight, sampleRenderedTerrainHeight, annotationSurfaceHeightAt, terrainSpanOf, maybeRebuildTerrainLod, rebuildGround, groundY, terrainCounters, resetTerrainCounters, invalidateTerrainLod, resetTerrainLifecycle, disposeTerrain }
}
