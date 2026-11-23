// 跟随相机的最近距离：以目标模型（优先 GLB，低模回退）的水平包围半径为准，
// 再给模型外表面留 1 m 净空。纯几何，不持有相机状态，也不逐帧执行。
import * as THREE from 'three'
import type { RuntimeVehicle } from './vehicleRuntime.js'

/** 跟随时相机与模型外表面之间保留的最小距离（米）。 */
export const FOLLOW_MODEL_CLEARANCE_M = 1

/** 低模履带盒 3.6 × 6.5 的外接半径；模型尚未加载/不可量时使用。 */
export const FOLLOW_FALLBACK_RADIUS_M = Math.hypot(3.6 / 2, 6.5 / 2)

/** 目标模型相对车体位姿原点的水平包围半径（米）。 */
export function followModelRadius(v: RuntimeVehicle | null | undefined): number {
  if (!v) return FOLLOW_FALLBACK_RADIUS_M
  const box = new THREE.Box3().setFromObject(v.glb ?? v.group)
  if (box.isEmpty()) return FOLLOW_FALLBACK_RADIUS_M
  const origin = v.group.position
  const dx = Math.max(Math.abs(box.min.x - origin.x), Math.abs(box.max.x - origin.x))
  const dz = Math.max(Math.abs(box.min.z - origin.z), Math.abs(box.max.z - origin.z))
  const radius = Math.hypot(dx, dz)
  return Number.isFinite(radius) && radius > 0 ? radius : FOLLOW_FALLBACK_RADIUS_M
}

/** OrbitControls.minDistance：模型外表面 1 m，而不是固定 20 m 的战术总览下限。 */
export function followCameraMinDistance(v: RuntimeVehicle | null | undefined): number {
  return followModelRadius(v) + FOLLOW_MODEL_CLEARANCE_M
}
