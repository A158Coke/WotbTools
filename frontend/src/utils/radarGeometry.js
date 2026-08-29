/**
 * Radar 几何纯函数：组件（PlayerRatingRadar）与导出卡（exportRatingProfilePng）共用，
 * 保证数据模型/维度顺序/归一化/几何完全同构，避免导出截图整 Drawer。
 * 只负责坐标计算，不含业务公式与 SVG 标签。
 */
import {
  RADAR_AVERAGE_VALUE,
  RADAR_DISPLAY_CAP,
  RADAR_STRONG_VALUE,
} from './radarScale.js'

/** 几何常量（为短标签留 breathing room；导出与组件共用）。 */
export const RADAR = Object.freeze({
  VIEW: 340,
  CENTER: 170,
  RADIUS: 120,
  LABEL_RADIUS: 1.16,
  SCORE_BADGE_HEIGHT: 17,
  SCORE_BADGE_RADIUS: 4,
  SCORE_BADGE_MIN_RATIO: 0.25,
  SCORE_BADGE_LOW_TOP_RATIO: 0.4,
  SCORE_BADGE_TOP_SHIFT_X: 22,
  /** 150 仅是不可见坐标上限；可见网格不包含 75 reference 或 150 outer boundary。 */
  AVERAGE_VALUE: RADAR_AVERAGE_VALUE,
  STRONG_VALUE: RADAR_STRONG_VALUE,
  DISPLAY_CAP: RADAR_DISPLAY_CAP,
  GRID_VALUES: [25, 50, RADAR_STRONG_VALUE],
  SCALE_VALUES: [25, 50, RADAR_AVERAGE_VALUE, RADAR_STRONG_VALUE],
})

export function radarValueRatio(value, g = RADAR) {
  return Number(value) / g.DISPLAY_CAP
}

export function radarGridPolygons(count, g = RADAR) {
  return g.GRID_VALUES.map(value => ({
    value,
    ratio: radarValueRatio(value, g),
    points: gridPolygonPoints(count, radarValueRatio(value, g), g),
  }))
}

export function radarScaleTicks(count, g = RADAR) {
  return g.SCALE_VALUES.map(value => ({
    value,
    ratio: radarValueRatio(value, g),
    p: scaleTickPosition(count, radarValueRatio(value, g), g),
  }))
}

/**
 * Score badge position follows the selected visual: top/bottom vertices use the
 * free vertical margin, while side vertices move inward away from axis labels.
 */
export function radarScoreLabelPosition(index, count, ratio, g = RADAR) {
  const numeric = Number(ratio)
  const safeRatio = Number.isFinite(numeric) ? Math.min(1, Math.max(0, numeric)) : 0
  const vertical = Math.abs(Math.sin(axisAngle(index, count))) >= 0.8
  const offset = 12 / g.RADIUS
  let labelRatio = vertical
    ? Math.min(1.06, safeRatio + offset)
    : safeRatio - offset
  labelRatio = Math.max(g.SCORE_BADGE_MIN_RATIO, labelRatio)
  const isTop = index === 0
  if (isTop && safeRatio < g.SCORE_BADGE_MIN_RATIO) {
    labelRatio = Math.max(labelRatio, g.SCORE_BADGE_LOW_TOP_RATIO)
  }
  const point = axisPoint(index, count, labelRatio, g)
  const topNeedsTickClearance = isTop
    && safeRatio <= radarValueRatio(g.STRONG_VALUE, g) + offset
  const x = point[0] + (topNeedsTickClearance ? g.SCORE_BADGE_TOP_SHIFT_X : 0)
  const y = point[1]
  return { x, y, ratio: labelRatio }
}

export function radarScoreBadgeWidth(value) {
  return Math.max(18, 8 + String(value ?? '--').length * 6)
}

/** 第 i 个轴的角度（从 12 点方向顺时针）。 */
function axisAngle(i, count) {
  return (Math.PI * 2 * i) / Math.max(count, 1) - Math.PI / 2
}

/** 第 i 个轴 ratio 处的坐标 [x, y]。 */
export function axisPoint(i, count, ratio, g = RADAR) {
  const r = g.RADIUS * ratio
  const a = axisAngle(i, count)
  return [g.CENTER + r * Math.cos(a), g.CENTER + r * Math.sin(a)]
}

/** 把归一化值数组转成 SVG polygon points 字符串（null/undefined 用 callers 过滤）。 */
export function polygonPoints(values, count, g = RADAR) {
  return values
    .map((ratio, i) => ({ i, ratio }))
    .filter(p => ratioIsFinite(p.ratio))
    .map(p => axisPoint(p.i, count, p.ratio, g).join(','))
    .join(' ')
}

function ratioIsFinite(v) {
  return v != null && Number.isFinite(Number(v))
}

/** 某归一化网格层的 polygon points（全部轴）。 */
function gridPolygonPoints(count, ratio, g = RADAR) {
  return Array.from({ length: count }, (_, i) => axisPoint(i, count, ratio, g).join(',')).join(' ')
}

/** 第 i 个轴的半径端点（用于画轴线）。 */
export function axisRay(i, count, g = RADAR) {
  return {
    x: axisPoint(i, count, 1, g)[0],
    y: axisPoint(i, count, 1, g)[1],
  }
}

/** 单侧刻度标签位置：从 12 点方向（第一个轴）向外延伸，避让轴线。 */
function scaleTickPosition(count, ratio, g = RADAR) {
  //
  const r = g.RADIUS * ratio
  const a = axisAngle(0, count)
  const x = g.CENTER + (r + 8) * Math.cos(a)
  const y = g.CENTER + (r + 8) * Math.sin(a)
  return { x, y }
}
