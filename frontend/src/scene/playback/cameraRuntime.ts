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

export const SCOPED_HIDDEN_LAYER = 1
export const CAMERA_GROUND_CLEARANCE = 0.5

export function createCameraRuntime(deps: CameraRuntimeDeps): CameraRuntimeHandle {
  const { container, store } = deps
  let CAM = 'free', FOLLOW_EID = 0;
  let followMinDistance = followCameraMinDistance(null);
  let topViewOnLoad = true;

  const flyInput = createCameraFlyInput(deps, { cam: () => CAM, markManual: () => { topViewOnLoad = false }, constrainFreeCameraAltitude })
  const { flyLook, flyMode, flyDbg, flyLookSyncFromCamera, flyLookSyncIfStale, flyLookApplyMode, flyLookApply, zoomTick,
    onFlyCaptureDown, onFlyCaptureMove, onFlyCaptureUp, onFlyCaptureCancel, onFlyCaptureWheel,
    onOrbitZoomWheel, onScenePointerDown, onScenePointerUp, applyMobileTouchControls } = flyInput


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
        const half = span / 2;
        if (x >= -half && x < half && z >= -half && z < half) {
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

  function applyFollowMinDistance() {
    const controls = deps.getControls();
    if (!controls) return;
    controls.minDistance = followMinDistance;
    controls.maxDistance = Math.max(controls.maxDistance, followMinDistance);
  }
  function refreshFollowMinDistance(eid: number) {
    if (CAM !== 'follow' || !FOLLOW_EID || eid !== FOLLOW_EID) return;
    followMinDistance = followCameraMinDistance(deps.vehicles.vehicleByEid(FOLLOW_EID));
    applyFollowMinDistance();
    deps.clampOrbitCameraToTerrain();
    deps.invalidate();
  }
  function setFollow(eid: number) {
    FOLLOW_EID = eid;
    if (FOLLOW_EID) { setCam('follow'); } else { setCam('free'); }
    if (deps.getData()) deps.updateRoster();
    deps.requestWaterReflectionRefresh();
    deps.invalidate();
  }
  function setCam(mode: string) {
    if (deps.annotationScene.hasGesture()) deps.annotationScene.cancelAnnotationGesture()
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
    if (!controls) { deps.requestWaterReflectionRefresh(); deps.invalidate(); return; }
    controls.enabled = nextMode === 'follow';
    controls.enablePan = nextMode === 'free';
    deps.requestWaterReflectionRefresh();
    deps.invalidate();
    if (nextMode === 'top') {
      applyTopView();
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
      followMinDistance = followCameraMinDistance(FOLLOW_EID ? deps.vehicles.vehicleByEid(FOLLOW_EID) : null)
      applyFollowMinDistance();
      controls.minPolarAngle = 0;
      controls.maxPolarAngle = Math.PI * 0.49;
      deps.clampOrbitCameraToTerrain();
    }
    deps.writeHud(true);
  }
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
  function applyTopView() {
    const camera = deps.getCamera();
    const controls = deps.getControls();
    const { cx, cz } = deps.mapWorld.worldCenter();
    camera.position.set(cx, topCameraDefaultHeight(), cz + 0.01);
    controls.target.set(cx, 0, cz);
    flyLookSyncFromCamera('top view', true);
  }
  function topCameraDefaultHeight() { return deps.mapWorld.worldCenter().ext * 1.7; }

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
      deps.requestWaterReflectionRefresh();
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
      deps.requestWaterReflectionRefresh();
      deps.invalidate();
    }
  }

  function attachListeners() {
    container.addEventListener('pointerdown', onFlyCaptureDown, true);
    container.addEventListener('pointermove', onFlyCaptureMove, true);
    container.addEventListener('pointerup', onFlyCaptureUp, true);
    container.addEventListener('pointercancel', onFlyCaptureCancel, true);
    container.addEventListener('wheel', onFlyCaptureWheel, { capture: true, passive: false });
    container.addEventListener('wheel', onOrbitZoomWheel, { capture: true, passive: false });
  }
  function detachListeners() {
    try { container.removeEventListener('pointerdown', onFlyCaptureDown, true); } catch (_) {}
    try { container.removeEventListener('pointermove', onFlyCaptureMove, true); } catch (_) {}
    try { container.removeEventListener('pointerup', onFlyCaptureUp, true); } catch (_) {}
    try { container.removeEventListener('pointercancel', onFlyCaptureCancel, true); } catch (_) {}
    try { container.removeEventListener('wheel', onFlyCaptureWheel, true); } catch (_) {}
    try { container.removeEventListener('wheel', onOrbitZoomWheel, true); } catch (_) {}
  }

  function resetSessionState() {
    if (CAM === 'recorder') {
      setCam('free');
      topViewOnLoad = true;
    }
    recorder.reset();
    cameraArmor.dispose();
  }

  function prepareSessionCamera() { if (CAM !== 'free') topViewOnLoad = true; }

  function setFlySpeed(n: number) {
    if (!isFlySpeedIndex(n)) return;
    store.flySpeed = FLY_SPEEDS[n - 1];
    store.flySpeedIndex = n;
    deps.invalidate();
  }
  let flyWasMoving = false;
  function flyTick(dt: number, pressed: Set<string>) {
    const camera = deps.getCamera();
    const controls = deps.getControls();
    if (!deps.getData() || !flyMode() || !(dt > 0) || !pressed?.size) return false;
    flyLookSyncIfStale('tick');
    const speed = store.flySpeed || FLY_SPEEDS[DEFAULT_FLY_SPEED_INDEX];
    const moved = tickFlyImpl(pressed, dt, camera, controls, speed, flyLook.yaw);
    if (moved) {
      topViewOnLoad = false;
      flyLookApply();
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
    refreshFollowMinDistance,
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
    cameraDistanceState,
    setCameraDistance,
  };
}
