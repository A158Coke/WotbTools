import { Matrix4, Vector3 } from 'three'

/** 控件使用模型局部炮管角度；不能把它直接当世界相机角度。 */
export function armorPresetGunPitch(kind: 'front' | 'hull_down', limits: { down: number; up: number }) {
  return kind === 'hull_down' ? limits.down : Math.min(limits.up, Math.max(limits.down, 0))
}

/** 复用已应用的完整炮管姿态，包含初始炮塔旋转、枢轴平移及模型到世界变换。 */
export function armorCameraPreset(gunPivot: Vector3, gunWorldMatrix: Matrix4, distance: number) {
  const target = gunPivot.clone().applyMatrix4(gunWorldMatrix)
  // GLB 炮管前向是 +Y；相机放在炮口前方，朝炮管枢轴取景。
  const direction = new Vector3(0, 1, 0).transformDirection(gunWorldMatrix)
  return { target, position: target.clone().addScaledVector(direction, distance) }
}

/**
 * 视角预设同时满足两个约束（2026-11-13 反馈定稿 + review 修正）：
 * 1. 旋转中心（轨道 target）保持默认/用户当前值，**任何回退都不得移动**；
 * 2. 炮管指向镜头：机位放在炮轴线（枢轴 + 炮线方向 × t，t > 0）上。
 * 距离是尽力而为：优先精确等于用户距离（缩放层级不回跳），不可达时取垂足站位
 * （指向优先于距离），且站位受 OrbitControls `maxDistance` 约束——超出上限的机位
 * 会被 `controls.update()` 沿中心方向拉回，反而破坏指向，因此一并纳入选址。
 *
 * 炮轴上到中心的距离 d(t)² = (t − proj)² + perp²（proj = toCenter·dir，perp = 垂距）。
 * 站位优先级：①精确用户距离（t_D = proj + √(D² − perp²)，需 D ≥ perp、t_D > 0、
 * D ≤ maxDistance）②垂足/安全站位（t = max(proj, standOff)，防机位贴炮尾；指向优先，
 * 距离让位）③距离上限内的最大炮轴站位（t = proj + √(maxDistance² − perp²)）。
 * 全部不可用（炮轴整体在 maxDistance 之外/正向无解）→ 保持用户当前取景不动
 * （中心契约 + 当前视图保住，指向性降级——此时炮管姿态仍按预设改变）。
 */
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
  const standOff = pose.position.distanceTo(pose.target) // 预设摆位距离（15m）
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
  // 炮轴上无合规站位：保持用户当前取景（中心不动；枪姿态已按预设改变，指向性降级）。
  return { target: prevTarget.clone(), position: prevCamera.clone() }
}
