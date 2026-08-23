/**
 * 地图鸟瞰共享坐标映射：把语义坐标（x=回放 x，y=回放 z）映射到图片像素。
 * 渲染边界优先图片自身的 coordinateBounds（逐图校准的世界坐标），
 * 旧配置无 coordinateBounds 时回退 playableBounds（兼容策略）。
 */
export function createMapView(image, overview) {
  const W = image ? image.width : 800
  const H = image ? image.height : 800
  const renderBounds = (image && image.coordinateBounds)
    ? image.coordinateBounds
    : (overview ? overview.playableBounds : null)
  function toX(x) {
    if (!renderBounds) return 0
    return ((x - renderBounds.xMin) / (renderBounds.xMax - renderBounds.xMin)) * W
  }
  function toY(y) {
    if (!renderBounds) return 0
    return ((renderBounds.yMax - y) / (renderBounds.yMax - renderBounds.yMin)) * H
  }
  /** 逆映射：SVG 像素 → 语义 x（无 renderBounds 时返回 null）。 */
  function fromX(svgX) {
    if (!renderBounds) return null
    return renderBounds.xMin + (svgX / W) * (renderBounds.xMax - renderBounds.xMin)
  }
  /** 逆映射：SVG 像素 → 语义 y（y 反转，无 renderBounds 时返回 null）。 */
  function fromY(svgY) {
    if (!renderBounds) return null
    return renderBounds.yMax - (svgY / H) * (renderBounds.yMax - renderBounds.yMin)
  }
  return { W, H, renderBounds, toX, toY, fromX, fromY }
}
