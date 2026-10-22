/** Replay workbook helpers and Replay-owned presentation styles. */

import { columnLetter, displayWidth } from './format.js'
import type { CellStyle, CellValue, SheetSpec, WorkbookSpec } from '../../shared/tabular/xlsx/index.js'

export type { SheetSpec, WorkbookSpec } from '../../shared/tabular/xlsx/index.js'

type StyleKey =
  | 'hdr'
  | 'team1L' | 'team1C' | 'team2L' | 'team2C' | 'plainL' | 'plainC'
  | 'title' | 'bold' | 'dupLabel' | 'none'

export type Fill = 'team1' | 'team2' | 'plain'

const LEFT_ALIGN = new Set(['nickname', 'clan', 'tank_name', 'date', 'map_name'])
const indexed = (index: number) => ({ indexed: index })
const solid = (argb?: string, index?: number): NonNullable<CellStyle['fill']> => ({
  type: 'pattern',
  pattern: 'solid',
  fgColor: argb ? { argb } : { indexed: index },
})
const thin = { style: 'thin' as const }
const border = { top: thin, bottom: thin, left: thin, right: thin }
const baseFont = { name: 'Calibri', size: 11, family: 2 }
const team1Fill = solid('FFDDEBF7')
const team2Fill = solid('FFFCE4D6')
const STYLES: Readonly<Record<StyleKey, CellStyle>> = {
  hdr: { font: { ...baseFont, bold: true, color: indexed(9) }, fill: solid(undefined, 18), alignment: { horizontal: 'center' }, border },
  team1L: { fill: team1Fill, alignment: { horizontal: 'left' }, border },
  team1C: { fill: team1Fill, alignment: { horizontal: 'center' }, border },
  team2L: { fill: team2Fill, alignment: { horizontal: 'left' }, border },
  team2C: { fill: team2Fill, alignment: { horizontal: 'center' }, border },
  plainL: { alignment: { horizontal: 'left' }, border },
  plainC: { alignment: { horizontal: 'center' }, border },
  title: { font: { ...baseFont, bold: true, size: 14 } },
  bold: { font: { ...baseFont, bold: true } },
  dupLabel: { font: { ...baseFont, bold: true, color: indexed(10) } },
  none: {},
}

export function newSheet(wb: WorkbookSpec, name: string): SheetSpec {
  const sheet: SheetSpec = { name, columns: [], rows: [], freeze: null, autoFilter: null }
  wb.sheets.push(sheet)
  return sheet
}

export function put(sheet: SheetSpec, row: number, col: number, value: CellValue, styleKey: StyleKey = 'none'): void {
  const targetRow = sheet.rows[row] ?? (sheet.rows[row] = { cells: [] })
  if (targetRow === null) return
  targetRow.cells[col] = { value, style: STYLES[styleKey] }
}

function setColumnWidth(sheet: SheetSpec, index: number, width: number): void {
  const column = sheet.columns ?? (sheet.columns = [])
  column[index] = { ...column[index], width }
}

/** Replay's presentation rules stay in the feature and become generic cell styles here. */
export function setCell(sheet: SheetSpec, row: number, col: number, value: unknown, fill: Fill, key: string): void {
  let cellValue: string | number
  if (typeof value === 'number') cellValue = value
  else if (value === null || value === undefined) cellValue = ''
  else cellValue = String(value)
  put(sheet, row, col, cellValue, `${fill}${LEFT_ALIGN.has(key) ? 'L' : 'C'}` as StyleKey)
}

/** Java `ExcelStyles.writeHeader`: preserve POI column widths and header padding. */
export function writeHeader(sheet: SheetSpec, titleWidth: readonly (readonly [string, number])[]): void {
  titleWidth.forEach(([title, width], column) => {
    put(sheet, 0, column, title, 'hdr')
    setColumnWidth(sheet, column, Math.max(width, displayWidth(title) + 4))
  })
}

/** POI `setAutoFilter(new CellRangeAddress(0, lastRow, 0, lastCol))`. */
export function autoFilter(sheet: SheetSpec, lastRow: number, lastCol: number): void {
  sheet.autoFilter = `A1:${columnLetter(lastCol)}${lastRow + 1}`
}
