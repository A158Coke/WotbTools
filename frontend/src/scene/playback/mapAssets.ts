import * as THREE from 'three'
import type { Group, InstancedMesh, Mesh, Object3D, ShaderMaterial, Texture } from 'three'
import { sceneHasSkyFlags, strictSurfacesOf, isWaterNode as isWaterNodeRule } from '../sceneryAssemblyRules.js'
import { resolveSceneryExtras, makeTexResolvers, assembleSceneryMaterials } from '../sceneryAssembly.js'
import { applyMaterialTextureAnisotropy } from '../sceneryMaterials.js'
import { pruneForeignVariantsDetailed, activeVariantOf } from '../variantFilter.js'
import { mergeCoincidentWaterMeshes } from './waterMerge.js'
import { makeWaterCoast, buildCorridorRefineMask } from '../groundPass.js'
import {
  collectInstanceEntries, groupInstanceBatches, buildInstancedMesh, buildStandaloneLightmappedMeshes,
  writeHiddenInstance, refreshBatchSphere, hasTransparentMaterial, canonicalizeEntryMaterials,
} from '../sceneryInstancing.js'
import { buildMeshOwnerMap } from '../pickDebug.js'
import { assembleDestructibleSlots } from './mapAssetsDestructibles.ts'
import { occlusionFootprintCells } from './pure.js'
import { buildAnnotationSurfaceGrid } from './annotationSurface.ts'
import type { GroundLayersField } from '../sceneryAssembly.js'
import type { WaterCoastField } from '../sceneryMaterials.js'
import type { DestructibleArea, DestructibleEvent, DestructibleFoldState, DestructibleInstance } from '../destructibles.js'
import type { MeshOwnerValue, PickMeshEntry } from '../pickDebug.js'
import type { InstanceBatch, InstanceEntry } from '../sceneryInstancing.js'

const OCCL_CELL = 16;

interface SceneryMeshSample {
  o: Mesh
  water: boolean
}

type SlottedEntry = InstanceEntry & { batch?: InstanceBatch; idx?: number; hidden?: boolean }
type BuiltBatch = InstanceBatch & { mesh: InstancedMesh }
export type BatchedEntry = InstanceEntry & { batch: BuiltBatch; idx: number; hidden?: boolean }

export interface MapAssemblyContext {
  DATA: {
    meta: { map_id: number | string }
    destructible_areas?: DestructibleArea[] | null
    destructible_events?: DestructibleEvent[] | null
  }
  Q: { anisotropy: number }
  DEBUG: boolean
  groundLayers: GroundLayersField | null
  camera: { near: number; far: number } | null
  renderer: { capabilities: { getMaxAnisotropy(): number }; getContext?: () => WebGLRenderingContext | null }
  scene: Object3D
  controls?: unknown
  terrainMesh?: unknown
  heightField: Float32Array | null
  heightMeta?: { size?: number; span?: number } | null
  terrainSpan: number
  stale(): boolean
  disposeObject3D(o: Object3D): void
  noteAsset(key: string, status: string, detail?: string): void
  sampleHeight(x: number, z: number): number
  onSceneryMounted(group: Object3D, heightTex: Texture | null): void
  onRefineMaskBuilt(mask: unknown): void
  destructDocPromise: Promise<{ instances?: DestructibleInstance[] } | null | undefined>
}

export interface MapAssemblyWrites {
  waterTexDispose?: Texture | null
  animLayerMats?: ShaderMaterial[]
  variantLabel?: string | null
  waterMeshes?: THREE.Mesh[]
  waterLevel?: number | null
  mapScenery?: Group
  terrainRefineMask?: unknown
  occlGrid?: Map<string, Mesh[]>
  annotationSurfaceGrid?: unknown
  destructPickList?: DestructibleInstance[] | null
  meshOwner?: Map<string, MeshOwnerValue> | null
  destruct?: { states: DestructibleFoldState[]; ptr: number; lastT: number; animating: boolean } | null
}

