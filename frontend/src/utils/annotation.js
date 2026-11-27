import { clipPenByEraser } from './annotationStrokeClipping.js'


export const ANNOT_COLORS = [
  '#ff4d4f', '#ffd166', '#ffffff', '#000000',
  '#40c4ff', '#69f0ae', '#ff7eb6', '#ff9f43', '#9c88ff'
]

import { TANK_CLASS_ICONS } from './tankClassIcon.js'
export { TANK_CLASS_ICONS as ANNOT_TANK_CLASSES }

export const ANNOT_WIDTH_MIN = 1
export const ANNOT_WIDTH_MAX = 12
export const ANNOT_WIDTH_DEFAULT = 3

export const ANNOT_ERASER_RADIUS_MIN = 6
export const ANNOT_ERASER_RADIUS_MAX = 40
export const ANNOT_ERASER_RADIUS_DEFAULT = 16

export function semanticWidthFromSlider(sliderValue, { semanticSpan, logicalSpan } = {}) {
  const value = Number(sliderValue)
  if (!Number.isFinite(value) || value <= 0) return 0
  const semantic = Number(semanticSpan)
  const logical = Number(logicalSpan)
  if (!Number.isFinite(semantic) || semantic <= 0 || !Number.isFinite(logical) || logical <= 0) return value
  return value * (semantic / logical)
}

export const ANNOT_FONT_SIZE = 20

export const UNDO_LIMIT = 100

function renderedSize(mapView, renderedW, renderedH) {
  return {
    rw: Number.isFinite(renderedW) && renderedW > 0 ? renderedW : mapView.W,
    rh: Number.isFinite(renderedH) && renderedH > 0 ? renderedH : mapView.H
  }
}

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

export function screenToSemantic(view, mapView, screenX, screenY, renderedW, renderedH) {
  if (!view || !mapView || !Number.isFinite(screenX) || !Number.isFinite(screenY)) return null
  const svg = screenToSvg(view, mapView, screenX, screenY, renderedW, renderedH)
  if (!svg) return null
  const x = typeof mapView.fromX === 'function' ? mapView.fromX(svg.x) : null
  const y = typeof mapView.fromY === 'function' ? mapView.fromY(svg.y) : null
  if (x == null || y == null || !Number.isFinite(x) || !Number.isFinite(y)) return null
  return { x, y }
}

export function rectFromCorners(a, b) {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y)
  }
}

export function circleFromCorners(a, b) {
  return {
    cx: (a.x + b.x) / 2,
    cy: (a.y + b.y) / 2,
    r: Math.hypot(a.x - b.x, a.y - b.y) / 2
  }
}

export function arrowHeadPoints(x1, y1, x2, y2, size = 14) {
  const angle = Math.atan2(y2 - y1, x2 - x1)
  const spread = Math.PI / 6
  const p1x = x2 - size * Math.cos(angle - spread)
  const p1y = y2 - size * Math.sin(angle - spread)
  const p2x = x2 - size * Math.cos(angle + spread)
  const p2y = y2 - size * Math.sin(angle + spread)
  return `${x2.toFixed(2)},${y2.toFixed(2)} ${p1x.toFixed(2)},${p1y.toFixed(2)} ${p2x.toFixed(2)},${p2y.toFixed(2)}`
}

export function polylinePoints(points, toX, toY) {
  if (!Array.isArray(points) || points.length === 0) return ''
  return points.map(p => `${toX(p.x).toFixed(2)},${toY(p.y).toFixed(2)}`).join(' ')
}

