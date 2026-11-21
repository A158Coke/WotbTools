// —— rasterOrientation fingerprint（RASTER_Y_AXIS_CONTRACT 证据）：从实际 baked rgba 计算 ——
// 记录图片 top/bottom 对应的 model Y、上下 10% 行的覆盖宽度均值与首/末覆盖行。
// 方向契约：model +Y（forward）必须位于图片 top——即 topModelY 是场景 bounds 的最大 Y，
// 且 topWidthMean 显著小于 bottomWidthMean（炮管/车首窄于车尾/炮塔体）。
// vitest（orientation 回归）与开发者 QA 都以此字段断言真实 raster 方向，非 metadata 自洽。
export const rasterFingerprint = (baked, boundsWorld) => {
  const { rgba, width: W, height: H } = baked
  const rowWidth = new Array(H).fill(0)
  let topRow = -1, bottomRow = -1
  for (let y = 0; y < H; y++) {
    let cnt = 0
    // alpha > 40：边缘半透明像素不算覆盖（与 check-webp-orientation 同阈值）
    for (let x = 0; x < W; x++) if (rgba[(y * W + x) * 4 + 3] > 40) cnt++
    rowWidth[y] = cnt
    if (cnt > 0) { if (topRow < 0) topRow = y; bottomRow = y }
  }
  const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0)
  const band = Math.max(1, Math.floor(H * 0.1))
  // 行 r ↔ modelY = maxY - r*(maxY-minY)/(H-1)（raster 行 = 屏幕 y，上小下大）
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
