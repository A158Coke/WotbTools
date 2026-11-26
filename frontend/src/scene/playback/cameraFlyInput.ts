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
  const zoomSmoother = createZoomSmoother();
  const flyZoomSmoother = createFlyZoomSmoother();
  const flyMode = () => hooks.cam() === 'free';
  const flyPointers = new Map<number, { x: number; y: number }>();
  let flyPan: { armed: boolean; startX: number; startY: number; x0?: number; y0?: number; z0?: number; height?: number; offset0?: { x: number; z: number } } | null = null;
  let flyTwoFinger: Record<string, unknown> | null = null;
  let mobileTouch = false;
  const FLY_LOOK_RAD_PER_PX = 0.0032;
  const flyDbg = (tag: string, extra?: string) => {
    const line = `[fly] ${tag} ${extra !== undefined ? extra : ''} cam=${hooks.cam()} enabled=${deps.getControls() ? deps.getControls().enabled : '?'} yaw=${flyLook.yaw.toFixed(2)} pitch=${flyLook.pitch.toFixed(2)} dist=${flyLook.dist.toFixed(0)}`;
    if (deps.debug) console.info(line); else console.debug(line);
  };
  let flyMoveLastLog = 0;

  function flyLookSyncFromCamera(tag: string | null = null, preserveVertical = false) {
    const camera = deps.getCamera();
    const controls = deps.getControls();
    const dx = controls.target.x - camera.position.x;
    const dy = controls.target.y - camera.position.y;
    const dz = controls.target.z - camera.position.z;
    const dist = Math.hypot(dx, dy, dz) || 1;
    flyLook.dist = dist;
    flyLook.yaw = Math.atan2(-dx, -dz);
    const rawPitch = Math.asin(Math.max(-1, Math.min(1, dy / dist)));
    flyLook.pitch = !preserveVertical && Math.abs(rawPitch) > Math.PI / 2 - 0.25
      ? 0.6 * Math.sign(rawPitch || 1)
      : rawPitch;
    if (tag) flyDbg(`sync(${tag})`);
  }
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
  function flyLookApplyMode(mode: string) {
    const controls = deps.getControls();
    flyPan = null;
    zoomSmoother.reset();
    flyZoomSmoother.reset();
    if (mode === 'free') {
      if (controls) {
        controls.enabled = false;
        controls.enableDamping = false;
        flyLookSyncFromCamera('enter free');
      }
    } else {
      flyPointers.clear();
      flyTwoFinger = null;
      flyLook.active = false;
      emptyDownAt = null;
      if (controls) {
        controls.enabled = true;
        controls.enableDamping = true;
        controls.__flyDist = undefined;
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
    camera.lookAt(controls.target);
  }
  const { zoomTick, flyDolly } = createCameraZoom(deps, { flyLook, flyMode, zoomSmoother, flyZoomSmoother,
    markManual: hooks.markManual, constrainFreeCameraAltitude: hooks.constrainFreeCameraAltitude })
  function flyPanRay(clientX: number, clientY: number) {
    const rect = container.getBoundingClientRect();
    if (!(rect.width > 0) || !(rect.height > 0)) return null;
    deps.annotationScene.setRaycasterFromClient(clientX, clientY, rect);
    return deps.getRaycaster().ray.direction;
  }
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
  function flyPanStep(clientX: number, clientY: number) {
    const camera = deps.getCamera();
    const controls = deps.getControls();
    const dir = flyPanRay(clientX, clientY);
    if (!dir) return;
    const o = groundPanOffset(dir, flyPan!.height!);
    camera.position.set(flyPan!.x0! + flyPan!.offset0!.x - o.x, flyPan!.y0!, flyPan!.z0! + flyPan!.offset0!.z - o.z);
    hooks.markManual();
    flyLookApply();
    const { x: bx, z: bz } = controls.target;
    deps.clampCameraTarget();
    camera.position.x += controls.target.x - bx;
    camera.position.z += controls.target.z - bz;
    hooks.constrainFreeCameraAltitude();
    camera.lookAt(controls.target);
    deps.invalidate();
  }
  function flyTwoFingerStart() {
    if (mobileTouch) { flyTwoFinger = null; return; }
    const [[a, pa], [b, pb]] = [...flyPointers.entries()];
    flyTwoFinger = { mode: 'pending', a, b, startA: pa, startB: pb };
    if (deps.annotationScene.annotationToolActive()) flyTwoFingerEnter('pinch', pa, pb);
  }
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
      if (!g.sampling) {
        g.sampling = true;
        requestAnimationFrame(() => flyTwoFingerSample(g));
      }
      return;
    }
    if (g.mode === 'pinch') {
      const d = Math.hypot(pa.x - pb.x, pa.y - pb.y) || 1;
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
    if (flyTwoFinger !== g || g.mode !== 'pending') return;
    const pa = flyPointers.get(g.a as number), pb = flyPointers.get(g.b as number);
    if (!pa || !pb) return;
    const mode = classifyTwoFinger(g.startA as { x: number; y: number }, g.startB as { x: number; y: number }, pa, pb);
    if (mode) flyTwoFingerEnter(mode, pa, pb);
  }
  function flyLookBy(dx: number, dy: number) {
    flyLook.yaw -= dx * FLY_LOOK_RAD_PER_PX;
    flyLook.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, flyLook.pitch - dy * FLY_LOOK_RAD_PER_PX));
  }
  function applyMobileTouchControls() {
    const controls = deps.getControls();
    if (!controls) return;
    controls.touches!.TWO = mobileTouch ? null : THREE.TOUCH.DOLLY_PAN;
  }

  function flyTouchCountChanged() {
    if (mobileTouch) { flyTwoFinger = null; return; }
    if (flyPointers.size >= 2) flyTwoFingerStart();
    else flyTwoFinger = null;
  }

  function onFlyCaptureDown(e: PointerEvent) {
    const controls = deps.getControls();
    if (!controls) return;
    if (flyMode()) {
      if (controls.enabled) controls.enabled = false;
      flyLookSyncIfStale('drag');
      flyDbg('down', `button=${e.button} type=${e.pointerType || 'mouse'}`);
      if (e.pointerType === 'touch') {
        flyPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        flyLook.active = false;
        emptyDownAt = null;
        if (flyPointers.size >= 2) {
          flyPan = null;
          flyTwoFingerStart();
        } else if (deps.annotationScene.annotationToolActive()) {
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
      try { container.setPointerCapture(e.pointerId); } catch (_) {}
      const ae = document.activeElement as HTMLElement | null;
      if (ae && ae !== document.body && typeof ae.blur === 'function') ae.blur();
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (hooks.cam() === 'recorder') return;
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
    e.stopPropagation();
  }
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
      if (flyPointers.size > 0) {
        e.stopPropagation();
        return;
      }
      settle = true;
      wasActive = !!flyPan && !flyPan.armed;
      flyPan = null;
    }
    flyLook.active = false;
    if (settle) settleCameraAfterGesture();
    if (!wasActive || e.button !== 0) return;
    const moved = Math.hypot(e.clientX - (emptyDownAt?.x ?? e.clientX), e.clientY - (emptyDownAt?.y ?? e.clientY));
    emptyDownAt = null;
    if (moved <= SCENE_CLICK_SLOP_PX) {
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
    flyLookSyncIfStale('wheel');
    flyZoomSmoother.pushDisplacement(flyLook.dist * (1 - flyWheelFactor(e.deltaY)));
    deps.invalidate();
    e.preventDefault();
    e.stopPropagation();
    flyDbg('wheel', `pushed=${(flyLook.dist * (1 - flyWheelFactor(e.deltaY))).toFixed(3)}`);
  }
  function orbitWheelNormalizedDelta(e: WheelEvent) {
    const controls = deps.getControls();
    let deltaY = e.deltaY;
    if (e.deltaMode === 1) deltaY *= 16;
    else if (e.deltaMode === 2) deltaY *= 100;
    if (e.ctrlKey && controls?._controlActive !== true) deltaY *= 10;
    return deltaY;
  }
  function onOrbitZoomWheel(e: WheelEvent) {
    const controls = deps.getControls();
    if (flyMode()) return;
    if (!controls || !controls.enabled || controls.enableZoom === false) return;
    const deltaY = orbitWheelNormalizedDelta(e);
    zoomSmoother.push(orbitWheelFactor(deltaY, controls.zoomSpeed));
    deps.invalidate();
    e.preventDefault();
    e.stopPropagation();
    flyDbg('wheel', `orbit pushed=${orbitWheelFactor(deltaY, controls.zoomSpeed).toFixed(3)}`);
  }
  function onFlyCaptureCancel(e: PointerEvent) {
    if (flyLook.active || flyPointers.size > 0) settleCameraAfterGesture();
    flyLook.active = false;
    emptyDownAt = null;
    flyPan = null;
    if (e) flyPointers.delete(e.pointerId);
    flyTouchCountChanged();
  }

  const SCENE_CLICK_SLOP_PX = 4;
  let emptyDownAt: { x: number; y: number; eid?: number | null; event?: PointerEvent } | null = null;
  function onScenePointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    if (deps.annotationScene.annotationToolActive()) { emptyDownAt = null; return; }
    if (deps.pickDebug()) deps.setPickDownAt({ x: e.clientX, y: e.clientY });
    const r = container.getBoundingClientRect();
    const nd = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    deps.getRaycaster().setFromCamera(nd, deps.getCamera());
    const hits = deps.getRaycaster().intersectObjects(deps.vehicles.getVehicles().map(v => v.group), true);
    if (hits.length) {
      let o: THREE.Object3D | null = hits[0].object;
      while (o && !o.userData.eid) o = o.parent;
      emptyDownAt = null;
      if (o) { emptyDownAt = { x: e.clientX, y: e.clientY, eid: o.userData.eid as number, event: e }; }
    } else {
      emptyDownAt = { x: e.clientX, y: e.clientY, eid: null };
    }
  }
  function onScenePointerUp(e: PointerEvent) {
    if (e.button !== 0) return;
    if (deps.annotationScene.annotationToolActive()) { emptyDownAt = null; return; }
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
