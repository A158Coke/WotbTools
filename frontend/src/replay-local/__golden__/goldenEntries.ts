/**
 * 测试专用：golden 批次 → ParsedEntry（compute / export 两个 golden 测试共用）。
 *
 * 按 batches.json 的顺序构造（sourceIndex = 批次内位置，sourceName = 文件名，battle 来自
 * java-battles.json）。失败文本归一化：java-battles.json 存的是 `String.valueOf(e)`
 * （`java.io.IOException: msg`），而 ParsedEntry.failureMessage 来自 `e.getMessage()`。
 */

import tier7 from '../../../../common/tankopedia-tier7.json'
import tier8 from '../../../../common/tankopedia-tier8.json'
import tier9 from '../../../../common/tankopedia-tier9.json'
import tier10 from '../../../../common/tankopedia-tier10.json'
import { createTankopedia, type Battle, type ParsedEntry } from '../compute/index.js'
import batches from './batches.json'
import javaBattles from './java-battles.json'

export const goldenTankopedia = createTankopedia([tier7, tier8, tier9, tier10])
export const goldenBatches = batches as Record<string, string[]>

const battlesByFile = javaBattles as unknown as Record<string, Battle | { error: string }>

/** `String.valueOf(throwable)` → `getMessage()`：剥离 `pkg.ClassName: ` 前缀。 */
export function messageOf(stringified: string): string {
  return stringified.replace(/^[\w$.]+(?:Exception|Error|Throwable): /, '')
}

function fileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

export function entriesFor(paths: readonly string[]): ParsedEntry[] {
  return paths.map((path, sourceIndex) => {
    const sourceName = fileName(path)
    const parsed = battlesByFile[sourceName]
    if (parsed === undefined) throw new Error(`golden missing battle for ${sourceName}`)
    if ('error' in parsed) return { sourceIndex, sourceName, battle: null, failureMessage: messageOf(parsed.error) }
    // 每个 source 独立解析产物（同一文件重复上传时 Java 也是两个 Battle 实例）
    return { sourceIndex, sourceName, battle: structuredClone(parsed), failureMessage: null }
  })
}
