/** Render a business-neutral workbook description to XLSX bytes. */

import type { Alignment, Borders, Fill, Font, Workbook } from 'exceljs'

import type { CellStyle, WorkbookSpec } from './spec.js'

type ExcelJsModule = typeof import('exceljs')

let excelJs: Promise<ExcelJsModule> | null = null

function loadExcelJs(): Promise<ExcelJsModule> {
  excelJs ??= import('exceljs').then((module) => ((module as unknown as { default?: ExcelJsModule }).default ?? module))
  return excelJs
}

function applyStyle(target: import('exceljs').Cell, style: CellStyle): void {
  if (style.font) target.font = style.font as Partial<Font>
  if (style.fill) target.fill = style.fill as Fill
  if (style.alignment) target.alignment = style.alignment as Partial<Alignment>
  if (style.border) target.border = style.border as Partial<Borders>
  if (style.numberFormat !== undefined) target.numFmt = style.numberFormat
}

function build(ExcelJS: ExcelJsModule, spec: WorkbookSpec): Workbook {
  const workbook = new ExcelJS.Workbook()

  for (const sheet of spec.sheets) {
    const worksheet = workbook.addWorksheet(sheet.name, {
      views: sheet.freeze ? [{ state: 'frozen', ...sheet.freeze }] : [],
      pageSetup: sheet.pageSetup,
    })

    sheet.columns.forEach((column, index) => {
      if (column.width === undefined) return
      const target = worksheet.getColumn(index + 1)
      target.width = column.width
      // ExcelJS omits its default width 9; preserve the caller's explicit width in the file.
      if (column.width === 9) Object.defineProperty(target, 'isCustomWidth', { get: () => true })
    })

    sheet.rows.forEach((rowSpec, rowIndex) => {
      if (rowSpec == null) return
      const row = worksheet.getRow(rowIndex + 1)
      if (rowSpec.height !== undefined) row.height = rowSpec.height
      rowSpec.cells.forEach((cellSpec, columnIndex) => {
        if (cellSpec == null) return
        const cell = row.getCell(columnIndex + 1)
        // ExcelJS only treats formula objects as formulas; strings remain text, including "=...".
        cell.value = cellSpec.value
        if (cellSpec.style) applyStyle(cell, cellSpec.style)
      })
    })

    for (const merge of sheet.merges ?? []) {
      worksheet.mergeCells(merge.startRow, merge.startColumn, merge.endRow, merge.endColumn)
    }
    if (sheet.autoFilter) worksheet.autoFilter = sheet.autoFilter
  }

  if (spec.sheets.length > 0) {
    workbook.views = [{
      x: 0,
      y: 0,
      width: 10000,
      height: 20000,
      firstSheet: 0,
      activeTab: spec.activeTab,
      visibility: 'visible',
    }]
  }

  return workbook
}

export async function renderXlsx(spec: WorkbookSpec): Promise<Uint8Array> {
  const ExcelJS = await loadExcelJs()
  const buffer = await build(ExcelJS, spec).xlsx.writeBuffer()
  return new Uint8Array(buffer as ArrayBuffer)
}
