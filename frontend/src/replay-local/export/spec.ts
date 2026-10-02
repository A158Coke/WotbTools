/**
 * 工作簿的纯数据描述（与 exceljs 解耦）：sheets.ts 构建，render.ts 才按需加载 exceljs 渲染成 xlsx。
 * 样式只有 Java `ExcelStyles` 里出现过的几种，用 key 引用。
 */

import { columnLetter, displayWidth } from './format.js'

/**
 * - hdr：表头（粗体白字 + DARK_BLUE 填充 + 居中 + 细边框）
 * - team1/team2/plain + L/C：细边框（+ 队伍底色）+ 左/居中对齐（`ExcelStyles.setCell`）
 * - title：14 号粗体（战斗信息标题）；bold：粗体（战斗信息键名）
 * - dupLabel：红色粗体（「已跳过的重复上传」）
 * - none：无样式（POI 默认 xf）
 */
export type StyleKey =
  | 'hdr'
  | 'team1L' | 'team1C' | 'team2L' | 'team2C' | 'plainL' | 'plainC'
  | 'title' | 'bold' | 'dupLabel' | 'none'

export type Fill = 'team1' | 'team2' | 'plain'

export interface CellSpec {
  /** string → 文本单元格；number → 数值单元格（Java `setCellValue(double)`）。 */
  v: string | number
  s: StyleKey
}

export interface SheetSpec {
  name: string
  /** 0 基列号 → 列宽（字符数，= POI `setColumnWidth(c, w * 256)` 的 w）。 */
  cols: Map<number, number>
  /** [xSplit, ySplit]（POI `createFreezePane(col, row)`）。 */
  freeze: [number, number] | null
  autoFilter: string | null
  /** 稀疏行：rows[r][c]，缺失 = 未创建的行/单元格。 */
  rows: (CellSpec | undefined)[][]
}

export interface WorkbookSpec {
  sheets: SheetSpec[]
  activeTab: number
}

/** 左对齐（文本）列 key（Java `Columns.LEFT_ALIGN`）。 */
const LEFT_ALIGN = new Set(['nickname', 'clan', 'tank_name', 'date', 'map_name'])

export function newSheet(wb: WorkbookSpec, name: string): SheetSpec {
  const sheet: SheetSpec = { name, cols: new Map(), freeze: null, autoFilter: null, rows: [] }
  wb.sheets.push(sheet)
  return sheet
}

export function put(sheet: SheetSpec, row: number, col: number, v: string | number, s: StyleKey = 'none'): void {
  const cells = sheet.rows[row] ?? (sheet.rows[row] = [])
  cells[col] = { v, s }
}

/** Java `ExcelStyles.setCell`：Number → 数值；null → 空串；其余 toString；按 key 选左/居中 + 填充。 */
export function setCell(sheet: SheetSpec, row: number, col: number, val: unknown, fill: Fill, key: string): void {
  let v: string | number
  if (typeof val === 'number') v = val
  else if (val === null || val === undefined) v = ''
  else v = String(val)
  put(sheet, row, col, v, `${fill}${LEFT_ALIGN.has(key) ? 'L' : 'C'}` as StyleKey)
}

/** Java `ExcelStyles.writeHeader`：第 0 行表头；列宽 = max(宽, 显示宽 + 4)（防筛选箭头截断）。 */
export function writeHeader(sheet: SheetSpec, titleWidth: readonly (readonly [string, number])[]): void {
  titleWidth.forEach(([title, width], c) => {
    put(sheet, 0, c, title, 'hdr')
    sheet.cols.set(c, Math.max(width, displayWidth(title) + 4))
  })
}

/** POI `setAutoFilter(new CellRangeAddress(0, lastRow, 0, lastCol))`。 */
export function autoFilter(sheet: SheetSpec, lastRow: number, lastCol: number): void {
  sheet.autoFilter = `A1:${columnLetter(lastCol)}${lastRow + 1}`
}
