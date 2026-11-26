const UNIT = 1000

export function formatXpCompact(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return ''
  if (n < UNIT) return String(Math.round(n))
  const k = Math.round((n / UNIT) * 10) / 10
  return `${k}k`
}
