const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI']

export function romanLevel(level) {
  const n = Number(level)
  if (!Number.isInteger(n) || n < 1) return ''
  return ROMAN[n - 1] || String(n)
}
