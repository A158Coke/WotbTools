import type * as THREE from 'three'
import type { PerspectiveCamera, Raycaster, Scene, WebGLRenderer } from 'three'
import type { CameraVec3 } from './cameraRig.js'
import type { loadRecorderCameraFromFile } from '../replaySource.js'
import type { AgentAuthorShellEvent } from '../../api/agent-replay-facets.js'
import type { createArmorHighlight, ArmorHighlightPerfStats } from './armorHighlight.js'
import type { RuntimeVehicle, VehicleRuntimeHandle } from './vehicleRuntime.js'
import type { AnnotationSceneHandle } from './annotationScene.js'
import type { createGpuFrameTracker } from './gpuTimer.js'

type GpuFrameTracker = ReturnType<typeof createGpuFrameTracker>
export type ArmorHighlightInstance = ReturnType<typeof createArmorHighlight>

export interface CameraRuntimeStore {
  cam?: string
  recorderCameraStatus?: string
  recorderViewAvailable?: boolean
  recorderModeUnknown?: boolean
  flySpeed?: number
  flySpeedIndex?: number
  [key: string]: unknown
}

export interface CameraRuntimeControls {
  target: THREE.Vector3
  enabled: boolean
  enableDamping: boolean
  enablePan: boolean
  enableZoom: boolean
  zoomSpeed: number
  minDistance: number
  maxDistance: number
  minPolarAngle: number
  maxPolarAngle: number
  update(): boolean
  dispose(): void
  touches?: { ONE?: unknown; TWO?: number | null }
  __flyDist?: number
  _controlActive?: boolean
}

export interface CameraRuntimeData {
  meta: { author_eid?: number; friendly_team?: number; [key: string]: unknown }
  author_shell_timeline?: readonly AgentAuthorShellEvent[] | null
  [key: string]: unknown
}

export interface RecorderReticleLike {
  hide(): void
  update(aim: CameraVec3 | null, gun: CameraVec3 | null, radiusPx: number): void
}

export interface CameraRuntimeDeps {
  store: CameraRuntimeStore
  container: HTMLElement
  getViewportSize(): { x: number; y: number }
  debug: boolean
  getCamera(): PerspectiveCamera
  getRenderer(): WebGLRenderer | null
  getControls(): CameraRuntimeControls
  getRaycaster(): Raycaster
  getScene(): Scene
  invalidate(): void
  requestWaterReflectionRefresh(): void
  getT(): number
  getData(): CameraRuntimeData | null
  sessionEpoch(): number
  destroyed(): boolean
  writeHud(force?: boolean): void
  updateRoster(): void
  vehicles: VehicleRuntimeHandle
  mapWorld: {
    heightField(): Float32Array | null
    heightMeta(): Record<string, unknown> | null
    terrainMesh(): THREE.Mesh | null
    sampleRenderedTerrainHeight(x: number, z: number): number
    sampleHeight(x: number, z: number): number
    mapScenery(): THREE.Object3D | null
    mapPlane(): THREE.Object3D | null
    groundMesh(): THREE.Mesh | null
    worldCenter(): { cx: number; cz: number; ext: number }
  }
  annotationScene: AnnotationSceneHandle
  deathAt(v: RuntimeVehicle, t: number): boolean
  deathTimesOf(v: RuntimeVehicle): number[]
  gpu(): GpuFrameTracker | null
  perfEnabled(): boolean
  armorHighlightPref(): boolean
  recorderReticle: RecorderReticleLike | null
  clampCameraTarget(): void
  clampOrbitCameraToTerrain(): void
  baseMinDistance(): number
  terrainHeightForCameraClamp(x: number, z: number): number | null | undefined
  syncContactShadow(v: RuntimeVehicle): void
  onVehicleSelect: ((eid: number | null, event: PointerEvent) => void) | null
  pickDebug(): boolean
  getPickDownAt(): { x: number; y: number } | null
  setPickDownAt(p: { x: number; y: number } | null): void
  reportPick(e: PointerEvent): void
}

export interface CameraRuntimeHandle {
  cam(): string
  followEid(): number
  topViewOnLoad(): boolean
  flyMode(): boolean
  flyYaw(): number
  scopedHiddenEid(): number
  cameraBlend(): { position: THREE.Vector3; quaternion: THREE.Quaternion; fov: number; elapsed: number } | null
  fovRestore(): { fov: number; elapsed: number } | null
  setCam(mode: string): void
  setFollow(eid: number): void
  resetFollow(): void
  followMinDistance(): number
  refreshFollowMinDistance(eid: number): void
  setFlySpeed(n: number): void
  flyTick(dt: number, pressed: Set<string>): boolean
  flyLookApplyMode(mode: string): void
  flyLookSyncFromCamera(tag?: string | null, preserveVertical?: boolean): void
  flyLookSyncIfStale(tag: string): void
  flyLookApply(): void
  flyDbg(tag: string, extra?: string): void
  zoomTick(dt: number): void
  constrainFreeCameraAltitude(): boolean
  cameraDriven(): boolean
  recorderViewAvailable(): boolean
  recorderModeUnknown(): boolean
  loadRecorderCamera(source: { file?: Parameters<typeof loadRecorderCameraFromFile>[0]; signal?: AbortSignal } | null, epoch: number): void
  prepareSessionCamera(): void
  driveRecorderCamera(dt: number): void
  stepFovRestore(dt: number): void
  renderArmorHighlight(): void
  ensureArmorHighlight(): ArmorHighlightInstance
  armorStats(): ArmorHighlightPerfStats
  releaseArmorHighlightRenderTargets(): void
  prewarmArmorHighlight(camera: PerspectiveCamera): void
  onScenePointerDown(e: PointerEvent): void
  onScenePointerUp(e: PointerEvent): void
  attachListeners(): void
  detachListeners(): void
  resetSessionState(): void
  discardTouchGesture(): void
  setMobileTouch(on: boolean): void
  applyMobileTouchControls(): void
  cameraDistanceState(): { available: boolean; mode?: 'free' | 'fixed'; v?: number }
  setCameraDistance(v: number): void
}