export async function assembleMapScenery(gltf: import('../sceneryAssembly.js').ParsedGltf, ctx: MapAssemblyContext): Promise<{ stale: boolean; writes: MapAssemblyWrites }> {
  const { DATA, Q, DEBUG, groundLayers } = ctx;
  const writes: MapAssemblyWrites = {};
  const skyFlagsAvailable = sceneHasSkyFlags(gltf.scene);
  const variantMappingIncomplete = gltf.scene.userData?.variantMappingIncomplete === true;
  const variantPrune = pruneForeignVariantsDetailed(gltf.scene as Object3D & import('../variantFilter.js').VariantPruneNode, DATA.meta.map_id);
  const prunedVariants = variantPrune.removed;
  const activeVariant = activeVariantOf(
    (gltf.scene as { userData?: { variantByMapId?: unknown } }).userData?.variantByMapId,
    DATA.meta.map_id,
  );
  if (prunedVariants && DEBUG) window.__prunedVariantNodes = prunedVariants;
  if (DEBUG) {
    const borderNames: string[] = [];
    gltf.scene.traverse((o) => { const n = (o as { name?: string }).name || ''; if (n.startsWith('MapBorder')) borderNames.push(n); });
    window.__mapBorderNodes = borderNames;
  }
  if (variantMappingIncomplete || variantPrune.failClosed) {
    ctx.noteAsset('scenery', 'variant-fail-closed', variantMappingIncomplete
      ? '导出器标记变体映射不完整，已 fail-closed 隐藏带标记节点'
      : '变体映射缺失/未知，已隐藏全部带标记节点');
  }
  const sceneryExtras = await resolveSceneryExtras(gltf);
  if (ctx.stale()) { ctx.disposeObject3D(gltf.scene); return { stale: true, writes }; }
  const strictSurfaces = strictSurfacesOf(gltf.scene);
  const isWaterNode = (name: string, mat: import('../sceneryAssemblyRules.js').SurfaceMaterial | null | undefined) =>
    isWaterNodeRule(name, mat, { strictSurfaces });
  const { maskTexOf, lmTexOf, detailTexOf, envTexOf, waterTexOf, decalTexOf } =
    makeTexResolvers(gltf, sceneryExtras);
  const sceneryMeshes: SceneryMeshSample[] = [];
  let waterCoast: WaterCoastField | null = null;
  if (ctx.heightField && ctx.heightMeta) {
    try {
      const hn = ctx.heightMeta.size || 512;
      if (ctx.heightField.length === hn * hn) {
        let depthBits = 24;
        try {
          const glc = ctx.renderer && ctx.renderer.getContext && ctx.renderer.getContext();
          const b = glc && glc.getParameter && glc.getParameter(glc.DEPTH_BITS);
          if (Number.isFinite(b) && b >= 16 && b <= 32) depthBits = b;
        } catch (e) { /* 取不到按 24bit 缺省 */ }
        waterCoast = makeWaterCoast({
          field: ctx.heightField, n: hn, span: ctx.terrainSpan,
          near: ctx.camera && Number.isFinite(ctx.camera.near) ? ctx.camera.near : 0.5,
          far: ctx.camera && Number.isFinite(ctx.camera.far) ? ctx.camera.far : 4000,
          depthBits,
        });
        writes.waterTexDispose = waterCoast.heightTex;
        if (DEBUG) window.__waterCoast = { present: true, span: waterCoast.mapSpan, materials: 0 };
      }
    } catch (e) { console.warn('水面海岸线高度场创建失败（按不淡出继续）:', e); }
  }
  const { animLayerMats: assembledAnimMats } = assembleSceneryMaterials(gltf, {
    strictSurfaces,
    masks: { maskTexOf, lmTexOf, detailTexOf, envTexOf, waterTexOf, decalTexOf },
    groundLayers, waterCoast, debug: DEBUG,
    onMesh: (o, waterMarked) => { sceneryMeshes.push({ o, water: waterMarked }); },
    skyFlagsAvailable,
  });

  const waterMerge = mergeCoincidentWaterMeshes(gltf.scene);
  if (DEBUG && (waterMerge.merged || waterMerge.dropped)) {
    window.__waterMerged = waterMerge;
  }

  {
    const waterMeshes: THREE.Mesh[] = [];
    let waterLevel: number | null = null;
    const box = new THREE.Box3();
    gltf.scene.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : (mesh.material ? [mesh.material] : []);
      if (!mats.some((m) => m && (m as THREE.Material & { userData?: { water?: boolean } }).userData?.water)) return;
      waterMeshes.push(mesh);
      box.setFromObject(mesh);
      if (!box.isEmpty()) waterLevel = Math.max(waterLevel ?? -Infinity, box.max.z);
    });
    writes.waterMeshes = waterMeshes;
    writes.waterLevel = waterLevel;
  }

  writes.animLayerMats = assembledAnimMats;
  if (DEBUG) window.__animLayerMats = assembledAnimMats.length;
  if (DEBUG) {
    const waterMats: THREE.ShaderMaterial[] = [];
    gltf.scene.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of mats) {
        const sm = mat as THREE.ShaderMaterial;
        if (sm?.userData?.water && sm.uniforms && !waterMats.includes(sm)) waterMats.push(sm);
      }
    });
    window.__waterMats = waterMats;
  }

  const aniso = Math.min(Q.anisotropy, ctx.renderer.capabilities.getMaxAnisotropy());
  const anisoTextures = applyMaterialTextureAnisotropy(gltf.scene, aniso);
  if (DEBUG) window.__sceneryAniso = { value: aniso, textures: anisoTextures };

  const mapScenery = new THREE.Group();
  mapScenery.rotation.order = 'YXZ';
  mapScenery.rotation.set(-Math.PI / 2, Math.PI, 0);
  mapScenery.add(gltf.scene);
  ctx.scene.add(mapScenery);
  writes.mapScenery = mapScenery;
  ctx.onSceneryMounted(mapScenery, waterCoast ? (waterCoast.heightTex ?? null) : null);

  if (sceneryMeshes.length && ctx.heightField) try {
    mapScenery.updateMatrixWorld(true);
    const built = buildCorridorRefineMask({
      meshes: sceneryMeshes, field: ctx.heightField,
      n: ctx.heightMeta?.size || 512, span: ctx.heightMeta?.span || 600,
    });
      if (built) {
        writes.terrainRefineMask = built.mask;
        if (DEBUG) window.__terrainRefineMask = { meshes: built.candidates, texels: built.texels };
        if (ctx.terrainMesh && ctx.camera && ctx.controls) ctx.onRefineMaskBuilt(built.mask);
      }
  } catch (e) { console.warn('走廊掩码构建失败（地形保持客户端口径）:', e); }


  gltf.scene.updateMatrixWorld(true);
  const allEntries: SlottedEntry[] = canonicalizeEntryMaterials(collectInstanceEntries(gltf.scene));
  const batchable = (e: SlottedEntry) =>
    !(e.node.userData && e.node.userData.isSky)
      && !isWaterNode(e.name, e.material)
      && !hasTransparentMaterial(e.material);
  const entries = allEntries.filter(batchable);
  buildStandaloneLightmappedMeshes(allEntries.filter((e) =>
    !batchable(e)
      && hasTransparentMaterial(e.material)
      && !(e.node.userData && e.node.userData.isSky)
      && !isWaterNode(e.name, e.material)), gltf.scene);
  const meshGrid = new Map<string, BatchedEntry[]>();
  const gridKey = (x: number, y: number): string => `${Math.round(x / 2)},${Math.round(y / 2)}`;
  for (const e of entries as BatchedEntry[]) {
    const k = gridKey(e.x, e.y);
    const list = meshGrid.get(k) ?? meshGrid.set(k, []).get(k)!
    list.push(e);
  }
  const cellSize = Math.max(75, (ctx.heightMeta?.span || 600) / 8);
  const batches = groupInstanceBatches(entries as InstanceEntry[], cellSize) as BuiltBatch[];
  for (const b of batches) (b.items as BatchedEntry[]).forEach((e, i) => { e.batch = b; e.idx = i; });
  for (const b of batches) { b.mesh = buildInstancedMesh(b); gltf.scene.add(b.mesh); }
  for (const e of entries) e.node.removeFromParent();
  for (const e of entries as BatchedEntry[]) {
    if (e.name && e.name.startsWith('D_')) { writeHiddenInstance(e.batch.mesh, e.idx); e.hidden = true; }
  }
  const initiallyHidden = (e: InstanceEntry) => (e as BatchedEntry).hidden === true;
  for (const b of batches) refreshBatchSphere(b.mesh, b, initiallyHidden);
  const MESH_MATCH_R = 0.02;
  const occGrid = new Map<string, InstancedMesh[]>();
  for (const b of batches) {
    if (!b.geometry.boundingSphere) b.geometry.computeBoundingSphere();
    const r = b.geometry.boundingSphere ? b.geometry.boundingSphere.radius : 0;
    for (const e of b.items as BatchedEntry[]) {
      if (e.hidden || !e.name) continue;
      const c = occlusionFootprintCells(e.x - r, e.y - r, e.x + r, e.y + r, OCCL_CELL);
      for (const key of c) {
        const list = occGrid.get(key);
        if (list) { if (!list.includes(b.mesh)) list.push(b.mesh); }
        else occGrid.set(key, [b.mesh]);
      }
    }
  }
  writes.occlGrid = occGrid;
  mapScenery.updateMatrixWorld(true);
  const surfaceMatrix = gltf.scene.matrixWorld.elements;
  writes.annotationSurfaceGrid = buildAnnotationSurfaceGrid(batches, {
    cell: OCCL_CELL,
    project: (item) => ({
      x: surfaceMatrix[0] * item.x + surfaceMatrix[4] * item.y + surfaceMatrix[8] * item.z + surfaceMatrix[12],
      z: surfaceMatrix[2] * item.x + surfaceMatrix[6] * item.y + surfaceMatrix[10] * item.z + surfaceMatrix[14],
    }),
  });
  const findMeshes = (px: number, py: number, wantDestroyed: boolean, r = MESH_MATCH_R): BatchedEntry[] => {
    const out: BatchedEntry[] = [];
    const gx = Math.round(px / 2), gy = Math.round(py / 2);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const e of meshGrid.get(`${gx + dx},${gy + dy}`) || []) {
        const destroyedMesh = e.name.startsWith('D_');
        if (destroyedMesh === wantDestroyed && Math.hypot(e.x - px, e.y - py) <= r) out.push(e);
      }
    }
    return out;
  };
  const destructDoc = await ctx.destructDocPromise;
  if (ctx.stale()) {
    return { stale: true, writes: {} };
  }
  if (DEBUG) window.__destructStage = destructDoc
    ? (Array.isArray(DATA.destructible_events) ? `events-${DATA.destructible_events.length}` : 'no-events-old-wasm')
    : 'doc-missing';
  let destruct: MapAssemblyWrites['destruct'] = null;
  let destructPickList: DestructibleInstance[] | null = null;
  let meshOwner: Map<string, MeshOwnerValue> | null = null;
  if (destructDoc && Array.isArray(destructDoc.instances)) {
    destructPickList = destructDoc.instances;
    meshOwner = buildMeshOwnerMap(destructPickList, (px, py, wantDestroyed): Iterable<PickMeshEntry> => findMeshes(px, py, wantDestroyed));
  }
  let volatileBatches: ReadonlySet<InstancedMesh> | undefined;
  if (destructDoc && Array.isArray(DATA.destructible_events)) {
    const assembled = assembleDestructibleSlots(DATA, destructDoc, findMeshes, ctx);
    destruct = assembled.destruct;
    volatileBatches = assembled.volatileBatches;
    for (const mesh of volatileBatches) mesh.userData.occluderBox = null;
    const readyDestruct = destruct;
    if (DEBUG && readyDestruct) {
      window.__destructStage = `ready states=${readyDestruct.states.length}`;
      window.__destructDebug = (): Record<string, unknown> => ({
        events: (DATA.destructible_events || []).length,
        states: readyDestruct.states.length,
        trees: readyDestruct.states.filter((st) => st.slots).length,
        swaps: readyDestruct.states.filter((st) => st.intactSlots).length,
        ptr: readyDestruct.ptr,
      });
    }
  }
  for (const b of batches) {
    if (!volatileBatches?.has(b.mesh) && b.items.every(initiallyHidden)) b.mesh.visible = false;
  }
  writes.destructPickList = destructPickList;
  writes.meshOwner = meshOwner;
  writes.destruct = destruct;
  mapScenery.updateMatrixWorld(true);
  gltf.scene.traverse((o) => { o.matrixAutoUpdate = false; });
  mapScenery.matrixAutoUpdate = false;
  writes.variantLabel = activeVariant;
  return { stale: false, writes };
}
