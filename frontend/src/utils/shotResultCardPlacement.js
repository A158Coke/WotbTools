/**
 * 射击结果卡（armor viewer `#traj-info`）的视口定位：把投影锚点换算成
 * `position: fixed` 的 left/top（translateX(-50%)，故 x 是卡片中心）。
 *
 * 纯函数，供 `tankViewer.updateTrajInfoPos` 与单元/浏览器门禁共用：
 * 1. 钳制在可见画布内；
 * 2. 避让固定 UI：优先后移到面板上方；顶部放不下时水平移到侧边，侧向选择只看
 *    blocker 左右的**可用空间**（与卡片当前中心无关），相机阻尼下贴边不会在
 *    面板中线两侧逐帧翻转。
 *
 * @param {object} input
 * @param {number} input.anchorX 投影锚点视口 x
 * @param {number} input.anchorY 投影锚点视口 y
 * @param {number} [input.offsetY=160] 卡片顶部相对锚点的下移量
 * @param {number} input.cardWidth 已测量卡片宽度
 * @param {number} input.cardHeight 已测量卡片高度
 * @param {{left:number,top:number,right:number,bottom:number}} input.clip 可见画布矩形
 * @param {Array<{left:number,top:number,right:number,bottom:number,width?:number,height?:number}>} [input.blockers]
 * @returns {{x:number,y:number}} left/top（y 为卡片顶边）
 */
export function placeShotResultCard({
  anchorX, anchorY, offsetY = 160, cardWidth, cardHeight, clip, blockers = [],
}) {
  const w = Math.max(0, Number(cardWidth) || 0)
  const h = Math.max(0, Number(cardHeight) || 0)
  const clipL = clip.left
  const clipT = clip.top
  const clipR = clip.right
  const clipB = clip.bottom
  let px = anchorX
  let py = anchorY + offsetY

  const minX = clipL + w / 2 + 10
  const maxX = clipR - w / 2 - 10
  const minY = clipT + 10
  const maxY = clipB - h - 10
  const clampX = (v) => (maxX >= minX ? Math.max(minX, Math.min(maxX, v)) : (clipL + clipR) / 2)
  const clampY = (v) => (maxY >= minY ? Math.max(minY, Math.min(maxY, v)) : clipT + 10)

  px = clampX(px)
  py = clampY(py)
  for (const r of blockers) {
    if (!r || !(r.width > 0) || !(r.height > 0)) continue
    const l = px - w / 2
    const t = py
    const rr = l + w
    const b = t + h
    if (l >= r.right || rr <= r.left || t >= r.bottom || b <= r.top) continue
    if (r.top - h - 12 >= clipT + 10) {
      py = clampY(r.top - h - 12)
      continue
    }
    const need = w + 12
    const spaceLeft = r.left - clipL
    const spaceRight = clipR - r.right
    let sideRight
    if (spaceRight >= need && spaceRight >= spaceLeft) sideRight = true
    else if (spaceLeft >= need) sideRight = false
    else sideRight = spaceRight >= spaceLeft
    px = clampX(sideRight ? r.right + w / 2 + 12 : r.left - w / 2 - 12)
  }
  return { x: px, y: py }
}
