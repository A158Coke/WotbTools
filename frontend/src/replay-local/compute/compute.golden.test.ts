/**
 * 客户端批次计算 ↔ Java golden 逐字段 parity（验收基准）。
 *
 * 每个批次：按 batches.json 的顺序构造 ParsedEntry（见 `__golden__/goldenEntries.ts`），断言
 * `toPreviewResponse(finalizeBatch(entries))` 与 java-preview.json 完全相等（含浮点逐位）。
 */

import { describe, expect, it } from 'vitest'

import { entriesFor, goldenBatches, goldenTankopedia as tankopedia } from '../__golden__/goldenEntries.js'
import javaPreview from '../__golden__/java-preview.json'
import {
  NoValidReplaysError,
  finalizeBatch,
  toPreviewResponse,
  type ParsedEntry,
} from './index.js'

const previews = javaPreview as unknown as Record<string, unknown>

describe('replay-local compute ↔ Java golden', () => {
  const specs = Object.entries(goldenBatches)

  it('golden 覆盖 8 个批次', () => {
    expect(specs).toHaveLength(8)
    expect(Object.keys(previews).sort()).toEqual(specs.map(([name]) => name).sort())
  })

  it.each(specs)('%s', (name, paths) => {
    const actual = toPreviewResponse(finalizeBatch(entriesFor(paths), tankopedia), tankopedia)
    expect(JSON.parse(JSON.stringify(actual))).toStrictEqual(previews[name])
  })

  it('不修改调用方传入的 Battle', () => {
    const entries = entriesFor(goldenBatches['league:cw+tournament'])
    const before = JSON.stringify(entries)
    toPreviewResponse(finalizeBatch(entries, tankopedia), tankopedia)
    expect(JSON.stringify(entries)).toBe(before)
  })

  it('0 场有效回放抛 NoValidReplaysError（全部失败 / 空批次）', () => {
    const failure: ParsedEntry = { sourceIndex: 0, sourceName: 'x.wotbreplay', battle: null, failureMessage: 'broken' }
    expect(() => finalizeBatch([failure], tankopedia)).toThrow(NoValidReplaysError)
    expect(() => finalizeBatch([], tankopedia)).toThrow(NoValidReplaysError)
  })
})
