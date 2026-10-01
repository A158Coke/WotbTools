import { describe, expect, it } from 'vitest'
import { toBattleFacts, type BattleFacts } from './battleFacts.js'
import type { AgentBattleResult } from '../api/agent-replay-facets.js'
import wasmResults from './__golden__/wasm-results.json'
import javaBattles from './__golden__/java-battles.json'

type JavaBattle = Record<string, unknown> & { players?: Record<string, unknown>[]; error?: string }

const wasm = wasmResults as unknown as Record<string, AgentBattleResult & { error?: string }>
const java = javaBattles as unknown as Record<string, JavaBattle>

/** BattleFacts 的每个键都必须与 Java Battle 同名同值（Java 多出来的键是批次 enrichment / 退役字段） */
function pick(source: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(keys.map((k) => [k, source[k] ?? null]))
}

describe('toBattleFacts —— 与 Java ReplayParser 逐字段一致（golden）', () => {
  const files = Object.keys(java).filter((f) => !java[f].error)

  it.each(files)('%s', (file) => {
    const facts: BattleFacts = toBattleFacts(wasm[file])
    const { players, ...battle } = facts
    const javaBattle = java[file]
    expect(battle).toEqual(pick(javaBattle, Object.keys(battle)))

    const javaPlayers = new Map((javaBattle.players ?? []).map((p) => [p.accountId, p]))
    expect(players).toHaveLength(javaPlayers.size)
    for (const p of players) {
      const jp = javaPlayers.get(p.accountId)
      expect(jp, `player ${p.accountId}`).toBeDefined()
      expect(p).toEqual(pick(jp!, Object.keys(p)))
    }
  })

  it('两边都解析失败的文件保持失败（损坏回放）', () => {
    const failed = Object.keys(java).filter((f) => java[f].error)
    expect(failed.length).toBeGreaterThan(0)
    for (const f of failed) expect(wasm[f].error).toBeTruthy()
  })

  it('阵亡却缺结算寿命 = 非法结算，整场失败', () => {
    const file = files[0]
    const broken = structuredClone(wasm[file])
    const dead = broken.players.find((p) => p.survived !== true)!
    delete dead.life_time_secs
    expect(() => toBattleFacts(broken)).toThrow(/missing settlement lifeTime/)
  })
})
