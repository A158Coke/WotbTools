
type PanZoomView = { scale: number; tx: number; ty: number }

export function normalizeDeg(a: number) {
  return (((a + 180) % 360) + 360) % 360 - 180
}

export function screenRotation(yawDeg: number) {
  return normalizeDeg(yawDeg)
}

export function turretWorldYawDeg(hullYawDeg: number, turretRelativeYawDeg: number) {
  return normalizeDeg(hullYawDeg + turretRelativeYawDeg)
}

const VIEW_MIN_SCALE = 1
const VIEW_MAX_SCALE = 4

export function zoomViewAt(view: PanZoomView, px: number, py: number, factor: number, minScale = VIEW_MIN_SCALE, maxScale = VIEW_MAX_SCALE) {
  if (!view || !Number.isFinite(view.scale) || !Number.isFinite(factor) || factor <= 0) return view
  const next = Math.min(maxScale, Math.max(minScale, view.scale * factor))
  const ratio = next / view.scale
  return {
    scale: next,
    tx: px - (px - view.tx) * ratio,
    ty: py - (py - view.ty) * ratio
  }
}

export function clampViewPan(view: PanZoomView, viewW: number, viewH: number, mapW = viewW, mapH = viewH) {
  if (!view || !Number.isFinite(view.scale)) return view
  const s = view.scale
  const known = Number.isFinite(viewW) && viewW > 0 && Number.isFinite(viewH) && viewH > 0
    && Number.isFinite(mapW) && mapW > 0 && Number.isFinite(mapH) && mapH > 0
  if (!known) {
    if (s <= 1) return { scale: s, tx: 0, ty: 0 }
    const noW = !Number.isFinite(viewW) || viewW <= 0
    const noH = !Number.isFinite(viewH) || viewH <= 0
    const txMin = noW ? -Infinity : viewW * (1 - s)
    const tyMin = noH ? -Infinity : viewH * (1 - s)
    return {
      scale: s,
      tx: noW ? view.tx : Math.min(0, Math.max(txMin, view.tx)),
      ty: noH ? view.ty : Math.min(0, Math.max(tyMin, view.ty)),
    }
  }
  const scaledW = mapW * s
  const scaledH = mapH * s
  let tx = view.tx
  let ty = view.ty
  if (scaledW > viewW) tx = Math.min(0, Math.max(viewW - scaledW, tx))
  else tx = (viewW - scaledW) / 2
  if (scaledH > viewH) ty = Math.min(0, Math.max(viewH - scaledH, ty))
  else ty = (viewH - scaledH) / 2
  return { scale: s, tx, ty }
}
