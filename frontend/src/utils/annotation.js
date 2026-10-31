/**
 * 战局回放地图标注（Battle Playback Annotation）纯工具：
 * 色板/线宽常量、屏幕→语义坐标换算、橡皮擦点擦、快照式 undo/redo。
 * 全部为纯函数，供 BattlePlayback.vue 与单测使用。
 *
 * 标注对象契约（几何一律存语义坐标 x=回放 x，y=回放 z，渲染时经 createMapView 的 toX/toY 换算）：
 * - pen:    { type:'pen',    color, width, points:[{x,y},...] }（自由笔迹，多段）
 * - arrow:  { type:'arrow',  color, width, x1,y1,x2,y2 }
 * - line:   { type:'line',   color, width, x1,y1,x2,y2 }
 * - rect:   { type:'rect',   color, width, x, y, w, h }
 * - circle: { type:'circle', color, width, cx, cy, r }
 * - text:   { type:'text',   color, x, y, text }
 * - unit:   { type:'unit', color, x, y, tankClass:'LT'|'MT'|'HT'|'TD', radius, label }
 * - route:  { type:'route', color, width, points:[{x,y},...], label }
 */

/** 标注颜色固定色板（含纯黑，供亮色地图与标注对比）。 */
export const ANNOT_COLORS = [
  '#ff4d4f', '#ffd166', '#ffffff', '#000000',
  '#40c4ff', '#69f0ae', '#ff7eb6', '#ff9f43', '#9c88ff'
]

// The palette and actual vehicles share one game-domain symbol definition.
export { TANK_CLASS_ICONS as ANNOT_TANK_CLASSES } from './tankClassIcon.js'

/** 粗细滑块范围与默认值（SVG 单位，随地图缩放）。 */
export const ANNOT_WIDTH_MIN = 1
export const ANNOT_WIDTH_MAX = 12
export const ANNOT_WIDTH_DEFAULT = 3

/** 3D 橡皮擦 visual radius（CSS/logical px；pen width 与 eraser radius 分离）。 */
export const ANNOT_ERASER_RADIUS_MIN = 6
export const ANNOT_ERASER_RADIUS_MAX = 40
export const ANNOT_ERASER_RADIUS_DEFAULT = 16

/**
 * Toolbar logical width → canonical map-space semantic width.
 * 2D 调用：semanticSpan = renderBounds.xMax−xMin，logicalSpan = mapView.W；
 * 3D 调用：semanticSpan = map coordinateBounds span，logicalSpan = mapImages[key].width。
 * 不读取 camera / viewport scale；span 不可用时 1:1 回退，保持有限且稳定。
 */
export function semanticWidthFromSlider(sliderValue, { semanticSpan, logicalSpan } = {}) {
  const value = Number(sliderValue)
  if (!Number.isFinite(value) || value <= 0) return 0
  const semantic = Number(semanticSpan)
  const logical = Number(logicalSpan)
  if (!Number.isFinite(semantic) || semantic <= 0 || !Number.isFinite(logical) || logical <= 0) return value
  return value * (semantic / logical)
}

/** 文字标注字号（SVG 单位，随地图缩放）。 */
export const ANNOT_FONT_SIZE = 20

/** undo/redo 快照上限（步）。 */
export const UNDO_LIMIT = 100

/**
 * 解析 CSS 渲染尺寸：真实未缩放地图布局尺寸（.pb-map clientWidth/clientHeight）缺失（≤0，
 * 如测试无布局）时按 1:1 回退到 viewBox 尺寸。
 * 背景：.pb-map 宽度为容器 66.7%（移动端 100%），CSS 渲染尺寸 ≠ viewBox W/H，
 * 1 CSS px ≠ 1 SVG viewBox unit——屏幕↔语义换算必须带渲染尺寸比例，禁止把 CSS px 当 SVG unit。
 */
function renderedSize(mapView, renderedW, renderedH) {
  return {
    rw: Number.isFinite(renderedW) && renderedW > 0 ? renderedW : mapView.W,
    rh: Number.isFinite(renderedH) && renderedH > 0 ? renderedH : mapView.H
  }
}

