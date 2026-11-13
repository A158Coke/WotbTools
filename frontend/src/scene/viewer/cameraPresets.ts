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
 * 视角预设只接管观察方向：旋转中心（轨道 target）保持默认/用户当前值，**不得移动**
 * （2026-11-13 反馈：把中心挪到炮线枢轴会改变环绕语义，用户不要）；距离同样归用户
 * （缩放层级不回跳，0x5f3759df 反馈）。机位 = 旧中心 + 预设观察方向 × 用户距离。
 * 用户偏移为零向量时距离退回预设摆位距离；预设方向为零向量时退回完整预设姿态。
 */
export function armorPresetViewPlacement(
  prevTarget: Vector3,
  prevCamera: Vector3,
  pose: { target: Vector3; position: Vector3 },
) {
  const direction = pose.position.clone().sub(pose.target)
  if (direction.lengthSq() === 0) return pose
  const offset = prevCamera.clone().sub(prevTarget)
  const distance = offset.length() > 0 ? offset.length() : direction.length()
  return {
    target: prevTarget.clone(),
    position: prevTarget.clone().addScaledVector(direction.normalize(), distance),
  }
}
