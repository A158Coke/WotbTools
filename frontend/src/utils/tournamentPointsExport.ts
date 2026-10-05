import type { TournamentStandings } from '../api/tournament-points.js'
import { sanitizeFilename } from './exportReplayPng.js'
import printStyles from '../styles/tokens/tournament-print.css?inline'

type Translate = (key: string, params?: { number: number }) => string
type Cell = number | string | null
type ColumnKind = 'rank' | 'clan' | 'total' | 'day' | 'round-total'
interface Column { key: string; label: string; kind: ColumnKind }
export interface TournamentTableProjection {
  title: string
  identity: string
  sheetName: string
  locale: string
  finalizedLabel: string
  columns: readonly Column[]
  rows: readonly { clanTag: string; cells: readonly Cell[] }[]
}

/** Shared display/export projection: labels and server scores are copied synchronously. */
export function projectTournamentPoints(standings: TournamentStandings, locale: string, t: Translate): TournamentTableProjection {
  const event = standings.event
  const seasonLabel = t('tournament.seasons.' + event.season)
  const identity = `${event.year} · ${t('tournament.regions.' + event.region)} · ${seasonLabel}`
  const localizedSheetName = `${event.year}_${event.region}_${seasonLabel}`.replace(/[\\/*?:\[\]\x00-\x1f]/g, '_').replace(/'$/g, '_')
  // Excel's 31-character cap must not erase the season from a long localized identity.
  const sheetName = localizedSheetName.length <= 31 ? localizedSheetName : `${event.year}_${event.region}_${event.season}`
  const columns: Column[] = [
    { key: 'rank', label: t('tournament.rank'), kind: 'rank' },
    { key: 'clan_tag', label: t('tournament.clan'), kind: 'clan' },
    { key: 'total_points', label: t('tournament.total'), kind: 'total' },
  ]
  for (let round = 1; round <= event.roundCount; round++) {
    for (let day = 1; day <= event.daysPerRound; day++) {
      const configured = event.dayLabels[day - 1]
      const dayLabel = !configured || /^Day \d+$/.test(configured) ? t('tournament.day', { number: day }) : configured
      columns.push({ key: `round_${round}_day_${day}_points`, label: `${t('tournament.round', { number: round })} · ${dayLabel}`, kind: 'day' })
    }
    columns.push({ key: `round_${round}_total_points`, label: t('tournament.roundTotal', { number: round }), kind: 'round-total' })
  }
  const rows = standings.rows.map(row => {
    const cells: Cell[] = [row.rank, row.clanTag, row.totalPoints]
    for (let round = 1; round <= event.roundCount; round++) {
      const score = row.rounds.find(value => value.roundNumber === round)
      for (let day = 1; day <= event.daysPerRound; day++) {
        cells.push(score?.days.find(value => value.dayNumber === day)?.points ?? null)
      }
      cells.push(score?.totalPoints ?? null)
    }
    return Object.freeze({ clanTag: row.clanTag, cells: Object.freeze(cells) })
  })
  return Object.freeze({
    title: `${identity} · ${t('tournament.title')}`, identity, sheetName, locale,
    finalizedLabel: t('tournament.exportFinalized'),
    columns: Object.freeze(columns.map(column => Object.freeze(column))), rows: Object.freeze(rows),
  })
}

/** No formulas or score recalculation: all numbers are the public API's finalized values. */
export async function createTournamentPointsXlsx(table: TournamentTableProjection): Promise<{ blob: Blob; filename: string }> {
  const module = await import('exceljs')
  const ExcelJS = module.default ?? module
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet(table.sheetName, {
    views: [{ state: 'frozen', xSplit: 2, ySplit: 3 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '1:3' },
  })
  sheet.addRow([table.title])
  sheet.mergeCells(1, 1, 1, table.columns.length)
  sheet.addRow([table.finalizedLabel])
  sheet.mergeCells(2, 1, 2, table.columns.length)
  sheet.addRow(table.columns.map(column => column.label))
  table.rows.forEach(row => sheet.addRow([...row.cells]))
  table.columns.forEach((column, index) => {
    const target = sheet.getColumn(index + 1)
    target.width = column.kind === 'clan' ? 24 : column.kind === 'rank' ? 8 : 16
    target.alignment = { horizontal: column.kind === 'clan' ? 'left' : 'right', vertical: 'middle', wrapText: true }
    if (column.kind === 'clan') {
      // ExcelJS treats string values as text; '@' also preserves tag punctuation in Excel.
      for (let row = 4; row <= sheet.rowCount; row++) sheet.getCell(row, index + 1).numFmt = '@'
    } else target.numFmt = '0'
  })
  for (let row = 1; row <= 3; row++) {
    sheet.getRow(row).font = { bold: true, size: row === 1 ? 14 : 11 }
    sheet.getRow(row).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true }
  }
  sheet.getRow(1).height = 30
  sheet.getRow(3).height = 42
  sheet.autoFilter = { from: { row: 3, column: 1 }, to: { row: sheet.rowCount, column: table.columns.length } }
  const buffer = await workbook.xlsx.writeBuffer()
  return {
    blob: new Blob([new Uint8Array(buffer as ArrayBuffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    filename: `${sanitizeFilename(table.title)}.xlsx`,
  }
}

/** Standalone paper document; no application navigation, backgrounds or draft controls. */
export function renderTournamentPointsPrintDocument(doc: Document, table: TournamentTableProjection): void {
  doc.documentElement.lang = table.locale
  doc.head.replaceChildren()
  const charset = doc.createElement('meta')
  charset.setAttribute('charset', 'utf-8')
  const style = doc.createElement('style')
  style.textContent = printStyles
  doc.head.append(charset, style)
  doc.title = table.title
  doc.body.replaceChildren()
  // Three days need wider paper so the full 4–5 round matrix remains readable.
  doc.body.className = table.columns.length > 18 ? 'wide-paper' : ''
  const element = doc.createElement('table')
  element.setAttribute('data-testid', 'tournament-print-table')
  const colgroup = doc.createElement('colgroup')
  for (const column of table.columns) {
    const col = doc.createElement('col')
    col.className = column.kind
    colgroup.append(col)
  }
  element.append(colgroup)
  const head = element.createTHead()
  for (const [value, className] of [[table.title, 'print-title'], [table.finalizedLabel, 'print-status']]) {
    const cell = doc.createElement('th')
    cell.colSpan = table.columns.length
    cell.textContent = value
    cell.className = className
    head.insertRow().append(cell)
  }
  const headers = head.insertRow()
  for (const column of table.columns) {
    const cell = doc.createElement('th')
    cell.scope = 'col'
    cell.className = column.kind
    cell.textContent = column.label
    headers.append(cell)
  }
  const body = element.createTBody()
  const number = new Intl.NumberFormat(table.locale)
  for (const row of table.rows) {
    const target = body.insertRow()
    row.cells.forEach((value, index) => {
      const clan = table.columns[index].kind === 'clan'
      const cell = doc.createElement(clan ? 'th' : 'td')
      if (clan) cell.setAttribute('scope', 'row')
      cell.className = table.columns[index].kind
      cell.textContent = value == null ? '' : typeof value === 'number' ? number.format(value) : value
      target.append(cell)
    })
  }
  doc.body.append(element)
}

/** Open during the click turn, then print the frozen document after fonts are ready. */
export async function printTournamentPoints(table: TournamentTableProjection): Promise<void> {
  const target = window.open('', '_blank')
  if (!target) throw new Error('PRINT_WINDOW_BLOCKED')
  try {
    target.opener = null
    renderTournamentPointsPrintDocument(target.document, table)
    target.addEventListener('afterprint', () => target.close(), { once: true })
    await target.document.fonts?.ready
    target.focus()
    target.print()
  } catch (error) {
    target.close()
    throw error
  }
}
