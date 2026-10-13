/**
 * 端到端 parity：上游 Rust Core parseResult（wasm-results.json）→ toBattleFacts → 批次计算 → Preview，
 * 与服务端 Java 全链路（ReplayParser → finalizeBatch → Mapper）的 java-preview.json 逐字段相等。
 *
 * 失败文本只比较文件名；客户端新增的环线列以原始 WASM 字段扩展期望值，Java 历史基准保持只读。
 */
import { describe, expect, it } from 'vitest'
import { analyzeReplays } from './analyzeReplays.js'
import { createTankopedia } from './compute/index.js'
import type { AgentBattleResult } from '../api/agent-replay-facets.js'
import type { ParsedReplayFile } from './parseWorkerProtocol.js'
import batches from './__golden__/batches.json'
import wasmResults from './__golden__/wasm-results.json'
import javaPreview from './__golden__/java-preview.json'
import tier7 from '../../../common/tankopedia-tier7.json'
import tier8 from '../../../common/tankopedia-tier8.json'
import tier9 from '../../../common/tankopedia-tier9.json'
import tier10 from '../../../common/tankopedia-tier10.json'

const tankopedia = createTankopedia([tier7, tier8, tier9, tier10])
const wasm = wasmResults as unknown as Record<string, AgentBattleResult & { error?: string }>
const previews = javaPreview as unknown as Record<string, { failures: string[][] }>

function parsedFiles(paths: readonly string[]): ParsedReplayFile[] {
  return paths.map((path) => {
    const name = path.slice(path.lastIndexOf('/') + 1)
    const out = wasm[name]
    if (out.error) return { name, result: null, error: out.error }
    return { name, result: structuredClone(out), error: null }
  })
}

/** failures: [[sourceName, message]] —— 只比文件名，措辞属于各自解析器 */
function normalizeFailures<T extends { failures: string[][] }>(preview: T): T {
  return { ...preview, failures: preview.failures.map(([name]) => [name]) }
}

describe('客户端全链路 ↔ 服务端 Java 全链路（golden）', () => {
  it.each(Object.entries(batches as Record<string, string[]>))('%s', (name, paths) => {
    const actual = JSON.parse(JSON.stringify(analyzeReplays(parsedFiles(paths), tankopedia)))
    const expected = structuredClone(previews[name]) as typeof actual
    expected.playerColumns.splice(expected.playerColumns.findIndex((c: { key: string }) => c.key === 'rank') + 1, 0, { key: 'gun_marks', num: true })
    for (const battle of expected.battles) {
      const marks = new Map(wasm[battle.sourceName].players.map(p => [p.account_id, p.gun_marks ?? null]))
      for (const player of battle.players) player.cells.gun_marks = marks.get(player.accountId) ?? null
    }
    expect(normalizeFailures(actual)).toStrictEqual(normalizeFailures(expected))
  })
})
