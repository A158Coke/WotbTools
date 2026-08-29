/**
 * Rating V2 radar presentation adapter.
 *
 * The server owns V2's scoring-index normalization. This module only orders the six V2 axes, translates labels,
 * formats raw values, and computes the batch-average reference from the server-provided projection.
 */
import { scaleRadarSeries } from './radarScale.js'

const RATING_V2_RADAR_KEYS = Object.freeze([
  'potential_damage_avg',
  'kast',
  'impact',
  'assist_avg',
  'multi_damage_rate',
  'kills_avg',
])

const PERCENT_KEYS = new Set(['kast', 'impact', 'multi_damage_rate'])

const FRACTION_DIGITS = Object.freeze({
  potential_damage_avg: 1,
  kast: 1,
  impact: 1,
  assist_avg: 1,
  multi_damage_rate: 1,
  kills_avg: 2,
})

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

function formatRawValue(key, value, locale) {
  if (!isFiniteNumber(value)) return '--'
  const digits = FRACTION_DIGITS[key] ?? 1
  const text = new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(Number(value))
  return PERCENT_KEYS.has(key) ? text + '%' : text
}

function unavailableMetric(key, t) {
  return {
    key,
    label: t(`ratingV2.radar.labels.${key}`),
    rawValue: null,
    normalized: null,
    displayValue: '--',
    available: false,
  }
}

function toMetric(key, axis, t, locale) {
  if (!axis || axis.key !== key || axis.available !== true
    || !isFiniteNumber(axis.rawValue) || !isFiniteNumber(axis.normalized)) {
    return unavailableMetric(key, t)
  }
  return {
    key,
    label: t(`ratingV2.radar.labels.${key}`),
    rawValue: Number(axis.rawValue),
    normalized: Math.max(0, Math.min(1, Number(axis.normalized))),
    displayValue: formatRawValue(key, axis.rawValue, locale),
    available: true,
  }
}

/** Converts one admin API row into the generic PlayerRatingRadar metric contract. */
export function ratingV2RadarMetrics(row, t, locale) {
  const byKey = new Map((row?.radar || []).map(axis => [axis?.key, axis]))
  return RATING_V2_RADAR_KEYS.map(key => toMetric(key, byKey.get(key), t, locale))
}

/**
 * Builds the dashed batch-average reference. Membership is every returned V2 row; if any member lacks one selected
 * axis, the whole reference is unavailable rather than silently excluding it or treating the value as zero.
 */
export function ratingV2RadarBatchAverage(rows, t, locale) {
  const members = rows || []
  const perMember = members.map(row => ratingV2RadarMetrics(row, t, locale))
  return RATING_V2_RADAR_KEYS.map((key, index) => {
    const axes = perMember.map(metrics => metrics[index])
    if (axes.length === 0 || axes.some(axis => !axis.available)) {
      return unavailableMetric(key, t)
    }
    const rawValue = axes.reduce((sum, axis) => sum + axis.rawValue, 0) / axes.length
    const normalized = axes.reduce((sum, axis) => sum + axis.normalized, 0) / axes.length
    return {
      key,
      label: t(`ratingV2.radar.labels.${key}`),
      rawValue,
      normalized: Math.max(0, Math.min(1, normalized)),
      displayValue: formatRawValue(key, rawValue, locale),
      available: true,
    }
  })
}

/** Builds the selected player and its real batch average on the shared relative-performance scale. */
export function ratingV2RadarSeries(row, rows, t, locale) {
  return scaleRadarSeries(
    ratingV2RadarMetrics(row, t, locale),
    ratingV2RadarBatchAverage(rows, t, locale),
  )
}

export function ratingV2RadarComplete(metrics) {
  return metrics.length > 0 && metrics.every(metric => metric.available)
}
