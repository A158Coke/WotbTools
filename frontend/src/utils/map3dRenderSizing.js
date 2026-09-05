function positiveNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : null
}

/**
 * Compute a 2.5D renderer target from the CSS size that the browser actually laid out.
 *
 * Battle Playback uses a layout-scaled viewport, so the host's client dimensions already
 * include view.scale. Keeping this helper based on measured CSS pixels prevents applying
 * view.scale a second time inside the WebGL renderer. The source and renderbuffer limits
 * cap physical work once the drawing buffer has reached useful detail/capability bounds.
 */
export function computeMap3dRenderTarget({
  cssWidth,
  cssHeight,
  devicePixelRatio = 1,
  maxPixelRatio = 2,
  textureWidth,
  textureHeight,
  maxRenderBufferSize,
}) {
  const width = Math.max(1, positiveNumber(cssWidth) || 1)
  const height = Math.max(1, positiveNumber(cssHeight) || 1)
  const limits = [
    positiveNumber(devicePixelRatio) || 1,
    positiveNumber(maxPixelRatio) || 2,
  ]

  const sourceWidth = positiveNumber(textureWidth)
  const sourceHeight = positiveNumber(textureHeight)
  if (sourceWidth) limits.push(sourceWidth / width)
  if (sourceHeight) limits.push(sourceHeight / height)

  const maxBuffer = positiveNumber(maxRenderBufferSize)
  if (maxBuffer) {
    limits.push(maxBuffer / width, maxBuffer / height)
  }

  const pixelRatio = Math.max(1 / Math.max(width, height), Math.min(...limits))
  return {
    cssWidth: width,
    cssHeight: height,
    pixelRatio,
    drawingBufferWidth: Math.max(1, Math.round(width * pixelRatio)),
    drawingBufferHeight: Math.max(1, Math.round(height * pixelRatio)),
  }
}