/**
 * 屏幕坐标（相对地图容器的 CSS px，见 BattlePlayback.screenPoint 契约）→ SVG viewBox 坐标。
 * 链：screen CSS px → 撤销 viewport translate/scale → 未缩放地图 CSS px → ×(viewBox/渲染尺寸) → SVG unit。
 * view = { scale, tx, ty }（单位 CSS px）；mapView 来自 createMapView（W/H = viewBox 尺寸）。
 */
export function screenToSvg(view, mapView, screenX, screenY, renderedW, renderedH) {
  if (!view || !mapView || !Number.isFinite(screenX) || !Number.isFinite(screenY)) return null
  const scale = Number.isFinite(view.scale) && view.scale > 0 ? view.scale : 1
  const tx = Number.isFinite(view.tx) ? view.tx : 0
  const ty = Number.isFinite(view.ty) ? view.ty : 0
  const { rw, rh } = renderedSize(mapView, renderedW, renderedH)
  return {
    x: ((screenX - tx) / scale) * (mapView.W / rw),
    y: ((screenY - ty) / scale) * (mapView.H / rh)
  }
}

/** SVG viewBox 坐标 → 屏幕坐标（相对地图容器的 CSS px）；与 screenToSvg 互逆（svgToScreen(screenToSvg(p)) ≈ p）。 */
export function svgToScreen(mapView, view, svgX, svgY, renderedW, renderedH) {
  if (!mapView || !view || !Number.isFinite(svgX) || !Number.isFinite(svgY)) return null
  const scale = Number.isFinite(view.scale) && view.scale > 0 ? view.scale : 1
  const tx = Number.isFinite(view.tx) ? view.tx : 0
  const ty = Number.isFinite(view.ty) ? view.ty : 0
  const { rw, rh } = renderedSize(mapView, renderedW, renderedH)
  return {
    x: (svgX / mapView.W) * rw * scale + tx,
    y: (svgY / mapView.H) * rh * scale + ty
  }
}

/**
 * 屏幕坐标（相对地图容器的 CSS px）→ 语义坐标（x=回放 x，y=回放 z）。
 * 完整链：CSS px → 撤销 viewport 变换 → CSS px→SVG unit 比例 → fromX/fromY。换算失败返回 null。
 */
export function screenToSemantic(view, mapView, screenX, screenY, renderedW, renderedH) {
  if (!view || !mapView || !Number.isFinite(screenX) || !Number.isFinite(screenY)) return null
  const svg = screenToSvg(view, mapView, screenX, screenY, renderedW, renderedH)
  if (!svg) return null
  const x = typeof mapView.fromX === 'function' ? mapView.fromX(svg.x) : null
  const y = typeof mapView.fromY === 'function' ? mapView.fromY(svg.y) : null
  if (x == null || y == null || !Number.isFinite(x) || !Number.isFinite(y)) return null
  return { x, y }
}

/** rect 两角点 → { x, y, w, h }（左上锚点，语义坐标）。 */
export function rectFromCorners(a, b) {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y)
  }
}

/** circle 两角点（对角）→ { cx, cy, r }（外接圆）。 */
export function circleFromCorners(a, b) {
  return {
    cx: (a.x + b.x) / 2,
    cy: (a.y + b.y) / 2,
    r: Math.hypot(a.x - b.x, a.y - b.y) / 2
  }
}

/** 箭头头部三角点（SVG 空间，"x,y x,y x,y" 字符串，随线段方向）。 */
export function arrowHeadPoints(x1, y1, x2, y2, size = 14) {
  const angle = Math.atan2(y2 - y1, x2 - x1)
  const spread = Math.PI / 6
  const p1x = x2 - size * Math.cos(angle - spread)
  const p1y = y2 - size * Math.sin(angle - spread)
  const p2x = x2 - size * Math.cos(angle + spread)
  const p2y = y2 - size * Math.sin(angle + spread)
  return `${x2.toFixed(2)},${y2.toFixed(2)} ${p1x.toFixed(2)},${p1y.toFixed(2)} ${p2x.toFixed(2)},${p2y.toFixed(2)}`
}

