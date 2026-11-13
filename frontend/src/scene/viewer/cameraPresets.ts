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
 * 视角预设同时满足两个约束（2026-11-13 反馈定稿）：
 * 1. 旋转中心（轨道 target）保持默认/用户当前值，**不得移动**；
 * 2. 炮管仍指向镜头：机位放到炮轴线（枢轴 + 炮线方向 × t）上，且距中心 = 用户距离
 *    （缩放层级不回跳，0x5f3759df 反馈）——解 |pivot + t·dir − center| = distance 取正根。
 * 距中心不可达（炮轴与中心距离 > 用户距离）时取炮轴上距中心最近点（指向优先于距离）；
 * 炮线方向为零向量、或正向炮轴上无解（交点在枢轴后方）时退回完整预设姿态。
 */
export function armorPresetViewPlacement(
  prevTarget: Vector3,
  prevCamera: Vector3,
  pose: { target: Vector3; position: Vector3 },
) {
  const direction = pose.position.clone().sub(pose.target)
  if (direction.lengthSq() === 0) return pose
  direction.normalize()
  const offset = prevCamera.clone().sub(prevTarget)
  const distance = offset.length() > 0 ? offset.length() : pose.position.distanceTo(pose.target)
  const toCenter = prevTarget.clone().sub(pose.target)
  const proj = toCenter.dot(direction)
  const disc = proj * proj - toCenter.lengthSq() + distance * distance
  let t: number
  if (disc < 0) {
    // 炮轴上距中心最近的点（垂足）：炮管指向镜头优先，用户距离让位。
    t = Math.max(proj, 0)
    if (t === 0) return pose // 垂足在枢轴上/后方且再无正向点：唯一保指向的姿态是完整预设
  } else {
    t = proj + Math.sqrt(disc)
    if (t <= 0) return pose // 交点都在枢轴后方：同上
  }
  return {
    target: prevTarget.clone(),
    position: pose.target.clone().addScaledVector(direction, t),
  }
}
