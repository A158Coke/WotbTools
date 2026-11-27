import { Matrix4, Vector3 } from 'three'

export function armorPresetGunPitch(kind: 'front' | 'hull_down', limits: { down: number; up: number }) {
  return kind === 'hull_down' ? limits.down : Math.min(limits.up, Math.max(limits.down, 0))
}

export function armorCameraPreset(gunPivot: Vector3, gunWorldMatrix: Matrix4, distance: number) {
  const target = gunPivot.clone().applyMatrix4(gunWorldMatrix)
  const direction = new Vector3(0, 1, 0).transformDirection(gunWorldMatrix)
  return { target, position: target.clone().addScaledVector(direction, distance) }
}

export function armorPresetViewPlacement(
  prevTarget: Vector3,
  prevCamera: Vector3,
  pose: { target: Vector3; position: Vector3 },
  maxDistance?: number,
) {
  const direction = pose.position.clone().sub(pose.target)
  if (direction.lengthSq() === 0) return pose
  direction.normalize()
  const offset = prevCamera.clone().sub(prevTarget)
  const distance = offset.length() > 0 ? offset.length() : pose.position.distanceTo(pose.target)

  const toCenter = prevTarget.clone().sub(pose.target)
  const proj = toCenter.dot(direction)
  const perp2 = Math.max(toCenter.lengthSq() - proj * proj, 0)
  const perp = Math.sqrt(perp2)
  const standOff = pose.position.distanceTo(pose.target)
  const maxD = Number.isFinite(maxDistance) && maxDistance! > 0 ? maxDistance! : Infinity

  const candidates: number[] = []
  if (distance >= perp) {
    const tExact = proj + Math.sqrt(distance * distance - perp2)
    if (tExact > 0 && distance <= maxD) candidates.push(tExact)
  }
  const tSafe = Math.max(proj, standOff)
  if (Math.hypot(tSafe - proj, perp) <= maxD) candidates.push(tSafe)
  if (perp <= maxD) {
    const tAtMax = proj + Math.sqrt(maxD * maxD - perp2)
    if (tAtMax > 0) candidates.push(tAtMax)
  }
  for (const t of candidates) {
    if (t > 0) {
      return {
        target: prevTarget.clone(),
        position: pose.target.clone().addScaledVector(direction, t),
      }
    }
  }
  return { target: prevTarget.clone(), position: prevCamera.clone() }
}
