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
    const epoch = deps.sessionEpoch();
    const diagnosticEpoch = perf?.epoch;
    const stale = () => deps.destroyed() || epoch !== deps.sessionEpoch();
    const scene = deps.getScene()
    if (st.mapPlane) { scene?.remove(st.mapPlane); st.mapPlane = null; }
    if (st.terrainMesh) { scene?.remove(st.terrainMesh); st.terrainMesh = null; if (DEBUG) debugWindow.__terrain = null; }
    if (st.mapScenery) { scene?.remove(st.mapScenery); st.mapScenery = null; }
    if (st.decalGroup) { scene?.remove(st.decalGroup.group); st.decalGroup.dispose(); st.decalGroup = null; }
    if (st.decalAtlas) { st.decalAtlas.dispose(); st.decalAtlas = null; }
    if (st.grassLayer) { scene?.remove(st.grassLayer.group); st.grassLayer.dispose(); st.grassLayer = null; }
    if (st.grassProtoScene) { deps.disposeObject3D(st.grassProtoScene); st.grassProtoScene = null; }
    st.terrainRefineMask = null;
    st.destruct = null;
    st.destructPickList = null;
    st.meshOwner = null;
    st.mapTexture = null; st.mapMetaInfo = null; st.heightField = null; st.heightMeta = null;
    if (st.waterTexDispose) { st.waterTexDispose.dispose(); st.waterTexDispose = null; }
    invalidateTerrainLod();
    resetTerrainLifecycle();
    st.occlGrid = null;
    st.annotationSurfaceGrid = null;
    st.groundLayers = null;
    const DATA_ = deps.getData()
    if (!DATA_ || !scene) return
    const Q = deps.quality()
    const mid = DATA_.meta.map_id || 0;
    const mapq = mid ? ('id=' + mid) : ('name=' + encodeURIComponent(DATA_.meta.map_name || ''));
    const resolvedKey = await resolveMapKey(mapq).catch(() => null);
    if (stale()) return;
    st.currentMapKey = resolvedKey;
    store.mapKey = resolvedKey;
    const mapBasesTable = mapBases as Record<string, unknown>;
    st.currentMapBases = resolvedKey ? (mapBasesTable[resolvedKey] || null) : null;
    const progress = createLoadProgress((snap) => { if (!stale()) store.assetProgress = snap.fraction; });
    const assetIssues: unknown[] = [];
    store.assetIssues = assetIssues;
    store.assetDegraded = false;
    const noteAsset = (key: string, status: string, detail: unknown = '', { optional = false }: { optional?: boolean } = {}) => {
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
                atlas.colorSpace = THREE.NoColorSpace;
                atlas.flipY = false;
                const built = buildDecalMeshes(doc, atlas);
                built.group.rotation.order = 'YXZ';
                built.group.rotation.set(-Math.PI / 2, Math.PI, 0);
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
      const { field, meta: tmeta, metaStatus, binStatus } = await loadTerrainTyped({
        binUrl: mapStaticUrl('terrain', undefined, resolvedKey),
        metaUrl: mapStaticUrl('terrain-meta', undefined, resolvedKey),
        fetchFn: (u: string) => assetProvider.fetch(u),
        stale,
        onDiagnostics: perf ? (event: Record<string, unknown>) => { if (!stale()) perf.event(event, diagnosticEpoch); } : undefined,
      });
      if (stale()) return;
      if (field && Number.isFinite(Number(tmeta?.size)) && tmeta?.terrainLayout !== undefined) {
        st.heightMeta = tmeta; st.heightField = field;
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
        const need = groundLayerKeys(L);
        const texs: Record<string, Texture> = {};
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
          setupGroundTextures(texs, ani);
          st.groundLayers = { layers: L, texs };
        } else {
          for (const k in texs) texs[k]?.dispose?.();
        }
      } else {
        noteAsset('groundLayers', `http-${mresp.status}`, 'ground.layers.json 获取失败（回退烘焙底图）', { optional: true });
      }
      }
    } catch (e) { noteAsset('groundLayers', 'failed', errorMessage(e), { optional: true }); }
    if (stale()) return;
    progress.complete('ground');
    if (DEBUG) debugWindow.__gdbg = { layers: !!st.groundLayers, texs: st.groundLayers ? Object.keys(st.groundLayers.texs) : [],
                                 meta: !!st.mapMetaInfo, sizeM: st.mapMetaInfo?.size_m ?? null };
    try {
      rebuildGround();
    } catch (e) {
      noteAsset('groundLayers', 'invalid', errorMessage(e));
      if (st.groundLayers) {
        for (const k in st.groundLayers.texs) st.groundLayers.texs[k]?.dispose?.();
        st.groundLayers = null;
      }
      try { rebuildGround(); } catch (e2) {
        console.warn('地面重建回退失败（保留 2D 底图）:', e2);
      }
    }
    if (Q.scenery) try {
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
        const asm = await assembleMapScenery(gltf, {
          DATA: DATA_, Q, DEBUG,
          camera: deps.getCamera(), renderer: deps.getRenderer()!, scene, controls: deps.getControls(), terrainMesh: st.terrainMesh,
          groundLayers: st.groundLayers, heightField: st.heightField, heightMeta: st.heightMeta, terrainSpan: terrainSpanOf(),
          stale, disposeObject3D: deps.disposeObject3D, noteAsset, sampleHeight,
          onRefineMaskBuilt: (mask) => { st.terrainRefineMask = mask; invalidateTerrainLod(); maybeRebuildTerrainLod(); },
          onSceneryMounted: (group, waterTex) => { st.mapScenery = group; if (waterTex) st.waterTexDispose = waterTex; },
          destructDocPromise,
        });
        if (asm.stale) return;
        const w = asm.writes;
        if ('waterTexDispose' in w) st.waterTexDispose = w.waterTexDispose!;
        if ('animLayerMats' in w) st.animLayerMats = w.animLayerMats!;
        if ('variantLabel' in w) {
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
