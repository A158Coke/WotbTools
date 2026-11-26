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
  let mapTexture: Texture | null = null, mapMetaInfo: MapMetaSurface | null = null;
  let groundLayers: { layers: GroundLayersField['layers']; texs: Record<string, Texture> } | null = null;
  let terrainMesh: THREE.Mesh | null = null, heightField: Float32Array | null = null, heightMeta: HeightMetaSurface | null = null;
  let waterTexDispose: { dispose(): void } | null = null;
  let mapScenery: THREE.Object3D | null = null;
  let decalGroup: ReturnType<typeof buildDecalMeshes> | null = null;
  let decalAtlas: THREE.Texture | null = null;
  let grassLayer: { group: THREE.Group; materials: THREE.ShaderMaterial[]; dispose(): void } | null = null
  let grassProtoScene: THREE.Object3D | null = null;
  let terrainRefineMask: unknown = null;
  let destruct: DestructRuntime | null = null;
  let destructPickList: unknown[] | null = null;
  let meshOwner: Map<string, unknown> | Record<string, unknown> | null = null;
  let groundMesh: THREE.Mesh | null = null, gridHelper: THREE.GridHelper | null = null;
  let currentMapKey: string | null = null;
  let currentMapBases: unknown = null;
  let waterMeshes: THREE.Object3D[] = [];
  let waterLevel: number | null = null;
  let WORLD_CENTER: { cx: number; cz: number; ext: number } = { cx: 0, cz: 0, ext: 300 };
  let animLayerMats: ShaderMaterial[] = [];
  let occlGrid: Map<string, unknown[]> | null = null;
  let annotationSurfaceGrid: unknown = null;

  function setMapKey(key: string | null) { currentMapKey = key; }
  let envTexture: Texture | null = null;
  let envMultiplier = 1;



  const boundsByMap = playableBounds as Record<string, { xMin: number; xMax: number; yMin: number; yMax: number } | undefined>;
  function playableBoundsFor() {
    const pb = (heightMeta && heightMeta.playableBounds) || (currentMapKey ? boundsByMap[currentMapKey] : undefined);
    if (!pb) return null;
    const sxMin = -pb.xMax, sxMax = -pb.xMin;
    return { cx: (sxMin + sxMax) / 2, cz: (pb.yMin + pb.yMax) / 2,
             hx: (sxMax - sxMin) / 2, hz: (pb.yMax - pb.yMin) / 2 };
  }


  function buildWorld() {
    const DATA_ = deps.getData()
    if (!DATA_) return
    const xs: number[] = [], zs: number[] = [];
    for (const def of DATA_.vehicles)
      for (let i = 0; i < def.pos.length; i += 9) { xs.push(def.pos[i]); zs.push(def.pos[i+2]); }
    xs.sort((a,b)=>a-b); zs.sort((a,b)=>a-b);
    const q = (a: number[], f: number) => a.length ? a[Math.floor((a.length-1) * f)] : 0;
    const ex = Math.max(q(xs, .98) - q(xs, .02), 200) * 0.65;
    const ez = Math.max(q(zs, .98) - q(zs, .02), 200) * 0.65;
    const m = Math.max(ex, ez);
    let ext = isFinite(m) && m > 0 ? Math.ceil(m / 50) * 50 : 300;
    let cx = -((q(xs, .98) + q(xs, .02)) / 2), cz = (q(zs, .98) + q(zs, .02)) / 2;
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
    ground.visible = false;
    scene.add(ground);
    groundMesh = ground;
    const grid = new THREE.GridHelper(ext * 2 + 100, Math.floor((ext * 2 + 100) / 50), 0x3a4a5e, 0x273140);
    grid.position.set(cx, 0.02, cz);
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



  const _tmpFallAxis = new THREE.Vector3();
  const _tmpInstM = new THREE.Matrix4();
  const _tmpFallQ = new THREE.Quaternion();
  function updateDestructibles(T: number) {
    if (!destruct) return;
    const states = destruct.states as DestructState[];
    if (T < destruct.lastT) {
      destruct.ptr = 0;
      for (const st of states) if (st.prop === 3) st.settled = false;
    }
    destruct.lastT = T;
    while (destruct.ptr < states.length && states[destruct.ptr].clock <= T) destruct.ptr++;
    destruct.animating = false;
    let dirty = null as Set<THREE.InstancedMesh> | null;
    const mark = (mesh: THREE.InstancedMesh) => { (dirty || (dirty = new Set())).add(mesh); };
    for (let i = 0; i < states.length; i++) {
      const st = states[i];
      const active = i < destruct.ptr;
      if (st.prop === 3) {
        if (!st.slots) continue;
        if (!active) {
          if (!st.upright) {
            for (const s of st.slots) { s.mesh.setMatrixAt(s.idx, s.base); mark(s.mesh); }
            st.fallQuat.w = 1;
            st.upright = true;
          }
          continue;
        }
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

  function applyMapLighting(L: MapLightingData | null) {
    const { renderer, scene, sunLight, hemiLight, debug } = deps.lightingTargets()
    if (!sunLight || !hemiLight) return;
    envMultiplier = applyMapLightingCore({ renderer: renderer!, scene, sunLight, hemiLight, lighting: L, debug }).envMultiplier;
    deps.onLightingApplied();
  }
  function resetMapLighting() {
    const { renderer, scene, sunLight, hemiLight, debug } = deps.lightingTargets()
    resetMapLightingCore({ renderer: renderer!, scene, sunLight, hemiLight, debug });
    envMultiplier = 1;
  }

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
    occlGrid = null;
    terrain.disposeTerrain();
    clearSceneryMatCache();
    if (mapTexture) { mapTexture.dispose(); mapTexture = null; }
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
    mapKey: () => currentMapKey,
    mapBases: () => currentMapBases,
    waterMeshes: () => waterMeshes,
    waterLevel: () => waterLevel,
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
