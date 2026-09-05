import { shallowRef } from 'vue'

export const RELIEF_ELEVATION_DEG = 45
export const RELIEF_Z_EXAGGERATION = 2.0
export const RELIEF_PADDING = 0
export const RELIEF_EDGE_FADE_FRACTION = 0.08

export const activeTerrainRelief = shallowRef(null)

function finite(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function smoothstep(edge0, edge1, value) {
  if (!(edge1 > edge0)) return value >= edge1 ? 1 : 0
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
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
  edgeFadeFraction = RELIEF_EDGE_FADE_FRACTION,
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
  const sinElevation = Math.sin(elevation)
  const centerX = (xMin + xMax) / 2
  const centerY = (yMin + yMax) / 2
  const centerZ = (minZ + maxZ) / 2
  const spanX = xMax - xMin
  const spanY = yMax - yMin
  const uPadding = spanX * Math.max(0, padding)
  const vPadding = spanY * Math.max(0, padding)

  // Product contract: 2.5D is an upgrade of the existing 2D tactical map, not a
  // physically foreshortened camera view. Keep the original X/Y footprint as the
  // projection frame and use the approved 45° angle only as a Z-derived vertical
  // relief cue. This prevents the whole map from shrinking into a trapezoid/bowl.
  return Object.freeze({
    mapCode: String(mapCode || ''),
    worldBounds: Object.freeze({ xMin, yMin, xMax, yMax }),
    heightRangeMeters: Object.freeze({ min: minZ, max: maxZ }),
    samplesPerAxis: size,
    heights,
    elevationDeg,
    zExaggeration,
    sinElevation,
    edgeFadeFraction: clamp(finite(edgeFadeFraction, RELIEF_EDGE_FADE_FRACTION), 0, 0.49),
    centerX,
    centerY,
    centerZ,
    projectedBounds: Object.freeze({
      left: -spanX / 2 - uPadding,
      right: spanX / 2 + uPadding,
      bottom: -spanY / 2 - vPadding,
      top: spanY / 2 + vPadding,
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

export const VEHICLE_ATTITUDE_MAX_PITCH_DEG = 14
export const VEHICLE_ATTITUDE_MAX_ROLL_DEG = 10
export const VEHICLE_ATTITUDE_RELIEF_SCALE = 1.35
const VEHICLE_ATTITUDE_SAMPLE_FRACTION = 0.42
const VEHICLE_ATTITUDE_DEFAULT_LENGTH_M = 7
const VEHICLE_ATTITUDE_DEFAULT_WIDTH_M = 3.2

/**
 * Presentation-only vehicle attitude from the authoritative terrain heightfield.
 * yaw follows the replay/map convention: 0° = +Y/north, 90° = +X/east.
 * The vehicle footprint comes from the existing marker sizing SSOT when available.
 * This does not invent replay Z or modify the terrain geometry; it only derives
 * pitch/roll from front/rear/left/right ground samples under the current hull.
 */
export function sampleTerrainAttitude(model, x, y, hullYawDeg, footprint = null) {
  if (!model || !Number.isFinite(Number(hullYawDeg))) return null
  const length = clamp(finite(footprint?.length, VEHICLE_ATTITUDE_DEFAULT_LENGTH_M), 4, 12)
  const width = clamp(finite(footprint?.width, VEHICLE_ATTITUDE_DEFAULT_WIDTH_M), 2, 5)
  const halfLength = clamp(length * VEHICLE_ATTITUDE_SAMPLE_FRACTION, 1.5, 4.5)
  const halfWidth = clamp(width * VEHICLE_ATTITUDE_SAMPLE_FRACTION, 0.8, 2.2)
  const yaw = Number(hullYawDeg) * Math.PI / 180
  const forwardX = Math.sin(yaw)
  const forwardY = Math.cos(yaw)
  const rightX = Math.cos(yaw)
  const rightY = -Math.sin(yaw)

  const frontZ = sampleTerrainHeight(model, x + forwardX * halfLength, y + forwardY * halfLength)
  const rearZ = sampleTerrainHeight(model, x - forwardX * halfLength, y - forwardY * halfLength)
  const rightZ = sampleTerrainHeight(model, x + rightX * halfWidth, y + rightY * halfWidth)
  const leftZ = sampleTerrainHeight(model, x - rightX * halfWidth, y - rightY * halfWidth)

  const pitchDeg = clamp(
    Math.atan2(frontZ - rearZ, halfLength * 2) * 180 / Math.PI * VEHICLE_ATTITUDE_RELIEF_SCALE,
    -VEHICLE_ATTITUDE_MAX_PITCH_DEG,
    VEHICLE_ATTITUDE_MAX_PITCH_DEG,
  )
  const rollDeg = clamp(
    Math.atan2(rightZ - leftZ, halfWidth * 2) * 180 / Math.PI * VEHICLE_ATTITUDE_RELIEF_SCALE,
    -VEHICLE_ATTITUDE_MAX_ROLL_DEG,
    VEHICLE_ATTITUDE_MAX_ROLL_DEG,
  )

  return Object.freeze({ pitchDeg, rollDeg })
}

export function terrainReliefEdgeWeight(model, x, y) {
  if (!model) return 0
  const { xMin, yMin, xMax, yMax } = model.worldBounds
  const spanX = xMax - xMin
  const spanY = yMax - yMin
  if (!(spanX > 0) || !(spanY > 0)) return 0
  const nx = clamp((finite(x, model.centerX) - xMin) / spanX, 0, 1)
  const ny = clamp((finite(y, model.centerY) - yMin) / spanY, 0, 1)
  const edgeDistance = Math.min(nx, 1 - nx, ny, 1 - ny)
  return smoothstep(0, model.edgeFadeFraction, edgeDistance)
}

export function projectTerrainCoordinates(model, x, y, z = null) {
  if (!model) return null
  const height = Number.isFinite(z) ? Number(z) : sampleTerrainHeight(model, x, y)
  const worldX = finite(x, model.centerX)
  const worldY = finite(y, model.centerY)
  const edgeWeight = terrainReliefEdgeWeight(model, worldX, worldY)
  const heightShift = (height - model.centerZ)
    * model.zExaggeration
    * model.sinElevation
    * edgeWeight
  return {
    u: worldX - model.centerX,
    v: (worldY - model.centerY) + heightShift,
    height,
    edgeWeight,
  }
}

export function projectTerrainPoint(model, x, y, z = null) {
  const projected = projectTerrainCoordinates(model, x, y, z)
  if (!projected) return null
  const bounds = model.projectedBounds
  return {
    xNorm: (projected.u - bounds.left) / (bounds.right - bounds.left),
    yNorm: 1 - ((projected.v - bounds.bottom) / (bounds.top - bounds.bottom)),
    height: projected.height,
    edgeWeight: projected.edgeWeight,
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
  const targetU = bounds.left + nx * spanU
  const targetV = bounds.bottom + (1 - ny) * spanV
  const x = clamp(model.centerX + targetU, model.worldBounds.xMin, model.worldBounds.xMax)
  const { yMin, yMax } = model.worldBounds
  const steps = model.samplesPerAxis
  const spacingY = (yMax - yMin) / steps

  const sampleV = (y) => {
    const projected = projectTerrainCoordinates(model, x, y)
    return { y, height: projected.height, v: projected.v }
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
