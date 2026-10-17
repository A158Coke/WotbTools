// Viewer uses IANA zones (including historical DST); editor uses explicit offsets
// so a repeated or missing local hour never silently changes the entered instant.
export const BROADCAST_DISPLAY_ZONES = ['Asia/Shanghai', 'UTC', 'America/Los_Angeles', 'Europe/Berlin', 'Europe/Moscow'] as const
export const BROADCAST_INPUT_OFFSETS = [480, 0, -480, -420, 60, 120, 180] as const
export const BROADCAST_ADMIN_OFFSET = 480
const formatters = new Map<string, Intl.DateTimeFormat>()

function parts(startsAt: string, timeZone: string, locale = 'en') {
  const key = `${locale}:${timeZone}`
  let formatter = formatters.get(key)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, { timeZone, calendar: 'gregory', numberingSystem: 'latn',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'shortOffset' })
    formatters.set(key, formatter)
  }
  return Object.fromEntries(formatter.formatToParts(new Date(startsAt)).map(part => [part.type, part.value]))
}

export function broadcastMatchDate(startsAt: string, timeZone: string): string {
  const p = parts(startsAt, timeZone)
  return `${p.year.padStart(4, '0')}-${p.month}-${p.day}`
}

export function formatBroadcastDate(matchDate: string, startsAt: string | null, timeZone: string, locale: string): string {
  if (!startsAt) return matchDate
  const p = parts(startsAt, timeZone, locale)
  const offset = p.timeZoneName.replace('GMT', 'UTC').replace('UTC−', 'UTC-')
  return `${p.year.padStart(4, '0')}-${p.month}-${p.day} ${p.hour}:${p.minute} ${offset}`
}

export function broadcastInputFields(matchDate: string, startsAt: string | null, offset = BROADCAST_ADMIN_OFFSET) {
  if (!startsAt) return { matchDate, time: '' }
  const local = new Date(new Date(startsAt).getTime() + offset * 60_000).toISOString()
  return { matchDate: local.slice(0, 10), time: local.slice(11, 23).replace(/\.000$/, '') }
}

/** null is date-only; undefined is an invalid wall time/date, never a guessed time. */
export function broadcastInputInstant(date: string, time: string, offset: number): string | null | undefined {
  if (!time) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?$/.test(time)
    || !BROADCAST_INPUT_OFFSETS.includes(offset as typeof BROADCAST_INPUT_OFFSETS[number])) return undefined
  const wall = new Date(`${date}T${time}Z`)
  if (!Number.isFinite(wall.getTime()) || wall.toISOString().slice(0, 10) !== date || wall.toISOString().slice(11, 16) !== time.slice(0, 5)) return undefined
  const instant = new Date(wall.getTime() - offset * 60_000).toISOString()
  return /^\d{4}-/.test(instant) ? instant : undefined
}
