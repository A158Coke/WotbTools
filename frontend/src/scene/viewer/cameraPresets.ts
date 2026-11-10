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
 * 视角预设保证炮管指向镜头：机位放在炮轴线上（枢轴 + 炮线方向 × 距离），
 * 旋转中心 = 炮线枢轴，后续环绕即绕炮线检视。距离归用户（缩放层级不回跳，
 * 0x5f3759df 反馈）——不保留旧轨道中心：炮轴线穿过枢轴而非车体中心，
 * 沿旧中心摆位会让炮管指向镜头之外（2026-11-10 反馈）。
 * userDistance 非正数/非有限时退回预设摆位距离；direction 为零向量时
 * 退回完整预设姿态（target + preset position）。
 */
export function armorPresetPlacement(
  pose: { target: Vector3; position: Vector3 },
  userDistance: number,
) {
  const direction = pose.position.clone().sub(pose.target)
  if (direction.lengthSq() === 0) return pose
  const distance = Number.isFinite(userDistance) && userDistance > 0
    ? userDistance
    : direction.length()
  return {
    target: pose.target.clone(),
    position: pose.target.clone().addScaledVector(direction.normalize(), distance),
  }
}
