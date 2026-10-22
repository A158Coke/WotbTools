import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'

import { renderXlsx } from './render.js'
import type { WorkbookSpec } from './spec.js'

describe('shared XLSX renderer', () => {
  it('maps cell values, styles, dimensions, panes, filters, merges and page setup', async () => {
    const spec: WorkbookSpec = {
      activeTab: 1,
      sheets: [{
        name: 'Summary',
        columns: [{ width: 24 }, { width: 12 }, { width: 16 }],
        rows: [
          { cells: [{ value: 'Report', style: { font: { bold: true, size: 14 } } }], height: 30 },
          { cells: [{ value: 'Finalized' }], height: 24 },
          { cells: [
            { value: 'Text', style: { alignment: { horizontal: 'left', vertical: 'middle', wrapText: true }, numberFormat: '@' } },
            {
              value: 'Number',
              style: {
                fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDEBF7' } },
                border: { bottom: { style: 'thin' } },
              },
            },
            { value: 'Absent' },
          ], height: 42 },
          { cells: [{ value: '=SUM(A1:A2)', style: { numberFormat: '@' } }, { value: 0, style: { numberFormat: '0' } }, { value: null }] },
        ],
        freeze: { xSplit: 2, ySplit: 3 },
        autoFilter: { from: { row: 3, column: 1 }, to: { row: 4, column: 3 } },
        merges: [
          { startRow: 1, startColumn: 1, endRow: 1, endColumn: 3 },
          { startRow: 2, startColumn: 1, endRow: 2, endColumn: 3 },
        ],
        pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '1:3' },
      }, { name: 'Notes', columns: [], rows: [] }],
    }

    const bytes = await renderXlsx(spec)
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)

    const sheet = workbook.getWorksheet('Summary')!
    expect(sheet.getCell('A4').value).toBe('=SUM(A1:A2)')
    expect(sheet.getCell('A4').type).toBe(ExcelJS.ValueType.String)
    expect(sheet.getCell('B4').value).toBe(0)
    expect(sheet.getCell('B4').type).toBe(ExcelJS.ValueType.Number)
    expect(sheet.getCell('C4').value).toBeNull()
    expect(sheet.getCell('A1').font.bold).toBe(true)
    expect(sheet.getCell('A1').font.size).toBe(14)
    expect(sheet.getCell('A3').alignment).toMatchObject({ horizontal: 'left', vertical: 'middle', wrapText: true })
    expect(sheet.getCell('B3').fill).toMatchObject({ type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDEBF7' } })
    expect(sheet.getCell('B3').border.bottom).toMatchObject({ style: 'thin' })
    expect(sheet.getCell('A3').numFmt).toBe('@')
    expect(sheet.getColumn(1).width).toBe(24)
    expect(sheet.getRow(1).height).toBe(30)
    expect(sheet.views[0]).toMatchObject({ state: 'frozen', xSplit: 2, ySplit: 3 })
    expect(sheet.autoFilter).toBe('A3:C4')
    expect(sheet.getCell('B1').isMerged).toBe(true)
    expect(sheet.pageSetup).toMatchObject({ orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '1:3' })
    expect(workbook.views[0].activeTab).toBe(1)
  })
})
