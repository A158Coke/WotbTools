// 相机运行时 owner（#820 结构拆分，2026-11-06 自 initPlayback 闭包出仓）：
// 自由飞行的 FPS 视角接管（flyLook / 滚轮与双指缩放平滑 / container capture 拦截）、
// top/follow 相机模式切换（setCam / setFollow / 俯视机位 / topViewOnLoad）、
// 录像者视角域（recorderCamera / driveRecorderCamera / 开镜隐藏层 / FOV 过渡 / 准星）、
// Sniper 穿深着色（armorHighlight 装配 / 选目标 / 叠加渲染 pass）与
// 场景指针选中语义（onScenePointerDown/Up + SCENE_CLICK_SLOP_PX）的唯一归属。
// 代码与搬移前逐字一致；闭包读数改经 deps 注入（getter 快照）：相机/控件/渲染器/
// 共享 raycaster 来自宿主渲染器核心，世界事实经 mapWorld 句柄消费，车辆事实经
// vehicles 句柄消费，annotation 让位判定经 annotationScene 句柄消费。
// 相机地形净空 / target 钳制（clampOrbitCameraToTerrain / clampCameraTarget /
// terrainHeightForCameraClamp）owner = playback/cameraTerrainClamp.js，仍归宿主，
// 本模块经 deps 回调消费。事件监听注册/摘除收口为 attachListeners()/detachListeners()
// （initScene 的 fly capture 段与 destroy 的摘除段逐字对应）。
import * as THREE from 'three'
import type { PerspectiveCamera, Raycaster, Scene, WebGLRenderer } from 'three'
import {
  ANCHOR_HEIGHT_M,
  ARCADE_BOOM_M,
  BASE_FOV_DEG,
  CAMERA_MODE,
  recorderModeAt,
  FOLIAGE_CLIP_ARCADE_M,
  FOLIAGE_CLIP_SCOPED_M,
  REVERSE_SAMPLE_OFFSET_SEC,
  aimDirectionScene,
  arcadeCameraPosition,
  backwardZoomScale,
  blendProgress,
  fovFromZoomRaw,
  isReversing,
  reticleRadiusPx,
  sampleRecorderCamera,
} from './cameraRig.ts'
import type { CameraVec3, RecorderCameraFacet, RecorderCameraSample } from './cameraRig.ts'
import { loadRecorderCameraFromFile } from '../replaySource.js'
import type { AgentAuthorShellEvent } from '../../api/agent-replay-facets.js'
import type { MountedConfigEvidence, TankJsonLike } from '../reloadBar.js'
import {
  isFlySpeedIndex, FLY_SPEEDS, DEFAULT_FLY_SPEED_INDEX, TOUCH_PAN_MIN_HEIGHT,
  advanceFly as tickFlyImpl, classifyTwoFinger, groundPanOffset,
} from '../../composables/useSceneFlyControls.js'
import { foliageClip } from '../sceneryMaterials.js'
import { assetProvider } from '../assetProvider.js'
import {
  aimedVehicle, armorEquipmentCoeffs, armorHighlightBlock, authorShellAt, createArmorHighlight, mountedShell, reticleAimDirection,
} from './armorHighlight.js'
import type { AimedVehicleCandidate, ArmorHighlightPerfStats, HighlightConfig } from './armorHighlight.js'
import { resolveExactMountedConfig } from '../reloadBar.js'
import { createZoomSmoother, createFlyZoomSmoother, flyWheelFactor, orbitWheelFactor } from './zoomSmoothing.js'
import type { RuntimeVehicle, VehicleRuntimeHandle } from './vehicleRuntime.ts'
import type { AnnotationSceneHandle } from './annotationScene.ts'
import type { createGpuFrameTracker } from './gpuTimer.ts'

/** ?perf 的 GPU 帧探针（宿主 ?perf 域创建；穿深着色 pass 透传计时）。 */
type GpuFrameTracker = ReturnType<typeof createGpuFrameTracker>
/** 穿深着色器（playback/armorHighlight.js 工厂产物；结构面按调用点口径）。 */
type ArmorHighlightInstance = ReturnType<typeof createArmorHighlight>

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
  /** 空处/车辆单击选中回调（owner = 宿主 pane 接线）。 */
  onVehicleSelect: ((eid: number | null, event: PointerEvent) => void) | null
  /** 点击拾取调试（PICK_DEBUG 域仍归宿主；按下/抬起判定经注入回调消费）。 */
  pickDebug(): boolean
  getPickDownAt(): { x: number; y: number } | null
  setPickDownAt(p: { x: number; y: number } | null): void
  reportPick(e: PointerEvent): void
}

/** 开镜时相机不启用的 layer：本车留在场景里但不绘制。 */
export const SCOPED_HIDDEN_LAYER = 1
/** 初值：小于地形起伏尺度，真实地图视觉校准由人工验收（free 钳制与录像者贴地共用）。 */
export const CAMERA_GROUND_CLEARANCE = 0.5

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
}