function pointSegmentDistance(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1
  const dy = y2 - y1
  const len2 = dx * dx + dy * dy
  if (len2 <= 1e-12) return Math.hypot(px - x1, py - y1)
  let t = ((px - x1) * dx + (py - y1) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
}

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

export function hitTestAnnotation(annotations, point, tolerance) {
  for (let i = annotations.length - 1; i >= 0; i--) {
    if (distanceToShape(annotations[i], point.x, point.y) <= tolerance) return i
  }
  return -1
}

export function translateAnnotation(annotation, dx, dy) {
  if (annotation.points) return { ...annotation, points: annotation.points.map(p => ({ ...p, x: p.x + dx, y: p.y + dy })) }
  const next = { ...annotation }
  for (const key of ['x', 'cx', 'x1', 'x2']) if (Number.isFinite(next[key])) next[key] += dx
  for (const key of ['y', 'cy', 'y1', 'y2']) if (Number.isFinite(next[key])) next[key] += dy
  return next
}

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

export function stripSurfaceAnchors(annotations) {
  if (!Array.isArray(annotations)) return []
  return annotations.map((ann) => {
    if (!ann || !Array.isArray(ann.points)) return ann
    return { ...ann, points: ann.points.map((p) => ({ x: p.x, y: p.y })) }
  })
}


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

export function annotationDraftFromTool(tool, start, end, { color, width } = {}) {
  switch (tool) {
    case 'arrow':
    case 'line':
      return { type: tool, color, width, x1: start.x, y1: start.y, x2: end.x, y2: end.y }
    case 'rect':
      return { type: 'rect', color, width, ...rectFromCorners(start, end) }
    case 'circle':
      return { type: 'circle', color, width, ...circleFromCorners(start, end) }
    default:
      return null
  }
}

export function isDegenerateAnnotation(annotation) {
  if (!annotation) return true
  if (annotation.type === 'rect') return !(annotation.w > 1e-9 && annotation.h > 1e-9)
  if (annotation.type === 'circle') return annotation.r < 1e-9
  if (annotation.type === 'line' || annotation.type === 'arrow') {
    return Math.hypot(annotation.x2 - annotation.x1, annotation.y2 - annotation.y1) < 1e-9
  }
  return false
}

export function projectAnnotationToSvg(annotation, { toX, toY, invX = 1, invY = 1, widthFallback = ANNOT_WIDTH_DEFAULT } = {}) {
  const widthSvg = (annotation.width || widthFallback) * invX
  const out = { ...annotation, widthSvg }
  if (annotation.type === 'pen' || annotation.type === 'route') {
    out.svgPoints = polylinePoints(annotation.points, toX, toY)
  } else if (annotation.type === 'line' || annotation.type === 'arrow') {
    out.x1 = toX(annotation.x1)
    out.y1 = toY(annotation.y1)
    out.x2 = toX(annotation.x2)
    out.y2 = toY(annotation.y2)
    if (annotation.type === 'arrow') {
      const length = Math.hypot(out.x2 - out.x1, out.y2 - out.y1)
      const headSize = Math.max(10, Math.min(Math.max(14, widthSvg * 2.8), length * 0.45 || 10))
      out.head = arrowHeadPoints(out.x1, out.y1, out.x2, out.y2, headSize)
    }
  } else if (annotation.type === 'rect') {
    out.x = toX(annotation.x)
    out.y = toY(annotation.y + annotation.h)
    out.w = annotation.w * invX
    out.h = annotation.h * invY
  } else if (annotation.type === 'circle') {
    out.cx = toX(annotation.cx)
    out.cy = toY(annotation.cy)
    out.r = annotation.r * invX
  } else if (annotation.type === 'text' || annotation.type === 'unit') {
    out.x = toX(annotation.x)
    out.y = toY(annotation.y)
  }
  return out
}

export function isValidAnnotation(annotation) {
  if (!annotation || typeof annotation !== 'object' || Array.isArray(annotation)) return false
  if (typeof annotation.color !== 'string' || annotation.color.length === 0) return false
  if (annotation.label !== undefined && typeof annotation.label !== 'string') return false
  const finite = (value) => typeof value === 'number' && Number.isFinite(value)
  const positive = (value) => finite(value) && value > 0
  const points = () => Array.isArray(annotation.points)
    && annotation.points.length >= 2
    && annotation.points.every(point => point && finite(point.x) && finite(point.y))
  switch (annotation.type) {
    case 'pen':
      return positive(annotation.width) && points()
    case 'route':
      return positive(annotation.width) && points()
    case 'line':
    case 'arrow':
      return positive(annotation.width)
        && finite(annotation.x1) && finite(annotation.y1)
        && finite(annotation.x2) && finite(annotation.y2)
    case 'rect':
      return positive(annotation.width)
        && finite(annotation.x) && finite(annotation.y)
        && positive(annotation.w) && positive(annotation.h)
    case 'circle':
      return positive(annotation.width)
        && finite(annotation.cx) && finite(annotation.cy) && positive(annotation.r)
    case 'text':
      return finite(annotation.x) && finite(annotation.y)
        && typeof annotation.text === 'string' && annotation.text.trim().length > 0
    case 'unit':
      return finite(annotation.x) && finite(annotation.y)
        && positive(annotation.radius)
        && TANK_CLASS_ICONS.some(icon => icon.key === annotation.tankClass)
    default:
      return false
  }
}
