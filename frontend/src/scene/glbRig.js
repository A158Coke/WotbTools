// GLB 装配共享 rig（架构债文档第 3 节）：装甲查看器（tankViewer.js）与全场回放
// （playbackScene.js）此前各自维护逐字相同的实现——抽共享后姿态语义单点定义。
//
// 坐标契约（两场景一致，勿单侧改动）：
// - 游戏系 → 场景系 = x 取负、yaw 取负（镜像）；GLB 根 = poseFromYPR(−yaw, pitch, 0)；
// - qFrame = Ry(π)·Rx(−π/2) 的 z-up→y-up 帧变换（GLB 内部系 x右/y前/z上）；
// - 炮塔绕 models.pb 原点链枢轴 Rz(−rel) 旋转、炮管 Rx(俯仰)，见各自 poseGlb /
//   poseShooterTurretGun（消费方还带 bake 捕获与炮盾随动，留在场景侧）。
import * as THREE from 'three'

/** GLB 根节点四元数：yaw/pitch/roll（场景系）× z-up→y-up 帧变换 */
export function poseFromYPR(yaw, pitch, roll) {
  const qYpi = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI)
  const qFrame = qYpi.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2))
  const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw || 0)
  const qPitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitch || 0)
  const qRoll = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), roll || 0)
  return qYaw.multiply(qPitch).multiply(qRoll).multiply(qFrame)
}
