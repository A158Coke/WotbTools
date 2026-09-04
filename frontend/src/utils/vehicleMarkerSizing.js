/**
 * Vehicle-aware playback marker sizing.
 *
 * `vehicleSizes` carries the real hull length/width in metres for every tankId
 * (BlitzKit hull bounding box), so markers are drawn to map scale. A resolved
 * Tier X model's own hull bounds and the per-class table remain as fallbacks
 * for tankIds the table does not cover. The returned dimensions are CSS pixels
 * before the map viewport transform; the viewport scale then enlarges the
 * complete marker together with the map.
 */

import { DEFAULT_VEHICLE_LENGTH_M, vehicleSizes } from '../data/vehicleSizes'

// 下限只保证「还看得见」，点击目标另有 HIT_TARGET_MIN_PX 兜底，所以可以放到接近真实尺寸。
export const MARKER_SIZE_LIMITS = Object.freeze({
  desktop: Object.freeze({ min: 10, max: 30 }),
  mobile: Object.freeze({ min: 10, max: 26 }),
})

const CLASS_FOOTPRINT_M = Object.freeze({
  light: Object.freeze({ width: 2.8, length: 6.0 }),
  medium: Object.freeze({ width: 3.2, length: 7.0 }),
  heavy: Object.freeze({ width: 4.0, length: 9.0 }),
  tankDestroyer: Object.freeze({ width: 3.6, length: 9.5 }),
  spg: Object.freeze({ width: 3.8, length: 9.5 }),
  // 未知车种用全表真实中位车长，而不是拍一个数。
  unknown: Object.freeze({ width: 3.2, length: DEFAULT_VEHICLE_LENGTH_M }),
})

// 车体图形约占方形烘焙的 88%，这里补回来让贴图边界贴合真实车体；不再额外放大。
const READABILITY_SCALE = 1.14
const FALLBACK_WORLD_SPAN_M = 600
const HIT_TARGET_EXTRA_PX = 4
const HIT_TARGET_MIN_PX = Object.freeze({ desktop: 20, mobile: 18 })

function finitePositive(value) {
  return Number.isFinite(value) && value > 0 ? value : null
}

function classFootprint(vehicle) {
  const raw = String(vehicle?.tankClass ?? vehicle?.vehicleClass ?? '').toLowerCase()
  if (raw.includes('light') || raw === 'lt') return CLASS_FOOTPRINT_M.light
  if (raw.includes('medium') || raw === 'mt') return CLASS_FOOTPRINT_M.medium
  if (raw.includes('destroyer') || raw === 'td') return CLASS_FOOTPRINT_M.tankDestroyer
  if (raw.includes('spg') || raw.includes('self-propelled') || raw.includes('artillery')) return CLASS_FOOTPRINT_M.spg
  if (raw.includes('heavy') || raw === 'ht') return CLASS_FOOTPRINT_M.heavy
  return CLASS_FOOTPRINT_M.unknown
}

/** 真实车体尺寸（米），按回放 tankId 查表——覆盖全部 735 辆，优先于 metadata 与 class 猜测。 */
function blitzkitFootprint(vehicle) {
  const id = vehicle?.tankId
  const size = id == null ? null : vehicleSizes[id]
  if (!Array.isArray(size)) return null
  const length = finitePositive(size[0])
  const width = finitePositive(size[1])
  return length && width ? { width, length } : null
}

function modelFootprint(model) {
  const bounds = model?.hullBounds
  if (!bounds) return null
  const width = finitePositive(bounds.maxX - bounds.minX)
  const length = finitePositive(bounds.maxY - bounds.minY)
  return width && length ? { width, length } : null
}

function projectedPixelsPerWorld(mapView, mapWidthPx, mapHeightPx) {
  const bounds = mapView?.renderBounds
  const worldWidth = bounds ? finitePositive(bounds.xMax - bounds.xMin) : null
  const worldHeight = bounds ? finitePositive(bounds.yMax - bounds.yMin) : null
  return {
    x: mapWidthPx / (worldWidth || FALLBACK_WORLD_SPAN_M),
    y: mapHeightPx / (worldHeight || FALLBACK_WORLD_SPAN_M),
  }
}

/**
 * Compute separate square raster, physical collision footprint and click target.
 * The raster stays isotropic because hull.webp already contains the vehicle
 * aspect ratio. Physical dimensions are retained only for collision geometry.
 */
export function computeVehicleMarkerSize(vehicle, {
  model = null,
  mapView = null,
  mapWidthPx = 800,
  mapHeightPx = null,
  mobile = false,
} = {}) {
  const limits = mobile ? MARKER_SIZE_LIMITS.mobile : MARKER_SIZE_LIMITS.desktop
  const hitMin = mobile ? HIT_TARGET_MIN_PX.mobile : HIT_TARGET_MIN_PX.desktop
  const widthPx = finitePositive(mapWidthPx) || 800
  const heightPx = finitePositive(mapHeightPx) || widthPx
  const realFootprint = blitzkitFootprint(vehicle)
  const metadataFootprint = realFootprint ? null : modelFootprint(model)
  const footprint = realFootprint || metadataFootprint || classFootprint(vehicle)
  const source = realFootprint ? 'blitzkit-hull' : (metadataFootprint ? 'hull-metadata' : 'class-fallback')
  const pixelsPerWorld = projectedPixelsPerWorld(mapView, widthPx, heightPx)
  const projectedWidth = footprint.width * pixelsPerWorld.x
  const projectedHeight = footprint.length * pixelsPerWorld.y
  const physicalLongEdge = Math.max(projectedWidth, projectedHeight)
  const renderSize = Math.min(limits.max, Math.max(limits.min, physicalLongEdge * READABILITY_SCALE))
  const footprintScale = physicalLongEdge > 0 ? renderSize / physicalLongEdge : 1
  const collisionFootprint = {
    width: Math.round(projectedWidth * footprintScale * 100) / 100,
    height: Math.round(projectedHeight * footprintScale * 100) / 100,
  }
  const hitSize = Math.max(renderSize + HIT_TARGET_EXTRA_PX, hitMin)

  return Object.freeze({
    renderBox: Object.freeze({ width: renderSize, height: renderSize }),
    collisionFootprint: Object.freeze(collisionFootprint),
    hitTarget: Object.freeze({ width: hitSize, height: hitSize }),
    source,
    footprint: Object.freeze({ width: footprint.width, length: footprint.length }),
  })
}
