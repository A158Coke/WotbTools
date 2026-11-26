import * as THREE from 'three'
import { ANCHOR_HEIGHT_M, ARCADE_BOOM_M, BASE_FOV_DEG, CAMERA_MODE, recorderModeAt, FOLIAGE_CLIP_ARCADE_M,
  FOLIAGE_CLIP_SCOPED_M, REVERSE_SAMPLE_OFFSET_SEC, aimDirectionScene, arcadeCameraPosition, backwardZoomScale,
  blendProgress, fovFromZoomRaw, isReversing, reticleRadiusPx, sampleRecorderCamera } from './cameraRig.js'
import type { CameraVec3, RecorderCameraFacet, RecorderCameraSample } from './cameraRig.js'
import { loadRecorderCameraFromFile } from '../replaySource.js'
import { foliageClip } from '../sceneryMaterials.js'
import type { RuntimeVehicle } from './vehicleRuntime.js'
import type { CameraRuntimeDeps } from './cameraRuntimeTypes.js'

export function createRecorderCamera(deps: CameraRuntimeDeps, hooks: {
  setCam: (mode: string) => void; prewarmArmorHighlight: (camera: THREE.PerspectiveCamera) => void
  releaseArmorHighlight: () => void; clearance: number; hiddenLayer: number
}) {
  const { store } = deps
  const { setCam, prewarmArmorHighlight } = hooks
  const CAMERA_GROUND_CLEARANCE = hooks.clearance, SCOPED_HIDDEN_LAYER = hooks.hiddenLayer
  const RETICLE_MIN_GUN_DISTANCE_M = 30
  let recorderCamera: RecorderCameraFacet | null = null
  const recorderSample: RecorderCameraSample = {} as RecorderCameraSample
  let recorderBoomScale = 1, scopedHiddenEid = 0
  let cameraBlend: { position: THREE.Vector3; quaternion: THREE.Quaternion; fov: number; elapsed: number } | null = null
  let fovRestore: { fov: number; elapsed: number } | null = null
  const recorderVehicle = () => deps.vehicles.vehicleByEid(deps.getData()?.meta?.author_eid ?? 0);
  function recorderOwnsCamera(v: RuntimeVehicle) {
    return !deps.deathAt(v, deps.getT()) && deps.deathTimesOf(v).every((death) => deps.getT() < death);
  }
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
    hooks.releaseArmorHighlight();
  }
  function setScopedLayer(v: RuntimeVehicle, hidden: boolean) {
    const layer = hidden ? SCOPED_HIDDEN_LAYER : 0;
    v.group.traverse((node) => { node.layers.set(layer); });
    v.glb?.traverse((node) => { node.layers.set(layer); });
    deps.syncContactShadow(v);
  }
  function applyCameraFov(fov: number) {
    const camera = deps.getCamera();
    if (Math.abs(camera.fov - fov) < 1e-3) return;
    camera.fov = fov;
    camera.updateProjectionMatrix();
    deps.invalidate();
  }
  function settleCameraTransition() {
    deps.requestWaterReflectionRefresh();
    deps.invalidate();
  }
  function stepFovRestore(dt: number) {
    fovRestore!.elapsed += dt;
    const progress = blendProgress(fovRestore!.elapsed);
    applyCameraFov(fovRestore!.fov + (BASE_FOV_DEG - fovRestore!.fov) * progress);
    if (progress >= 1) {
      fovRestore = null;
      settleCameraTransition();
    }
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
      deps.requestWaterReflectionRefresh();
      if (wasScoped && !scoped) hooks.releaseArmorHighlight();
      if (scoped && !wasScoped && deps.armorHighlightPref()) prewarmArmorHighlight(camera);
    } else if (scoped && v.glb && !v.glb.layers.isEnabled(SCOPED_HIDDEN_LAYER)) {
      setScopedLayer(v, true);
    }
    foliageClip.value = scoped ? FOLIAGE_CLIP_SCOPED_M : FOLIAGE_CLIP_ARCADE_M;
    let fov = BASE_FOV_DEG;
    if (scoped) {
      if (!deps.vehicles.glbGunWorld(v, _recorderPos, _recorderGunDir)) {
        v.gunPivot.updateWorldMatrix(true, false);
        v.gunPivot.getWorldPosition(_recorderPos);
      }
      fov = fovFromZoomRaw(sample.zoomRaw as number);
      recorderBoomScale = 1;
    } else {
      deps.vehicles.posAt(v, deps.getT(), _recorderAnchor);
      _recorderAnchor.y += ANCHOR_HEIGHT_M;
      if (recorderCamera.client_options.backward_zoom === true) {
        deps.vehicles.posAt(v, deps.getT() - REVERSE_SAMPLE_OFFSET_SEC, _recorderPrev);
        const reversing = isReversing(
          { x: -_recorderPrev.x, y: 0, z: _recorderPrev.z },
          { x: -_recorderAnchor.x, y: 0, z: _recorderAnchor.z },
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
      if (progress >= 1) {
        cameraBlend = null;
        settleCameraTransition();
      }
    }
    applyCameraFov(fov);
    controls.target.copy(camera.position).addScaledVector(_recorderLook, 30);
    if (!camera.position.equals(_recorderLastPos) || !camera.quaternion.equals(_recorderLastQuat) || camera.fov !== lastFov) {
      deps.invalidate();
    }
    updateRecorderReticle(sample, v);
  }
  function recorderAimPoint(sample: RecorderCameraSample, out: THREE.Vector3) {
    return out.set(-sample.rayX, sample.rayY, sample.rayZ);
  }
  function projectToStage(point: THREE.Vector3, out: CameraVec3, stage: { x: number; y: number }): CameraVec3 | null {
    point.project(deps.getCamera());
    if (![point.x, point.y, point.z].every((n) => Number.isFinite(n) && Math.abs(n) <= 1)) return null;
    out.x = (point.x + 1) * stage.x / 2;
    out.y = (1 - point.y) * stage.y / 2;
    return out;
  }
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
    const stage = deps.getViewportSize();
    const aim = projectToStage(_recorderRay, _reticleAim, stage);
    const gun = projectToStage(_recorderGun, _reticleGun, stage);
    if (!aim && !gun) { deps.recorderReticle.hide(); return; }
    deps.recorderReticle.update(aim, gun, reticleRadiusPx({
      bloomRaw: sample.bloomRaw, fovDeg: camera.fov, viewportH: stage.y,
    }));
  }
  return { recorderVehicle, recorderViewAvailable, loadRecorderCamera, enterRecorderView, leaveRecorderView,
    stepFovRestore, driveRecorderCamera, recorderAimPoint, recorderSample,
    scopedHiddenEid: () => scopedHiddenEid, cameraBlend: () => cameraBlend, fovRestore: () => fovRestore,
    recorderModeUnknown: () => !!recorderCamera && recorderModeAt(recorderCamera, deps.getT()) === CAMERA_MODE.UNKNOWN,
    reset: () => { recorderCamera = null } }
}
