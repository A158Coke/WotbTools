// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import ExcelJS from 'exceljs'
import { createI18n } from 'vue-i18n'
import { messages } from '../locales/messages.js'
import type { TournamentStandings } from '../api/tournament-points.js'
import { createTournamentPointsXlsx, printTournamentPoints, projectTournamentPoints, renderTournamentPointsPrintDocument } from './tournamentPointsExport.js'

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
    expect(sheet.views[0]).toMatchObject({ state: 'frozen', xSplit: 2, ySplit: 3 })
    expect(sheet.autoFilter).toBe(`A3:R5`)
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
