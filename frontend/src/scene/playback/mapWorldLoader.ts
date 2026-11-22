import * as THREE from 'three'
import type { Texture } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { mapStaticUrl, resolveMapKey } from '../replaySource.js'
import { mapBases } from '../../data/mapBases.js'
import { basesForVariant, type MapBasesEntry } from './bases.js'
import { loadTerrain, groundLayerKeys, setupGroundTextures } from '../groundPass.js'
import { buildDecalMeshes, type DecalDoc } from './deferredDecals.js'
import { loadMapGrass } from './mapWorldGrass.js'
import { assembleMapScenery } from './mapAssets.js'
import type { ParsedGltf } from '../sceneryAssembly.js'
import { ASSET_CONCURRENCY, mapLimit } from './util.js'
import { assetProvider } from '../assetProvider.js'
import { createLoadProgress } from '../loadProgress.js'
import type { MapWorldDeps, MapWorldLoadState, HeightMetaSurface } from './mapWorldLoadState.js'
import type { MapLightingData } from '../mapLighting.js'

export type MapWorldLoaderState = Pick<MapWorldLoadState, 'mapPlane' | 'terrainMesh' | 'mapScenery' | 'decalGroup' | 'decalAtlas' | 'grassLayer' | 'grassProtoScene' | 'terrainRefineMask' | 'destruct' | 'destructPickList' | 'meshOwner' | 'mapTexture' | 'mapMetaInfo' | 'heightField' | 'heightMeta' | 'waterTexDispose' | 'occlGrid' | 'annotationSurfaceGrid' | 'groundLayers' | 'currentMapKey' | 'currentMapBases' | 'envTexture' | 'envMultiplier' | 'animLayerMats' | 'waterMeshes' | 'waterLevel' | 'groundMesh' | 'WORLD_CENTER'>
const errorMessage = (e: unknown) => { const err = e as { message?: unknown }; return err && err.message ? err.message : e }
const debugWindow = (typeof window !== 'undefined' ? window : {}) as Window & { __terrain?: THREE.Mesh | null; __gdbg?: { layers: boolean; texs: string[]; meta: boolean; sizeM: number | null }; __destructStage?: string }
const loadTerrainTyped = loadTerrain as (a: { binUrl: string | null; metaUrl: string | null; fetchFn: (u: string) => Promise<Response>; stale: () => boolean; onDiagnostics?: ((d: Record<string, unknown>) => void) | null }) => { field: Float32Array | null; meta: HeightMetaSurface | null; metaStatus: number | null; binStatus: number | null }
export function createMapWorldLoader(deps: MapWorldDeps, st: MapWorldLoaderState, hooks: { resetTerrainLifecycle: () => void; invalidateTerrainLod: () => void; applyMapLighting: (data: MapLightingData | null) => void; rebuildGround: () => void; terrainSpanOf: () => number; maybeRebuildTerrainLod: () => void; sampleHeight: (x: number, z: number) => number }) {
  const store = deps.store
  const { resetTerrainLifecycle, invalidateTerrainLod, applyMapLighting, rebuildGround, terrainSpanOf, maybeRebuildTerrainLod, sampleHeight } = hooks
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
    if (st.mapPlane) { scene?.remove(st.mapPlane); st.mapPlane = null; }
    if (st.terrainMesh) { scene?.remove(st.terrainMesh); st.terrainMesh = null; if (DEBUG) debugWindow.__terrain = null; }
    if (st.mapScenery) { scene?.remove(st.mapScenery); st.mapScenery = null; }
    if (st.decalGroup) { scene?.remove(st.decalGroup.group); st.decalGroup.dispose(); st.decalGroup = null; }
    if (st.decalAtlas) { st.decalAtlas.dispose(); st.decalAtlas = null; }
    if (st.grassLayer) { scene?.remove(st.grassLayer.group); st.grassLayer.dispose(); st.grassLayer = null; }
    if (st.grassProtoScene) { deps.disposeObject3D(st.grassProtoScene); st.grassProtoScene = null; }
    st.terrainRefineMask = null;   // 走廊掩码属场景 GLB，随它失效
    st.destruct = null;
    st.destructPickList = null;
    st.meshOwner = null;
    st.mapTexture = null; st.mapMetaInfo = null; st.heightField = null; st.heightMeta = null;
    if (st.waterTexDispose) { st.waterTexDispose.dispose(); st.waterTexDispose = null; }
    invalidateTerrainLod();   // 会话场景失效：下一场首帧必重建地形 LOD
    resetTerrainLifecycle();
    st.occlGrid = null;   // 标签遮挡候选格属于会话场景，随场景一起失效
    st.annotationSurfaceGrid = null;   // 3D annotation 表面候选格同样属于会话场景
    st.groundLayers = null;
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
    st.currentMapKey = resolvedKey;
    store.mapKey = resolvedKey;
    const mapBasesTable = mapBases as Record<string, unknown>;
    st.currentMapBases = resolvedKey ? (mapBasesTable[resolvedKey] || null) : null;
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
          st.mapMetaInfo = meta;
          st.mapTexture = texture;
          st.mapTexture!.colorSpace = THREE.SRGBColorSpace;
          st.mapTexture!.anisotropy = Math.min(Q.anisotropy, deps.getRenderer()?.capabilities.getMaxAnisotropy() ?? 1);
          if (st.mapMetaInfo!.flip_x) { st.mapTexture!.wrapS = THREE.RepeatWrapping; st.mapTexture!.repeat.x = -1; st.mapTexture!.offset.x = 1; }
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
    // 投影贴花（上游 decals.json + 解码图集，2026-11-17 审计 B9；当前内容仅 plant 有）。
    // 可选资产：缺文件/旧包 → 无贴花层，不阻断。静态近似语义与坐标帧见 deferredDecals.ts
    // （几何顶点 = 客户端世界系，组上施加与 mapScenery 同款 qFrame）。
    try {
      const decalUrl = mapStaticUrl('decals', undefined, resolvedKey);
      if (decalUrl) {
        const dresp = await assetProvider.fetch(decalUrl);
        if (stale()) return;
        if (dresp.ok) {
          const doc = await dresp.json() as DecalDoc | null;
          if (stale()) return;
          if (doc && Array.isArray(doc.decals) && doc.decals.length && doc.textures) {
            const texPath = doc.decals[0]?.texture;
            const texFile = texPath ? doc.textures[texPath] : undefined;
            if (texFile) {
              const texUrl = assetProvider.url(`/map/${resolvedKey}/${texFile}`);
              const texResp = await assetProvider.fetch(texUrl);
              if (stale()) return;
              if (texResp.ok) {
                const blob = await texResp.blob();
                if (stale()) return;
                const objUrl = URL.createObjectURL(blob);
                let atlas: THREE.Texture | undefined;
                try {
                  atlas = await new THREE.TextureLoader().loadAsync(objUrl);
                } finally {
                  URL.revokeObjectURL(objUrl);
                }
                if (stale()) { atlas.dispose(); return; }
                atlas.colorSpace = THREE.NoColorSpace;   // legacy 链原样采样（与场景 GLB 同口径）
                atlas.flipY = false;                      // 上游按"文件原始行序"嵌入，v=0 = 首行
                const built = buildDecalMeshes(doc, atlas);
                built.group.rotation.order = 'YXZ';
                built.group.rotation.set(-Math.PI / 2, Math.PI, 0);   // qFrame，与 mapScenery 同帧
                scene.add(built.group);
                st.decalGroup = built;
                st.decalAtlas = atlas;
              } else {
                noteAsset('decals', `tex-http-${texResp.status}`, '贴花图集获取失败（无贴花层）', { optional: true });
              }
            }
          }
        } else {
          noteAsset('decals', `http-${dresp.status}`, '无贴花数据', { optional: true });
        }
      }
    } catch (e) { noteAsset('decals', 'failed', errorMessage(e), { optional: true }); }
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
          st.envTexture = tex!;
          // 场景可能尚未创建（渲染器/场景惰性，资产阶段可早于 initScene）→ 有则立即挂、
          // 无则留待 initScene 末尾补挂（两种时序都覆盖）
          if (scene) {
            scene.environment = tex;
            scene.environmentIntensity = st.envMultiplier;
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
        st.heightMeta = tmeta; st.heightField = field;
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
          st.groundLayers = { layers: L, texs };
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
    if (DEBUG) debugWindow.__gdbg = { layers: !!st.groundLayers, texs: st.groundLayers ? Object.keys(st.groundLayers.texs) : [],
                                 meta: !!st.mapMetaInfo, sizeM: st.mapMetaInfo?.size_m ?? null };
    try {
      rebuildGround();
    } catch (e) {
      // 分层地表元数据形状错误（如缺 tiling）会在 groundShaderMaterial 抛错；这不是
      // 「无分层」而是资产故障——必须记降级，清掉坏层并用烘焙底图重试，且不能因此
      // 跳过后续场景 GLB。
      noteAsset('groundLayers', 'invalid', errorMessage(e));
      if (st.groundLayers) {
        for (const k in st.groundLayers.texs) st.groundLayers.texs[k]?.dispose?.();
        st.groundLayers = null;
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
          camera: deps.getCamera(), renderer: deps.getRenderer()!, scene, controls: deps.getControls(), terrainMesh: st.terrainMesh,
          groundLayers: st.groundLayers, heightField: st.heightField, heightMeta: st.heightMeta, terrainSpan: terrainSpanOf(),
          stale, disposeObject3D: deps.disposeObject3D, noteAsset, sampleHeight,
          // 掩码先写入宿主绑定再重建 LOD（评审 P2：否则首次重建拿到空掩码、
          // terrainLodPrev 置当前后不再失效，走廊细分在初始视角丢失）
          onRefineMaskBuilt: (mask) => { st.terrainRefineMask = mask; invalidateTerrainLod(); maybeRebuildTerrainLod(); },
          // 挂载即归属（评审 P1 复核）：destructibles 悬挂期间 reset/切场，
          // teardownSession 也能看到并释放这批资源（原闭包在此点即时赋值的语义）
          onSceneryMounted: (group, waterTex) => { st.mapScenery = group; if (waterTex) st.waterTexDispose = waterTex; },
          destructDocPromise,
        });
        // stale 判定先于一切 writes 发布（评审 P1：stale 结果不得写回宿主——
        // 会覆盖新会话的 mapScenery/动画材质/遮挡表；过期资源已由模块就地回收）
        if (asm.stale) return;
        const w = asm.writes;
        if ('waterTexDispose' in w) st.waterTexDispose = w.waterTexDispose!;
        if ('animLayerMats' in w) st.animLayerMats = w.animLayerMats!;
        if ('variantLabel' in w) {
          // 基地点位按当前变体取：多变体场景的 mapBases[key].variants[label]；
          // 无该变体数据时回退基础变体（basesForVariant）。
          const entry = resolvedKey ? (mapBasesTable[resolvedKey] as MapBasesEntry | null) : null;
          st.currentMapBases = basesForVariant(entry, w.variantLabel);
        }
        if ('mapScenery' in w) st.mapScenery = w.mapScenery!;
        if ('waterMeshes' in w) st.waterMeshes = w.waterMeshes || [];
        if ('waterLevel' in w) st.waterLevel = w.waterLevel ?? null;
        if ('terrainRefineMask' in w) st.terrainRefineMask = w.terrainRefineMask;
        if ('occlGrid' in w) st.occlGrid = w.occlGrid!;
        if ('annotationSurfaceGrid' in w) st.annotationSurfaceGrid = w.annotationSurfaceGrid;
        st.destructPickList = w.destructPickList!;
        st.meshOwner = w.meshOwner!;
        st.destruct = w.destruct!;
      }
      }
    } catch (e) {
      console.warn('场景模型加载失败（忽略）:', e);
      // 装配/变体裁剪/实例化等后续步骤抛错同样意味着建筑缺失，必须进入降级状态
      noteAsset('scenery', 'failed', errorMessage(e));
    }
    const grassBudget = deps.grassInstanceBudget();
    if (grassBudget > 0) {
      const grassLoad = loadMapGrass(deps, { grassBudget, resolvedKey, stale, scene, sampleHeight, hasHeightField: () => !!st.heightField,
        noteAsset, publish: (layer, prototype) => { st.grassLayer = layer; st.grassProtoScene = prototype; st.animLayerMats.push(...layer.materials); } });
      if (grassLoad) await grassLoad;
    }
    if (stale()) return;
    progress.complete('scenery');
  }
  return { loadMapImage }
}
