// 封面图展示裁剪（数据驱动，2026-10-15）：客户端图标是原始画布（256×128 / 128×128），
// 坦克斜向绘制且锚定左上、右侧与底部留白近半——直接 contain 展示比旧 BlitzKit
// 紧裁版显得小。数据面 `tank_images/crops.json` 给出逐车内容框（alpha>0 紧裁，
// canvas 像素坐标），本模块把内容框换算成容器内的 `translate(%) scale()`：
// 等效于把内容框当整张图做 contain（居中、至多铺满），与旧紧裁口径一致，
// **不改图标字节**。
//
// 约定：img 以 `object-fit: contain` 绝对定位铺满固定宽高比容器（见 AgentTankopedia
// 的 `.tp-media`）。变换合成顺序 = 先以元素中心 scale、再平移（CSS 列表
// `translate(...) scale(...)` 即 T·S）；平移百分比相对元素自身盒（= 容器盒）。
//
// 数学（box 宽归一化为 1，高 = 1/A）：
//   s = den = min(1/Wc, 1/(A·Hc))          -- contain 缩放（每单位容器宽的像素比例）
//   k = min(1/w, 1/(A·h)) / den            -- 把内容框放到与整图同规则的 contain
//   tx = k·den·(Wc/2 − x − w/2)            -- 内容框中心对回容器中心
//   ty = k·A·den·(Hc/2 − y − h/2)

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

/** 内容框 → CSS transform 字符串；crop 缺失/非法返回 ''（回退原始 contain 展示）。 */
export function tankIconCropTransform(crop, boxAspect) {
  const m = tankIconCropMetrics(crop, boxAspect)
  if (!m) return ''
  return `translate(${(m.tx * 100).toFixed(4)}%, ${(m.ty * 100).toFixed(4)}%) scale(${m.scale.toFixed(6)})`
}
