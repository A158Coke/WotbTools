import * as THREE from 'three'
import type { Texture } from 'three'
import { CLIENT_NORMAL_CAMERA_FOV_H, terrainLodState, terrainLodPoseReason, terrainLodStaleReason, terrainSurfaceHeightAt } from '../terrainMesh.js'
import { buildGroundGeometry, groundGeometryFromData, makeGroundMaterial } from '../groundPass.js'
import { createTerrainLodScheduler } from './terrainLodScheduler.js'
import type { TerrainLodScheduler, TerrainLodJob, GroundGeometryData, TerrainSwapInfo } from './terrainLodScheduler.js'
import { createTerrainLodWake } from './terrainLodWake.js'
import type { MapWorldDeps, MapWorldLoadState } from './mapWorldLoadState.js'

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
  includeNormals: boolean
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
  let perfGeometryGeneration = 0, perfGeometryCreated = 0, perfGeometryDisposed = 0
  let perfGeometrySummary: Record<string, number> = { generation: 0, vertices: 0, indices: 0, attributeBytes: 0, indexBytes: 0 }
  function describeGeometry(geometry: THREE.BufferGeometry) {
    let attributeBytes = 0
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
  function adoptGeometry(geometry: THREE.BufferGeometry) {
    const oldGeneration = perfGeometrySummary.generation
    perfGeometryCreated += 1
    perfGeometryGeneration += 1
    perfGeometrySummary = describeGeometry(geometry)
    return { ...perfGeometrySummary, oldGeneration, created: perfGeometryCreated, disposed: perfGeometryDisposed }
  }
  const terrainLodWake = createTerrainLodWake(() => deps.invalidate(), () => deps.destroyed())
  const debugWindow = (typeof window !== 'undefined' ? window : {}) as Window & { __terrain?: THREE.Mesh | null }
  function sampleHeight(x: number, z: number) {
    if (!st.heightField || !st.heightMeta) return 0;
    const n = Number(st.heightMeta.size), span = Number(st.heightMeta.span);
    if (!Number.isInteger(n) || n < 2 || !Number.isFinite(span) || span <= 0) return 0;
    const fx = (x / span + 0.5) * n, fy = (z / span + 0.5) * n;
    const x0 = Math.max(0, Math.min(n - 2, Math.floor(fx))), y0 = Math.max(0, Math.min(n - 2, Math.floor(fy)));
    const tx = Math.max(0, Math.min(1, fx - x0)), ty = Math.max(0, Math.min(1, fy - y0));
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
      const size = Number(st.mapMetaInfo?.size_m) || Number(st.heightMeta?.span) || 600
      const cx = Number(st.mapMetaInfo?.x) || 0
      const cz = Number(st.mapMetaInfo?.z) || 0
      const half = size / 2
      if (x < cx - half || x >= cx + half || z < cz - half || z >= cz + half) return null
      return st.mapPlane.position.y
    }
    if (st.groundMesh) {
      const { cx, cz, ext } = st.WORLD_CENTER
      const half = ext + 50
      if (x < cx - half || x >= cx + half || z < cz - half || z >= cz + half) return null
      return st.groundMesh.position.y
    }
    return null
  }

  function terrainSpanOf() {
    return st.mapMetaInfo?.size_m || st.heightMeta?.span || 600;
  }
  function terrainHFovDeg() {
    const camera = deps.getCamera()
    const scopedHidden = deps.scopedHiddenEid()
    if (!scopedHidden || !camera || !(camera.fov > 0) || !(camera.aspect > 0)) {
      return CLIENT_NORMAL_CAMERA_FOV_H;
    }
    return (2 * Math.atan(Math.tan((camera.fov * Math.PI) / 360) * camera.aspect) * 180) / Math.PI;
  }
  function terrainBuildRequest() {
    const camera = deps.getCamera()
    return {
      cam: camera ? { x: camera.position.x, y: camera.position.y, z: camera.position.z } : { x: 0, y: 320, z: 0 },
      fovY: camera && Number.isFinite(camera.fov) ? (camera.fov * Math.PI) / 180 : 0.8,
      aspect: camera && Number.isFinite(camera.aspect) && camera.aspect > 0 ? camera.aspect : 16 / 9,
      hFovDeg: terrainHFovDeg() as number | null,
      includeNormals: false,
      measure: !!deps.perf(),
    }
  }
  function buildTerrainGeometry(reason = 'first', mode = 'sync') {
    const perf = deps.perf()
    const n = st.heightMeta?.size || 512;
    const span = terrainSpanOf();
    const r = terrainBuildRequest()
    return buildGroundGeometryTyped({
      field: st.heightField, n, span,
      cam: r.cam, fovY: r.fovY, aspect: r.aspect, hFovDeg: r.hFovDeg,
      refineMask: st.terrainRefineMask, includeNormals: r.includeNormals,
      onDiagnostics: perf ? (data: Record<string, unknown>) => perf.event({ stage: 'terrain-build', ...data, mode, reason }) : undefined,
      cx: st.mapMetaInfo?.x || 0, cz: st.mapMetaInfo?.z || 0,
    });
  }
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
      onDiscard: () => deps.invalidate(),
      onWorkerLost: (_job, reason) => {
        terrainWorkerFailed = true
        terrainScheduler = null
        terrainSrcField = null; terrainSrcMask = null
        const perf = deps.perf()
        if (perf) perf.event({ stage: 'terrain-build', mode: 'sync-fallback', reason: 'worker-lost', detail: reason })
        deps.invalidate()
      },
    })
    return terrainScheduler
  }
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
    terrainLodPrev = job.snapshot
    terrainLodAt = performance.now()
    if (perf) perfTerrainRebuilds++
    deps.constrainFreeCameraAltitude()
    deps.reprojectAnnotationHeights()
    deps.onTerrainReground()
    const camera = deps.getCamera()
    const controls = deps.getControls()
    if (camera && controls && terrainLodPoseReason(job.snapshot, terrainLodState(camera, controls.target, camera.aspect))) {
      terrainLodWake.scheduleElapsed(performance.now() - terrainLodAt)
    } else {
      terrainLodWake.cancel()
    }
    if (perf) {
      const swapMs = performance.now() - t0
      perf.event({ stage: 'terrain-geometry', owner: 'mapWorldTerrain', mode: 'worker', reason: job.reason,
        ...adoption, disposed: perfGeometryDisposed, queueMs: info.queueMs, workerMs: info.workerMs, swapMs, at: performance.now() })
      perf.event({ stage: 'terrain-build', ...(data.diagnostics ?? {}), mode: 'worker', reason: job.reason, queueMs: info.queueMs, workerMs: info.workerMs, swapMs })
      perf.event({ stage: 'terrain-rebuild-inclusive', durationMs: swapMs })
    }
  }
  function maybeRebuildTerrainLod(now = performance.now()) {
    const perf = deps.perf()
    const camera = deps.getCamera()
    const controls = deps.getControls()
    if (perf) perfTerrainChecks++;
    if (!st.terrainMesh || !st.heightField || !camera || !controls) return;
    const cur = terrainLodState(camera, controls.target, camera.aspect);
    const reason = terrainLodStaleReason(terrainLodPrev, cur, now - terrainLodAt);
    if (!reason) return;
    const sch = ensureTerrainScheduler()
    if (sch) {
      syncTerrainWorkerSource(sch)
      if (sch.request({ request: terrainBuildRequest(), snapshot: cur, reason })) {
        terrainLodWake.cancel()
        return
      }
    }
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


  function rebuildGround() {
    const scene = deps.getScene()
    if (!scene) return
    if (st.mapPlane) { scene.remove(st.mapPlane); st.mapPlane = null; }
    if (st.terrainMesh) { scene.remove(st.terrainMesh); st.terrainMesh = null; }
    if (!st.mapTexture && !st.heightField) return;
    const meta = st.mapMetaInfo || {};
    const size = meta.size_m || st.heightMeta?.span || 600;
    if (st.heightField) {
      const buildStarted = deps.perf() ? performance.now() : 0;
      const geo = buildTerrainGeometry();
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
      if (deps.debug) debugWindow.__terrain = st.terrainMesh;
    } else if (st.mapTexture) {
      const mat = new THREE.MeshBasicMaterial({ map: st.mapTexture });
      mat.toneMapped = false;
      st.mapPlane = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
      st.mapPlane.rotation.set(-Math.PI / 2, 0, Math.PI + (meta.rot90 || 0) * Math.PI / 2);
      st.mapPlane.position.set(meta.x || 0, 0.04, meta.z || 0);
      scene.add(st.mapPlane);
    }
    deps.regroundBases();
    deps.regroundSpawns();
    deps.onTerrainReground();
    deps.rebuildAnnotationProjection();
  }

  function groundY(x: number, z: number) {
    return sampleHeight(x, z) + 0.12;
  }


  function terrainCounters() {
    return { terrainChecks: perfTerrainChecks, terrainRebuilds: perfTerrainRebuilds,
      terrainGeneration: perfGeometrySummary.generation, terrainGeometriesCreated: perfGeometryCreated,
      terrainGeometriesDisposed: perfGeometryDisposed, terrainVertices: perfGeometrySummary.vertices,
      terrainIndices: perfGeometrySummary.indices, terrainAttributeBytes: perfGeometrySummary.attributeBytes,
      terrainIndexBytes: perfGeometrySummary.indexBytes }
  }
  function resetTerrainCounters() {
    perfTerrainChecks = 0; perfTerrainRebuilds = 0; perfGeometryCreated = 0; perfGeometryDisposed = 0
  }
  function invalidateTerrainLod() { terrainLodPrev = null }
  function resetTerrainLifecycle() { terrainLodWake.cancel(); terrainScheduler?.invalidate() }
  function disposeTerrain() { terrainLodWake.cancel(); terrainScheduler?.dispose(); terrainScheduler = null }
  return { sampleHeight, sampleRenderedTerrainHeight, annotationSurfaceHeightAt, terrainSpanOf, maybeRebuildTerrainLod, rebuildGround, groundY, terrainCounters, resetTerrainCounters, invalidateTerrainLod, resetTerrainLifecycle, disposeTerrain }
}
