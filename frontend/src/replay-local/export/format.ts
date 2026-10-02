/**
 * 导出层的值格式化（Java `ExcelStyles` 静态助手 + `MapNames.cn` + `Players.TEAM_NAME` +
 * `Columns.displayWidth`），逐字符对齐服务端 xlsx。
 */

import MAP_NAMES from '../../../../common/map_names.json'
import { hasText, javaRound, javaTrim } from '../compute/java.js'

/** Java `Players.TEAM_NAME.getOrDefault(winner ?? 0, "平局/未知")`。 */
export function teamName(winnerTeam: number | null): string {
  const team = winnerTeam ?? 0
  return team === 1 ? '队伍A' : team === 2 ? '队伍B' : '平局/未知'
}

type MapNameNode = string | { zh?: unknown; en?: unknown } | null

function textOrNull(v: unknown): string | null {
  return typeof v === 'string' && hasText(v) ? v : null
}

function normalizeKey(mapName: string): string {
  return javaTrim(mapName.toLowerCase())
}

/** `MapNames.loadChineseNames`：直接字符串 → zh → en → 原 key。 */
const CN: ReadonlyMap<string, string> = new Map(
  Object.entries(MAP_NAMES as Record<string, MapNameNode>).map(([key, node]) => {
    let label: string = key
    if (node !== null && node !== undefined) {
      label = textOrNull(node) ?? (typeof node === 'object' ? textOrNull(node.zh) ?? textOrNull(node.en) : null) ?? key
    }
    return [normalizeKey(key), label]
  }),
)

/** Java `MapNames.cn`：中文名，未收录原样返回；空白原样返回。 */
export function mapNameCn(mapName: string): string {
  if (!hasText(mapName)) return mapName
  return CN.get(normalizeKey(mapName)) ?? mapName
}

/** Java `ExcelStyles.r1`。 */
export function r1(v: number): number {
  return javaRound(v * 10) / 10.0
}

/** Java `ExcelStyles.duration`：`(int) floor(s)` → `m分s秒`；null → 空串。 */
export function duration(s: number | null): string {
  if (s === null) return ''
  const t = Math.trunc(Math.floor(s))
  return `${Math.trunc(t / 60)}分${t % 60}秒`
}

/** `yyyy-MM-dd HH:mm:ss`（DT）或 `yyyy-MM-dd HH:mm`（DT_MIN）。 */
export type DatePattern = 'DT' | 'DT_MIN'

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatter(timeZone: string | undefined): Intl.DateTimeFormat {
  const key = timeZone ?? ''
  let f = formatters.get(key)
  if (f === undefined) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hourCycle: 'h23',
    })
    formatters.set(key, f)
  }
  return f
}

/**
 * Java `ExcelStyles.fmt(epochSec, f)`：epoch 秒 → 本地时间文本；null → 空串。
 *
 * Java 用 `ZoneId.systemDefault()`（服务器时区）；客户端对应的是浏览器本地时区
 * （`timeZone` 省略时），测试固定传 IANA 时区以对齐 golden。
 */
export function formatEpoch(epochSec: number | null, pattern: DatePattern, timeZone?: string): string {
  if (epochSec === null) return ''
  const parts: Record<string, string> = {}
  for (const p of formatter(timeZone).formatToParts(new Date(epochSec * 1000))) parts[p.type] = p.value
  const date = `${parts.year.padStart(4, '0')}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`
  return pattern === 'DT' ? `${date}:${parts.second}` : date
}

/** Java `Double.toString(double)`（JDK 19+ 最短往返表示）。 */
export function javaDoubleToString(v: number): string {
  if (Number.isNaN(v)) return 'NaN'
  if (v === Infinity) return 'Infinity'
  if (v === -Infinity) return '-Infinity'
  if (v === 0) return Object.is(v, -0) ? '-0.0' : '0.0'
  const abs = Math.abs(v)
  if (abs >= 1e-3 && abs < 1e7) {
    const s = String(v)
    return s.includes('.') ? s : `${s}.0`
  }
  const [mantissa, exp] = v.toExponential().split('e')
  return `${mantissa.includes('.') ? mantissa : `${mantissa}.0`}E${Number(exp)}`
}

/** Java `Columns.displayWidth`：code unit > U+2E7F 计 2，其余计 1。 */
export function displayWidth(text: string): number {
  let w = 0
  for (let i = 0; i < text.length; i++) w += text.charCodeAt(i) > 0x2e7f ? 2 : 1
  return w
}

/** 0 基列号 → Excel 列字母（0 → A，26 → AA）。 */
export function columnLetter(index: number): string {
  let n = index + 1
  let s = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    s = String.fromCharCode(65 + rem) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}
