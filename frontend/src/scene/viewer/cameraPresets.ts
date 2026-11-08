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
 * 视角预设只接管观察方向：旋转中心（轨道 target）与距离归用户所有。
 * 用户平移/缩放后点击「正面 / 压坡卖头」，取景不回跳到炮线枢轴。
 * direction 为零向量时退回完整预设姿态（target + preset position）。
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
