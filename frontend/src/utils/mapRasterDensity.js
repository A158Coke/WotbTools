/**
 * Runtime raster capacity diagnostics.
 *
 * This describes how much source raster is available for a rendered map frame;
 * it is not a sharpness guarantee and must not alter camera limits.
 */
export function mapRasterDensity({
  naturalWidth,
  naturalHeight,
  renderedCssWidth,
  renderedCssHeight,
  viewScale = 1,
  devicePixelRatio = 1,
} = {}) {
  const values = [
    naturalWidth,
    naturalHeight,
    renderedCssWidth,
    renderedCssHeight,
    viewScale,
    devicePixelRatio,
  ]
  if (values.some(value => !Number.isFinite(value) || value <= 0)) return null

  const requiredDeviceWidth = renderedCssWidth * viewScale * devicePixelRatio
  const requiredDeviceHeight = renderedCssHeight * viewScale * devicePixelRatio
  return {
    requiredDeviceWidth,
    requiredDeviceHeight,
    effectiveSourcePxPerDevicePx: naturalWidth / requiredDeviceWidth,
    effectiveSourcePxPerDevicePxY: naturalHeight / requiredDeviceHeight,
    widthSufficient: naturalWidth >= requiredDeviceWidth,
    heightSufficient: naturalHeight >= requiredDeviceHeight,
  }
}
