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
 */

/** 标注颜色固定色板（8 色，暗图高对比）。 */
export const ANNOT_COLORS = [
  '#ff4d4f', '#ffd166', '#ffffff', '#40c4ff',
  '#69f0ae', '#ff7eb6', '#ff9f43', '#9c88ff'
]

/** 粗细滑块范围与默认值（SVG 单位，随地图缩放）。 */
export const ANNOT_WIDTH_MIN = 1
export const ANNOT_WIDTH_MAX = 12
export const ANNOT_WIDTH_DEFAULT = 3

/** 文字标注字号（SVG 单位，随地图缩放）。 */
export const ANNOT_FONT_SIZE = 20

/** undo/redo 快照上限（步）。 */
export const UNDO_LIMIT = 100

/**
 * 屏幕坐标（相对地图容器的 client 坐标，见 BattlePlayback.screenPoint 契约）→ 语义坐标。
 * view = { scale, tx, ty }（viewport 变换：svgPx = (screen − translate) / scale）；
 * mapView 来自 createMapView（含 fromX/fromY 逆映射）。换算失败返回 null。
 */
export function screenToSemantic(view, mapView, screenX, screenY) {
  if (!view || !mapView || !Number.isFinite(screenX) || !Number.isFinite(screenY)) return null
  const scale = Number.isFinite(view.scale) && view.scale > 0 ? view.scale : 1
  const tx = Number.isFinite(view.tx) ? view.tx : 0
  const ty = Number.isFinite(view.ty) ? view.ty : 0
  const svgX = (screenX - tx) / scale
  const svgY = (screenY - ty) / scale
  const x = typeof mapView.fromX === 'function' ? mapView.fromX(svgX) : null
  const y = typeof mapView.fromY === 'function' ? mapView.fromY(svgY) : null
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

/**
 * 按保留点集合把原始点列拆成连续段：被删除的点制造中断，中断处不重新连线。
 * kept 必须是 original 中元素的引用子集（保持原顺序）。
 */
function splitByRemoved(original, kept) {
  const keptSet = new Set(kept)
  const segments = []
  let current = []
  for (const p of original) {
    if (keptSet.has(p)) {
      current.push(p)
    } else if (current.length) {
      segments.push(current)
      current = []
    }
  }
  if (current.length) segments.push(current)
  return segments
}

/**
 * 橡皮擦应用（不可变，返回新数组）：
 * - pen 笔迹：删去距任一橡皮点 ≤ radius 的点，「点擦局部」；剩余点按中断拆段，
 *   不足 2 点的段丢弃（整笔被擦净则整笔消失）；
 * - 形状/文字：橡皮路径任一点距其几何 ≤ radius + 线宽（文字为字号）时整件删除。
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
      const kept = ann.points.filter(
        p => !eraserPoints.some(ep => Math.hypot(p.x - ep.x, p.y - ep.y) <= r)
      )
      if (kept.length < ann.points.length) changed = true
      if (kept.length < 2) continue
      const segments = splitByRemoved(ann.points, kept)
      for (const seg of segments) {
        if (seg.length >= 2) result.push({ ...ann, points: seg })
      }
    } else {
      const width = Number.isFinite(ann.width) && ann.width > 0 ? ann.width : ANNOT_WIDTH_DEFAULT
      const hit = eraserPoints.some(ep => distanceToShape(ann, ep.x, ep.y) <= r + width)
      if (hit) {
        changed = true
        continue
      }
      result.push(ann)
    }
  }
  // 未命中任何内容：返回原数组引用，调用方不产生无效的 undo 快照
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
