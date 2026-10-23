// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ExcelJS from 'exceljs'
import { createI18n } from 'vue-i18n'
import { messages } from '../locales/messages.js'
import type { TournamentStandings } from '../api/tournament-points.js'
import { createTournamentPointsCsv, createTournamentPointsXlsx, printTournamentPoints, projectTournamentCsv, projectTournamentPoints, renderTournamentPointsPrintDocument } from './tournamentPointsExport.js'
import { encodeCsv } from '../shared/tabular/csv/index.js'

const TOURNAMENT_CSV_FIXTURES = resolve(process.cwd(), '../common/fixtures/tournament/csv')
const tournamentCsvFixture = (name: string) => new Uint8Array(readFileSync(resolve(TOURNAMENT_CSV_FIXTURES, name)))

function standings(roundCount = 5, daysPerRound = 2): TournamentStandings {
  return {
    event: { id: 7, year: 2026, region: 'CN', season: 'SUMMER', roundCount, daysPerRound, dayLabels: ['小组赛', '决赛圈', 'Day 3'], version: 1, configLocked: true },
    days: [], rows: [
      { rank: 1, clanTag: '=SUM(A1:A2)', totalPoints: 100, rounds: [{ roundNumber: 1, totalPoints: 100, days: [{ dayNumber: 1, points: 0 }, { dayNumber: 2, points: 100 }] }] },
      { rank: 1, clanTag: '送葬者*', totalPoints: 100, rounds: [{ roundNumber: 1, totalPoints: 100, days: [{ dayNumber: 1, points: 100 }, { dayNumber: 2, points: null }] }] },
    ],
  } as TournamentStandings
}
const projection = (input = standings(), locale = 'zh') => {
  const i18n = createI18n({ legacy: false, locale, messages: messages as Record<string, any> })
  return projectTournamentPoints(input, locale, i18n.global.t)
}

function canonicalStandings(roundCount: number, daysPerRound: number, rows: readonly { clanTag: string; points: readonly (number | null)[]; total: number }[]): TournamentStandings {
  return {
    event: { id: 7, year: 2026, region: 'CN', season: 'SUMMER', roundCount, daysPerRound, dayLabels: Array.from({ length: daysPerRound }, (_, index) => `Day ${index + 1}`), version: 1, configLocked: true },
    days: [],
    rows: rows.map((row, index) => ({
      rank: index + 1,
      clanTag: row.clanTag,
      totalPoints: row.total,
      rounds: Array.from({ length: roundCount }, (_, roundIndex) => ({
        roundNumber: roundIndex + 1,
        totalPoints: 0,
        days: Array.from({ length: daysPerRound }, (_, dayIndex) => ({
          dayNumber: dayIndex + 1,
          points: row.points[roundIndex * daysPerRound + dayIndex],
        })),
      })),
    })),
  } as TournamentStandings
}

describe('public standings export projection', () => {
  it.each([[4, 2], [5, 2], [4, 3], [5, 3]])('projects the configured %i × %i matrix once without calculating scores', (rounds, days) => {
    const table = projection(standings(rounds, days))
    expect(table.columns).toHaveLength(3 + rounds * (days + 1))
    expect(table.columns.slice(0, 3).map(column => column.key)).toEqual(['rank', 'clan_tag', 'total_points'])
    expect(table.columns[3].label).toBe('第 1 轮 · 小组赛')
    expect(table.columns[4].label).toBe('第 1 轮 · 决赛圈')
    expect(table.columns.at(-1)?.kind).toBe('round-total')
    expect(table.rows[0].cells.slice(0, 6)).toEqual(days === 2 ? [1, '=SUM(A1:A2)', 100, 0, 100, 100] : [1, '=SUM(A1:A2)', 100, 0, 100, null])
    expect(table.rows[1].cells[4]).toBeNull()
    expect(table.rows[1].cells[2]).toBe(100)
  })

  it('freezes every value and label before a source or locale change', () => {
    const input = standings()
    const i18n = createI18n({ legacy: false, locale: 'en', messages: messages as Record<string, any> })
    const table = projectTournamentPoints(input, 'en', i18n.global.t)
    input.event.year = 2025
    input.rows[0].clanTag = 'other'
    input.rows[0].rounds[0].days[0].points = 999
    i18n.global.locale.value = 'ru'
    expect(table.identity).toContain('2026')
    expect(table.columns[0].label).toBe('Rank')
    expect(table.rows[0].cells[1]).toBe('=SUM(A1:A2)')
    expect(table.rows[0].cells[3]).toBe(0)
    expect(Object.isFrozen(table.rows[0].cells)).toBe(true)
  })

  it.each(['zh', 'en', 'ru'])('uses the chosen %s language for standard day labels', locale => {
    const input = standings(4, 3)
    input.event.dayLabels = ['Day 1', 'Day 2', 'Day 3']
    const table = projection(input, locale)
    const i18n = createI18n({ legacy: false, locale, messages: messages as Record<string, any> })
    expect(table.columns[5].label).toBe(`${i18n.global.t('tournament.round', { number: 1 })} · ${i18n.global.t('tournament.day', { number: 3 })}`)
  })
})

