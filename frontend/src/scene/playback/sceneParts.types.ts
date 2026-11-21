// playbackScene 闭包状态 / 入参的类型定义（拆分后的 5 个 part 共享）。
// 成员类型尽量从 owner 模块的返回值推导，避免第二份手写形状。
import type * as THREE from 'three'
import type { Store } from '../playbackStore.js'
import type { createMapWorld } from './mapWorld.ts'
import type { createWaterReflectionRuntime } from './waterReflectionRuntime.ts'
import type { createVehicleRuntime } from './vehicleRuntime.ts'
import type { createTreadRuntime } from './treadRuntime.ts'
import type { createBattleRuntime } from './battleRuntime.ts'
import type { createAnnotationScene } from './annotationScene.ts'
import type { createLabelsRuntime } from './labelsRuntime.ts'
import type { createBaseMarkers } from './bases.ts'
import type { createSpawnMarkers } from './spawns.ts'
import type { LocalPlayback } from '../../replay-local/playback/parseLocalPlayback.js'
import type { createBattleMarkerHost } from './battleMarkerHost.ts'
import type { createCameraTerrainClamp } from './cameraTerrainClamp.ts'
import type { createCameraRuntime } from './cameraRuntime.ts'
import type { createFrameMeter } from '../frameMeter.js'
import type { createPerfProbe } from './perfProbe.ts'
import type { createDynRes } from '../dynRes.js'
import type { createSessionLifecycle } from './sessionLifecycle.ts'
import type { createContactShadowControl } from './contactShadowControl.ts'
import type { createPickReporter } from './pickReport.js'
import type { createSceneCore } from './renderer.ts'
import type { loadPlaybackData } from '../replaySource.js'
import type { QUALITY_PRESETS } from './quality.js'
import type { QualityPreset } from './renderer.ts'
import type { VehiclePlaybackTrack } from '../../types/playback-v2.js'

export type PlaybackData = NonNullable<Awaited<ReturnType<typeof loadPlaybackData>>>
export type QualityKey = keyof typeof QUALITY_PRESETS
export type SceneCore = ReturnType<typeof createSceneCore>

export interface SceneParams {
  container: HTMLElement
  store: Store
  labelOverlay: HTMLElement | null
  onVehicleSelect?: (eid: number | null, event?: MouseEvent | null) => void
  onAnnotationCommit?: (...args: never[]) => void
  onAnnotationErase?: (...args: never[]) => void
  recorderReticle: HTMLElement | null
}

/** 闭包共享状态（入口函数持有；只要 part 间可互访就必须在这里声明）。 */
export type RuntimeVehicle = ReturnType<NonNullable<SceneParts['vehicles']>['getVehicles']>[number]

export interface SceneParts {
  // ---- 会话数据 / 时钟 ----
  DATA: PlaybackData | null
  VIS_BY_EID: Map<number, number[]>
  POSE_GRID: { tStart: number; samples: number }
  T: number
  PLAYING: boolean
  SPEED: number
  START: number
  END: number
  sceneClock: { startRaw: number; durationSec: number } | null
  canonicalClock: { startRaw: number; durationSec: number } | null
  lifeTracks: readonly VehiclePlaybackTrack[] | null
  lifeTracksByAccount: Map<number, VehiclePlaybackTrack>

  // ---- 渲染器 / 场景 ----
  renderer: THREE.WebGLRenderer | null
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  controls: SceneCore['controls'] | null
  clock: THREE.Clock
  raycaster: THREE.Raycaster
  hemiLight: THREE.HemisphereLight | null
  sunLight: THREE.DirectionalLight | null
  sizeObserver: ResizeObserver | null
  destroyed: boolean
  MAP_BASES_KIND: 'supremacy' | 'assault' | null
  MAP_SPAWN_POINTS: unknown[] | null
  rafId: number
  paused: boolean

  // ---- 配置 / 质量 ----
  DEBUG: boolean
  PICK_DEBUG: boolean
  LOGDEPTH: boolean
  DYNRES: boolean
  ARMOR_HIGHLIGHT: boolean
  QKEY: QualityKey
  Q: QualityPreset
  contactShadowCtl: ReturnType<typeof createContactShadowControl>
  applyQualityFeatures: () => void
  requestWaterReflectionRefresh: () => void
  dynResCtl: ReturnType<typeof createDynRes> | null
  rendererCaps: SceneCore['rendererCaps']
  gpu: ReturnType<typeof createPerfProbe>['gpu']
  PERF: boolean
  perf: ReturnType<typeof createPerfProbe>['perf'] | null
  perfProbe: ReturnType<typeof createPerfProbe>
  prewarmShaders: () => void

