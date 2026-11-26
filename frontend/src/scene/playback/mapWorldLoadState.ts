import * as THREE from 'three'
import type { Texture, ShaderMaterial, Scene, PerspectiveCamera, WebGLRenderer, DirectionalLight, HemisphereLight } from 'three'
import type { GroundLayersField } from '../sceneryAssembly.js'
import type { DestructibleFoldState } from '../destructibles.js'
import type { buildDecalMeshes } from './deferredDecals.js'
import type { createPerf } from './perf.ts'
type PerfHandle = ReturnType<typeof createPerf>

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

export function errorMessage(e: unknown): unknown {
  const err = e as { message?: unknown }
  return err && err.message ? err.message : e
}

export interface HeightMetaSurface {
  size?: number
  span?: number
  zmax?: number
  terrainLayout?: unknown
  playableBounds?: { xMin: number; xMax: number; yMin: number; yMax: number } | null
}

export interface MapMetaSurface {
  size_m?: number
  x?: number
  z?: number
  rot90?: number
  flip_x?: boolean
}

export interface DestructRuntime {
  states: DestructibleFoldState[]
  ptr: number
  lastT: number
  animating?: boolean
}

export interface DestructState extends DestructibleFoldState {
  applied?: boolean
  pivotPos: { x: number; y: number; z: number }
  fallQuat: { w: number }
}

export interface WorldPlaybackData {
  meta: { map_id: number; map_name?: string | null; t_start?: number }
  vehicles: Array<{ pos: number[] }>
}

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
  sessionEpoch(): number
  destroyed(): boolean
  getData(): WorldPlaybackData | null
  quality(): { groundLayers?: boolean; scenery?: boolean; anisotropy: number }
  grassInstanceBudget(): number
  getScene(): Scene | null
  getCamera(): PerspectiveCamera | null
  getRenderer(): WebGLRenderer | null
  getControls(): { target: { x: number; y: number; z: number } } | null
  invalidate(): void
  disposeObject3D(root: unknown): void
  constrainFreeCameraAltitude(): void
  regroundBases(): void
  regroundSpawns(): void
  rebuildAnnotationProjection(): void
  lightingTargets(): { renderer: WebGLRenderer | null; scene: Scene | null; sunLight: DirectionalLight | null; hemiLight: HemisphereLight | null; debug: boolean }
  buildWorldCameraPlacement(center: { cx: number; cz: number; ext: number }): void
  scopedHiddenEid(): number
  reprojectAnnotationHeights(): void
  onTerrainReground(): void
  onLightingApplied(): void
}

