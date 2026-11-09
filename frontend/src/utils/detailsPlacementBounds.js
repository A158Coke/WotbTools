/**
 * 详情浮窗的纯几何计算（无 DOM / 无 Vue）。生产 composable 与浏览器回归共用同一份
 * 边界公式，避免测试自己维护第二套「合法位置」事实源。
 *
 * 坐标全部相对 workspace 宿主：left/top 是浮窗相对 host 的像素位置；transportTop 是
 * 传输控件上缘相对 host 的位置（null/非有限值 = 控件不可用，退化为 host 下边界）。
 */

/** 浮窗贴边时仍需保留的最小可见余量。 */
export const DETAILS_EDGE_MARGIN = 8

const px = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

/**
 * 当前面板尺寸下允许的左上角范围与最大高度。
 * @param {{
 *   hostWidth: number, hostHeight: number,
 *   paddingLeft?: number, paddingRight?: number, paddingTop?: number,
 *   panelWidth: number, panelHeight: number,
 *   transportTop?: number | null,
 * }} input
 * @returns {{minLeft:number,maxLeft:number,minTop:number,maxTop:number,maxBottom:number,maxHeight:number}}
 */
export function detailsPlacementLimits({
  hostWidth,
  hostHeight,
  paddingLeft = 0,
  paddingRight = 0,
  paddingTop = 0,
  panelWidth,
  panelHeight,
  transportTop = null,
}) {
  const minLeft = px(paddingLeft) + DETAILS_EDGE_MARGIN
  const minTop = px(paddingTop) + DETAILS_EDGE_MARGIN
  const maxLeft = Math.max(minLeft, px(hostWidth) - px(paddingRight) - px(panelWidth) - DETAILS_EDGE_MARGIN)
  const rawTransportTop = transportTop == null ? hostHeight : Number(transportTop)
  const boundary = Number.isFinite(rawTransportTop) ? rawTransportTop : px(hostHeight)
  const maxBottom = Math.min(px(hostHeight) - DETAILS_EDGE_MARGIN, boundary - DETAILS_EDGE_MARGIN)
  const maxTop = Math.max(minTop, maxBottom - px(panelHeight))
  return {
    minLeft,
    maxLeft,
    minTop,
    maxTop,
    maxBottom,
    maxHeight: Math.max(0, maxBottom - minTop),
  }
}

/**
 * 用户拖过的位置在选择变化后的唯一合法结果：尺寸变化后仍合法就**原位保留**，
 * 只有越界才夹到真实边界。返回 true 表示 newTop 恰好是允许结果且下缘不遮 transport。
 *
 * @param {{
 *   oldTop: number, newTop: number, newHeight: number,
 *   hostWidth: number, hostHeight: number,
 *   paddingLeft?: number, paddingRight?: number, paddingTop?: number,
 *   panelWidth: number, transportTop?: number | null,
 * }} input
 */
export function detailsPlacementPreserved({
  oldTop,
  newTop,
  newHeight,
  hostWidth,
  hostHeight,
  paddingLeft = 0,
  paddingRight = 0,
  paddingTop = 0,
  panelWidth,
  transportTop = null,
}) {
  const limits = detailsPlacementLimits({
    hostWidth,
    hostHeight,
    paddingLeft,
    paddingRight,
    paddingTop,
    panelWidth,
    panelHeight: newHeight,
    transportTop,
  })
  const expectedTop = Math.min(Math.max(px(oldTop), limits.minTop), limits.maxTop)
  // 浮窗位置是 Math.round 后的整数；1px 吸收亚像素/取整，不是放宽对齐语义。
  return Math.abs(px(newTop) - expectedTop) <= 1
    && px(newTop) >= limits.minTop - 1
    && px(newTop) + px(newHeight) <= limits.maxBottom + 1
}
