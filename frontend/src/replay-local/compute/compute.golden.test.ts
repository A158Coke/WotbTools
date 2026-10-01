/**
 * 客户端批次计算 ↔ Java golden 逐字段 parity（验收基准）。
 *
 * 每个批次：按 batches.json 的顺序构造 ParsedEntry（sourceIndex = 批次内位置，
 * sourceName = 文件名，battle 来自 java-battles.json），断言
 * `toPreviewResponse(finalizeBatch(entries))` 与 java-preview.json 完全相等（含浮点逐位）。
 *
 * 失败文本归一化：java-battles.json 存的是 `String.valueOf(e)`（`java.io.IOException: msg`），
 * 而 golden 的 ParsedEntry.failureMessage 来自 `e.getMessage()`——去掉 `全限定类名: ` 前缀即可。
 */

import { describe, expect, it } from 'vitest'

import batches from '../__golden__/batches.json'
import javaBattles from '../__golden__/java-battles.json'
import javaPreview from '../__golden__/java-preview.json'
import tier7 from '../../../../common/tankopedia-tier7.json'
import tier8 from '../../../../common/tankopedia-tier8.json'
import tier9 from '../../../../common/tankopedia-tier9.json'
import tier10 from '../../../../common/tankopedia-tier10.json'
import {
  NoValidReplaysError,
  createTankopedia,
  finalizeBatch,
  toPreviewResponse,
  type Battle,
  type ParsedEntry,
} from './index.js'

const tankopedia = createTankopedia([tier7, tier8, tier9, tier10])
const battlesByFile = javaBattles as unknown as Record<string, Battle | { error: string }>
const previews = javaPreview as unknown as Record<string, unknown>

/** `String.valueOf(throwable)` → `getMessage()`：剥离 `pkg.ClassName: ` 前缀。 */
function messageOf(stringified: string): string {
  return stringified.replace(/^[\w$.]+(?:Exception|Error|Throwable): /, '')
}

function fileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

function entriesFor(paths: readonly string[]): ParsedEntry[] {
  return paths.map((path, sourceIndex) => {
    const sourceName = fileName(path)
    const parsed = battlesByFile[sourceName]
    if (parsed === undefined) throw new Error(`golden missing battle for ${sourceName}`)
    if ('error' in parsed) return { sourceIndex, sourceName, battle: null, failureMessage: messageOf(parsed.error) }
    // 每个 source 独立解析产物（同一文件重复上传时 Java 也是两个 Battle 实例）
    return { sourceIndex, sourceName, battle: structuredClone(parsed), failureMessage: null }
  })
}

describe('replay-local compute ↔ Java golden', () => {
  const specs = Object.entries(batches as Record<string, string[]>)

  it('golden 覆盖 8 个批次', () => {
    expect(specs).toHaveLength(8)
    expect(Object.keys(previews).sort()).toEqual(specs.map(([name]) => name).sort())
  })

  it.each(specs)('%s', (name, paths) => {
    const actual = toPreviewResponse(finalizeBatch(entriesFor(paths), tankopedia), tankopedia)
    expect(JSON.parse(JSON.stringify(actual))).toStrictEqual(previews[name])
  })

  it('不修改调用方传入的 Battle', () => {
    const entries = entriesFor((batches as Record<string, string[]>)['league:cw+tournament'])
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
