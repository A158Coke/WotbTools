/**
 * 车型图层旋转数学（admin preview 与未来 production VehicleMarker 共用）。
 *
 * 契约（docs/assets/tier-x-models/svg-generation-spec.md）：
 * - hull.svg 与 turret.svg 都使用统一 viewBox（320×320），渲染时 img 与画布
 *   1:1 对齐（left:0 top:0，覆盖整个画布）→ img 局部坐标 == viewBox 坐标；
 * - hull 绕画布中心（viewBox 中心）旋转；
 * - turret 绕 metadata.turretPivot（viewBox 绝对坐标）旋转。
 *
 * 因此旋转中心直接用 transform-origin 的像素值表达（无需 translate 技巧）：
 *   transform-origin = pivot × renderScale（renderScale = 画布 CSS 尺寸 / viewBox 尺寸）
 *   transform = rotate(deg)
 * rotate 以 transform-origin 为不动点——0°/90°/180°/270° 下 pivot 屏幕位置不变。
 */
import { VIEWBOX } from './types.js'

/**
 * turret 层样式：绕 pivot（viewBox 坐标）旋转。
 * @param {{deg:number, pivot:{x:number,y:number}, renderScale?:number}} p
 */
export function pivotLayerTransform({ deg, pivot, renderScale = 1 }) {
  const s = renderScale
  return {
    transformOrigin: `${pivot.x * s}px ${pivot.y * s}px`,
    transform: `rotate(${deg}deg)`,
  }
}

/**
 * hull 层样式：绕画布中心（viewBox 中心）旋转。
 * @param {{deg:number, renderScale?:number}} p
 */
export function hullLayerTransform({ deg, renderScale = 1 }) {
  const cx = (VIEWBOX.width / 2) * renderScale
  const cy = (VIEWBOX.height / 2) * renderScale
  return {
    transformOrigin: `${cx}px ${cy}px`,
    transform: `rotate(${deg}deg)`,
  }
}

/**
 * 数学验证：以 origin 为不动点的 rotate(deg) 下，点 point 的像。
 * 返回旋转后的坐标（2D 仿射，角度制）。
 */
export function rotatePointAround({ point, origin, deg }) {
  const rad = (deg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const dx = point.x - origin.x
  const dy = point.y - origin.y
  return {
    x: origin.x + dx * cos - dy * sin,
    y: origin.y + dx * sin + dy * cos,
  }
}
