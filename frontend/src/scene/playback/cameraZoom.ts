import * as THREE from 'three'
import type { CameraRuntimeDeps } from './cameraRuntimeTypes.js'
import type { createZoomSmoother, createFlyZoomSmoother } from './zoomSmoothing.js'
export function createCameraZoom(deps: CameraRuntimeDeps, hooks: {
  flyLook: { pitch: number; yaw: number }; flyMode: () => boolean; markManual: () => void; constrainFreeCameraAltitude: () => boolean
  zoomSmoother: ReturnType<typeof createZoomSmoother>; flyZoomSmoother: ReturnType<typeof createFlyZoomSmoother>
}) {
  const { flyLook, flyMode, zoomSmoother, flyZoomSmoother, constrainFreeCameraAltitude } = hooks
  function flyDolly(step: number) {
    if (!step) return;
    const camera = deps.getCamera();
    const controls = deps.getControls();
    hooks.markManual();
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
  const _zoomDir = new THREE.Vector3();
  function zoomTick(dt: number) {
    const camera = deps.getCamera();
    const controls = deps.getControls();
    if (!deps.getRenderer()) return;
    if (flyMode()) {
      if (!flyZoomSmoother.active()) return;
      const step = flyZoomSmoother.advance(dt);
      flyDolly(step);
      if (step !== 0 && !flyZoomSmoother.active()) deps.requestWaterReflectionRefresh();
    } else {
      if (!zoomSmoother.active()) return;
      const f = zoomSmoother.advance(dt);
      if (f === 1) return;
      let changed = false;
      if (controls && controls.enabled) {
        const off = _zoomDir.subVectors(camera.position, controls.target);
        const len = off.length();
        if (len > 1e-6) {
          const next = Math.min(controls.maxDistance, Math.max(controls.minDistance, len * f));
          camera.position.copy(controls.target).addScaledVector(off.divideScalar(len), next);
          camera.lookAt(controls.target);
          changed = true;
        }
      }
      if (changed && !zoomSmoother.active()) deps.requestWaterReflectionRefresh();
    }
    deps.invalidate();
  }
  return { zoomTick, flyDolly }
}
