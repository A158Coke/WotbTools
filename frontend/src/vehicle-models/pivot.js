/**
 * 车型图层旋转数学（admin preview 与未来 production VehicleMarker 共用）。
 *
 * 契约（docs/assets/tier-x-models/svg-generation-spec.md）：
 * - hull.webp 与 turret.webp（turreted）都是 Source-faithful 俯视资产：
 *   model +Y（车头/炮管 forward）→ 图片 top（0° = 12 点），hull 与 turret 同一 orientation；
 * - hull 绕画布中心（viewBox 中心，车辆几何中心 C）旋转 hullWorldDeg；
 * - turret 是「随 hull 移动的装配」：OFF_CENTER_TURRET_HULL_COMPOSITION 修复——
 *   P = metadata.turretPivot（viewBox 绝对坐标），H = hull world rotation；
 *   hull 旋转后炮塔座圈的屏幕位置 P' = C + rotate(P - C, H)，不是固定不动点；
 * - 最终 turret world yaw = authoritative turretWorldDeg（hull + 相对转角）。
 *
 * 实现用嵌套 transform（无 translate 平移近似，与旧单层 transform-origin 方案同构）：
 *   1) turret assembly 父层：rotate(hullWorldDeg) around C（与 hull 层同数学）——
 *      座圈随车体围绕 C 移动（P → P'）；
 *   2) turret image 子层：rotate(turretWorldDeg - hullWorldDeg) around image-local pivot
 *      （raster.pivotX/pivotY）——子层旋转抵消父层 hull 分量后，最终 world yaw = T。
 *
 * rotate 以 transform-origin 为不动点；img 与 320×320 viewBox 1:1 对齐
 * （局部坐标 == viewBox 坐标），origin 直接用 viewBox 像素值 × renderScale。
 */
import { VIEWBOX } from './types.js'

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
 * turret assembly 父层样式：随 hull 绕车辆中心旋转（与 hullLayerTransform 同一数学）。
 * 嵌套结构：父层负责把座圈从 P 移动到 P' = C + rotate(P - C, hullDeg)；
 * 子层（turretImageTransform）只负责图像自身旋转。
 * @param {{hullDeg:number, renderScale?:number}} p
 */
export function turretAssemblyTransform({ hullDeg, renderScale = 1 }) {
  return hullLayerTransform({ deg: hullDeg, renderScale })
}

/**
 * turret image 子层样式：绕 image-local pivot（raster.pivotX/pivotY）旋转
 * (turretWorldDeg - hullDeg)——父层已旋转 hullDeg，抵消后最终 world yaw = turretWorldDeg。
 * @param {{hullDeg:number, turretWorldDeg:number, pivot:{x:number,y:number}, renderScale?:number}} p
 */
export function turretImageTransform({ hullDeg, turretWorldDeg, pivot, renderScale = 1 }) {
  const s = renderScale
  return {
    transformOrigin: `${pivot.x * s}px ${pivot.y * s}px`,
    transform: `rotate(${turretWorldDeg - hullDeg}deg)`,
  }
}

/**
 * —— Battle Playback marker 专用（标记盒尺寸由 CSS 控制，28px/22px，无固定 renderScale）——
 * 所有定位/原点用百分比表达：left/top/width/height % 相对 marker 盒（containing block），
 * transform-origin % 相对子元素自身盒——与 320 logical viewBox 按比例换算，任意标记尺寸成立。
 */

/**
 * turret assembly 父层（marker 内）：绕 marker 盒中心旋转 hullWorldDeg。
 * transform-origin 默认 50% 50%（元素自身中心 = 盒中心 = 车辆中心契约）。
 * @param {{hullDeg:number}} p
 */
export function markerTurretAssemblyTransform({ hullDeg }) {
  return { transform: `rotate(${hullDeg}deg)` }
}

/**
 * turret image 子层（marker 内）：按 turretRaster（logical bounds + image-local pivot）
 * 百分比定位，绕 image-local pivot 旋转 (turretWorldDeg - hullDeg)——最终 world yaw = T。
 * @param {{hullDeg:number, turretWorldDeg:number, raster:object}} p raster = turretRaster
 */
export function markerTurretImageTransform({ hullDeg, turretWorldDeg, raster }) {
  const { logicalMinX, logicalMinY, pixelWidth, pixelHeight, pivotX, pivotY } = raster
  const pct = (v) => (v / VIEWBOX.width) * 100
  return {
    left: `${pct(logicalMinX).toFixed(4)}%`,
    top: `${pct(logicalMinY).toFixed(4)}%`,
    width: `${pct(pixelWidth / 2).toFixed(4)}%`,
    height: `${pct(pixelHeight / 2).toFixed(4)}%`,
    transformOrigin: `${pct(pivotX).toFixed(4)}% ${pct(pivotY).toFixed(4)}%`,
    transform: `rotate(${turretWorldDeg - hullDeg}deg)`,
  }
}

/**
 * hull 旋转后炮塔座圈的真实屏幕位置（viewBox 坐标；y 向下，rotate 正角 = 屏幕顺时针）。
 * P' = C + rotate(P - C, hullDeg)。非中心炮塔（Grille 15 等）必须用此值，
 * 禁止把 turretPivot 当作 hull rotation 后的固定 screen point。
 * @param {{pivot:{x:number,y:number}, hullDeg:number}} p
 */
export function turretRingPosition({ pivot, hullDeg }) {
  const rad = (hullDeg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const cx = VIEWBOX.width / 2
  const cy = VIEWBOX.height / 2
  const dx = pivot.x - cx
  const dy = pivot.y - cy
  return {
    x: cx + dx * cos - dy * sin,
    y: cy + dx * sin + dy * cos,
  }
}