  // ---- 运行时句柄 ----
  mapWorld: ReturnType<typeof createMapWorld>
  waterReflection: ReturnType<typeof createWaterReflectionRuntime>
  vehicles: ReturnType<typeof createVehicleRuntime>
  tread: ReturnType<typeof createTreadRuntime>
  battle: ReturnType<typeof createBattleRuntime>
  annotationScene: ReturnType<typeof createAnnotationScene>
  labels: ReturnType<typeof createLabelsRuntime>
  bases: ReturnType<typeof createBaseMarkers>
  spawnMarkers: ReturnType<typeof createSpawnMarkers>
  battleMarkers: ReturnType<typeof createBattleMarkerHost>
  cameraTerrainClamp: ReturnType<typeof createCameraTerrainClamp>
  cameraRuntime: ReturnType<typeof createCameraRuntime>
  session: ReturnType<typeof createSessionLifecycle>
  pickReporter: ReturnType<typeof createPickReporter>
  pickDownAt: { x: number; y: number } | null
  frameMeter: ReturnType<typeof createFrameMeter>
  lastRenderAt: number
  fpsIdle: boolean
  winnerShown: boolean
  frameDirty: boolean
  followAnchor: THREE.Vector3 | null
  hudWrittenMs: number
  HUD_INTERVAL_MS: number

  // ---- 会话内帮助函数 ----
  idxOf: (t: number) => number
  hpAt: (v: RuntimeVehicle, t: number) => number
  canonicalLifeTrack: (v: RuntimeVehicle, canonical: LocalPlayback) => VehiclePlaybackTrack | undefined
  canonicalDeathAppliesTo: (v: RuntimeVehicle, rawDeath: number, canonical: LocalPlayback) => boolean
  sceneLifeAt: (v: RuntimeVehicle, t: number) => { lifeState?: string; destroyedKnownAtSec?: number | null } | null
  deathAt: (v: RuntimeVehicle, t: number) => boolean
  replacedAt: (eid: number, t: number) => boolean
  visibleAt: (v: RuntimeVehicle, t: number) => boolean
  initScene: () => boolean
  onResize: () => void
  reportPick: (event: unknown) => void
  buildBases: () => void
  clearBases: () => void
  regroundBases: () => void
  updateBases: () => void
  buildSpawns: () => void
  clearSpawns: () => void
  regroundSpawns: () => void
  refreshSpawnColors: () => void
  applyCameraClamp: () => void
  terrainHeightForCameraClamp: (x: number, z: number) => number
  clampOrbitCameraToTerrain: () => void
  clampCameraTarget: () => void
  deathTimesOf: (v: RuntimeVehicle) => number[]
  invalidate: () => void
  animate: () => void
  tick: () => void
  writeHud: (force?: boolean) => void
  setPlaying: (playing: boolean) => void
  setPaused: (next: boolean) => void
  battleRange: () => { start: number; end: number }
  setBattleClock: (clock: unknown) => void
  seekTo: (t: number) => void
  setSpeed: (s: number) => void
  teardownSession: () => void
  rebuildRenderer: () => void
  ensureRenderer: () => void
  prepareSessionCamera: () => void
  publishSessionData: (data: unknown, playbackSession: unknown) => void
  publishMapOnlyData: (mapId: string, mapName: string) => void
  prepareResolvers: () => void
  resetSessionCursors: () => void
  setQuality: (k: string) => void
  applyGlbGate: () => void
}

// ---- 运行时 deps 的精确类型（cast 边界；owner = 各 runtime 模块） ----
type VehDeps = Parameters<typeof createVehicleRuntime>[0]
type BattleDeps = Parameters<typeof createBattleRuntime>[0]
type LabelsDeps = Parameters<typeof createLabelsRuntime>[0]
type BasesDeps = Parameters<typeof createBaseMarkers>[0]
type CamDeps = Parameters<typeof createCameraRuntime>[0]
type AnnDeps = Parameters<typeof createAnnotationScene>[0]

export type VehicleRuntimeDataT = NonNullable<ReturnType<VehDeps['getData']>>
export type BattleRuntimeDataT = NonNullable<ReturnType<BattleDeps['getData']>>
export type LabelsRuntimeDataT = NonNullable<ReturnType<LabelsDeps['getData']>>
export type BasesDataT = ReturnType<BasesDeps['getData']>
export type CameraRuntimeDataT = NonNullable<ReturnType<CamDeps['getData']>>
export type AnnotationControlsT = NonNullable<ReturnType<AnnDeps['getControls']>>
export type LabelsStoreT = LabelsDeps['store']
export type LabelsOverlayT = NonNullable<ReturnType<LabelsDeps['getLabelOverlay']>>
export type TransientOverlayT = NonNullable<BattleDeps['getLabelOverlay']>
export type RecorderReticleT = CamDeps['recorderReticle']
type ClampDeps = Parameters<typeof createCameraTerrainClamp>[0]
export type HeightMetaT = ReturnType<ClampDeps['getHeightMeta']>
export type MapSpawnPointT = Parameters<ReturnType<typeof createSpawnMarkers>['build']>[0]
