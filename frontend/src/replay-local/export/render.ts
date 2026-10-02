/**
 * WorkbookSpec → xlsx 字节（exceljs）/ 多个 xlsx → zip（fflate）。
 *
 * 两个库都只在这里通过动态 import 加载：用户真正导出时才下载，不进主 bundle。
 * 样式对齐 Java `ExcelStyles`（POI）：细边框、DARK_BLUE(indexed 18) 表头 + WHITE(indexed 9) 粗体字、
 * 队伍底色 DDEBF7 / FCE4D6、战斗信息 14 号粗体标题、RED(indexed 10) 粗体重复提示。
 */

import type { Alignment, Borders, Fill, Font, Workbook } from 'exceljs'

import type { StyleKey, WorkbookSpec } from './spec.js'

interface CellStyle {
  font?: Partial<Font>
  fill?: Fill
  alignment?: Partial<Alignment>
  border?: Partial<Borders>
}

/** exceljs 的 Color 类型没有声明 indexed，但 ColorXform 支持（POI IndexedColors）。 */
function indexed(index: number): Font['color'] {
  return { indexed: index } as unknown as Font['color']
}

const THIN = { style: 'thin' } as const
const BORDER: Partial<Borders> = { top: THIN, bottom: THIN, left: THIN, right: THIN }
/** POI `wb.createFont()` 的默认字体（Calibri 11）。 */
const BASE_FONT: Partial<Font> = { name: 'Calibri', size: 11, family: 2 }

function solid(fgColor: Font['color']): Fill {
  return { type: 'pattern', pattern: 'solid', fgColor }
}

const TEAM1_FILL = solid({ argb: 'FFDDEBF7' })
const TEAM2_FILL = solid({ argb: 'FFFCE4D6' })
const LEFT: Partial<Alignment> = { horizontal: 'left' }
const CENTER: Partial<Alignment> = { horizontal: 'center' }

const STYLES: Readonly<Record<StyleKey, CellStyle>> = {
  hdr: { font: { ...BASE_FONT, bold: true, color: indexed(9) }, fill: solid(indexed(18)), alignment: CENTER, border: BORDER },
  team1L: { fill: TEAM1_FILL, alignment: LEFT, border: BORDER },
  team1C: { fill: TEAM1_FILL, alignment: CENTER, border: BORDER },
  team2L: { fill: TEAM2_FILL, alignment: LEFT, border: BORDER },
  team2C: { fill: TEAM2_FILL, alignment: CENTER, border: BORDER },
  plainL: { alignment: LEFT, border: BORDER },
  plainC: { alignment: CENTER, border: BORDER },
  title: { font: { ...BASE_FONT, bold: true, size: 14 } },
  bold: { font: { ...BASE_FONT, bold: true } },
  dupLabel: { font: { ...BASE_FONT, bold: true, color: indexed(10) } },
  none: {},
}

type ExcelJsModule = typeof import('exceljs')

let excelJs: Promise<ExcelJsModule> | null = null

/** 动态加载 exceljs（CJS/UMD 兼容：取 default 或命名空间本身）。 */
function loadExcelJs(): Promise<ExcelJsModule> {
  excelJs ??= import('exceljs').then((m) => ((m as unknown as { default?: ExcelJsModule }).default ?? m))
  return excelJs
}

function build(ExcelJS: ExcelJsModule, spec: WorkbookSpec): Workbook {
  const wb = new ExcelJS.Workbook()
  for (const sheet of spec.sheets) {
    const ws = wb.addWorksheet(sheet.name, {
      views: sheet.freeze === null ? [] : [{ state: 'frozen', xSplit: sheet.freeze[0], ySplit: sheet.freeze[1] }],
    })
    for (const [c, width] of sheet.cols) {
      const column = ws.getColumn(c + 1)
      column.width = width
      // exceljs 把 width === 9（其 DEFAULT_COLUMN_WIDTH）视为默认列而不写 <col>，Excel 会按 8.43 显示；
      // POI 照写 width=9 customWidth=1——实例上强制 customWidth 保持一致
      if (width === 9) Object.defineProperty(column, 'isCustomWidth', { get: () => true })
    }
    sheet.rows.forEach((cells, r) => {
      if (cells === undefined) return
      const row = ws.getRow(r + 1)
      cells.forEach((cell, c) => {
        if (cell === undefined) return
        const target = row.getCell(c + 1)
        target.value = cell.v
        const style = STYLES[cell.s]
        if (style.font) target.font = style.font as Font
        if (style.fill) target.fill = style.fill
        if (style.alignment) target.alignment = style.alignment
        if (style.border) target.border = style.border
      })
    })
    if (sheet.autoFilter !== null) ws.autoFilter = sheet.autoFilter
  }
  if (spec.sheets.length > 0) {
    wb.views = [{ x: 0, y: 0, width: 10000, height: 20000, firstSheet: 0, activeTab: spec.activeTab, visibility: 'visible' }]
  }
  return wb
}

/** 渲染单个工作簿为 xlsx 字节。 */
export async function renderXlsx(spec: WorkbookSpec): Promise<Uint8Array> {
  const ExcelJS = await loadExcelJs()
  const buffer = await build(ExcelJS, spec).xlsx.writeBuffer()
  return new Uint8Array(buffer as ArrayBuffer)
}

/** 多个文件打成 zip（UTF-8 文件名；条目顺序 = 输入顺序）。 */
export async function zipFiles(files: readonly { name: string; data: Uint8Array }[]): Promise<Uint8Array> {
  const { zipSync } = await import('fflate')
  const entries: Record<string, Uint8Array> = {}
  for (const f of files) entries[f.name] = f.data
  return zipSync(entries, { level: 6 })
}
