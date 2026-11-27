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
  function fromX(svgX) {
    if (!renderBounds) return null
    return renderBounds.xMin + (svgX / W) * (renderBounds.xMax - renderBounds.xMin)
  }
  function fromY(svgY) {
    if (!renderBounds) return null
    return renderBounds.yMax - (svgY / H) * (renderBounds.yMax - renderBounds.yMin)
  }
  return { W, H, renderBounds, toX, toY, fromX, fromY }
}