export function createCameraRuntime(deps: CameraRuntimeDeps): CameraRuntimeHandle {
  const { container, store } = deps
  let CAM = 'free', FOLLOW_EID = 0;
  // 新会话默认以俯视机位开局；用户一旦操作过相机，同一实例内不再覆盖其视角。
  let topViewOnLoad = true;
  // 录像者视角：facet 随会话，相机由 driveRecorderCamera 逐帧写入。
  let recorderCamera: RecorderCameraFacet | null = null;
  const recorderSample: RecorderCameraSample = {} as RecorderCameraSample;
  let recorderBoomScale = 1;
  // 开镜时相机在炮位，本车只从渲染里摘掉：group.visible 仍表示「车辆在场」，
  // 炮口定位与击毁特效都依赖它。
  let scopedHiddenEid = 0;
  let cameraBlend: { position: THREE.Vector3; quaternion: THREE.Quaternion; fov: number; elapsed: number } | null = null;              // 进入录像者视角的呈现过渡
  let fovRestore: { fov: number; elapsed: number } | null = null;               // 离开录像者视角时 FOV 的呈现过渡

  // ---------- 自由飞行的 FPS 视角接管（用户裁定：旋转中心 = 镜头自身） ----------
  // **接管态 = CAM === 'free'（派生，非独立状态）**——独立布尔会被任何路径漏设/
  // 误清（表现 = FPS 转头与 OrbitControls 环绕/pan 漂移交替，用户实测两轮）。
  // 自由模式下：
  //   · 左键拖拽 = 转视角（yaw/pitch 直接作用在相机朝向上）；
  //   · 滚轮 = 沿视线推拉相机（OrbitControls 的 dolly 语义——推近/拉远，视角与视距不变）；
  //   · WASD/QE = 平移相机（flyTick → advanceFly，target 重钉 cam+dir×flyDist）。
  // 触屏对应键鼠：单指 = WASD（贴地平移）；两指一起拖 = 左键拖拽；指距变化 = 滚轮。
  // 事件在 **container capture 阶段**拦截：祖先 capture 先于 canvas 的 target 阶段，
  // OrbitControls（挂 canvas）物理上收不到左键拖拽/滚轮。选中/拾取语义不变
  // （位移 ≤ SLOP 仍算单击，在 capture 处理器内联）。切回跟随/top 或销毁时恢复 controls。
  const flyLook = { active: false, lastX: 0, lastY: 0, yaw: 0, pitch: 0, dist: 30 };
  // 滚轮缩放平滑（#835）：两条滚轮路径（fly 拦截 / top·follow 的 OrbitControls 拦截）
  // 都只把事件比例 push 进预算，zoomTick 每帧向目标收敛——事件当帧立即生效一小步，
  // 约 0.4s 收敛到终点（公式/界限与原即时实现逐值一致，只改节奏不改步长）。
  const zoomSmoother = createZoomSmoother();
  // fly 路径用独立的**可加世界位移**预算（旧 flyDolly 语义）：比例预算对视距不变的
  // fly 不等价（各帧比例份额相加 ≠ 事件时刻的一次性位移，且随帧率漂移）——见
  // zoomSmoothing.createFlyZoomSmoother 注释。orbit 路径（top/follow）仍用比例预算。
  const flyZoomSmoother = createFlyZoomSmoother();
  // 接管态 = 自由模式（派生）。**不按输入设备开关**：`(pointer: fine)` 之类的能力
  // 探测在触屏笔记本 / 平板模式下会报 coarse，把整条接管链关掉（用户实测：WASD 全灭、
  // 拖拽退回 OrbitControls）。
  const flyMode = () => CAM === 'free';
  // 触屏多点手势状态：pointerId → 最新坐标
  const flyPointers = new Map<number, { x: number; y: number }>();
  // 单指：armed 前是单击候选，armed 后是贴地平移（x0/y0/z0 手势起点相机 / height 平移平面 / offset0 抓取偏移）
  let flyPan: { armed: boolean; startX: number; startY: number; x0?: number; y0?: number; z0?: number; height?: number; offset0?: { x: number; z: number } } | null = null;
  // 双指：mode = pending（判定中）| pinch（d0 指距 / dist0 视距）| look（cx/cy 两指中点）
  let flyTwoFinger: Record<string, unknown> | null = null;
  const FLY_LOOK_RAD_PER_PX = 0.0032;   // rad/px（与常见 FPS 灵敏度同量级）
  // [fly] 埋点：?debug 下走 console.info（默认级别可见，排障不用勾 Verbose）；
  // 非 debug 走 console.debug（默认隐藏）。每次交互只输出个位数行。
  const flyDbg = (tag: string, extra?: string) => {
    const line = `[fly] ${tag} ${extra !== undefined ? extra : ''} cam=${CAM} enabled=${deps.getControls() ? deps.getControls().enabled : '?'} yaw=${flyLook.yaw.toFixed(2)} pitch=${flyLook.pitch.toFixed(2)} dist=${flyLook.dist.toFixed(0)}`;
    if (deps.debug) console.info(line); else console.debug(line);
  };
  let flyMoveLastLog = 0;

  /** 从当前相机→target 向量反解 yaw/pitch（进入自由模式的朝向基准）。
   *  顶视（top→free）反解出 pitch≈±π/2 会让 WASD 的水平投影 fwdLen≈0（无法移动）——
   *  |pitch| 接近天顶/天底时回落到斜俯视（保留 yaw）：从正俯视过渡到斜俯视是自然的
   *  模式切换，换来飞行立即可用。 */
  function flyLookSyncFromCamera(tag: string | null = null, preserveVertical = false) {
    const camera = deps.getCamera();
    const controls = deps.getControls();
    const dx = controls.target.x - camera.position.x;
    const dy = controls.target.y - camera.position.y;
    const dz = controls.target.z - camera.position.z;
    const dist = Math.hypot(dx, dy, dz) || 1;
    flyLook.dist = dist;
    flyLook.yaw = Math.atan2(-dx, -dz);              // yaw：绕 y（0 = 看 -z）
    const rawPitch = Math.asin(Math.max(-1, Math.min(1, dy / dist)));
    // 天顶/天底附近回落到斜俯视：**保持原朝向的上下符号**（俯视=向下看，pitch 仍为负）。
    // 旧实现 `-0.6*sign(rawPitch)` 把俯视翻成仰视（target 跑到地图上空、WASD 水平分量为 0）。
    flyLook.pitch = !preserveVertical && Math.abs(rawPitch) > Math.PI / 2 - 0.25
      ? 0.6 * Math.sign(rawPitch || 1)
      : rawPitch;
    if (tag) flyDbg(`sync(${tag})`);   // 逐帧对齐（tick）不埋点，防按住键时刷屏
  }
  /** 相机被**外部路径**改过（初始视野 fit / 名册跟随退出 / 钳制）后，flyLook 会与
   *  实际 cam→target 不一致——交互起点先对齐，否则首帧拖拽/飞行会把 target 跳到
   *  旧朝向×旧视距上（用户实测：进入自由后第一次拖拽视距从 570 变 284）。 */
  function flyLookSyncIfStale(tag: string) {
    const camera = deps.getCamera();
    const controls = deps.getControls();
    if (flyLook.active) return;
    const cp = Math.cos(flyLook.pitch);
    const ex = camera.position.x - Math.sin(flyLook.yaw) * cp * flyLook.dist;
    const ey = camera.position.y + Math.sin(flyLook.pitch) * flyLook.dist;
    const ez = camera.position.z - Math.cos(flyLook.yaw) * cp * flyLook.dist;
    const d = Math.hypot(ex - controls.target.x, ey - controls.target.y, ez - controls.target.z);
    if (d > 0.05) flyLookSyncFromCamera(tag);
  }
  /** free↔其他模式切换的 OrbitControls 侧状态迁移（enabled/damping/惯性清理）。 */
  function flyLookApplyMode(mode: string) {
    const controls = deps.getControls();
    flyPan = null;   // 平移从手势起点重算：相机被模式切换挪动后，旧起点不能再用
    zoomSmoother.reset();   // 滚轮预算一并清空：旧目标在新机位上继续生效会突然一跳
    flyZoomSmoother.reset();
    if (mode === 'free') {
      if (controls) {
        controls.enabled = false;
        controls.enableDamping = false;
        flyLookSyncFromCamera('enter free');   // 进入自由：以当前视野为基准（top 的天顶朝向在此回落）
      }
    } else {
      // 离开自由：手势状态一并清空（触屏指针表 / 平移 / 双指 / 转头态）
      flyPointers.clear();
      flyTwoFinger = null;
      flyLook.active = false;
      emptyDownAt = null;
      if (controls) {
        controls.enabled = true;
        controls.enableDamping = true;
        controls.__flyDist = undefined;   // 语义同原 null：消费侧 ?? 视为未缓存
      }
    }
  }
  function flyLookApply() {
    const camera = deps.getCamera();
    const controls = deps.getControls();
    const cp = Math.cos(flyLook.pitch);
    const dir = { x: -Math.sin(flyLook.yaw) * cp, y: Math.sin(flyLook.pitch), z: -Math.cos(flyLook.yaw) * cp };
    controls.target.set(
      camera.position.x + dir.x * flyLook.dist,
      camera.position.y + dir.y * flyLook.dist,
      camera.position.z + dir.z * flyLook.dist,
    );
    // 相机朝向必须显式重算：free 模式跳过 controls.update()（它的球面状态会与
    // target 重钉互相污染），而 update() 正是平时调用 camera.lookAt(target) 的地方——
    // 只改 target 不 lookAt，拖拽时 target 在动、画面却完全不转（用户实测）。
    camera.lookAt(controls.target);
  }
  /** 沿当前视线推拉相机（OrbitControls 的 dolly 语义 = 滚轮/捏合缩放）：相机与 target
   *  同步平移，视角与视距保持不变。step > 0 前进（推近），step < 0 后退（拉远）。
   *  只改 flyLook.dist 而相机不动是没有画面变化的（用户实测「滚轮没有缩放」）。 */
  function flyDolly(step: number) {
    if (!step) return;
    const camera = deps.getCamera();
    const controls = deps.getControls();
    topViewOnLoad = false;
    const cp = Math.cos(flyLook.pitch);
    const dx = -Math.sin(flyLook.yaw) * cp;
    const dy = Math.sin(flyLook.pitch);
    const dz = -Math.cos(flyLook.yaw) * cp;
    camera.position.x += dx * step;
    camera.position.y += dy * step;
    camera.position.z += dz * step;
    controls.target.x += dx * step;
    controls.target.y += dy * step;
    controls.target.z += dz * step;
    constrainFreeCameraAltitude();
    camera.lookAt(controls.target);
    deps.invalidate();
  }
  // 滚轮缩放的逐帧推进（animate 每帧调用；预算见 zoomSmoothing.js）：
  //   · fly：可加世界位移预算，advance 返回本帧位移直接交给 flyDolly——各帧位移之和
  //     恒等于事件时刻按旧公式算出的总位移，终点与旧即时实现逐值一致且帧率无关；
  //   · top/follow：f = 本帧视距比例，沿 target→camera 缩放视距（OrbitControls dolly
  //     的同一几何）。min/maxDistance 已含地形净空锁定值，随后的
  //     clampOrbitCameraToTerrain 逐帧再校验——被钳掉的部分自然吸收（与即时缩放同一
  //     钳制语义，只改节奏）。
  const _zoomDir = new THREE.Vector3();
  function zoomTick(dt: number) {
    const camera = deps.getCamera();
    const controls = deps.getControls();
    if (!deps.getRenderer()) return;
    if (flyMode()) {
      if (!flyZoomSmoother.active()) return;
      flyDolly(flyZoomSmoother.advance(dt));
    } else {
      if (!zoomSmoother.active()) return;
      const f = zoomSmoother.advance(dt);
      if (f === 1) return;
      if (controls && controls.enabled) {
        const off = _zoomDir.subVectors(camera.position, controls.target);
        const len = off.length();
        if (len > 1e-6) {
          const next = Math.min(controls.maxDistance, Math.max(controls.minDistance, len * f));
          camera.position.copy(controls.target).addScaledVector(off.divideScalar(len), next);
          camera.lookAt(controls.target);
        }
      }
    }
    deps.invalidate();
  }
  /** 手指当前射线的方向（单指平移用）；rect 不可用时返回 null。 */
  function flyPanRay(clientX: number, clientY: number) {
    const rect = container.getBoundingClientRect();
    if (!(rect.width > 0) || !(rect.height > 0)) return null;
    deps.annotationScene.setRaycasterFromClient(clientX, clientY, rect);
    return deps.getRaycaster().ray.direction;
  }
  /** 单指越过单击阈值：抓住手指下的地面点。高度只决定平移比例，不用作净空。 */
  function flyPanArm(clientX: number, clientY: number) {
    const camera = deps.getCamera();
    if (!flyPanRay(clientX, clientY)) return;
    const { x: x0, y: y0, z: z0 } = camera.position;
    const refY = deps.annotationScene.raycastAnnotationGround(clientX, clientY, container.getBoundingClientRect())?.point.y
      ?? deps.terrainHeightForCameraClamp(camera.position.x, camera.position.z)
      ?? 0;
    const height = Math.max(y0 - refY, TOUCH_PAN_MIN_HEIGHT);
    const offset0 = groundPanOffset(flyPanRay(clientX, clientY)!, height);
    Object.assign(flyPan!, { armed: true, x0, y0, z0, height, offset0 });
    emptyDownAt = null;
  }
  /** 单指平移一步：每次从手势起点重算，撞边修正不累积，手指回到起点相机就回到起点。 */
  function flyPanStep(clientX: number, clientY: number) {
    const camera = deps.getCamera();
    const controls = deps.getControls();
    const dir = flyPanRay(clientX, clientY);
    if (!dir) return;
    const o = groundPanOffset(dir, flyPan!.height!);
    camera.position.set(flyPan!.x0! + flyPan!.offset0!.x - o.x, flyPan!.y0!, flyPan!.z0! + flyPan!.offset0!.z - o.z);
    topViewOnLoad = false;
    flyLookApply();
    // target 被钳制时相机同步修正：到地图边缘停下，而不是转头
    const { x: bx, z: bz } = controls.target;
    deps.clampCameraTarget();
    camera.position.x += controls.target.x - bx;
    camera.position.z += controls.target.z - bz;
    constrainFreeCameraAltitude();
    camera.lookAt(controls.target);
    deps.invalidate();
  }
  /** 从当前前两根手指开始一轮双指手势（绘制模式固定捏合，其余先判定）。 */
  function flyTwoFingerStart() {
    const [[a, pa], [b, pb]] = [...flyPointers.entries()];
    flyTwoFinger = { mode: 'pending', a, b, startA: pa, startB: pb };
    if (deps.annotationScene.annotationToolActive()) flyTwoFingerEnter('pinch', pa, pb);
  }
  /** 进入双指通道：以当前时刻为基准，判定瞬间相机不跳。 */
  function flyTwoFingerEnter(mode: string, pa: { x: number; y: number }, pb: { x: number; y: number }) {
    const g = flyTwoFinger as Record<string, unknown>;
    g.mode = mode;
    if (mode === 'pinch') {
      g.d0 = Math.hypot(pa.x - pb.x, pa.y - pb.y) || 1;
      g.dist0 = flyLook.dist;
      g.applied = 0;
    } else {
      g.cx = (pa.x + pb.x) / 2;
      g.cy = (pa.y + pb.y) / 2;
    }
    flyDbg('two-finger', mode);
  }
  function flyTwoFingerStep() {
    const g = flyTwoFinger as Record<string, unknown>;
    const pa = flyPointers.get(g.a as number), pb = flyPointers.get(g.b as number);
    if (!pa || !pb) return;
    if (g.mode === 'pending') {
      // pointermove 逐指派发，单个事件时另一指可能还是旧位置：一帧判定一次，
      // 这一帧里两指的最新位置都到齐后再分类，结果不依赖派发顺序。
      if (!g.sampling) {
        g.sampling = true;
        requestAnimationFrame(() => flyTwoFingerSample(g));
      }
      return;
    }
    if (g.mode === 'pinch') {
      const d = Math.hypot(pa.x - pb.x, pa.y - pb.y) || 1;
      // 双指捏合 = 沿视线推拉相机：以**手势基准**算**累计目标**，再应用目标与已应用量之差。
      // 累计位移 = clamp((d−d0)/d0, ±0.5)·dist0：
      //  · 回到 d0 ⇒ 目标 0 ⇒ 精确回位（不随事件分批漂移）；
      //  · 单次触限只截断**累计目标**，不会丢掉后续回程位移（评审 P2：分别截断
      //    每次增量 + 无条件推进基准，会让 200→350→275→200 净退 0.25×视距）。
      const target = Math.max(-0.5, Math.min(0.5, (d - (g.d0 as number)) / (g.d0 as number))) * (g.dist0 as number);
      const delta = target - (g.applied as number);
      g.applied = target;
      flyDolly(delta);
      return;
    }
    const cx = (pa.x + pb.x) / 2, cy = (pa.y + pb.y) / 2;
    flyLookBy(cx - (g.cx as number), cy - (g.cy as number));
    g.cx = cx; g.cy = cy;
    topViewOnLoad = false;
    flyLookApply();
    deps.invalidate();
  }
  function flyTwoFingerSample(g: Record<string, unknown>) {
    g.sampling = false;
    if (flyTwoFinger !== g || g.mode !== 'pending') return;   // 这一帧里手势已结束或换了手指
    const pa = flyPointers.get(g.a as number), pb = flyPointers.get(g.b as number);
    if (!pa || !pb) return;
    const mode = classifyTwoFinger(g.startA as { x: number; y: number }, g.startB as { x: number; y: number }, pa, pb);
    if (mode) flyTwoFingerEnter(mode, pa, pb);
  }
  function flyLookBy(dx: number, dy: number) {
    flyLook.yaw -= dx * FLY_LOOK_RAD_PER_PX;
    flyLook.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, flyLook.pitch - dy * FLY_LOOK_RAD_PER_PX));
  }
  /** 手指数量变化：还有两指就重新判定，否则结束双指手势（剩下的手指不生效）。 */
  function flyTouchCountChanged() {
    if (flyPointers.size >= 2) flyTwoFingerStart();
    else flyTwoFinger = null;
  }

  // ---- container capture 拦截（祖先 capture 先于 canvas target 阶段）----
  //（SCENE_CLICK_SLOP_PX / emptyDownAt 沿用原选中语义的声明——同一闭包作用域）
  function onFlyCaptureDown(e: PointerEvent) {
    const controls = deps.getControls();
    if (!controls) return;
    if (flyMode()) {
      // 进入自由模式：OrbitControls 让位（enabled=false 后其处理器自忽略，
      // capture 先行是双保险）；本处理器接管拖拽 + 单击选中
      if (controls.enabled) controls.enabled = false;
      flyLookSyncIfStale('drag');
      flyDbg('down', `button=${e.button} type=${e.pointerType || 'mouse'}`);
      if (e.pointerType === 'touch') {
        flyPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        flyLook.active = false;
        emptyDownAt = null;
        if (flyPointers.size >= 2) {
          // 第二指加入：平移立即停止，本次手势也算不上单击
          flyPan = null;
          flyTwoFingerStart();
        } else if (deps.annotationScene.annotationToolActive()) {
          // drawing mode：单指 owner 是 annotation；free camera 也不得移动。
          flyPan = null;
        } else {
          flyPan = { armed: false, startX: e.clientX, startY: e.clientY };
          emptyDownAt = { x: e.clientX, y: e.clientY };
        }
      } else if (e.button === 0) {
        flyLook.active = true;
        flyLook.lastX = e.clientX; flyLook.lastY = e.clientY;
        emptyDownAt = { x: e.clientX, y: e.clientY };
      }
      // 指针捕获：拖出画布仍能收到 move/up。否则画布外松键会留下「幽灵拖拽」
      // （回到画布不按键也在转头）。
      try { container.setPointerCapture(e.pointerId); } catch (_) {}
      // 画布交互夺回键盘焦点：preventDefault 挡住了浏览器的焦点迁移，若不主动 blur，
      // 点过「自由」按钮后焦点仍留在该按钮上——空格 / ←→（播放传输）会落给按钮。
      const ae = document.activeElement as HTMLElement | null;
      if (ae && ae !== document.body && typeof ae.blur === 'function') ae.blur();
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    // 录像者视角不接受相机输入：OrbitControls 保持关闭，选中语义仍由 renderer 接线。
    if (CAM === 'recorder') return;
    // 非 free：恢复 OrbitControls 并走原选中语义（onScenePointerDown 由 renderer 接线）
    if (!controls.enabled) controls.enabled = true;
  }
  function onFlyCaptureMove(e: PointerEvent) {
    if (!flyMode()) return;
    if (e.pointerType === 'touch') {
      if (!flyPointers.has(e.pointerId)) return;
      flyPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (flyTwoFinger) {
        flyTwoFingerStep();
      } else if (flyPan?.armed) {
        flyPanStep(e.clientX, e.clientY);
      } else if (flyPan && Math.hypot(e.clientX - flyPan.startX, e.clientY - flyPan.startY) > SCENE_CLICK_SLOP_PX) {
        flyPanArm(e.clientX, e.clientY);
      } else {
        return;
      }
      e.stopPropagation();
      return;
    }
    if (!flyLook.active) return;
    // 已无按键 = 在画布外松了键（捕获没拿到 up）：结束拖拽，且不当作单击
    if (!e.buttons) { flyLook.active = false; emptyDownAt = null; return; }
    const now = performance.now();
    const logThis = now - flyMoveLastLog > 400;
    if (logThis) flyMoveLastLog = now;
    const events = e.getCoalescedEvents?.().length ? e.getCoalescedEvents() : [e];
    for (const ev of events) {
      const dx = ev.clientX - flyLook.lastX, dy = ev.clientY - flyLook.lastY;
      flyLook.lastX = ev.clientX; flyLook.lastY = ev.clientY;
      flyLookBy(dx, dy);
    }
    topViewOnLoad = false;
    flyLookApply();
    if (logThis) flyDbg('move(applied)');
    deps.invalidate();
    e.stopPropagation();   // flyMode 下 OrbitControls 与场景单击语义都不再需要
  }
  function onFlyCaptureUp(e: PointerEvent) {
    if (!flyMode()) return;
    try { container.releasePointerCapture(e.pointerId); } catch (_) {}
    let wasActive = flyLook.active;
    if (e.pointerType === 'touch') {
      flyPointers.delete(e.pointerId);
      flyTouchCountChanged();
      // 双指手势收尾（还剩一指）：不把它当单击，剩下的手指也不生效
      if (flyPointers.size > 0) {
        e.stopPropagation();
        return;
      }
      // 只有没越过阈值的单指才是单击：平移过的手指回到起点也不算
      wasActive = !!flyPan && !flyPan.armed;
      flyPan = null;
    }
    // 单击判定（≤SLOP）与拖拽共存：按下记录起点、抬起位移 ≤SLOP 才算单击
    flyLook.active = false;
    if (!wasActive || e.button !== 0) return;
    const moved = Math.hypot(e.clientX - (emptyDownAt?.x ?? e.clientX), e.clientY - (emptyDownAt?.y ?? e.clientY));
    emptyDownAt = null;
    if (moved <= SCENE_CLICK_SLOP_PX) {
      // 单击：up 位置统一 raycast（命中车辆 → eid；空处 → null）
      const r = container.getBoundingClientRect();
      const nd = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      deps.getRaycaster().setFromCamera(nd, deps.getCamera());
      const hits = deps.getRaycaster().intersectObjects(deps.vehicles.getVehicles().map(v => v.group), true);
      let eid: number | null = null;
      if (hits.length) {
        let o: THREE.Object3D | null = hits[0].object;
        while (o && !o.userData.eid) o = o.parent;
        if (o) eid = o.userData.eid;
      }
      flyDbg('click', `eid=${eid}`);
      if (!deps.annotationScene.annotationToolActive()) deps.onVehicleSelect?.(eid, e);
    }
    e.stopPropagation();
  }
  function onFlyCaptureWheel(e: WheelEvent) {
    if (CAM === 'recorder') { e.preventDefault(); e.stopPropagation(); return; }
    if (!flyMode()) return;
    // 滚轮 = 沿视线推拉相机（OrbitControls 的 dolly 语义）：相机与 target 一起前进/后退，
    // 视角与视距保持不变。旧实现只改 flyLook.dist 而相机不动——target 只沿视线挪，
    // 画面毫无变化（用户实测「滚轮没有缩放」）。
    flyLookSyncIfStale('wheel');
    // 事件只累积**可加世界位移**（旧即时公式：step = clamp(−deltaY×0.0012, ±0.3)，
    // 位移 = 当前视距 × step——flyDolly 平移 camera+target，视距不变，故为可加量），
    // 实际推拉由 zoomTick 逐帧收敛——平滑只改变时间分布，最终位移与旧即时实现逐值
    // 一致（#835「缩放生硬」）。
    flyZoomSmoother.pushDisplacement(flyLook.dist * (1 - flyWheelFactor(e.deltaY)));
    deps.invalidate();
    e.preventDefault();
    e.stopPropagation();
    flyDbg('wheel', `pushed=${(flyLook.dist * (1 - flyWheelFactor(e.deltaY))).toFixed(3)}`);
  }
  /** three 0.185.1 OrbitControls._customWheelEvent 的归一化等价（对照 node_modules
   *  安装源码）：deltaMode 1（行）×16、2（页）×100；`ctrlKey && !_controlActive` =
   *  触控板模拟 pinch（实体 Control 按键按下时 OrbitControls 经 keydown 维护
   *  _controlActive=true），再 ×10。我们的 capture 拦截发生在 OrbitControls 收到事件
   *  之前，必须先复刻该归一化再换算比例，否则行/页单位设备与触控板捏合的实际缩放
   *  幅度都会变小。 */
  function orbitWheelNormalizedDelta(e: WheelEvent) {
    const controls = deps.getControls();
    let deltaY = e.deltaY;
    if (e.deltaMode === 1) deltaY *= 16;
    else if (e.deltaMode === 2) deltaY *= 100;
    if (e.ctrlKey && controls?._controlActive !== true) deltaY *= 10;
    return deltaY;
  }
  /** top/follow（OrbitControls 路径）的滚轮拦截：只累积缩放预算，几何推进归 zoomTick。
   *  事件幅度与 OrbitControls 直收滚轮逐值一致（先过 _customWheelEvent 等价归一化，
   *  再走 orbitWheelFactor 公式），拦截只是把「当帧一步到位」换成短窗收敛；单事件不改
   *  min/max/地形钳制语义。 */
  function onOrbitZoomWheel(e: WheelEvent) {
    const controls = deps.getControls();
    if (flyMode()) return;   // fly/recorder 已由 onFlyCaptureWheel（先注册）处理或拦截
    if (!controls || !controls.enabled || controls.enableZoom === false) return;   // 输入关闭态不劫持
    const deltaY = orbitWheelNormalizedDelta(e);
    zoomSmoother.push(orbitWheelFactor(deltaY, controls.zoomSpeed));
    deps.invalidate();
    e.preventDefault();
    e.stopPropagation();
    flyDbg('wheel', `orbit pushed=${orbitWheelFactor(deltaY, controls.zoomSpeed).toFixed(3)}`);
  }
  function onFlyCaptureCancel(e: PointerEvent) {
    flyLook.active = false;
    emptyDownAt = null;
    flyPan = null;
    if (e) flyPointers.delete(e.pointerId);
    flyTouchCountChanged();
  }

  // 空处按下起点：pointerup 位移 ≤ 阈值才算「单击空处」（轨道旋转/平移的拖拽起点也在空处，
  // 拖拽不属于「点击其它地方」，不得把详情窗关掉）。
  const SCENE_CLICK_SLOP_PX = 4;
  let emptyDownAt: { x: number; y: number; eid?: number | null; event?: PointerEvent } | null = null;
  function onScenePointerDown(e: PointerEvent) {
    // （free 模式的事件在 container capture 已拦截——此处只服务 OrbitControls 路径）
    if (e.button !== 0) return;
    if (deps.annotationScene.annotationToolActive()) { emptyDownAt = null; return; }
    if (deps.pickDebug()) deps.setPickDownAt({ x: e.clientX, y: e.clientY });   // 调试拾取独立记录（车辆命中路径也出报告）
    const r = container.getBoundingClientRect();
    const nd = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    deps.getRaycaster().setFromCamera(nd, deps.getCamera());
    const hits = deps.getRaycaster().intersectObjects(deps.vehicles.getVehicles().map(v => v.group), true);
    if (hits.length) {
      let o: THREE.Object3D | null = hits[0].object;
      while (o && !o.userData.eid) o = o.parent;
      emptyDownAt = null;
      // 车辆命中：选中延迟到 pointerup 判定（拖拽转头 ≠ 点击选中——飞行动作下
      // 按下即选会把"路过"的车辆选上；≤SLOP 才算单击，与空处单击同口径）
      if (o) { emptyDownAt = { x: e.clientX, y: e.clientY, eid: o.userData.eid as number, event: e }; }
    } else {
      emptyDownAt = { x: e.clientX, y: e.clientY, eid: null };
    }
  }
  function onScenePointerUp(e: PointerEvent) {
    if (e.button !== 0) return;
    if (deps.annotationScene.annotationToolActive()) { emptyDownAt = null; return; }
    // 调试拾取：按下/抬起与拖拽判定独立于选中语义——车辆命中路径（emptyDownAt=null）
    // 同样出报告，且不会被前方车辆挡掉场景物体的调试报告
    const pickDownAt = deps.getPickDownAt();
    if (pickDownAt) {
      const movedPick = Math.hypot(e.clientX - pickDownAt.x, e.clientY - pickDownAt.y);
      deps.setPickDownAt(null);
      if (movedPick <= SCENE_CLICK_SLOP_PX) deps.reportPick(e);
    }
    if (!emptyDownAt) return;
    const moved = Math.hypot(e.clientX - emptyDownAt.x, e.clientY - emptyDownAt.y);
    const down = emptyDownAt;
    emptyDownAt = null;
    // 单击判定（≤SLOP）对自由飞行与 OrbitControls 路径同一口径：
    // 车辆命中 → 选中该 eid；空处 → 上报 null（宿主隐藏详情窗）。拖拽（>SLOP）不触发。
    if (moved <= SCENE_CLICK_SLOP_PX) deps.onVehicleSelect?.(down.eid ?? null, e);
  }

  // 相机地形净空与 target 钳制（#820 Wave B6A：实现与语义注释在
  // playback/cameraTerrainClamp.js）。owner 仍归宿主，本模块经 deps 回调消费。

  /** Free Camera 的上限与俯视默认高度同源；地面下限只在有效高度场覆盖内生效。 */
  function constrainFreeCameraAltitude() {
    if (!flyMode()) return false;
    const camera = deps.getCamera();
    const controls = deps.getControls();
    const { x, y, z } = camera.position;
    if (!Number.isFinite(y) || !Number.isFinite(controls.target.y)) return false;
    let minY = -Infinity;
    const heightField = deps.mapWorld.heightField(), heightMeta = deps.mapWorld.heightMeta();
    if (heightField && heightMeta) {
      const n = Number(heightMeta.size), span = Number(heightMeta.span);
      if (Number.isInteger(n) && n >= 2 && heightField.length === n * n
        && Number.isFinite(span) && span > 0
        && Number.isFinite(x) && Number.isFinite(z)) {
        // sampleHeight 的 corner 坐标域是 [-span/2, span/2)；外侧会被采样器夹到 edge texel。
        const half = span / 2;
        if (x >= -half && x < half && z >= -half && z < half) {
          // 地形高度异步发布早于网格装配；网格可用时按其局部 LOD 三角面 O(1) 采样，
          // 避免双线性高度低估非共面格子；装配前沿用高度场。
          const terrainY = deps.mapWorld.terrainMesh()
            ? deps.mapWorld.sampleRenderedTerrainHeight(x, z)
            : deps.mapWorld.sampleHeight(x, z);
          if (Number.isFinite(terrainY)) minY = terrainY + CAMERA_GROUND_CLEARANCE;
        }
      }
    }
    const maxY = topCameraDefaultHeight();
    if (!Number.isFinite(maxY)) return false;
    const constrainedY = Math.max(minY, Math.min(maxY, y));
    if (constrainedY === y) return false;
    const deltaY = constrainedY - y;
    camera.position.y += deltaY;
    controls.target.y += deltaY;
    camera.lookAt(controls.target);
    return true;
  }

  function setFollow(eid: number) {
    FOLLOW_EID = eid;
    if (FOLLOW_EID) { setCam('follow'); } else { setCam('free'); }
    // 跟随变更立即应用到名册行（followed 高亮）：updateRoster 平时在 tick 里跑，
    // **暂停时不跑**——不补这次，暂停中点跟随的行高亮永远不亮（实测门禁抓到）。
    if (deps.getData()) deps.updateRoster();
    deps.invalidate();
  }
  function setCam(mode: string) {
    if (deps.annotationScene.hasGesture()) deps.annotationScene.cancelAnnotationGesture()   // 相机模式跳变不得继续旧 draft
    // 沙盘（top）是持续的战术总览模式：OrbitControls 以**地图中心**为 target，拖拽/滚轮围绕
    // 地图中心旋转与缩放。top-view 不是模式，只是快速回到俯视机位的动作（reset view）：
    // 完成后就是自由视角，键盘、鼠标与触屏从同一帧起可用。跟随以选中坦克为 target；
    // 自由视角是 FPS 飞行（旋转中心 = 相机，由 flyLook 接管）。
    const controls = deps.getControls();
    const camera = deps.getCamera();
    const topViewAction = mode === 'top-view';
    const nextMode = topViewAction ? 'free' : mode;
    if (nextMode === 'recorder' && !recorderViewAvailable()) return;
    if (nextMode !== 'top') topViewOnLoad = false;
    if (CAM === 'recorder' && nextMode !== 'recorder') leaveRecorderView();
    if (nextMode === 'recorder' && CAM !== 'recorder') enterRecorderView();
    CAM = nextMode;
    store.cam = nextMode;
    flyLookApplyMode(nextMode === 'free' ? 'free' : 'follow');
    if (nextMode !== 'follow') FOLLOW_EID = 0;
    if (!controls) { deps.invalidate(); return; }
    controls.enabled = nextMode === 'follow';
    // 旋转/缩放中心语义要求 target 不被平移带走：Top 锁地图中心、Follow 锁坦克；
    // Free 由 flyLook 接管，OrbitControls 的 pan 不参与（恢复默认值供下次非 Free 入口设置）。
    controls.enablePan = nextMode === 'free';
    deps.invalidate();
    if (nextMode === 'top') {
      applyTopView();
      // 总览视角：可绕地图中心自由旋转（仍不沉到地平线以下），缩放上限放开到默认机位高度
      controls.minPolarAngle = 0;
      controls.maxPolarAngle = Math.PI * 0.49;
      controls.minDistance = deps.baseMinDistance();
      controls.maxDistance = Math.max(controls.maxDistance, topCameraDefaultHeight());
      deps.clampOrbitCameraToTerrain();
      camera.lookAt(controls.target);
      controls.enabled = true;
    } else if (nextMode === 'free') {
      controls.minPolarAngle = 0;
      controls.maxPolarAngle = Math.PI;
      if (topViewAction) applyTopView();
      constrainFreeCameraAltitude();
      if (topViewAction) camera.lookAt(controls.target);
    } else if (nextMode === 'follow') {
      // 跟随绕转不得沉到 target 水平线以下：OrbitControls 的极角上限直接挡住
      // 「向下绕到地下」的输入；相机点仍由 clampOrbitCameraToTerrain 按地形净空校验。
      controls.minPolarAngle = 0;
      controls.maxPolarAngle = Math.PI * 0.49;
      deps.clampOrbitCameraToTerrain();
    }
    // 跟随目标是名册的运行时状态（followed）。setFollow 也经由这里：暂停时没有帧在跑，
    // 换相机必须自己补写，否则跟随描边要等到下次播放 / seek 才出现。走 writeHud 而不是
    // 直接投影名册：播放中名册也不得跑到顶栏前面（两者始终同一个 T）。
    deps.writeHud(true);
  }
  // ---------- 录像者视角 ----------
  const cameraDriven = () => flyMode() || CAM === 'recorder';
  const recorderVehicle = () => deps.vehicles.vehicleByEid(deps.getData()?.meta?.author_eid ?? 0);
  /** Type39/23/31 的归属止于第一次死亡：之后可能属于观战视点，复活不能证明相机回到录像者。 */
  function recorderOwnsCamera(v: RuntimeVehicle) {
    return !deps.deathAt(v, deps.getT()) && deps.deathTimesOf(v).every((death) => deps.getT() < death);
  }
  /** Type23 未知时不伪装成 Arcade：保留 raw，消费层退出。 */
  function recorderViewAvailable() {
    const v = recorderVehicle();
    return !!recorderCamera && !!v && recorderOwnsCamera(v)
      && recorderModeAt(recorderCamera, deps.getT()) !== CAMERA_MODE.UNKNOWN;
  }
  function loadRecorderCamera(source: { file?: unknown; signal?: unknown } | null, epoch: number) {
    recorderCamera = null;
    const file = source?.file as Parameters<typeof loadRecorderCameraFromFile>[0] | undefined;
    store.recorderCameraStatus = file ? 'loading' : 'unavailable';
    if (!file) return;
    const settle = (facet: RecorderCameraFacet | null) => {
      if (deps.destroyed() || epoch !== deps.sessionEpoch()) return;
      const usable = !!facet && facet.author_eid === deps.getData()?.meta?.author_eid;
      recorderCamera = usable ? facet : null;
      store.recorderCameraStatus = usable ? 'ready' : 'unavailable';
      deps.writeHud(true);
    };
    loadRecorderCameraFromFile(file, source?.signal as AbortSignal | undefined).then(settle).catch((err: { name?: string }) => {
      if (err?.name !== 'AbortError') console.warn('[playback] 录像者相机解析失败:', err);
      settle(null);
    });
  }
  function enterRecorderView() {
    const camera = deps.getCamera();
    cameraBlend = {
      position: camera.position.clone(),
      quaternion: camera.quaternion.clone(),
      fov: camera.fov,
      elapsed: 0,
    };
    fovRestore = null;
    recorderBoomScale = 1;
    // 开镜前预取敌方车型 armor 模板，减少首次瞄准新车型的 GLB 下载/解析卡顿。
    if (deps.armorHighlightPref() && deps.getRenderer()) {
      prewarmArmorHighlight(camera);
    }
  }
  function leaveRecorderView() {
    const camera = deps.getCamera();
    cameraBlend = null;
    fovRestore = camera.fov === BASE_FOV_DEG ? null : { fov: camera.fov, elapsed: 0 };
    const hidden = scopedHiddenEid ? deps.vehicles.vehicleByEid(scopedHiddenEid) : null;
    scopedHiddenEid = 0;
    if (hidden) setScopedLayer(hidden, false);
    foliageClip.value = 0;
    deps.recorderReticle?.hide();
    // 开镜结束即释放全尺寸 RT（下次开镜命中目标时按需重建），不把 2×W×H 显存挂到会话结束。
    armorHighlight?.releaseRenderTargets?.();
  }
  function setScopedLayer(v: RuntimeVehicle, hidden: boolean) {
    const layer = hidden ? SCOPED_HIDDEN_LAYER : 0;
    v.group.traverse((node) => { node.layers.set(layer); });
    v.glb?.traverse((node) => { node.layers.set(layer); });
  }
  function applyCameraFov(fov: number) {
    const camera = deps.getCamera();
    if (Math.abs(camera.fov - fov) < 1e-3) return;
    camera.fov = fov;
    camera.updateProjectionMatrix();
    deps.invalidate();
  }
  function stepFovRestore(dt: number) {
    fovRestore!.elapsed += dt;
    const progress = blendProgress(fovRestore!.elapsed);
    applyCameraFov(fovRestore!.fov + (BASE_FOV_DEG - fovRestore!.fov) * progress);
    if (progress >= 1) fovRestore = null;
  }
  const _recorderDir: CameraVec3 = {} as CameraVec3;
  const _recorderPos = new THREE.Vector3();
  const _recorderAnchor = new THREE.Vector3();
  const _recorderPrev = new THREE.Vector3();
  const _recorderLook = new THREE.Vector3();
  const _recorderRay = new THREE.Vector3();
  const _recorderGun = new THREE.Vector3();
  const _recorderGunDir = new THREE.Vector3();
  const _reticleAim = new THREE.Vector3();
  const _reticleGun = new THREE.Vector3();
  const _recorderQuat = new THREE.Quaternion();
  const _recorderLastPos = new THREE.Vector3();
  const _recorderLastQuat = new THREE.Quaternion();
  /** 回放数据驱动相机：开镜相机在炮位、朝向与 FOV 全部来自回放，不做平滑。 */
  function driveRecorderCamera(dt: number) {
    const camera = deps.getCamera();
    const controls = deps.getControls();
    const v = recorderVehicle();
    if (!deps.getData() || !recorderCamera || !v || !recorderOwnsCamera(v)) { setCam('free'); return; }
    const sample = sampleRecorderCamera(recorderCamera, deps.getT(), recorderSample);
    if (sample.mode === CAMERA_MODE.UNKNOWN) { setCam('free'); return; }
    aimDirectionScene(sample.yaw, sample.pitch, _recorderDir);
    const scoped = sample.mode === CAMERA_MODE.SNIPER;
    const hiddenEid = scoped ? v.def.eid : 0;
    const wasScoped = scopedHiddenEid !== 0;
    if (hiddenEid !== scopedHiddenEid) {
      scopedHiddenEid = hiddenEid;
      setScopedLayer(v, scoped);
      // SNIPER→ARCADE（含 seek 回 Arcade）：叠加渲染停止，释放全尺寸 RT；
      // 下次命中目标再按需重建。进入开镜/待在开镜不释放。
      if (wasScoped && !scoped) armorHighlight?.releaseRenderTargets?.();
      if (scoped && !wasScoped && deps.armorHighlightPref()) prewarmArmorHighlight(camera);
    } else if (scoped && v.glb && !v.glb.layers.isEnabled(SCOPED_HIDDEN_LAYER)) {
      setScopedLayer(v, true);   // 开镜期间 GLB 才装配完成
    }
    foliageClip.value = scoped ? FOLIAGE_CLIP_SCOPED_M : FOLIAGE_CLIP_ARCADE_M;
    let fov = BASE_FOV_DEG;
    if (scoped) {
      if (!deps.vehicles.glbGunWorld(v, _recorderPos, _recorderGunDir)) {
        v.gunPivot.updateWorldMatrix(true, false);
        v.gunPivot.getWorldPosition(_recorderPos);
      }
      fov = fovFromZoomRaw(sample.zoomRaw as number);   // SNIPER 采样必带 zoomRaw（原 JS 同口径）
      recorderBoomScale = 1;
    } else {
      deps.vehicles.posAt(v, deps.getT(), _recorderAnchor);
      _recorderAnchor.y += ANCHOR_HEIGHT_M;
      if (recorderCamera.client_options.backward_zoom === true) {
        deps.vehicles.posAt(v, deps.getT() - REVERSE_SAMPLE_OFFSET_SEC, _recorderPrev);
        const reversing = isReversing(
          { x: -_recorderPrev.x, y: 0, z: -_recorderPrev.z },
          { x: -_recorderAnchor.x, y: 0, z: -_recorderAnchor.z },
          deps.vehicles.yawAt(v, deps.getT()),
        );
        recorderBoomScale = backwardZoomScale(recorderBoomScale, reversing, dt);
      }
      arcadeCameraPosition(_recorderAnchor, _recorderDir, ARCADE_BOOM_M * recorderBoomScale, _recorderPos);
      const terrainY = deps.terrainHeightForCameraClamp(_recorderPos.x, _recorderPos.z);
      if (terrainY != null && Number.isFinite(terrainY)) _recorderPos.y = Math.max(_recorderPos.y, terrainY + CAMERA_GROUND_CLEARANCE);
    }
    _recorderLastPos.copy(camera.position);
    _recorderLastQuat.copy(camera.quaternion);
    const lastFov = camera.fov;
    camera.position.copy(_recorderPos);
    _recorderLook.set(_recorderDir.x, _recorderDir.y, _recorderDir.z);
    camera.lookAt(_recorderPos.x + _recorderLook.x, _recorderPos.y + _recorderLook.y, _recorderPos.z + _recorderLook.z);
    if (cameraBlend) {
      cameraBlend.elapsed += dt;
      const progress = blendProgress(cameraBlend.elapsed);
      _recorderQuat.copy(camera.quaternion);
      camera.position.lerpVectors(cameraBlend.position, _recorderPos, progress);
      camera.quaternion.slerpQuaternions(cameraBlend.quaternion, _recorderQuat, progress);
      fov = cameraBlend.fov + (fov - cameraBlend.fov) * progress;
      if (progress >= 1) cameraBlend = null;
    }
    applyCameraFov(fov);
    controls.target.copy(camera.position).addScaledVector(_recorderLook, 30);
    if (!camera.position.equals(_recorderLastPos) || !camera.quaternion.equals(_recorderLastQuat) || camera.fov !== lastFov) {
      deps.invalidate();
    }
    updateRecorderReticle(sample, v);
  }
  /** Type39 瞄准点（场景坐标）：准星与穿深着色的选目标共用这一点。 */
  function recorderAimPoint(sample: RecorderCameraSample, out: THREE.Vector3) {
    return out.set(-sample.rayX, sample.rayY, sample.rayZ);
  }
  /** 世界点 → 舞台像素；投影不到返回 null，不伪造屏幕位置。 */
  function projectToStage(point: THREE.Vector3, out: CameraVec3): CameraVec3 | null {
    point.project(deps.getCamera());
    if (![point.x, point.y, point.z].every((n) => Number.isFinite(n) && Math.abs(n) <= 1)) return null;
    out.x = (point.x + 1) * container.clientWidth / 2;
    out.y = (1 - point.y) * container.clientHeight / 2;
    return out;
  }
  /**
   * Arcade 相机沿 Type39 看，所以中心点按定义在屏幕中间；扩散圆画在炮管实际指向上，
   * 炮塔转动滞后时才会偏离中心再追上来，开镜时两者接近重合。
   */
  function updateRecorderReticle(sample: RecorderCameraSample, v: RuntimeVehicle) {
    if (!deps.recorderReticle) return;
    const camera = deps.getCamera();
    camera.updateMatrixWorld();
    if (!deps.vehicles.glbGunWorld(v, _recorderGun, _recorderGunDir)) {
      v.gunPivot.updateWorldMatrix(true, false);
      v.gunPivot.getWorldPosition(_recorderGun);
      _recorderGunDir.set(0, 0, 1).transformDirection(v.gunPivot.matrixWorld);
    }
    recorderAimPoint(sample, _recorderRay);
    const distance = Math.max(RETICLE_MIN_GUN_DISTANCE_M, _recorderGun.distanceTo(_recorderRay));
    _recorderGun.addScaledVector(_recorderGunDir, distance);
    const aim = projectToStage(_recorderRay, _reticleAim);
    const gun = projectToStage(_recorderGun, _reticleGun);
    if (!aim && !gun) { deps.recorderReticle.hide(); return; }
    deps.recorderReticle.update(aim, gun, reticleRadiusPx({
      bloomRaw: sample.bloomRaw, fovDeg: camera.fov, viewportH: container.clientHeight,
    }));
  }
  // ---------- Sniper 穿深着色 ----------
  let armorHighlight: ArmorHighlightInstance | null = null;
  const _armorAimPoint = new THREE.Vector3();
  const _armorAimDir = new THREE.Vector3();
  /** 当前时刻可被准星选中的敌车（可见、复活/存活、真实车模）。 */
  function highlightEnemies(): AimedVehicleCandidate[] {
    const data = deps.getData();
    if (!data?.meta) return [];
    const friendlyTeam = data.meta.friendly_team;
    return deps.vehicles.getVehicles()
      .filter((v): v is RuntimeVehicle & { glb: THREE.Group } => !!(v.glb?.visible && v.group.visible && v.tankData
        && (v.def.team === 1 || v.def.team === 2) && v.def.team !== friendlyTeam && !deps.deathAt(v, deps.getT())))
      .map((v) => v as AimedVehicleCandidate);
  }
  function ensureArmorHighlight() {
    armorHighlight ??= createArmorHighlight({ renderer: deps.getRenderer()!, assetProvider });   // 相机域入口都在 initScene 之后
    return armorHighlight;
  }
  const armorStats = { pickMs: 0, stateMs: 0, thicknessMs: 0, occluderMs: 0, colorMs: 0, calls: 0, _t0: 0 } as ArmorHighlightPerfStats;
  const _occluderRoots: THREE.Object3D[] = [];
  function occluderRoots(targetEid: number) {
    _occluderRoots.length = 0;
    for (const root of [deps.mapWorld.terrainMesh(), deps.mapWorld.mapScenery(), deps.mapWorld.mapPlane(), deps.mapWorld.groundMesh()]) {
      if (root) _occluderRoots.push(root);
    }
    for (const v of deps.vehicles.getVehicles()) {
      if (v.def.eid === targetEid) continue;
      if (v.group) _occluderRoots.push(v.group);
      if (v.glb) _occluderRoots.push(v.glb);
      for (const head of v.detachedTurrets || []) _occluderRoots.push(head.root);
    }
    return _occluderRoots;
  }
  /**
   * 主渲染之后的叠加 pass：只有录像者开镜才可能运行，其余路径没有任何额外 render。
   * 进入录像者的过渡期相机还没到炮位，距离衰减和入射角都不对，不着色。
   */
  function renderArmorHighlight() {
    const camera = deps.getCamera();
    const PERF = deps.perfEnabled();
    if (PERF) {
      armorStats.pickMs = 0; armorStats.stateMs = 0; armorStats.thicknessMs = 0;
      armorStats.occluderMs = 0; armorStats.colorMs = 0; armorStats.calls = 0;
      armorStats.stateCalls = 0; armorStats.thicknessCalls = 0; armorStats.occluderCalls = 0; armorStats.colorCalls = 0;
    }
    if (!deps.armorHighlightPref() || CAM !== 'recorder' || !scopedHiddenEid || cameraBlend) return;
    const author = recorderVehicle();
    if (!author?.tankData) return;
    const tPick0 = PERF ? performance.now() : 0;
    const enemies = highlightEnemies();
    const aimDir = reticleAimDirection(camera, recorderAimPoint(recorderSample, _armorAimPoint), _armorAimDir);
    let target: AimedVehicleCandidate | null = null;
    if (aimDir) target = aimedVehicle(camera.position, aimDir, enemies, camera);
    const shellId = target == null ? null : authorShellAt(deps.getData()!.author_shell_timeline, deps.getT());
    const config = target == null ? null : resolveExactMountedConfig(target.def as MountedConfigEvidence, target.tankData as TankJsonLike) as HighlightConfig | null;
    const authorConfig = target == null ? null : resolveExactMountedConfig(author.def as MountedConfigEvidence, author.tankData as TankJsonLike) as HighlightConfig | null;
    const blocked = target == null ? 'no_target' : armorHighlightBlock({
      targetTankId: target.def.tank_id, targetConfig: config, authorConfig, shellId,
      targetEquipment: target.def.equipment as MountedConfigEvidence, authorEquipment: author.def.equipment as MountedConfigEvidence,
    });
    if (PERF) {
      armorStats.pickMs = performance.now() - tPick0;
      if (blocked) return;
    } else if (blocked) return;
    if (!target) return;   // TS 收窄：target 为空时 blocked === 'no_target'，上方已 return（原语义不可达分支）
    const { shell, caliber } = mountedShell(authorConfig, shellId)!;
    ensureArmorHighlight().render({
      scene: deps.getScene(), camera, vehicle: target as AimedVehicleCandidate & { def: { eid: number; tank_id?: number | null; equipment?: unknown } }, tankData: target.tankData as { model_url?: string | null; [key: string]: unknown }, config, shell, caliber,
      ...armorEquipmentCoeffs(shell, author.def.equipment, target.def.equipment),
      onReady: deps.invalidate,
      occluderRoots: occluderRoots(target.def.eid as number),
      stats: PERF ? armorStats : undefined,
      gpu: deps.gpu() ?? undefined,
    });
  }
  /** 穿深着色开启路径共用（enterRecorderView / setArmorHighlight-on）：预编译 + 预取。 */
  function prewarmArmorHighlight(camera: PerspectiveCamera) {
    const highlight = ensureArmorHighlight();
    highlight.prewarm(camera);
    highlight.prefetch(highlightEnemies());
  }
  // ---------- 俯视机位 ----------
  /** 回到俯视机位：相机置地图中心正上方，target 锁地图中心。 */
  function applyTopView() {
    const camera = deps.getCamera();
    const controls = deps.getControls();
    const { cx, cz } = deps.mapWorld.worldCenter();
    camera.position.set(cx, topCameraDefaultHeight(), cz + 0.01);
    controls.target.set(cx, 0, cz);
    // 保留直下朝向：默认的天顶回落会让第一次拖拽突然跳到斜俯视。
    flyLookSyncFromCamera('top view', true);
  }
  /** Free Camera 的上限与俯视默认高度同源。 */
  function topCameraDefaultHeight() { return deps.mapWorld.worldCenter().ext * 1.7; }
  // 瞄准点贴脸时扩散圆的最小投影距离
  const RETICLE_MIN_GUN_DISTANCE_M = 30;

  // ---- container capture 监听注册/摘除（initScene 的 fly 段与 destroy 的摘除段收口）----
  function attachListeners() {
    // FPS 飞行接管（capture 阶段挂 container——先于 canvas 的 target 阶段，
    // OrbitControls 物理收不到 flyMode 下的事件；down/up 的 renderer 接线仍服务
    // 非 free 模式的选中语义）
    container.addEventListener('pointerdown', onFlyCaptureDown, true);
    container.addEventListener('pointermove', onFlyCaptureMove, true);
    container.addEventListener('pointerup', onFlyCaptureUp, true);
    container.addEventListener('pointercancel', onFlyCaptureCancel, true);
    container.addEventListener('wheel', onFlyCaptureWheel, { capture: true, passive: false });
    // top/follow 的滚轮拦截（#835）：OrbitControls 的 wheel dolly 当帧生效、无过渡。
    // 在 container capture 拦下（先于 canvas 的 target 阶段，OrbitControls 收不到），
    // 比例公式与其 _getZoomScale 逐值同构（orbitWheelFactor）——单事件幅度不变，
    // 只把「一步到位」换成 zoomTick 的短窗收敛。fly/recorder 模式在 onFlyCaptureWheel
    // 内已处理/拦截，此处理器只服务 OrbitControls 路径。
    container.addEventListener('wheel', onOrbitZoomWheel, { capture: true, passive: false });
  }
  function detachListeners() {
    // container 由宿主复用（场景销毁 ≠ 舞台销毁）：capture 拦截必须摘除，
    // 否则重建场景后同一事件被多份闭包重复消费（拖拽增量翻倍）。
    try { container.removeEventListener('pointerdown', onFlyCaptureDown, true); } catch (_) {}
    try { container.removeEventListener('pointermove', onFlyCaptureMove, true); } catch (_) {}
    try { container.removeEventListener('pointerup', onFlyCaptureUp, true); } catch (_) {}
    try { container.removeEventListener('pointercancel', onFlyCaptureCancel, true); } catch (_) {}
    try { container.removeEventListener('wheel', onFlyCaptureWheel, true); } catch (_) {}
    try { container.removeEventListener('wheel', onOrbitZoomWheel, true); } catch (_) {}
  }

  /** 会话 teardown 的相机段（原 teardownSession 的 recorder/armorHighlight 复位块）。 */
  function resetSessionState() {
    // 录像者不跨回放：同步退出，旧机位不能被下一场当成用户的自由相机保留。
    if (CAM === 'recorder') {
      setCam('free');
      topViewOnLoad = true;
    }
    recorderCamera = null;
    armorHighlight?.dispose();
    armorHighlight = null;
  }

  /** 会话开场相机重置：跟随目标不跨回放（startPlayback 编排调用）。 */
  function prepareSessionCamera() { if (CAM !== 'free') topViewOnLoad = true; }

  // ---------- 键盘自由视角（WASD/QE 飞行）----------
  // 速率档 1–6（与播放速度档独立）：场景只存展示值并失效一帧（暂停时改档也出帧）；
  // 位移推进本体在 composables/useSceneFlyControls.tickFly（Replay3DPane 逐帧调用，
  // 相机数学不进内核——OrbitControls 的 target 随位移平移，其余控制语义不变）。
  function setFlySpeed(n: number) {
    if (!isFlySpeedIndex(n)) return;
    store.flySpeed = FLY_SPEEDS[n - 1];
    store.flySpeedIndex = n;
    deps.invalidate();
  }
  // 键盘飞行一帧（Replay3DPane 的 useSceneFlyControls 循环逐帧调用）：follow 不接管
  //（跟随语义 = 车体锚定）；位移并入按需渲染判定（暂停时按键也出帧）。dt ≤ 0 零位移。
  // pressed = 调用方（composable 实例）维护的按下键集合——按键态不进内核（pane 持有）。
  let flyWasMoving = false;
  function flyTick(dt: number, pressed: Set<string>) {
    const camera = deps.getCamera();
    const controls = deps.getControls();
    if (!deps.getData() || !flyMode() || !(dt > 0) || !pressed?.size) return false;
    // 相机可能被非飞行路径改过（初始 fit / 跟随退出）：首帧对齐朝向基准，防 target 跳变
    flyLookSyncIfStale('tick');
    // 接管（enabled/damping/朝向反解）由 flyLookApplyMode 在模式切换时完成；
    // 这里只做平移推进 + target 重钉。
    const speed = store.flySpeed || FLY_SPEEDS[DEFAULT_FLY_SPEED_INDEX];
    const moved = tickFlyImpl(pressed, dt, camera, controls, speed, flyLook.yaw);
    if (moved) {
      topViewOnLoad = false;
      flyLookApply();                                // 平移后重钉 target = cam + dir×dist
      deps.clampCameraTarget();
      constrainFreeCameraAltitude();
      if (!flyWasMoving) { flyDbg('fly', `keys=${[...pressed].join('+')} speed=${speed}`); flyWasMoving = true; }
    } else {
      flyWasMoving = false;
    }
    return moved;
  }

  return {
    cam: () => CAM,
    followEid: () => FOLLOW_EID,
    topViewOnLoad: () => topViewOnLoad,
    flyMode,
    flyYaw: () => flyLook.yaw,
    scopedHiddenEid: () => scopedHiddenEid,
    cameraBlend: () => cameraBlend,
    fovRestore: () => fovRestore,
    setCam,
    setFollow,
    resetFollow: () => { FOLLOW_EID = 0; },
    setFlySpeed,
    flyTick,
    flyLookApplyMode,
    flyLookSyncFromCamera,
    flyLookSyncIfStale,
    flyLookApply,
    flyDbg,
    zoomTick,
    constrainFreeCameraAltitude,
    cameraDriven,
    recorderViewAvailable,
    recorderModeUnknown: () => !!recorderCamera && recorderModeAt(recorderCamera, deps.getT()) === CAMERA_MODE.UNKNOWN,
    loadRecorderCamera,
    prepareSessionCamera,
    driveRecorderCamera,
    stepFovRestore,
    renderArmorHighlight,
    ensureArmorHighlight,
    armorStats: () => armorStats,
    releaseArmorHighlightRenderTargets: () => { armorHighlight?.releaseRenderTargets?.(); },
    prewarmArmorHighlight,
    onScenePointerDown,
    onScenePointerUp,
    attachListeners,
    detachListeners,
    resetSessionState,
  };
}
