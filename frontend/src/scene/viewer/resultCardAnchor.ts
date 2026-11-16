import * as THREE from 'three'

/**
 * 结果卡世界锚点 → 画布容器坐标（纯几何，无 DOM、无统计判断）。
 *
 * 2026-11-16 用户裁示：射击结果卡要保持在命中位置附近，旋转视角时随命中点移动，
 * 不能再固定在点击时的屏幕坐标或顶部停靠。调用方每帧用渲染后的相机矩阵调用本函数，
 * 把世界命中点投到 #canvas-container 坐标系，再交给 chooseResultCardPosition 避让 HUD。
 *
 * 相机看向 -Z；view.z >= -near 表示锚点已在相机后方/近平面内，透视投影会镜像或退化，
 * 此时 inFront=false，调用方应隐藏卡片（没有可“靠近”的屏幕位置，不伪造一个）。
 * 视口尺寸非法或坐标非有限值时返回 null（fail-closed）。
 */
export interface ProjectedCardAnchor {
  /** 画布容器坐标系（0..viewportWidth / 0..viewportHeight），不是 client 坐标。 */
  x: number
  y: number
  /** false = 锚点在相机后方/近平面内，投影不可解释。 */
  inFront: boolean
}

export function projectCardAnchor(
  anchor: THREE.Vector3,
  camera: THREE.Camera,
  viewportWidth: number,
  viewportHeight: number,
): ProjectedCardAnchor | null {
  if (!(viewportWidth > 0) || !(viewportHeight > 0)) return null
  if (!Number.isFinite(anchor.x) || !Number.isFinite(anchor.y) || !Number.isFinite(anchor.z)) return null
  // 相机矩阵必须已由渲染循环更新；用 view 空间判前后，避免 behind-camera 的镜像 NDC。
  const view = anchor.clone().applyMatrix4(camera.matrixWorldInverse)
  const near = (camera as THREE.PerspectiveCamera).near
  const nearPlane = Number.isFinite(near) && near > 0 ? near : 0.1
  const inFront = view.z < -nearPlane
  const ndc = anchor.clone().project(camera)
  if (!Number.isFinite(ndc.x) || !Number.isFinite(ndc.y)) return null
  return {
    x: (ndc.x * 0.5 + 0.5) * viewportWidth,
    y: (-ndc.y * 0.5 + 0.5) * viewportHeight,
    inFront,
  }
}
