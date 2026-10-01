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

/** 老式车材质（无 metallicRoughness 贴图）的金属度归零。
 *
 * glTF 的 `pbrMetallicRoughness` 省略 `metallicFactor` 时默认值是 **1.0**（全金属），
 * 而老式车材质（`*_mtr`，如 T-34/M4 Sherman）只有 baseColor + normal、没有
 * metallicRoughness 贴图，于是 three.js 照默认值把它当抛光金属渲染。本查看器没有
 * 环境贴图（无 `scene.environment`）：金属拿不到任何环境反射，漫反射又被
 * `diffuseColor * (1 − metalness)` 归零，环境光与半球光对它**恒等于零**，
 * 整车只剩聚光灯的宽高光 → 发黑（实测 T-34 平均亮度 17.8/255，低于背景 21.4，
 * 即黑过背景；仅把金属度归零即回到 119.2，与 PBR 车 E-100 的 116.0 齐平；
 * 单独改粗糙度无效，只到 23.7）。
 *
 * 判据与 BlitzKit `useModel` 的 `hasPbr`（任一材质有 roughnessMap）同源：无
 * metallicRoughness 贴图即非 PBR。只动「无贴图且仍为默认 1」的材质——显式声明过
 * 金属度的材质不受影响。
 */
export function neutralizeDefaultMetalness(root) {
  root.traverse((node) => {
    if (!node.isMesh) return
    const material = node.material
    if (material && !material.metalnessMap && material.metalness === 1) material.metalness = 0
  })
}
