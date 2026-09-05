import { shallowRef } from 'vue'

export const RELIEF_ELEVATION_DEG = 45
export const RELIEF_Z_EXAGGERATION = 2.0
export const RELIEF_PADDING = 0.035

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

  // Camera comes from map south and looks north/up at a fixed elevation. X therefore
  // stays horizontal and north stays screen-up, preserving the normal tactical-map
  // orientation while Z becomes visible in screen Y.
  const rawUMin = xMin - centerX
  const rawUMax = xMax - centerX
  const rawVMin = (yMin - centerY) * cosElevation
    + (minZ - centerZ) * zExaggeration * sinElevation
  const rawVMax = (yMax - centerY) * cosElevation
    + (maxZ - centerZ) * zExaggeration * sinElevation

  const centerU = (rawUMin + rawUMax) / 2
  const centerV = (rawVMin + rawVMax) / 2
  const half = Math.max(rawUMax - rawUMin, rawVMax - rawVMin) * 0.5 * (1 + padding * 2)

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
      left: centerU - half,
      right: centerU + half,
      bottom: centerV - half,
      top: centerV + half,
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

export function activateTerrainRelief(model) {
  activeTerrainRelief.value = model
}

export function clearTerrainRelief(model = null) {
  if (!model || activeTerrainRelief.value === model) activeTerrainRelief.value = null
}
