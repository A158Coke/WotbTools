import * as THREE from 'three'
import { TOUCH_PAN_MIN_HEIGHT, classifyTwoFinger, groundPanOffset } from '../../composables/useSceneFlyControls.js'
import { createZoomSmoother, createFlyZoomSmoother, flyWheelFactor, orbitWheelFactor } from './zoomSmoothing.js'
import { createCameraZoom } from './cameraZoom.js'
import type { CameraRuntimeDeps } from './cameraRuntimeTypes.js'

export function createCameraFlyInput(deps: CameraRuntimeDeps, hooks: {
  cam: () => string; markManual: () => void; constrainFreeCameraAltitude: () => boolean
}) {
  const { container } = deps
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
  const flyMode = () => hooks.cam() === 'free';
  // 触屏多点手势状态：pointerId → 最新坐标
  const flyPointers = new Map<number, { x: number; y: number }>();
  // 单指：armed 前是单击候选，armed 后是贴地平移（x0/y0/z0 手势起点相机 / height 平移平面 / offset0 抓取偏移）
  let flyPan: { armed: boolean; startX: number; startY: number; x0?: number; y0?: number; z0?: number; height?: number; offset0?: { x: number; z: number } } | null = null;
  // 双指：mode = pending（判定中）| pinch（d0 指距 / dist0 视距）| look（cx/cy 两指中点）
  let flyTwoFinger: Record<string, unknown> | null = null;
  // 移动端触屏相机契约（docs/frontend/replay-workspace.md）：单指按模式分流
  // （Free=贴地平移 / Fixed=OrbitControls 左键式旋转），**双指不承担任何相机控制**。
  // 由宿主按 form-factor（usePlaybackPhoneForm）下发（setMobileTouch），不在场景内嗅探；
  // 桌面鼠标路径完全不受影响。
  let mobileTouch = false;
  const FLY_LOOK_RAD_PER_PX = 0.0032;   // rad/px（与常见 FPS 灵敏度同量级）
  // [fly] 埋点：?debug 下走 console.info（默认级别可见，排障不用勾 Verbose）；
  // 非 debug 走 console.debug（默认隐藏）。每次交互只输出个位数行。
  const flyDbg = (tag: string, extra?: string) => {
    const line = `[fly] ${tag} ${extra !== undefined ? extra : ''} cam=${hooks.cam()} enabled=${deps.getControls() ? deps.getControls().enabled : '?'} yaw=${flyLook.yaw.toFixed(2)} pitch=${flyLook.pitch.toFixed(2)} dist=${flyLook.dist.toFixed(0)}`;
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
  const { zoomTick, flyDolly } = createCameraZoom(deps, { flyLook, flyMode, zoomSmoother, flyZoomSmoother,
    markManual: hooks.markManual, constrainFreeCameraAltitude: hooks.constrainFreeCameraAltitude })
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
    hooks.markManual();
    flyLookApply();
    // target 被钳制时相机同步修正：到地图边缘停下，而不是转头
    const { x: bx, z: bz } = controls.target;
    deps.clampCameraTarget();
    camera.position.x += controls.target.x - bx;
    camera.position.z += controls.target.z - bz;
    hooks.constrainFreeCameraAltitude();
    camera.lookAt(controls.target);
    deps.invalidate();
  }
  /** 从当前前两根手指开始一轮双指手势（绘制模式固定捏合，其余先判定）。
   *  移动端触屏（MOBILE_TOUCH）：双指不承担相机控制——不进入 pending/pinch/look
   *  分类，直接作废本手势（指针表仍跟踪，up 收尾语义不变）。 */
  function flyTwoFingerStart() {
    if (mobileTouch) { flyTwoFinger = null; return; }
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
    hooks.markManual();
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
  /** 触屏相机 OrbitControls 侧分流：双指 DOLLY_PAN 关闭（捏合/双指拖不动相机），单指保持
   *  默认 ROTATE（= Fixed 模式的「左键拖动」契约）。renderer/controls 每次重建都会重置
   *  touches，所以每次创建后（initScene）都要重新应用。桌面恢复默认，行为零变化。 */
  function applyMobileTouchControls() {
    const controls = deps.getControls();
    if (!controls) return;
    controls.touches!.TWO = mobileTouch ? null : THREE.TOUCH.DOLLY_PAN;   // OrbitControls 默认双指手势
  }

  /** 手指数量变化：还有两指就重新判定，否则结束双指手势（剩下的手指不生效）。 */
  function flyTouchCountChanged() {
    if (mobileTouch) { flyTwoFinger = null; return; }
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
    if (hooks.cam() === 'recorder') return;
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
    if (!e.buttons) { flyLook.active = false; emptyDownAt = null; settleCameraAfterGesture(); return; }
    const now = performance.now();
    const logThis = now - flyMoveLastLog > 400;
    if (logThis) flyMoveLastLog = now;
    const events = e.getCoalescedEvents?.().length ? e.getCoalescedEvents() : [e];
    for (const ev of events) {
      const dx = ev.clientX - flyLook.lastX, dy = ev.clientY - flyLook.lastY;
      flyLook.lastX = ev.clientX; flyLook.lastY = ev.clientY;
      flyLookBy(dx, dy);
    }
    hooks.markManual();
    flyLookApply();
    if (logThis) flyDbg('move(applied)');
    deps.invalidate();
    e.stopPropagation();   // flyMode 下 OrbitControls 与场景单击语义都不再需要
  }
  /** 相机交互结束：强制反射刷新，并安排下一帧消费该请求（HIGH 档只 invalidate 会命中跳过帧）。 */
  function settleCameraAfterGesture() {
    deps.requestWaterReflectionRefresh();
    deps.invalidate();
  }
  function onFlyCaptureUp(e: PointerEvent) {
    if (!flyMode()) return;
    try { container.releasePointerCapture(e.pointerId); } catch (_) {}
    let wasActive = flyLook.active;
    let settle = wasActive;
    if (e.pointerType === 'touch') {
      flyPointers.delete(e.pointerId);
      flyTouchCountChanged();
      // 双指手势收尾（还剩一指）：不把它当单击，剩下的手指也不生效
      if (flyPointers.size > 0) {
        e.stopPropagation();
        return;
      }
      // 最后一指离开：无论单指平移/双指手势，相机都进入静止态。
      settle = true;
      // 只有没越过阈值的单指才是单击：平移过的手指回到起点也不算
      wasActive = !!flyPan && !flyPan.armed;
      flyPan = null;
    }
    // 单击判定（≤SLOP）与拖拽共存：按下记录起点、抬起位移 ≤SLOP 才算单击
    flyLook.active = false;
    if (settle) settleCameraAfterGesture();
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
    if (hooks.cam() === 'recorder') { e.preventDefault(); e.stopPropagation(); return; }
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
    // pointercancel 也是相机交互结束：正在拖拽/多指手势时收口，避免最后姿态停在反射跳过帧。
    if (flyLook.active || flyPointers.size > 0) settleCameraAfterGesture();
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

  function discardTouchGesture() { flyTwoFinger = null }
  function setMobileTouch(on: boolean) {
    const next = !!on
    if (mobileTouch === next) { applyMobileTouchControls(); return }
    mobileTouch = next; flyTwoFinger = null; applyMobileTouchControls()
  }
  return { flyLook, flyMode, flyDbg, flyLookSyncFromCamera, flyLookSyncIfStale, flyLookApplyMode, flyLookApply,
    zoomTick, onFlyCaptureDown, onFlyCaptureMove, onFlyCaptureUp, onFlyCaptureCancel, onFlyCaptureWheel,
    onOrbitZoomWheel, onScenePointerDown, onScenePointerUp, discardTouchGesture, setMobileTouch, applyMobileTouchControls }
}
