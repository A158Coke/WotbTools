/**
 * 产物字节可被 exceljs 重新读入（round-trip sanity）：工作表名、表头、行数、冻结与筛选保持。
 */

import ExcelJS from 'exceljs'
import { unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'

import { entriesFor, goldenBatches, goldenTankopedia as tankopedia } from '../__golden__/goldenEntries.js'
import { finalizeBatch } from '../compute/index.js'
import { XLSX_MIME, ZIP_MIME, buildAggregateWorkbook, exportAggregateXlsx, exportEachZip } from './index.js'

async function load(bytes: Uint8Array | ArrayBuffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook()
  const buffer = bytes instanceof Uint8Array
    ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    : bytes
  await wb.xlsx.load(buffer)
  return wb
}

describe('xlsx round-trip', () => {
  it('League 多场汇总：7 张表、表头与行数一致', async () => {
    const dataset = finalizeBatch(entriesFor(goldenBatches['league:cw+tournament']), tankopedia)
    const spec = buildAggregateWorkbook(dataset, tankopedia)
    const file = await exportAggregateXlsx(dataset, tankopedia)
    expect(file.mime).toBe(XLSX_MIME)
    expect(file.blob.type).toBe(XLSX_MIME)

    const wb = await load(await file.blob.arrayBuffer())
    expect(wb.worksheets.map((ws) => ws.name)).toEqual(spec.sheets.map((s) => s.name))
    wb.worksheets.forEach((ws, i) => {
      const sheet = spec.sheets[i]
      expect(ws.actualRowCount).toBe(sheet.rows.filter((r) => r !== undefined).length)
      expect(ws.getRow(1).getCell(1).value).toBe(sheet.rows[0]?.cells[0]?.value)
      expect(ws.autoFilter ?? null).toBe(sheet.autoFilter)
    })
  })

  it('逐场 zip：每个条目都是可读的单场工作簿', async () => {
    const dataset = finalizeBatch(entriesFor(goldenBatches['mixed:random+cw']), tankopedia)
    const zip = await exportEachZip(dataset, tankopedia)
    expect(zip.mime).toBe(ZIP_MIME)
    const files = unzipSync(new Uint8Array(await zip.blob.arrayBuffer()))
    expect(Object.keys(files)).toEqual(['random-battle-example.xlsx', 'cw-training-15-14-example.xlsx'])
    for (const data of Object.values(files)) {
      const wb = await load(data)
      expect(wb.worksheets.map((ws) => ws.name)).toEqual(['玩家数据', '战斗信息', '原始字段'])
      expect(wb.worksheets[0].actualRowCount).toBe(15)
    }
  })
})

it('exports recorded 0/1/2/3 marks as numeric cells, unknown as blank, without a summary mark average', async () => {
  const entries = entriesFor(goldenBatches['mixed:random+cw'])
  const players = entries[0].battle!.players
  const marks = [0, 1, 2, 3, null]
  for (let i = 0; i < players.length; i++) players[i].gunMarks = marks[i % marks.length]
  const expected = new Map(players.map(p => [p.nickname, p.gunMarks]))
  const data = finalizeBatch(entries, tankopedia)
  const zip = await exportEachZip(data, tankopedia)
  const files = unzipSync(new Uint8Array(await zip.blob.arrayBuffer()))
  const wb = await load(Object.values(files)[0])
  const ws = wb.worksheets[0]
  const headers = ws.getRow(1).values as unknown[]
  const col = headers.indexOf('环线')
  expect(col).toBeGreaterThan(0)
  for (let row = 2; row <= ws.actualRowCount; row++) {
    const mark = expected.get(String(ws.getRow(row).getCell(1).value))
    expect(ws.getRow(row).getCell(col).value).toBe(mark ?? '')
  }
  const aggregate = await exportAggregateXlsx(data, tankopedia)
  const summary = await load(await aggregate.blob.arrayBuffer())
  expect(summary.worksheets[0].getRow(1).values).not.toContain('环线')
})
