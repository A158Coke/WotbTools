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
  const boxPct = (v) => (v / VIEWBOX.width) * 100
  const imgW = pixelWidth / 2
  const imgH = pixelHeight / 2
  const originPct = (v, size) => (size > 0 ? (v / size) * 100 : 0)
  return {
    left: `${boxPct(logicalMinX).toFixed(4)}%`,
    top: `${boxPct(logicalMinY).toFixed(4)}%`,
    width: `${boxPct(imgW).toFixed(4)}%`,
    height: `${boxPct(imgH).toFixed(4)}%`,
    transformOrigin: `${originPct(pivotX, imgW).toFixed(4)}% ${originPct(pivotY, imgH).toFixed(4)}%`,
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
