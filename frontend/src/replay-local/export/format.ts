
import MAP_NAMES from '../../../../common/map_names.json'
import { hasText, javaRound, javaTrim } from '../compute/java.js'

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

const CN: ReadonlyMap<string, string> = new Map(
  Object.entries(MAP_NAMES as Record<string, MapNameNode>).map(([key, node]) => {
    let label: string = key
    if (node !== null && node !== undefined) {
      label = textOrNull(node) ?? (typeof node === 'object' ? textOrNull(node.zh) ?? textOrNull(node.en) : null) ?? key
    }
    return [normalizeKey(key), label]
  }),
)

export function mapNameCn(mapName: string): string {
  if (!hasText(mapName)) return mapName
  return CN.get(normalizeKey(mapName)) ?? mapName
}

export function r1(v: number): number {
  return javaRound(v * 10) / 10.0
}

export function duration(s: number | null): string {
  if (s === null) return ''
  const t = Math.trunc(Math.floor(s))
  return `${Math.trunc(t / 60)}分${t % 60}秒`
}

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

export function formatEpoch(epochSec: number | null, pattern: DatePattern, timeZone?: string): string {
  if (epochSec === null) return ''
  const parts: Record<string, string> = {}
  for (const p of formatter(timeZone).formatToParts(new Date(epochSec * 1000))) parts[p.type] = p.value
  const date = `${parts.year.padStart(4, '0')}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`
  return pattern === 'DT' ? `${date}:${parts.second}` : date
}

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

export function displayWidth(text: string): number {
  let w = 0
  for (let i = 0; i < text.length; i++) w += text.charCodeAt(i) > 0x2e7f ? 2 : 1
  return w
}

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