/** 笔迹（语义坐标）→ SVG points 字符串（经 toX/toY 换算）。 */
export function polylinePoints(points, toX, toY) {
  if (!Array.isArray(points) || points.length === 0) return ''
  return points.map(p => `${toX(p.x).toFixed(2)},${toY(p.y).toFixed(2)}`).join(' ')
}

/** 点到线段最短距离。 */
function pointSegmentDistance(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1
  const dy = y2 - y1
  const len2 = dx * dx + dy * dy
  if (len2 <= 1e-12) return Math.hypot(px - x1, py - y1)
  let t = ((px - x1) * dx + (py - y1) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
}

/** 点到标注几何的最短距离（形状/文字命中判定；pen 不走此路径）。 */
function distanceToShape(ann, px, py) {
  switch (ann.type) {
    case 'pen':
    case 'route':
      return ann.points.length < 2 ? Infinity : Math.min(...ann.points.slice(1).map((p, i) =>
        pointSegmentDistance(px, py, ann.points[i].x, ann.points[i].y, p.x, p.y)))
    case 'unit':
      return Math.max(0, Math.hypot(px - ann.x, py - ann.y) - ann.radius)
    case 'arrow':
    case 'line':
      return pointSegmentDistance(px, py, ann.x1, ann.y1, ann.x2, ann.y2)
    case 'rect': {
      const x2 = ann.x + ann.w
      const y2 = ann.y + ann.h
      return Math.min(
        pointSegmentDistance(px, py, ann.x, ann.y, x2, ann.y),
        pointSegmentDistance(px, py, ann.x, ann.y, ann.x, y2),
        pointSegmentDistance(px, py, x2, ann.y, x2, y2),
        pointSegmentDistance(px, py, ann.x, y2, x2, y2)
      )
    }
    case 'circle':
      return Math.abs(Math.hypot(px - ann.cx, py - ann.cy) - ann.r)
    case 'text':
      return Math.hypot(px - ann.x, py - ann.y) - ANNOT_FONT_SIZE
    default:
      return Infinity
  }
}

/** Select topmost geometry in semantic coordinates; callers supply a screen-sized tolerance. */
export function hitTestAnnotation(annotations, point, tolerance) {
  for (let i = annotations.length - 1; i >= 0; i--) {
    if (distanceToShape(annotations[i], point.x, point.y) <= tolerance) return i
  }
  return -1
}

/** Immutable translation keeps undo snapshots independent, including polyline vertices. */
export function translateAnnotation(annotation, dx, dy) {
  if (annotation.points) return { ...annotation, points: annotation.points.map(p => ({ x: p.x + dx, y: p.y + dy })) }
  const next = { ...annotation }
  for (const key of ['x', 'cx', 'x1', 'x2']) if (Number.isFinite(next[key])) next[key] += dx
  for (const key of ['y', 'cy', 'y1', 'y2']) if (Number.isFinite(next[key])) next[key] += dy
  return next
}

/**
 * 橡皮擦 capsule 与一条直线段的参数区间：返回 t∈[0,1] 上被擦除的区间。
 * capsule = 到 eraser 线段的距离 ≤ radius，等价于「两端 disc ∪ 两条平行边之间的矩形」。
 */
function capsuleIntervals(a, b, c, d, radius) {
  const vx = b.x - a.x
  const vy = b.y - a.y
  const ex = d.x - c.x
  const ey = d.y - c.y
  const length2 = ex * ex + ey * ey
  const intervals = []
  const segLength2 = vx * vx + vy * vy
  if (segLength2 <= 1e-12) return intervals

  const addDisc = (p) => {
    const px = a.x - p.x
    const py = a.y - p.y
    const bq = 2 * (px * vx + py * vy)
    const cq = px * px + py * py - radius * radius
    const disc = bq * bq - 4 * segLength2 * cq
    if (disc < 0) return
    const root = Math.sqrt(disc)
    intervals.push([(-bq - root) / (2 * segLength2), (-bq + root) / (2 * segLength2)])
  }

  if (length2 <= 1e-12) {
    addDisc(c)
    return intervals
  }

  const length = Math.sqrt(length2)
  const ux = ex / length
  const uy = ey / length
  const nx = -uy
  const ny = ux
  const w0 = (a.x - c.x) * nx + (a.y - c.y) * ny
  const wd = vx * nx + vy * ny
  let lineLo = -Infinity
  let lineHi = Infinity
  let bodyPossible = true
  if (Math.abs(wd) <= 1e-12) {
    if (Math.abs(w0) > radius) bodyPossible = false
  } else {
    lineLo = (-radius - w0) / wd
    lineHi = (radius - w0) / wd
    if (lineLo > lineHi) {
      const tmp = lineLo
      lineLo = lineHi
      lineHi = tmp
    }
  }

  const q0 = (a.x - c.x) * ux + (a.y - c.y) * uy
  const qd = vx * ux + vy * uy
  let projLo = -Infinity
  let projHi = Infinity
  if (Math.abs(qd) <= 1e-12) {
    if (q0 < -1e-9 || q0 > length + 1e-9) bodyPossible = false
  } else {
    projLo = -q0 / qd
    projHi = (length - q0) / qd
    if (projLo > projHi) {
      const tmp = projLo
      projLo = projHi
      projHi = tmp
    }
  }

  if (bodyPossible) {
    const lo = Math.max(lineLo, projLo)
    const hi = Math.min(lineHi, projHi)
    if (hi > lo) intervals.push([lo, hi])
  }
  // Body miss must not bypass caps: start/end discs are part of the capsule.
  addDisc(c)
  addDisc(d)
  return intervals
}

function mergeCoveredIntervals(intervals) {
  const clamped = intervals
    .map(([a, b]) => [Math.max(0, a), Math.min(1, b)])
    .filter(([a, b]) => b > a + 1e-9)
    .sort((p, q) => p[0] - q[0])
  if (!clamped.length) return []
  const out = [clamped[0]]
  for (let i = 1; i < clamped.length; i++) {
    const last = out[out.length - 1]
    const next = clamped[i]
    if (next[0] <= last[1] + 1e-9) last[1] = Math.max(last[1], next[1])
    else out.push(next)
  }
  return out
}

function boxesOverlap(a, b) {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1]
}

