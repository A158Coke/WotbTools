/**
 * Shared presentation-only Radar scale.
 *
 * The business score/raw value stays untouched. Geometry is relative to the
 * current reference cohort: average=75, 2x average=100, 4x=125, >=8x=150.
 */
export const RADAR_AVERAGE_VALUE = 75
export const RADAR_STRONG_VALUE = 100
export const RADAR_DISPLAY_CAP = 150
const RADAR_ABOVE_AVERAGE_STEP = RADAR_STRONG_VALUE - RADAR_AVERAGE_VALUE

const isFiniteRaw = value => typeof value === 'number' && Number.isFinite(value)

export function radarVisualValue(playerRaw, referenceRaw) {
  if (!isFiniteRaw(playerRaw) || !isFiniteRaw(referenceRaw)) return null
  const player = playerRaw
  const reference = referenceRaw
  if (player < 0 || reference <= 0) return null
  const relative = player / reference
  const visual = relative <= 1
    ? RADAR_AVERAGE_VALUE * relative
    : RADAR_AVERAGE_VALUE + RADAR_ABOVE_AVERAGE_STEP * Math.log2(relative)
  return Math.min(RADAR_DISPLAY_CAP, Math.max(0, visual))
}

export function radarRadiusRatio(visualValue) {
  if (!isFiniteRaw(visualValue)) return null
  return Math.min(1, Math.max(0, visualValue / RADAR_DISPLAY_CAP))
}

/** Resolve the 0..150 score consumed by chart labels and score-mode details. */
export function radarAxisVisualScore(axis) {
  if (axis?.available !== true) return null
  if (isFiniteRaw(axis.visualValue)) {
    return Math.min(RADAR_DISPLAY_CAP, Math.max(0, axis.visualValue))
  }
  if (isFiniteRaw(axis.normalized)) {
    return Math.min(1, Math.max(0, axis.normalized)) * RADAR_DISPLAY_CAP
  }
  return null
}

export function formatRadarVisualScore(axis) {
  const score = radarAxisVisualScore(axis)
  return score == null ? '--' : String(Math.round(score))
}

function unavailable(axis) {
  return { ...axis, visualValue: null, normalized: null, available: false }
}

/**
 * Scales player/reference axes together while preserving raw/display values.
 * Returned reference axes follow player order and form a regular 75 ring.
 */
export function scaleRadarSeries(metrics = [], reference = []) {
  const referenceByKey = new Map((reference || []).map(axis => [axis?.key, axis]))
  const scaledMetrics = []
  const scaledReference = []

  for (const metric of metrics || []) {
    const ref = referenceByKey.get(metric?.key)
    const usable = metric?.available === true && ref?.available === true
    const visualValue = usable ? radarVisualValue(metric.rawValue, ref.rawValue) : null
    if (visualValue == null) {
      scaledMetrics.push(unavailable(metric || {}))
      scaledReference.push(unavailable(ref || { key: metric?.key }))
      continue
    }
    scaledMetrics.push({
      ...metric,
      visualValue,
      normalized: radarRadiusRatio(visualValue),
      available: true,
    })
    scaledReference.push({
      ...ref,
      visualValue: RADAR_AVERAGE_VALUE,
      normalized: radarRadiusRatio(RADAR_AVERAGE_VALUE),
      available: true,
    })
  }

  return { metrics: scaledMetrics, reference: scaledReference }
}
