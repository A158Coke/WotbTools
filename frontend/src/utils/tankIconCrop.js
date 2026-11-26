
const EPS = 1e-6

/**
 * 内容框 → 变换参数。
 * @param {{canvas_w:number, canvas_h:number, x:number, y:number, w:number, h:number}} crop
 * @param {number} boxAspect 容器宽/高（坦克百科为 8/5）
 * @returns {{scale:number, tx:number, ty:number}|null} tx/ty 为容器盒比例（0..1 尺度）；
 *           crop 缺失/非法时返回 null（调用方回退原始 contain 展示）。
 */
export function tankIconCropMetrics(crop, boxAspect) {
  if (!crop || !(boxAspect > 0)) return null
  const { canvas_w: cw, canvas_h: ch, x, y, w, h } = crop
  if (![cw, ch, w, h, x, y].every(Number.isFinite)) return null
  if (!(cw > 0 && ch > 0 && w > 0 && h > 0)) return null
  if (x < 0 || y < 0 || x + w > cw + EPS || y + h > ch + EPS) return null
  const den = Math.min(1 / cw, 1 / (boxAspect * ch))
  if (!(den > 0)) return null
  const scale = Math.min(1 / w, 1 / (boxAspect * h)) / den
  if (!(scale > 0)) return null
  return {
    scale,
    tx: scale * den * (cw / 2 - x - w / 2),
    ty: scale * boxAspect * den * (ch / 2 - y - h / 2),
  }
}

export function tankIconCropTransform(crop, boxAspect) {
  const m = tankIconCropMetrics(crop, boxAspect)
  if (!m) return ''
  return `translate(${(m.tx * 100).toFixed(4)}%, ${(m.ty * 100).toFixed(4)}%) scale(${m.scale.toFixed(6)})`
}