describe('canonical Tournament CSV contract', () => {
  it.each([
    ['4x2.csv', 4, 2, [
      { clanTag: '-KSR-', points: [100, null, 0, 50, null, 25, 10, 15], total: 200 },
      { clanTag: '雪,豹*', points: [0, 0, null, 0, 0, null, 0, 0], total: 0 },
      { clanTag: '=SUM(A1:A2)', points: [1, null, null, null, null, null, null, 1], total: 2 },
    ]],
    ['5x3.csv', 5, 3, [
      { clanTag: 'ALPHA*', points: [100, null, 0, 50, null, 25, 10, 15, null, 20, 0, 30, null, 40, 10], total: 300 },
      { clanTag: '雪,豹*', points: [0, 100, null, 0, 100, null, 0, 100, null, 0, 100, null, 0, 100, null], total: 500 },
      { clanTag: '=CMD+1', points: [1, ...Array(14).fill(null)], total: 1 },
    ]],
  ] as const)('matches %s exact bytes with fixed locale-independent headers and null/zero values', (fixtureName, rounds, days, rows) => {
    const document = projectTournamentCsv(canonicalStandings(rounds, days, [...rows]))
    expect(document.headers).toEqual(['军团标签', ...Array.from({ length: rounds * days }, (_, index) => `R${Math.floor(index / days) + 1}D${(index % days) + 1}`), '总积分'])
    expect(encodeCsv(document, { includeBom: false })).toEqual(tournamentCsvFixture(fixtureName))
    expect(document.rows[0][2]).toBe('')
    expect(document.rows[0][3]).toBe('0')
    expect(document.rows.at(-1)?.[0]).toBe(rows.at(-1)?.clanTag)
  })

  it('creates a stable CSV filename and UTF-8 download without rewriting formula-like clan identity', async () => {
    const file = createTournamentPointsCsv(canonicalStandings(4, 2, [
      { clanTag: '=SUM(A1:A2)', points: [1, null, null, null, null, null, null, 1], total: 2 },
    ]))
    expect(file.filename).toBe('2026_CN_SUMMER.csv')
    expect(file.blob.type).toBe('text/csv;charset=utf-8')
    expect(await file.blob.text()).toContain('=SUM(A1:A2)')
    expect([...new Uint8Array(await file.blob.arrayBuffer()).slice(0, 3)]).not.toEqual([0xef, 0xbb, 0xbf])
  })
})

describe('stage preset day labels follow the viewer language', () => {
  it.each([
    ['en', 'Round 1 · Group stage', 'Round 1 · Finals'],
    ['ru', 'Этап 1 · Групповой этап', 'Этап 1 · Финал'],
  ])('%s: a Chinese-stored 小组赛 / 决赛圈 preset is shown in the current language', (locale, group, finals) => {
    const table = projection(standings(), locale)
    expect(table.columns[3].label).toBe(group)
    expect(table.columns[4].label).toBe(finals)
  })

  it('keeps administrator custom names verbatim', () => {
    const input = standings()
    input.event.dayLabels = ['A 组', 'Grand Final']
    const table = projection(input, 'en')
    expect(table.columns[3].label).toBe('Round 1 · A 组')
    expect(table.columns[4].label).toBe('Round 1 · Grand Final')
  })
})

