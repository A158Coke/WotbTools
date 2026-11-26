export function isCompactShotResultCard(viewportWidth, viewportHeight) {
  if (!Number.isFinite(viewportWidth) || !Number.isFinite(viewportHeight)) return false
  return (viewportWidth < 768 && viewportHeight > viewportWidth) || viewportHeight < 520
}

export function shotResultCardScale(viewportWidth, viewportHeight) {
  if (!isCompactShotResultCard(viewportWidth, viewportHeight)) return 1
  const shortSide = Math.min(viewportWidth, viewportHeight)
  return Math.max(0.88, Math.min(1, shortSide / 520))
}

const SCALED_FIELDS = [
  'topFont', 'titleFont', 'damageFont', 'chanceFont', 'expectedFont', 'expectedLine',
  'layerFont', 'layerLine', 'bulletWidth', 'indexWidth', 'inlineGap', 'damageGap',
  'marginTight', 'marginNormal',
]

const round1 = (value) => Math.round(value * 10) / 10

function scaleMetrics(metrics, scale) {
  if (scale === 1) return metrics
  const scaled = { ...metrics }
  for (const field of SCALED_FIELDS) scaled[field] = round1(metrics[field] * scale)
  scaled.padding = metrics.padding
    .split(' ')
    .map((part) => (/^-?\d+(?:\.\d+)?px$/.test(part) ? `${round1(parseFloat(part) * scale)}px` : part))
    .join(' ')
  return scaled
}

export function shotResultCardMetrics(compact, scale = 1) {
  const metrics = compact
    ? {
        padding: '4px 8px',
        radius: 7,
        borderWidth: 3,
        topFont: 10,
        titleFont: 13,
        damageFont: 12,
        chanceFont: 11,
        expectedFont: 10,
        expectedLine: 13,
        layerFont: 11,
        layerLine: 15,
        bulletWidth: 10,
        indexWidth: 14,
        inlineGap: 6,
        damageGap: 5,
        marginTight: 1,
        marginNormal: 3,
      }
    : {
        padding: '10px 16px',
        radius: 10,
        borderWidth: 4,
        topFont: 12,
        titleFont: 18,
        damageFont: 16,
        chanceFont: 14,
        expectedFont: 12,
        expectedLine: 18,
        layerFont: 13,
        layerLine: 20,
        bulletWidth: 14,
        indexWidth: 20,
        inlineGap: 14,
        damageGap: 8,
        marginTight: 4,
        marginNormal: 6,
      }
  return scaleMetrics(metrics, Number.isFinite(scale) && scale > 0 ? scale : 1)
}

export function shotResultCardMaxWidth(hostWidth, viewportWidth, viewportHeight) {
  const width = Number(hostWidth)
  if (!(width > 0)) return null
  const compact = isCompactShotResultCard(viewportWidth, viewportHeight)
  const fitted = Math.max(compact ? 180 : 220, Math.floor(width - (compact ? 16 : 32)))
  if (!compact) return fitted
  return Math.min(fitted, 360, Math.round(width * 0.82))
}
