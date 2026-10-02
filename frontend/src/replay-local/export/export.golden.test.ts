/**
 * 客户端 xlsx 导出 ↔ Java（POI）golden 逐格 parity。
 *
 * golden：`tools/parity/JavaExportDump.java` 对每个批次跑服务端同一条导出链路
 * （finalizeBatch → ReplayExportJobService 的 aggregate / each 分支 → ExcelExporter），
 * 把 xlsx 用 POI 读回归一化。这里用同一批输入走 finalizeBatch → exportAggregateXlsx / exportEachZip，
 * 把真实字节（zip 解包后）用 exceljs 读回、按同一规则归一化（normalize.ts），断言完全相等。
 */

import { unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'

import { entriesFor, goldenBatches, goldenTankopedia as tankopedia } from '../__golden__/goldenEntries.js'
import javaExport from '../__golden__/java-export.json'
import { finalizeBatch } from '../compute/index.js'
import { exportAggregateXlsx, exportEachZip, parseTeamNames, type ExportOptions } from './index.js'
import { normalizeXlsx, type NormalizedWorkbook } from './normalize.js'

interface GoldenWorkbook {
  activeTab: number
  sheets: { name: string; cols: Record<string, number>; freeze: [number, number] | null; autoFilter: string | null;
    merges: string[]; rows: (([unknown, number] | null)[] | null)[] }[]
}

interface GoldenBatch {
  aggregate: { filename: string; workbook: string }
  each: { filename: string; entries: { name: string; workbook: string }[] }
  teamNames?: Record<string, unknown>
}

const golden = javaExport as unknown as {
  timeZone: string
  styles: string[]
  workbooks: Record<string, GoldenWorkbook>
  batches: Record<string, GoldenBatch>
}

/** golden 的样式下标 → 样式串（与 normalize.ts 的输出形状一致）。 */
function expand(id: string): NormalizedWorkbook {
  const wb = golden.workbooks[id]
  return {
    activeTab: wb.activeTab,
    sheets: wb.sheets.map((s) => ({
      ...s,
      rows: s.rows.map((row) => row && row.map((cell) => cell && [cell[0], golden.styles[cell[1]]])),
    })),
  }
}

async function bytesOf(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer())
}

describe('replay-local export ↔ Java golden', () => {
  const specs = Object.entries(golden.batches)

  it('golden 覆盖全部批次 + 战队名称覆盖变体', () => {
    const plain = specs.map(([name]) => name).filter((name) => !name.includes('#'))
    expect(plain.sort()).toEqual(Object.keys(goldenBatches).sort())
    expect(specs.some(([, b]) => b.teamNames !== undefined)).toBe(true)
  })

  it.each(specs)('%s', async (name, batch) => {
    const paths = goldenBatches[name.split('#')[0]]
    const options: ExportOptions = { timeZone: golden.timeZone, teamNames: batch.teamNames }

    const aggregate = await exportAggregateXlsx(finalizeBatch(entriesFor(paths), tankopedia), tankopedia, options)
    expect(aggregate.filename).toBe(batch.aggregate.filename)
    expect(await normalizeXlsx(await bytesOf(aggregate.blob))).toStrictEqual(expand(batch.aggregate.workbook))

    const each = await exportEachZip(finalizeBatch(entriesFor(paths), tankopedia), tankopedia, options)
    expect(each.filename).toBe(batch.each.filename)
    const files = unzipSync(await bytesOf(each.blob))
    expect(Object.keys(files)).toEqual(batch.each.entries.map((e) => e.name))
    for (const entry of batch.each.entries) {
      expect(await normalizeXlsx(files[entry.name])).toStrictEqual(expand(entry.workbook))
    }
  })
})

describe('parseTeamNames（服务端 teamNames 参数契约）', () => {
  it('结构化 / 扁平 / 非法输入', () => {
    const structured = parseTeamNames('{"battle":{"1:1":"A","x":3},"summary":{"clan:X":"B"}}')
    expect([...structured.battle]).toEqual([['1:1', 'A']])
    expect([...structured.summary]).toEqual([['clan:X', 'B']])
    const flat = parseTeamNames({ '1:2': 'C' })
    expect([...flat.battle]).toEqual([['1:2', 'C']])
    expect(flat.summary.size).toBe(0)
    for (const bad of ['', 'not json', '[1]', null, undefined]) {
      const parsed = parseTeamNames(bad)
      expect(parsed.battle.size + parsed.summary.size).toBe(0)
    }
  })
})