function pathLength(points) {
  let total = 0
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
  }
  return total
}

/**
 * 语义 capsule eraser：对每条 stroke segment 求被擦除的 t 区间，取补集生成新 polyline。
 * 返回 null = 未命中（调用方保留原 annotation 引用）；[] = 整笔被擦净；否则为 ≥2 点的新段。
 * 子段精度是 3D 稀疏笔迹（远距离画、快速划）不漏擦的前提。
 */
function clipPenByEraser(points, eraserPoints, radius) {
  if (!Array.isArray(points) || points.length < 2) return null
  const cleanPoints = []
  for (const point of points) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) continue
    const previous = cleanPoints[cleanPoints.length - 1]
    if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) <= 1e-9) continue
    cleanPoints.push(point)
  }
  if (cleanPoints.length < 2) return null
  const cleanEraser = []
  for (const point of eraserPoints) {
    if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) cleanEraser.push(point)
  }
  if (!cleanEraser.length) return null
  const segments = []
  if (cleanEraser.length === 1) {
    segments.push({ a: cleanEraser[0], b: cleanEraser[0] })
  } else {
    for (let i = 1; i < cleanEraser.length; i++) {
      segments.push({ a: cleanEraser[i - 1], b: cleanEraser[i] })
    }
  }
  const boxes = segments.map((segment) => [
    Math.min(segment.a.x, segment.b.x) - radius,
    Math.min(segment.a.y, segment.b.y) - radius,
    Math.max(segment.a.x, segment.b.x) + radius,
    Math.max(segment.a.y, segment.b.y) + radius,
  ])

  const pieces = []
  let current = []
  let changed = false
  const flush = () => {
    if (current.length >= 2 && pathLength(current) > 1e-9) pieces.push(current)
    current = []
  }
  const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })

  for (let i = 1; i < cleanPoints.length; i++) {
    const a = cleanPoints[i - 1]
    const b = cleanPoints[i]
    const strokeBox = [
      Math.min(a.x, b.x) - radius, Math.min(a.y, b.y) - radius,
      Math.max(a.x, b.x) + radius, Math.max(a.y, b.y) + radius,
    ]
    let covered = []
    for (let k = 0; k < segments.length; k++) {
      if (!boxesOverlap(strokeBox, boxes[k])) continue
      covered.push(...capsuleIntervals(a, b, segments[k].a, segments[k].b, radius))
    }
    covered = mergeCoveredIntervals(covered)
    if (!covered.length) {
      if (!current.length) current.push({ x: a.x, y: a.y })
      current.push({ x: b.x, y: b.y })
      continue
    }
    changed = true
    let cursor = 0
    for (const [lo, hi] of covered) {
      if (lo > cursor + 1e-9) {
        const start = cursor <= 1e-9 ? { x: a.x, y: a.y } : lerp(a, b, cursor)
        if (!current.length) current.push(start)
        current.push(lerp(a, b, lo))
        flush()
      } else {
        flush()
      }
      cursor = Math.max(cursor, hi)
    }
    if (cursor < 1 - 1e-9) {
      const start = cursor <= 1e-9 ? { x: a.x, y: a.y } : lerp(a, b, cursor)
      if (!current.length) current.push(start)
      current.push({ x: b.x, y: b.y })
    } else {
      flush()
    }
  }
  flush()
  if (!changed) return null
  return pieces
}

