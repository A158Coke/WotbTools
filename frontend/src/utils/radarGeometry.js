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
  /** Keep axis names outside capped top badges while staying inside the 340px viewBox. */
  LABEL_RADIUS: 1.22,
  SCORE_BADGE_HEIGHT: 17,
  SCORE_BADGE_RADIUS: 4,
  SCORE_BADGE_MIN_RATIO: 0.25,
  SCORE_BADGE_LOW_TOP_RATIO: 0.4,
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
  const isTop = index === 0
  const vertical = Math.abs(Math.sin(axisAngle(index, count))) >= 0.8
  const offset = 12 / g.RADIUS
  // The top badge can use the viewBox headroom. Other near-vertical badges stop
  // just inside the data cap so their axis names retain a readable gap.
  const verticalCap = isTop ? 1.06 : 0.98
  let labelRatio = vertical
    ? Math.min(verticalCap, safeRatio + offset)
    : safeRatio - offset
  labelRatio = Math.max(g.SCORE_BADGE_MIN_RATIO, labelRatio)
  if (isTop && safeRatio < g.SCORE_BADGE_MIN_RATIO) {
    labelRatio = Math.max(labelRatio, g.SCORE_BADGE_LOW_TOP_RATIO)
  }
  const point = axisPoint(index, count, labelRatio, g)
  return { x: point[0], y: point[1], ratio: labelRatio }
}

export function radarScoreBadgeWidth(value) {
  return Math.max(18, 8 + String(value ?? '--').length * 6)
}

/**
 * Resolve score-badge positions as one layout so the top badge can dodge both
 * the single-side scale ticks and its two neighboring score badges.
 */
export function radarScoreLabelLayout(ratios = [], values = [], g = RADAR) {
  const count = ratios.length
  const layout = ratios.map((ratio, index) => {
    if (!ratioIsFinite(ratio)) return null
    const value = String(values[index] ?? '--')
    return {
      ...radarScoreLabelPosition(index, count, ratio, g),
      value,
      width: radarScoreBadgeWidth(value),
    }
  })
  const top = layout[0]
  if (!top) return layout

  const tickRects = radarScaleTicks(count, g).map(tick => scaleTickRect(tick))
  const obstacles = [
    ...layout.slice(1).filter(Boolean).map(item => scoreBadgeRect(item, g)),
    ...tickRects,
  ]
  const collides = rect => obstacles.some(obstacle => rectanglesOverlap(rect, obstacle))
  if (!collides(scoreBadgeRect(top, g))) return layout

  const tickWidth = Math.max(...tickRects.map(rect => rect.right - rect.left), 0)
  const sideShift = top.width / 2 + tickWidth / 2 + 2
  for (const yShift of [0, -g.SCORE_BADGE_HEIGHT, g.SCORE_BADGE_HEIGHT,
    -2 * g.SCORE_BADGE_HEIGHT, 2 * g.SCORE_BADGE_HEIGHT]) {
    for (const direction of [1, -1]) {
      const candidate = { ...top, x: top.x + direction * sideShift, y: top.y + yShift }
      const rect = scoreBadgeRect(candidate, g)
      const insideView = rect.left >= 0 && rect.right <= g.VIEW && rect.top >= 0 && rect.bottom <= g.VIEW
      if (insideView && !collides(rect)) {
        layout[0] = candidate
        return layout
      }
    }
  }
  return layout
}

function scoreBadgeRect(item, g) {
  return {
    left: item.x - item.width / 2,
    right: item.x + item.width / 2,
    top: item.y - g.SCORE_BADGE_HEIGHT / 2,
    bottom: item.y + g.SCORE_BADGE_HEIGHT / 2,
  }
}

function scaleTickWidth(value) {
  return Math.max(9, String(value).length * 6)
}

function scaleTickRect(tick) {
  const width = scaleTickWidth(tick.value)
  return {
    left: tick.p.x - width / 2,
    right: tick.p.x + width / 2,
    top: tick.p.y - 4.5,
    bottom: tick.p.y + 4.5,
  }
}

function rectanglesOverlap(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
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
  const r = g.RADIUS * ratio
  const a = axisAngle(0, count)
  const x = g.CENTER + (r + 8) * Math.cos(a)
  const y = g.CENTER + (r + 8) * Math.sin(a)
  return { x, y }
}
