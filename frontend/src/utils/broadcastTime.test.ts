import { describe, expect, it } from 'vitest'
import { broadcastInputFields, broadcastInputInstant, broadcastMatchDate, formatBroadcastDate } from './broadcastTime.js'

describe('broadcast time conversion without the browser time zone', () => {
  it('converts APAC 19:00 and Pacific 18:00 into absolute UTC instants', () => {
    expect(broadcastInputInstant('2026-08-16', '19:00', 480)).toBe('2026-08-16T11:00:00.000Z')
    expect(broadcastInputInstant('2026-08-16', '18:00', -420)).toBe('2026-08-17T01:00:00.000Z')
    expect(broadcastMatchDate('2026-08-17T01:00:00Z', 'America/Los_Angeles')).toBe('2026-08-16')
  })
  it.each([
    ['2026-01-16T11:00:00Z', 'America/Los_Angeles', '2026-01-16 03:00 UTC-8'],
    ['2026-08-16T11:00:00Z', 'America/Los_Angeles', '2026-08-16 04:00 UTC-7'],
    ['2026-01-16T11:00:00Z', 'Europe/Berlin', '2026-01-16 12:00 UTC+1'],
    ['2026-08-16T11:00:00Z', 'Europe/Berlin', '2026-08-16 13:00 UTC+2'],
    ['2025-12-31T23:30:00Z', 'Asia/Shanghai', '2026-01-01 07:30 UTC+8'],
    ['2026-03-01T00:30:00Z', 'America/Los_Angeles', '2026-02-28 16:30 UTC-8'],
  ])('uses historical DST and calendar boundaries for %s in %s', (instant, zone, expected) => {
    for (const locale of ['zh', 'en', 'ru']) expect(formatBroadcastDate('unused', instant, zone, locale)).toBe(expected)
  })
  it('never moves a date-only record or invents midnight', () => {
    expect(formatBroadcastDate('2026-01-01', null, 'America/Los_Angeles', 'zh')).toBe('2026-01-01')
    expect(broadcastInputFields('2026-01-01', null, -480)).toEqual({ matchDate: '2026-01-01', time: '' })
    expect(broadcastInputInstant('2026-01-01', '', 480)).toBeNull()
  })
  it('defaults admin input to UTC+8 and preserves seconds while changing offsets', () => {
    const instant = '2025-12-31T23:45:37.123Z'
    expect(broadcastInputFields('', instant)).toEqual({ matchDate: '2026-01-01', time: '07:45:37.123' })
    for (const offset of [-480, -420, 0, 60, 120, 180, 480]) {
      const value = broadcastInputFields('', instant, offset)
      expect(broadcastInputInstant(value.matchDate, value.time, offset)).toBe(instant)
    }
  })
  it.each([
    ['2026-02-30', '10:00', 480], ['2026-01-01', '24:00', 480], ['2026-01-01', '10:99', 480],
    ['2026-01-01', '10:00', 45], ['', '10:00', 480], ['bad', 'bad', 480],
  ])('rejects invalid wall input %s %s', (date, time, offset) => {
    expect(broadcastInputInstant(date as string, time as string, offset as number)).toBeUndefined()
  })
  it('keeps the two repeated DST hours explicit through their chosen fixed offset', () => {
    expect(broadcastInputInstant('2026-11-01', '01:30', -420)).toBe('2026-11-01T08:30:00.000Z')
    expect(broadcastInputInstant('2026-11-01', '01:30', -480)).toBe('2026-11-01T09:30:00.000Z')
  })
})