/**
 * 橡皮擦应用（不可变，返回新数组）：
 * - pen 笔迹：eraser 路径作为 capsule 扫过 semantic 平面，按子段裁剪并断段；
 *   不足 2 点的段丢弃（整笔被擦净则整笔消失）；
 * - 形状/文字：橡皮路径任一点距其几何 ≤ radius + 线宽（文字为字号）时整件删除。
 * 未命中任何内容时返回原数组引用，调用方不产生无效 undo 快照。
 */
export function applyEraser(annotations, eraserPoints, radius) {
  if (!Array.isArray(annotations) || !Array.isArray(eraserPoints) || eraserPoints.length === 0) {
    return annotations
  }
  const r = Number.isFinite(radius) && radius > 0 ? radius : 1
  const result = []
  let changed = false
  for (const ann of annotations) {
    if (!ann) continue
    if (ann.type === 'pen') {
      const pieces = clipPenByEraser(ann.points, eraserPoints, r)
      if (pieces === null) {
        result.push(ann)
        continue
      }
      changed = true
      for (const piece of pieces) {
        if (piece.length >= 2) result.push({ ...ann, points: piece })
      }
    } else {
      const width = Number.isFinite(ann.width) && ann.width > 0 ? ann.width : ANNOT_WIDTH_DEFAULT
      const hit = eraserPoints.some((ep) => ep && Number.isFinite(ep.x) && Number.isFinite(ep.y)
        && distanceToShape(ann, ep.x, ep.y) <= r + width)
      if (hit) {
        changed = true
        continue
      }
      result.push(ann)
    }
  }
  return changed ? result : annotations
}


/**
 * 快照式提交：next 成为新历史项；若当前不在栈尾（已撤回过），丢弃 redo 侧。
 * history 为不可变快照数组，index 指向当前快照；上限 UNDO_LIMIT（超限丢最旧）。
 */
export function commit(history, index, next) {
  const base = history.slice(0, index + 1)
  base.push(next)
  const trimmed = base.length > UNDO_LIMIT ? base.slice(base.length - UNDO_LIMIT) : base
  return { history: trimmed, index: trimmed.length - 1 }
}

export function canUndo(index) {
  return index > 0
}

export function canRedo(history, index) {
  return Array.isArray(history) && index >= 0 && index < history.length - 1
}

export function undo(history, index) {
  if (!canUndo(index)) return { history, index }
  return { history, index: index - 1 }
}

export function redo(history, index) {
  if (!canRedo(history, index)) return { history, index }
  return { history, index: index + 1 }
}
