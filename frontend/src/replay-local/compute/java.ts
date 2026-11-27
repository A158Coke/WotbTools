
export function javaRound(v: number): number {
  if (Number.isNaN(v)) return 0
  if (v === Infinity) return Number.MAX_SAFE_INTEGER
  if (v === -Infinity) return Number.MIN_SAFE_INTEGER
  const r = Math.round(v)
  return r === 0 ? 0 : r
}

export function r1(v: number): number {
  return javaRound(v * 10) / 10.0
}

export function r2(v: number): number {
  return javaRound(v * 100) / 100.0
}

export function doubleCompare(a: number, b: number): number {
  if (a < b) return -1
  if (a > b) return 1
  const aNaN = Number.isNaN(a)
  const bNaN = Number.isNaN(b)
  if (aNaN || bNaN) return aNaN === bNaN ? 0 : aNaN ? 1 : -1
  const aNeg = Object.is(a, -0)
  const bNeg = Object.is(b, -0)
  return aNeg === bNeg ? 0 : aNeg ? -1 : 1
}

export function compareNumbers(a: number, b: number): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function isJavaWhitespace(code: number): boolean {
  if ((code >= 0x09 && code <= 0x0d) || (code >= 0x1c && code <= 0x1f)) return true
  if (code === 0x00a0 || code === 0x2007 || code === 0x202f) return false
  return /[\p{Zs}\p{Zl}\p{Zp}]/u.test(String.fromCodePoint(code))
}

export function hasText(s: string | null | undefined): s is string {
  if (s == null) return false
  for (const ch of s) {
    if (!isJavaWhitespace(ch.codePointAt(0) as number)) return true
  }
  return false
}

export function javaTrim(s: string): string {
  let start = 0
  let end = s.length
  while (start < end && s.charCodeAt(start) <= 0x20) start++
  while (end > start && s.charCodeAt(end - 1) <= 0x20) end--
  return s.substring(start, end)
}

function charUpper(ch: string): string {
  const u = ch.toUpperCase()
  return u.length === 1 ? u : ch
}

function charLower(ch: string): string {
  const l = ch.toLowerCase()
  return l.length === 1 ? l : ch
}

export function compareIgnoreCase(a: string, b: string): number {
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    let c1 = a[i]
    let c2 = b[i]
    if (c1 === c2) continue
    c1 = charUpper(c1)
    c2 = charUpper(c2)
    if (c1 === c2) continue
    c1 = charLower(c1)
    c2 = charLower(c2)
    if (c1 !== c2) return c1.charCodeAt(0) - c2.charCodeAt(0)
  }
  return a.length - b.length
}

export function maxBy<T>(items: readonly T[], cmp: (a: T, b: T) => number): T | null {
  let best: T | null = null
  for (const item of items) {
    if (best === null || cmp(best, item) < 0) best = item
  }
  return best
}

export function javaDoubleKey(v: number | null): string {
  if (v === null) return 'null'
  return Object.is(v, -0) ? '-0.0' : String(v)
}

export class DecimalSum {
  private mantissa = 0n
  private scale = 0

  add(v: number): void {
    if (!Number.isFinite(v)) {
      throw new RangeError(`BigDecimal.valueOf requires a finite double, got ${v}`)
    }
    const [m, s] = parseDecimal(String(v))
    if (s > this.scale) {
      this.mantissa *= 10n ** BigInt(s - this.scale)
      this.scale = s
      this.mantissa += m
    } else {
      this.mantissa += m * 10n ** BigInt(this.scale - s)
    }
  }

  doubleValue(): number {
    return Number(`${this.mantissa}e-${this.scale}`)
  }
}

function parseDecimal(text: string): [bigint, number] {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(text)
  if (!match) throw new RangeError(`unparseable decimal: ${text}`)
  const [, sign, intPart, fracPart = '', expPart = '0'] = match
  let mantissa = BigInt(intPart + fracPart)
  let scale = fracPart.length - Number(expPart)
  if (scale < 0) {
    mantissa *= 10n ** BigInt(-scale)
    scale = 0
  }
  return [sign === '-' ? -mantissa : mantissa, scale]
}
