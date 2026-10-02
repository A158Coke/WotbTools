/**
 * 测试专用：把 xlsx 字节（exceljs 读回）归一化成与 `tools/parity/JavaExportDump.java`（POI 读回）
 * 相同的 JSON 形状，用于和 `__golden__/java-export.json` 逐格比较。只被测试 import，不进产物。
 *
 * 规则（两侧一致）：
 * - 单元格值：数值 / 字符串 / 布尔 / {f: 公式} / {blank: true}；不存在的单元格/行 = null；去掉末尾空行
 * - 样式串：`b=粗体;sz=字号;fc=字色;fill=填充;h=水平对齐;bd=上,下,左,右;fmt=数字格式`
 *   颜色：indexed → `idx:n`（indexed 8 = 默认黑色 → 空）；rgb → 6 位大写 hex；theme/未设 → 空
 * - 列宽：只列出显式 `<col width>` 的列（0 基 → 宽度字符数）
 */

import type { Cell, Color, Workbook, Worksheet } from 'exceljs'

export interface NormalizedSheet {
  name: string
  cols: Record<string, number>
  freeze: [number, number] | null
  autoFilter: string | null
  merges: string[]
  rows: (([unknown, string] | null)[] | null)[]
}

export interface NormalizedWorkbook {
  activeTab: number
  sheets: NormalizedSheet[]
}

function color(c: Partial<Color> | undefined): string {
  if (c === undefined) return ''
  const idx = (c as { indexed?: number }).indexed
  if (idx !== undefined) return idx === 8 ? '' : `idx:${idx}`
  if (c.argb !== undefined) return c.argb.slice(-6).toUpperCase()
  return ''
}

function styleKey(cell: Cell): string {
  const font = cell.font ?? {}
  const fill = cell.fill as { type?: string; pattern?: string; fgColor?: Partial<Color> } | undefined
  let fillText = 'none'
  if (fill?.type === 'pattern' && fill.pattern === 'solid') fillText = `solid:${color(fill.fgColor)}`
  else if (fill?.type === 'pattern' && fill.pattern !== 'none' && fill.pattern !== undefined) fillText = fill.pattern
  const border = cell.border ?? {}
  const side = (s: { style?: string } | undefined): string => s?.style ?? ''
  return [
    `b=${font.bold ? 1 : 0}`,
    `sz=${font.size ?? 11}`,
    `fc=${color(font.color)}`,
    `fill=${fillText}`,
    `h=${cell.alignment?.horizontal ?? ''}`,
    `bd=${side(border.top)},${side(border.bottom)},${side(border.left)},${side(border.right)}`,
    `fmt=${cell.numFmt ?? 'General'}`,
  ].join(';')
}

function value(cell: Cell): unknown {
  const v = cell.value
  if (v === null || v === undefined) return { blank: true }
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return v
  if (typeof v === 'object' && 'formula' in v) return { f: (v as { formula: string }).formula }
  throw new Error(`unsupported cell value: ${JSON.stringify(v)}`)
}

function sheet(ws: Worksheet): NormalizedSheet {
  const cols: Record<string, number> = {}
  ;(ws.columns ?? []).forEach((col, i) => {
    if (col.width !== undefined) cols[String(i)] = col.width
  })
  const view = ws.views?.[0]
  const freeze: [number, number] | null = view?.state === 'frozen'
    ? [view.xSplit ?? 0, view.ySplit ?? 0]
    : null
  const filter = ws.autoFilter
  const rows: (([unknown, string] | null)[] | null)[] = []
  ws.eachRow({ includeEmpty: false }, (row, r) => {
    const cells: ([unknown, string] | null)[] = []
    row.eachCell({ includeEmpty: false }, (cell, c) => {
      cells[c - 1] = [value(cell), styleKey(cell)]
    })
    for (let i = 0; i < cells.length; i++) cells[i] ??= null
    rows[r - 1] = cells
  })
  for (let i = 0; i < rows.length; i++) rows[i] ??= null
  return {
    name: ws.name,
    cols,
    freeze,
    autoFilter: typeof filter === 'string' ? filter : filter === undefined ? null : JSON.stringify(filter),
    merges: Object.keys((ws as unknown as { _merges: Record<string, unknown> })._merges ?? {}),
    rows,
  }
}

/** 读回 xlsx 字节并归一化。 */
export async function normalizeXlsx(bytes: Uint8Array): Promise<NormalizedWorkbook> {
  const ExcelJS = (await import('exceljs')).default
  const wb: Workbook = new ExcelJS.Workbook()
  await wb.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
  return {
    activeTab: wb.views?.[0]?.activeTab ?? 0,
    sheets: wb.worksheets.map(sheet),
  }
}
