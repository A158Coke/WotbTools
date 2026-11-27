import {
  RADAR_AVERAGE_VALUE,
  RADAR_DISPLAY_CAP,
  RADAR_STRONG_VALUE,
} from './radarScale.js'

export const RADAR = Object.freeze({
  VIEW: 340,
  CENTER: 170,
  RADIUS: 120,
  LABEL_RADIUS: 1.22,
  SCORE_BADGE_HEIGHT: 17,
  SCORE_BADGE_RADIUS: 4,
  SCORE_BADGE_MIN_RATIO: 0.25,
  SCORE_BADGE_LOW_TOP_RATIO: 0.4,
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

export function radarScoreLabelPosition(index, count, ratio, g = RADAR) {
  const numeric = Number(ratio)
  const safeRatio = Number.isFinite(numeric) ? Math.min(1, Math.max(0, numeric)) : 0
  const isTop = index === 0
  const vertical = Math.abs(Math.sin(axisAngle(index, count))) >= 0.8
  const offset = 12 / g.RADIUS
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

function axisAngle(i, count) {
  return (Math.PI * 2 * i) / Math.max(count, 1) - Math.PI / 2
}

export function axisPoint(i, count, ratio, g = RADAR) {
  const r = g.RADIUS * ratio
  const a = axisAngle(i, count)
  return [g.CENTER + r * Math.cos(a), g.CENTER + r * Math.sin(a)]
}

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

function gridPolygonPoints(count, ratio, g = RADAR) {
  return Array.from({ length: count }, (_, i) => axisPoint(i, count, ratio, g).join(',')).join(' ')
}

export function axisRay(i, count, g = RADAR) {
  return {
    x: axisPoint(i, count, 1, g)[0],
    y: axisPoint(i, count, 1, g)[1],
  }
}

function scaleTickPosition(count, ratio, g = RADAR) {
  const r = g.RADIUS * ratio
  const a = axisAngle(0, count)
  const x = g.CENTER + (r + 8) * Math.cos(a)
  const y = g.CENTER + (r + 8) * Math.sin(a)
  return { x, y }
}
