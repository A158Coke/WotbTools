import type * as THREE from 'three'
import type { PerspectiveCamera, Raycaster, Scene, WebGLRenderer } from 'three'
import type { CameraVec3 } from './cameraRig.js'
import type { loadRecorderCameraFromFile } from '../replaySource.js'
import type { AgentAuthorShellEvent } from '../../api/agent-replay-facets.js'
import type { createArmorHighlight, ArmorHighlightPerfStats } from './armorHighlight.js'
import type { RuntimeVehicle, VehicleRuntimeHandle } from './vehicleRuntime.js'
import type { AnnotationSceneHandle } from './annotationScene.js'
import type { createGpuFrameTracker } from './gpuTimer.js'

/** ?perf 的 GPU 帧探针（宿主 ?perf 域创建；穿深着色 pass 透传计时）。 */
type GpuFrameTracker = ReturnType<typeof createGpuFrameTracker>
/** 穿深着色器（playback/armorHighlight.js 工厂产物；结构面按调用点口径）。 */
export type ArmorHighlightInstance = ReturnType<typeof createArmorHighlight>

/** 相机域写/读的 store 字段面（store 唯一 owner 在宿主）。 */
export interface CameraRuntimeStore {
  cam?: string
  recorderCameraStatus?: string
  recorderViewAvailable?: boolean
  recorderModeUnknown?: boolean
  flySpeed?: number
  flySpeedIndex?: number
  [key: string]: unknown
}

/** 本模块消费的 OrbitControls 结构面（相机域入口都在 initScene 之后）。 */
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
  /** 触屏手势映射（OrbitControls.touches；MOBILE_TOUCH 契约双指置 null）。 */
  touches?: { ONE?: unknown; TWO?: number | null }
  __flyDist?: number
  _controlActive?: boolean
}

/** 相机域读的数据面（录像者相机/穿深着色消费；其余字段走索引签名）。 */
export interface CameraRuntimeData {
  meta: { author_eid?: number; friendly_team?: number; [key: string]: unknown }
  author_shell_timeline?: readonly AgentAuthorShellEvent[] | null
  [key: string]: unknown
}

/** 录像者准星组件结构面（owner = Replay3DPane；scene 只调 hide/update）。 */
export interface RecorderReticleLike {
  hide(): void
  update(aim: CameraVec3 | null, gun: CameraVec3 | null, radiusPx: number): void
}

/** 宿主注入的依赖（getter 快照；语义见各字段处原文注释）。 */
export interface CameraRuntimeDeps {
  store: CameraRuntimeStore
  container: HTMLElement
  /** ?debug 诊断（[fly] 埋点走 console.info）。 */
  debug: boolean
  /** 相机（宿主渲染器核心 owner；相机域入口都在 initScene 之后，非空）。 */
  getCamera(): PerspectiveCamera
  /** 渲染器（zoomTick 的渲染器惰性守卫 / 穿深着色装配 / 滚轮预算的按需渲染）。 */
  getRenderer(): WebGLRenderer | null
  /** OrbitControls（宿主渲染器核心 owner；fly 接管在其上做 enabled/damping 迁移）。 */
  getControls(): CameraRuntimeControls
  /** 共享 raycaster（选中语义 / 单指平移取面）。 */
  getRaycaster(): Raycaster
  /** 场景根（穿深着色叠加 pass 的 render 目标）。 */
  getScene(): Scene
  invalidate(): void
  getT(): number
  getData(): CameraRuntimeData | null
  /** 会话代数（录像者相机迟到 settle 的归属判定）。 */
  sessionEpoch(): number
  destroyed(): boolean
  /** HUD 降频写入（setCam / 录像者相机 settle / 跟随变更后的名册对齐）。 */
  writeHud(force?: boolean): void
  /** 名册重投影（setFollow 的 followed 高亮；owner = labelsRuntime）。 */
  updateRoster(): void
  /** 车辆运行时（owner = vehicleRuntime.ts；位姿/炮管世界矩阵/车辆清单）。 */
  vehicles: VehicleRuntimeHandle
  /** 世界事实（owner = mapWorld.ts；高度场/地形网格/世界中心）。 */
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
  /** annotation 场景层（fly/选中路径的让位判定与地表拾取）。 */
  annotationScene: AnnotationSceneHandle
  /** canonical 生命事实（owner = 宿主；录像者相机归属 / 穿深着色选目标）。 */
  deathAt(v: RuntimeVehicle, t: number): boolean
  deathTimesOf(v: RuntimeVehicle): number[]
  /** ?perf 的 GPU 探针（穿深着色 pass 透传；宿主 ?perf 域创建）。 */
  gpu(): GpuFrameTracker | null
  /** ?perf 开关（穿深着色 stats 门控，原 PERF）。 */
  perfEnabled(): boolean
  /** 穿深着色偏好（原 ARMOR_HIGHLIGHT；owner = 宿主 setArmorHighlight）。 */
  armorHighlightPref(): boolean
  /** 录像者准星组件（owner = Replay3DPane；null = 无覆盖层）。 */
  recorderReticle: RecorderReticleLike | null
  /** 相机地形净空 / target 钳制（owner = cameraTerrainClamp，宿主接线）。 */
  clampCameraTarget(): void
  clampOrbitCameraToTerrain(): void
  baseMinDistance(): number
  terrainHeightForCameraClamp(x: number, z: number): number | null | undefined
  /** 接地阴影显隐同步（owner = vehicleRuntime.syncContactShadow；#907 主干随迁）。 */
  syncContactShadow(v: RuntimeVehicle): void
  /** 空处/车辆单击选中回调（owner = 宿主 pane 接线）。 */
  onVehicleSelect: ((eid: number | null, event: PointerEvent) => void) | null
  /** 点击拾取调试（PICK_DEBUG 域仍归宿主；按下/抬起判定经注入回调消费）。 */
  pickDebug(): boolean
  getPickDownAt(): { x: number; y: number } | null
  setPickDownAt(p: { x: number; y: number } | null): void
  reportPick(e: PointerEvent): void
}

/** 相机运行时对外句柄（宿主的唯一消费面；公开 API setCam/setFollow 经宿主 re-export）。 */
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
  /** 当前跟随最近距离（场景装配把它注入地形钳制）。 */
  followMinDistance(): number
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
  /** 穿深着色开启路径共用：预编译 + 敌车模板预取（enterRecorderView / setArmorHighlight）。 */
  prewarmArmorHighlight(camera: PerspectiveCamera): void
  onScenePointerDown(e: PointerEvent): void
  onScenePointerUp(e: PointerEvent): void
  attachListeners(): void
  detachListeners(): void
  /** 会话 teardown 的相机段（原 teardownSession 的 recorder/armorHighlight 复位块）。 */
  resetSessionState(): void
  /** 契约切换瞬间作废在途双指手势（宿主 setMobileTouch 调用）。 */
  discardTouchGesture(): void
  /** 触屏相机契约开关（语义见 applyMobileTouchControls；宿主 setMobileTouch 委托）。 */
  setMobileTouch(on: boolean): void
  /** renderer/controls 重建（initScene）后重新应用触屏 touches 分流。 */
  applyMobileTouchControls(): void
  /** 移动端竖向距离滑条（#912 主干随迁）：读当前相机真实距离（v: 1=近 0=远）；follow/recorder 返回 unavailable。 */
  cameraDistanceState(): { available: boolean; mode?: 'free' | 'fixed'; v?: number }
  setCameraDistance(v: number): void
}

