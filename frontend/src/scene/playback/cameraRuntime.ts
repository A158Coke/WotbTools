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
import {
  isFlySpeedIndex, FLY_SPEEDS, DEFAULT_FLY_SPEED_INDEX,
  advanceFly as tickFlyImpl, freeVerticalDistancePose,
} from '../../composables/useSceneFlyControls.js'
import { createRecorderCamera } from './recorderCameraRuntime.js'
import { createCameraArmorHighlight } from './cameraArmorHighlight.js'
import { createCameraFlyInput } from './cameraFlyInput.js'
import { followCameraMinDistance } from './followCameraDistance.js'
import type { CameraRuntimeDeps, CameraRuntimeHandle } from './cameraRuntimeTypes.js'
export type { CameraRuntimeStore, CameraRuntimeControls, CameraRuntimeData, RecorderReticleLike, CameraRuntimeDeps, CameraRuntimeHandle } from './cameraRuntimeTypes.js'

/** 开镜时相机不启用的 layer：本车留在场景里但不绘制。 */
export const SCOPED_HIDDEN_LAYER = 1
/** 初值：小于地形起伏尺度，真实地图视觉校准由人工验收（free 钳制与录像者贴地共用）。 */
export const CAMERA_GROUND_CLEARANCE = 0.5

export function createCameraRuntime(deps: CameraRuntimeDeps): CameraRuntimeHandle {
  const { container, store } = deps
  let CAM = 'free', FOLLOW_EID = 0;
  // 跟随的 OrbitControls 近端：进入跟随时按目标模型量一次，不在帧循环里做包围盒。
  let followMinDistance = followCameraMinDistance(null);
  // 新会话默认以俯视机位开局；用户一旦操作过相机，同一实例内不再覆盖其视角。
  let topViewOnLoad = true;

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
  const flyInput = createCameraFlyInput(deps, { cam: () => CAM, markManual: () => { topViewOnLoad = false }, constrainFreeCameraAltitude })
  const { flyLook, flyMode, flyDbg, flyLookSyncFromCamera, flyLookSyncIfStale, flyLookApplyMode, flyLookApply, zoomTick,
    onFlyCaptureDown, onFlyCaptureMove, onFlyCaptureUp, onFlyCaptureCancel, onFlyCaptureWheel,
    onOrbitZoomWheel, onScenePointerDown, onScenePointerUp, applyMobileTouchControls } = flyInput

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
      // 最近距离按被跟随车辆的模型外廓量一次（GLB 优先，低模回退）：
      // 相机可贴到车体附近，但不会钻进模型；旧固定 20 m 会一直停在战术总览距离。
      followMinDistance = followCameraMinDistance(FOLLOW_EID ? deps.vehicles.vehicleByEid(FOLLOW_EID) : null)
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
  const recorder = createRecorderCamera(deps, {
    setCam, prewarmArmorHighlight: (camera) => cameraArmor.prewarmArmorHighlight(camera),
    releaseArmorHighlight: () => cameraArmor.release(), clearance: CAMERA_GROUND_CLEARANCE, hiddenLayer: SCOPED_HIDDEN_LAYER,
  })
  const { recorderVehicle, recorderViewAvailable, loadRecorderCamera, enterRecorderView, leaveRecorderView,
    stepFovRestore, driveRecorderCamera, recorderAimPoint, recorderSample } = recorder
  const cameraArmor = createCameraArmorHighlight(deps, {
    cam: () => CAM, scopedHiddenEid: recorder.scopedHiddenEid, cameraBlend: recorder.cameraBlend,
    recorderVehicle, recorderAimPoint, recorderSample,
  })
  const { ensureArmorHighlight, renderArmorHighlight, prewarmArmorHighlight } = cameraArmor
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

  // ---------- 移动端竖向距离滑条（相机真实状态反推，无第二套倍率 SSOT） ----------
  // 值语义统一 v ∈ [0,1]：v=1（滑条顶部）= 近，v=0（底部）= 远。
  //   · Free：净空距离 = camera.y − 相机 xz 处地形高。近端 = 贴地下限
  //     （CAMERA_GROUND_CLEARANCE），远端 = 自由相机高度上限（topCameraDefaultHeight）。
  //     设置 = 垂直平移 camera；constrainFreeCameraAltitude 贴限时同步平移 target
  //     （朝向不变，相机在真实限制处停住）。
  //   · Fixed（top 持续模式）：camera↔target 距离（OrbitControls 半径）。近端 =
  //     minDistance（含地形净空锁定值），远端 = maxDistance。设置 = 沿 target→camera
  //     缩放半径后交给既有地形钳制。
  // Follow / Recorder 返回 unavailable——滑条在这些形态隐藏，绝不接管相机所有权。
  function cameraDistanceState(): { available: boolean; mode?: 'free' | 'fixed'; v?: number } {
    const camera = deps.getCamera();
    const controls = deps.getControls();
    if (!deps.getRenderer() || !controls) return { available: false };
    if (CAM === 'free') {
      const terrain = deps.terrainHeightForCameraClamp(camera.position.x, camera.position.z) ?? 0;
      const cMin = CAMERA_GROUND_CLEARANCE;
      const cMax = Math.max(cMin + 0.001, topCameraDefaultHeight() - terrain);
      const c = camera.position.y - terrain;
      return { available: true, mode: 'free', v: Math.min(1, Math.max(0, 1 - (c - cMin) / (cMax - cMin))) };
    }
    if (CAM === 'top') {
      const min = Number(controls.minDistance) || 0;
      const max = Math.max(min + 0.001, Number(controls.maxDistance) || min);
      const len = camera.position.distanceTo(controls.target);
      return { available: true, mode: 'fixed', v: Math.min(1, Math.max(0, 1 - (len - min) / (max - min))) };
    }
    return { available: false };
  }
  const _zoomDir = new THREE.Vector3()
  function setCameraDistance(v: number) {
    const camera = deps.getCamera();
    const controls = deps.getControls();
    if (!deps.getRenderer() || !controls) return;
    const t = Math.min(1, Math.max(0, Number(v) || 0));
    if (CAM === 'free') {
      // 竖直平移位姿由纯函数给出（freeVerticalDistancePose）：camera 与 target 加
      // 同一个高度差，yaw/pitch/FOV 保持不变；贴地/上限处相机停住、target 跟随
      // 实际生效差值，真实净空由 cameraDistanceState() 从相机状态反推。
      const terrain = deps.terrainHeightForCameraClamp(camera.position.x, camera.position.z) ?? 0;
      const pose = freeVerticalDistancePose({
        camY: camera.position.y,
        targetY: controls.target.y,
        terrainY: terrain,
        clearanceMin: CAMERA_GROUND_CLEARANCE,
        heightMax: topCameraDefaultHeight(),
        v: t,
      });
      camera.position.y = pose.camY;
      controls.target.y = pose.targetY;
      constrainFreeCameraAltitude();
      camera.lookAt(controls.target);
      deps.invalidate();
      return;
    }
    if (CAM === 'top') {
      const off = _zoomDir.subVectors(camera.position, controls.target);
      const len = off.length();
      if (len <= 1e-6) return;
      const min = Number(controls.minDistance) || 0;
      const max = Math.max(min + 0.001, Number(controls.maxDistance) || min);
      const next = max - t * (max - min);
      camera.position.copy(controls.target).addScaledVector(off.divideScalar(len), next);
      deps.clampOrbitCameraToTerrain();
      camera.lookAt(controls.target);
      deps.invalidate();
    }
  }
  // 瞄准点贴脸时扩散圆的最小投影距离

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
    recorder.reset();
    cameraArmor.dispose();
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
    scopedHiddenEid: recorder.scopedHiddenEid,
    cameraBlend: recorder.cameraBlend,
    fovRestore: recorder.fovRestore,
    setCam,
    setFollow,
    resetFollow: () => { FOLLOW_EID = 0; followMinDistance = followCameraMinDistance(null); },
    followMinDistance: () => followMinDistance,
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
    recorderModeUnknown: recorder.recorderModeUnknown,
    loadRecorderCamera,
    prepareSessionCamera,
    driveRecorderCamera,
    stepFovRestore,
    renderArmorHighlight,
    ensureArmorHighlight,
    armorStats: cameraArmor.armorStats,
    releaseArmorHighlightRenderTargets: () => { cameraArmor.release(); },
    prewarmArmorHighlight,
    onScenePointerDown,
    onScenePointerUp,
    attachListeners,
    detachListeners,
    resetSessionState,
    discardTouchGesture: flyInput.discardTouchGesture,
    setMobileTouch: flyInput.setMobileTouch,
    applyMobileTouchControls,
    // ---------- 移动端竖向距离滑条（相机真实状态反推，无第二套倍率 SSOT；主干随迁） ----------
    cameraDistanceState,
    setCameraDistance,
  };
}
