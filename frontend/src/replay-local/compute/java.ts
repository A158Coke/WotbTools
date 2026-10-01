/**
 * Java 语义原语：移植计算层时凡是 JS 默认行为与 Java 不同之处，都在这里集中实现，
 * 保证数值与排序逐位一致（golden parity）。
 */

/** Java `Math.round(double)` → long：half-up；NaN → 0；±∞ 饱和；不产生 -0。 */
export function javaRound(v: number): number {
  if (Number.isNaN(v)) return 0
  if (v === Infinity) return Number.MAX_SAFE_INTEGER
  if (v === -Infinity) return Number.MIN_SAFE_INTEGER
  const r = Math.round(v)
  return r === 0 ? 0 : r
}

/** 一位小数（Java `Math.round(v * 10) / 10.0`）。 */
export function r1(v: number): number {
  return javaRound(v * 10) / 10.0
}

/** 两位小数（Java `Math.round(v * 100) / 100.0`）。 */
export function r2(v: number): number {
  return javaRound(v * 100) / 100.0
}

/** Java `Double.compare`：-0.0 < 0.0，NaN 最大且等于自身。 */
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

/** 整数/long/boolean 比较（Java `Integer.compare` / `Long.compare` / `Boolean.compare`）。 */
export function compareNumbers(a: number, b: number): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** Java `String.compareTo`：UTF-16 code unit 字典序。 */
export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** Java `Character.isWhitespace(int)`。 */
function isJavaWhitespace(code: number): boolean {
  if ((code >= 0x09 && code <= 0x0d) || (code >= 0x1c && code <= 0x1f)) return true
  if (code === 0x00a0 || code === 0x2007 || code === 0x202f) return false
  return /[\p{Zs}\p{Zl}\p{Zp}]/u.test(String.fromCodePoint(code))
}

/** Spring `StringUtils.hasText`（= 非 null 且 `!String.isBlank()`）。 */
export function hasText(s: string | null | undefined): s is string {
  if (s == null) return false
  for (const ch of s) {
    if (!isJavaWhitespace(ch.codePointAt(0) as number)) return true
  }
  return false
}

/** Java `String.trim()`：去掉两端 code unit <= U+0020 的字符（不同于 JS trim）。 */
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

/** Java `String.CASE_INSENSITIVE_ORDER`（逐 code unit：先 toUpperCase 再 toLowerCase 比较）。 */
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

/** Java `Stream.max(comparator)`：并列时保留先出现者（`BinaryOperator.maxBy`）。 */
export function maxBy<T>(items: readonly T[], cmp: (a: T, b: T) => number): T | null {
  let best: T | null = null
  for (const item of items) {
    if (best === null || cmp(best, item) < 0) best = item
  }
  return best
}

/** 指纹用的 Java `Double.toString` 等价键：只需与 double 相等性同构（-0.0 与 0.0 不同）。 */
export function javaDoubleKey(v: number | null): string {
  if (v === null) return 'null'
  return Object.is(v, -0) ? '-0.0' : String(v)
}

/**
 * `BigDecimal` 精确十进制累加（`sum = sum.add(BigDecimal.valueOf(d))` → `sum.doubleValue()`）。
 *
 * `BigDecimal.valueOf(d)` = `new BigDecimal(Double.toString(d))`；JDK 19+ 的 `Double.toString`
 * 与 JS `String(number)` 都输出最短可往返十进制（同一最近值选择规则），因此数字串一致；
 * `doubleValue()` 正确舍入，与 `Number(十进制串)` 一致。
 */
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

/** 十进制串 → (mantissa, scale)，value = mantissa × 10^-scale；scale 可为负时折算到 mantissa。 */
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
