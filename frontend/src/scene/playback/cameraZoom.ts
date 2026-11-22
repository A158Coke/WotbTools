import * as THREE from 'three'
import type { CameraRuntimeDeps } from './cameraRuntimeTypes.js'
import type { createZoomSmoother, createFlyZoomSmoother } from './zoomSmoothing.js'
export function createCameraZoom(deps: CameraRuntimeDeps, hooks: {
  flyLook: { pitch: number; yaw: number }; flyMode: () => boolean; markManual: () => void; constrainFreeCameraAltitude: () => boolean
  zoomSmoother: ReturnType<typeof createZoomSmoother>; flyZoomSmoother: ReturnType<typeof createFlyZoomSmoother>
}) {
  const { flyLook, flyMode, zoomSmoother, flyZoomSmoother, constrainFreeCameraAltitude } = hooks
  /** 沿当前视线推拉相机（OrbitControls 的 dolly 语义 = 滚轮/捏合缩放）：相机与 target
   *  同步平移，视角与视距保持不变。step > 0 前进（推近），step < 0 后退（拉远）。
   *  只改 flyLook.dist 而相机不动是没有画面变化的（用户实测「滚轮没有缩放」）。 */
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
  return { zoomTick, flyDolly }
}
