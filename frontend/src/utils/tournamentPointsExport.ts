import type { TournamentStandings } from '../api/tournament-points.js'
import { sanitizeFilename } from './exportReplayPng.js'
import { renderXlsx } from '../shared/tabular/xlsx/index.js'
import type { CellStyle, RowSpec, WorkbookSpec } from '../shared/tabular/xlsx/index.js'
import printStyles from '../styles/tokens/tournament-print.css?inline'
import tournamentMessages from '../locales/tournament-messages.json'

/**
 * 「小组赛 / 决赛圈」预设在创建赛事时按**当时的界面语言**落库（TournamentPointsConfigPage.chooseNaming）。
 * 显示 / 导出时把任一语言的预设文本识别回预设，再按当前语言重新翻译；管理员自定义的名称原样保留。
 */
const STAGE_PRESET_KEYS = ['groupStage', 'finalStage'] as const
const STAGE_PRESETS = new Map<string, (typeof STAGE_PRESET_KEYS)[number]>(
  Object.values(tournamentMessages)
    .flatMap(messages => STAGE_PRESET_KEYS.map(key => [messages.tournament[key], key] as const))
    .filter(([text]) => text.length > 0),
)

export function localizedDayLabel(configured: string | null | undefined, day: number, t: Translate): string {
  if (!configured || /^Day \d+$/.test(configured)) return t('tournament.day', { number: day })
  const preset = STAGE_PRESETS.get(configured.trim())
  return preset ? t('tournament.' + preset) : configured
}

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
      const dayLabel = localizedDayLabel(event.dayLabels[day - 1], day, t)
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
function buildTournamentWorkbook(table: TournamentTableProjection): WorkbookSpec {
  const columnStyles = table.columns.map((column): CellStyle => ({
    alignment: { horizontal: column.kind === 'clan' ? 'left' : 'right', vertical: 'middle', wrapText: true },
    // Text formatting keeps clan tags literal; all score and rank cells remain numeric.
    numberFormat: column.kind === 'clan' ? '@' : '0',
  }))
  const headerStyle: CellStyle = {
    font: { bold: true, size: 11 },
    alignment: { horizontal: 'left', vertical: 'middle', wrapText: true },
  }
  const titleStyle: CellStyle = {
    font: { bold: true, size: 14 },
    alignment: { horizontal: 'left', vertical: 'middle', wrapText: true },
    numberFormat: columnStyles[0]?.numberFormat,
  }
  const statusStyle: CellStyle = {
    font: { bold: true, size: 11 },
    alignment: { horizontal: 'left', vertical: 'middle', wrapText: true },
    numberFormat: columnStyles[0]?.numberFormat,
  }
  const rows: RowSpec[] = [
    { cells: [{ value: table.title, style: titleStyle }], height: 30 },
    { cells: [{ value: table.finalizedLabel, style: statusStyle }] },
    {
      cells: table.columns.map((column, index) => ({ value: column.label, style: { ...columnStyles[index], ...headerStyle } })),
      height: 42,
    },
    ...table.rows.map(row => ({
      cells: row.cells.map((value, index) => ({ value, style: columnStyles[index] })),
    })),
  ]

  return {
    activeTab: 0,
    sheets: [{
      name: table.sheetName,
      columns: table.columns.map(column => ({ width: column.kind === 'clan' ? 24 : column.kind === 'rank' ? 8 : 16 })),
      rows,
      freeze: { xSplit: 2, ySplit: 3 },
      autoFilter: { from: { row: 3, column: 1 }, to: { row: rows.length, column: table.columns.length } },
      merges: [
        { startRow: 1, startColumn: 1, endRow: 1, endColumn: table.columns.length },
        { startRow: 2, startColumn: 1, endRow: 2, endColumn: table.columns.length },
      ],
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '1:3' },
    }],
  }
}

export async function createTournamentPointsXlsx(table: TournamentTableProjection): Promise<{ blob: Blob; filename: string }> {
  const bytes = await renderXlsx(buildTournamentWorkbook(table))
  const blobBytes = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  return {
    blob: new Blob([blobBytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
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
