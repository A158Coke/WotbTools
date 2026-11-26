import * as THREE from 'three'
import type { RuntimeVehicle } from './vehicleRuntime.js'

export const FOLLOW_MODEL_CLEARANCE_M = 1

export const FOLLOW_FALLBACK_RADIUS_M = Math.hypot(3.6 / 2, 6.5 / 2)

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

export function followCameraMinDistance(v: RuntimeVehicle | null | undefined): number {
  return followModelRadius(v) + FOLLOW_MODEL_CLEARANCE_M
}