describe('real xlsx bytes', () => {
  it('keeps year, region code and localized season intact for Russian North America Fire Cup', async () => {
    const input = standings()
    input.event.region = 'NA'
    input.event.season = 'FIRE_CUP'
    const table = projection(input, 'ru')
    const file = await createTournamentPointsXlsx(table)
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(await file.blob.arrayBuffer())
    const sheet = workbook.worksheets[0]
    expect(sheet.name).toBe('2026_NA_Кубок огня')
    expect(sheet.name.length).toBeLessThanOrEqual(31)
    expect(sheet.name).not.toMatch(/[\\/*?:\[\]]/)
    expect(sheet.getCell('A1').value).toContain('2026 · Северная Америка · Кубок огня')
    expect(file.filename).toContain('Северная_Америка_·_Кубок_огня')
  })

  it('uses the complete season code when a localized season cannot fit the sheet name', async () => {
    const input = standings()
    input.event.region = 'NA'
    input.event.season = 'FIRE_CUP'
    const i18n = createI18n({ legacy: false, locale: 'ru', messages: messages as Record<string, any> })
    const t = (key: string, params?: { number: number }) => key === 'tournament.seasons.FIRE_CUP' ? 'Очень длинное название сезона турнира' : i18n.global.t(key, params ?? {})
    const table = projectTournamentPoints(input, 'ru', t)
    const file = await createTournamentPointsXlsx(table)
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(await file.blob.arrayBuffer())
    expect(workbook.worksheets[0].name).toBe('2026_NA_FIRE_CUP')
    expect(workbook.worksheets[0].getCell('A1').value).toContain('Очень длинное название сезона турнира')
  })

  it('round-trips the complete selected tournament with numeric scores, blank omissions and text tags', async () => {
    const table = projection()
    const file = await createTournamentPointsXlsx(table)
    expect(file.filename).toContain('2026_·_国服_·_夏季赛')
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(await file.blob.arrayBuffer())
    const sheet = workbook.worksheets[0]
    expect(sheet.getCell('A1').value).toBe(table.title)
    expect(sheet.getCell('A2').value).toBe(table.finalizedLabel)
    expect(sheet.columnCount).toBe(table.columns.length)
    expect(sheet.rowCount).toBe(5)
    const headers = sheet.getRow(3).values
    expect(Array.isArray(headers) ? headers.slice(1) : []).toEqual(table.columns.map(column => column.label))
    expect(sheet.getCell('B4').type).toBe(ExcelJS.ValueType.String)
    expect(sheet.getCell('B4').value).toBe('=SUM(A1:A2)')
    expect(sheet.getCell('B4').numFmt).toBe('@')
    expect(sheet.getCell('C4').type).toBe(ExcelJS.ValueType.Number)
    expect(sheet.getCell('D4').value).toBe(0)
    expect(sheet.getCell('E5').value).toBeNull()
    expect(sheet.getCell('B5').value).toBe('送葬者*')
    expect(sheet.getCell('B1').isMerged).toBe(true)
    expect(sheet.getCell('B2').isMerged).toBe(true)
    expect(sheet.getColumn(1).width).toBe(8)
    expect(sheet.getColumn(2).width).toBe(24)
    expect(sheet.getColumn(3).width).toBe(16)
    expect(sheet.getCell('A3').font).toMatchObject({ bold: true, size: 11 })
    expect(sheet.getCell('A3').alignment).toMatchObject({ horizontal: 'left', vertical: 'middle', wrapText: true })
    expect(sheet.getCell('B4').alignment).toMatchObject({ horizontal: 'left', vertical: 'middle', wrapText: true })
    expect(sheet.getCell('C4').numFmt).toBe('0')
    expect(sheet.getRow(1).height).toBe(30)
    expect(sheet.getRow(3).height).toBe(42)
    expect(sheet.views[0]).toMatchObject({ state: 'frozen', xSplit: 2, ySplit: 3 })
    expect(sheet.autoFilter).toBe(`A3:R5`)
    expect(sheet.pageSetup).toMatchObject({ orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '1:3' })
  })
})

describe('standalone printable text document', () => {
  it('keeps the entire matrix, repeatable header, locale and escaped text separate from the application', () => {
    const input = standings(5, 3)
    input.rows[0].clanTag = '<img src=x onerror=alert(1)>'
    const table = projection(input)
    const doc = document.implementation.createHTMLDocument('old')
    renderTournamentPointsPrintDocument(doc, table)
    expect(doc.title).toBe(table.title)
    expect(doc.documentElement.lang).toBe('zh')
    expect(doc.body.className).toBe('wide-paper')
    expect(doc.querySelectorAll('thead tr')).toHaveLength(3)
    expect(doc.querySelectorAll('thead tr:last-child th')).toHaveLength(23)
    expect(doc.querySelectorAll('tbody tr')).toHaveLength(2)
    expect(doc.querySelector('tbody tr:last-child')?.children[4].textContent).toBe('')
    expect(doc.querySelector('tbody tr')?.children[3].textContent).toBe('0')
    expect(doc.body.textContent).toContain('<img src=x onerror=alert(1)>')
    expect(doc.querySelector('img')).toBeNull()
    expect(doc.querySelector('nav, button, a')).toBeNull()
  })

  it('reports a blocked popup, then lets a subsequent click print and close after the dialog', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValueOnce(null)
    await expect(printTournamentPoints(projection())).rejects.toThrow('PRINT_WINDOW_BLOCKED')
    const doc = document.implementation.createHTMLDocument('print')
    const target = { document: doc, opener: window, print: vi.fn(), focus: vi.fn(), close: vi.fn(), addEventListener: vi.fn() }
    open.mockReturnValueOnce(target as unknown as Window)
    await printTournamentPoints(projection())
    expect(target.opener).toBeNull()
    expect(target.print).toHaveBeenCalledOnce()
    expect(target.close).not.toHaveBeenCalled()
    const afterprint = target.addEventListener.mock.calls[0][1] as () => void
    afterprint()
    expect(target.close).toHaveBeenCalledOnce()
    open.mockRestore()
  })
})
