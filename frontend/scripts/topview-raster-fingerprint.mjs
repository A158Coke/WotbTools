export const rasterFingerprint = (baked, boundsWorld) => {
  const { rgba, width: W, height: H } = baked
  const rowWidth = new Array(H).fill(0)
  let topRow = -1, bottomRow = -1
  for (let y = 0; y < H; y++) {
    let cnt = 0
    for (let x = 0; x < W; x++) if (rgba[(y * W + x) * 4 + 3] > 40) cnt++
    rowWidth[y] = cnt
    if (cnt > 0) { if (topRow < 0) topRow = y; bottomRow = y }
  }
  const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0)
  const band = Math.max(1, Math.floor(H * 0.1))
  const span = boundsWorld.maxY - boundsWorld.minY
  const yAtRow = (r) => (r < 0 ? null : boundsWorld.maxY - (r * span) / Math.max(1, H - 1))
  return {
    axisContract: 'model +Y = screen up（raster top = bounds.maxY）',
    topModelY: +boundsWorld.maxY.toFixed(4),
    bottomModelY: +boundsWorld.minY.toFixed(4),
    topRowCovered: topRow,
    bottomRowCovered: bottomRow,
    topCoveredModelY: topRow < 0 ? null : +yAtRow(topRow).toFixed(4),
    bottomCoveredModelY: bottomRow < 0 ? null : +yAtRow(bottomRow).toFixed(4),
    topWidthMean: +mean(rowWidth.slice(0, band)).toFixed(2),
    bottomWidthMean: +mean(rowWidth.slice(H - band)).toFixed(2),
  }
}
