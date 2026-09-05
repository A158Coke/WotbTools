import { shallowRef } from 'vue'

export const RELIEF_ELEVATION_DEG = 45
export const RELIEF_Z_EXAGGERATION = 2.0
// 2.5D replaces the old 2D map presentation, so it must occupy the same map rect.
// Do not inset the relief envelope: any positive padding makes the upgraded map
// visibly shrink inside the BattleMap viewport.
export const RELIEF_PADDING = 0

export const activeTerrainRelief = shallowRef(null)

function finite(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

export function createTerrainReliefModel({
  mapCode,
  worldBounds,
  heightRangeMeters,
  samplesPerAxis,
  heights,
  elevationDeg = RELIEF_ELEVATION_DEG,
  zExaggeration = RELIEF_Z_EXAGGERATION,
  padding = RELIEF_PADDING,
}) {
  const xMin = finite(worldBounds?.xMin)
  const yMin = finite(worldBounds?.yMin)
  const xMax = finite(worldBounds?.xMax)
  const yMax = finite(worldBounds?.yMax)
  const minZ = finite(heightRangeMeters?.min)
  const maxZ = finite(heightRangeMeters?.max, minZ + 1)
  const size = Number(samplesPerAxis)

  if (!(xMax > xMin) || !(yMax > yMin)) throw new Error('Relief world bounds are invalid')
  if (!(maxZ >= minZ)) throw new Error('Relief height range is invalid')
  if (!Number.isInteger(size) || size < 2) throw new Error(`Invalid relief sample size: ${size}`)
  if (!(heights instanceof Float32Array) || heights.length !== size * size) {
    throw new Error(`Relief height sample mismatch: expected ${size * size}, got ${heights?.length ?? 'none'}`)
  }

  const elevation = elevationDeg * Math.PI / 180
  const cosElevation = Math.cos(elevation)
  const sinElevation = Math.sin(elevation)
  const centerX = (xMin + xMax) / 2
  const centerY = (yMin + yMax) / 2
  const centerZ = (minZ + maxZ) / 2

  // Camera comes from map south and looks north/up at a fixed elevation. X stays
  // horizontal and north stays screen-up. Fit against the *actual sampled terrain*
  // envelope instead of the theoretical minZ/maxZ corner combination, and never
  // force the projected frustum to a square. A square frustum made the 45° map look
  // visibly shrunken inside the existing tactical viewport.
  const rawUMin = xMin - centerX
  const rawUMax = xMax - centerX
  const spacingY = (yMax - yMin) / size
  let rawVMin = Number.POSITIVE_INFINITY
  let rawVMax = Number.NEGATIVE_INFINITY

  const observeV = (y, height) => {
    const v = (y - centerY) * cosElevation
      + (finite(height, centerZ) - centerZ) * zExaggeration * sinElevation
    rawVMin = Math.min(rawVMin, v)
    rawVMax = Math.max(rawVMax, v)
  }

  for (let sy = 0; sy < size; sy++) {
    const y = yMin + sy * spacingY
    const row = sy * size
    for (let sx = 0; sx < size; sx++) observeV(y, heights[row + sx])
  }
  // Renderer duplicates the final sample row on the north world-bound edge. Include
  // that real boundary in fit calculations so no terrain edge can be clipped.
  const lastRow = (size - 1) * size
  for (let sx = 0; sx < size; sx++) observeV(yMax, heights[lastRow + sx])

  if (!Number.isFinite(rawVMin) || !Number.isFinite(rawVMax)) {
    throw new Error('Relief projected terrain envelope is invalid')
  }
  const uPadding = (rawUMax - rawUMin) * padding
  const vPadding = Math.max(rawVMax - rawVMin, 1e-6) * padding

  return Object.freeze({
    mapCode: String(mapCode || ''),
    worldBounds: Object.freeze({ xMin, yMin, xMax, yMax }),
    heightRangeMeters: Object.freeze({ min: minZ, max: maxZ }),
    samplesPerAxis: size,
    heights,
    elevationDeg,
    zExaggeration,
    cosElevation,
    sinElevation,
    centerX,
    centerY,
    centerZ,
    projectedBounds: Object.freeze({
      left: rawUMin - uPadding,
      right: rawUMax + uPadding,
      bottom: rawVMin - vPadding,
      top: rawVMax + vPadding,
    }),
  })
}

export function visualReliefZ(model, z) {
  const value = finite(z, model.centerZ)
  return model.centerZ + (value - model.centerZ) * model.zExaggeration
}

export function sampleTerrainHeight(model, x, y) {
  if (!model) return 0
  const { xMin, yMin, xMax, yMax } = model.worldBounds
  const size = model.samplesPerAxis
  const spacingX = (xMax - xMin) / size
  const spacingY = (yMax - yMin) / size

  const sx = clamp((finite(x, xMin) - xMin) / spacingX, 0, size - 1)
  const sy = clamp((finite(y, yMin) - yMin) / spacingY, 0, size - 1)
  const x0 = Math.floor(sx)
  const y0 = Math.floor(sy)
  const x1 = Math.min(size - 1, x0 + 1)
  const y1 = Math.min(size - 1, y0 + 1)
  const tx = sx - x0
  const ty = sy - y0
  const h00 = model.heights[y0 * size + x0]
  const h10 = model.heights[y0 * size + x1]
  const h01 = model.heights[y1 * size + x0]
  const h11 = model.heights[y1 * size + x1]
  const h0 = h00 + (h10 - h00) * tx
  const h1 = h01 + (h11 - h01) * tx
  return h0 + (h1 - h0) * ty
}

export function projectTerrainPoint(model, x, y, z = null) {
  if (!model) return null
  const height = Number.isFinite(z) ? Number(z) : sampleTerrainHeight(model, x, y)
  const u = finite(x, model.centerX) - model.centerX
  const v = (finite(y, model.centerY) - model.centerY) * model.cosElevation
    + (height - model.centerZ) * model.zExaggeration * model.sinElevation
  const bounds = model.projectedBounds
  return {
    xNorm: (u - bounds.left) / (bounds.right - bounds.left),
    yNorm: 1 - ((v - bounds.bottom) / (bounds.top - bounds.bottom)),
    height,
  }
}

export function unprojectTerrainPoint(model, xNorm, yNorm) {
  if (!model) return null
  const bounds = model.projectedBounds
  const spanU = bounds.right - bounds.left
  const spanV = bounds.top - bounds.bottom
  if (!(spanU > 0) || !(spanV > 0)) return null

  const nx = clamp(finite(xNorm, 0.5), 0, 1)
  const ny = clamp(finite(yNorm, 0.5), 0, 1)
  const u = bounds.left + nx * spanU
  const targetV = bounds.bottom + (1 - ny) * spanV
  const x = clamp(model.centerX + u, model.worldBounds.xMin, model.worldBounds.xMax)
  const { yMin, yMax } = model.worldBounds
  const steps = model.samplesPerAxis
  const spacingY = (yMax - yMin) / steps

  const sampleV = (y) => {
    const height = sampleTerrainHeight(model, x, y)
    const v = (y - model.centerY) * model.cosElevation
      + (height - model.centerZ) * model.zExaggeration * model.sinElevation
    return { y, height, v }
  }

  let previous = sampleV(yMin)
  let best = previous
  let bestError = Math.abs(previous.v - targetV)
  for (let i = 1; i <= steps; i++) {
    const current = sampleV(yMin + i * spacingY)
    const currentError = Math.abs(current.v - targetV)
    if (currentError < bestError) {
      best = current
      bestError = currentError
    }
    const lo = Math.min(previous.v, current.v)
    const hi = Math.max(previous.v, current.v)
    if (targetV >= lo && targetV <= hi && Math.abs(current.v - previous.v) > 1e-9) {
      // Camera looks south -> north, so the first crossing is the nearest visible
      // surface when a steep heightfield folds in screen space.
      const t = (targetV - previous.v) / (current.v - previous.v)
      const y = previous.y + (current.y - previous.y) * t
      return { x, y, height: sampleTerrainHeight(model, x, y) }
    }
    previous = current
  }
  return { x, y: best.y, height: best.height }
}

export function activateTerrainRelief(model) {
  activeTerrainRelief.value = model
}

export function clearTerrainRelief(model = null) {
  if (!model || activeTerrainRelief.value === model) activeTerrainRelief.value = null
}
