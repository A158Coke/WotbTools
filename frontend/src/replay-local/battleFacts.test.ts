import { describe, expect, it } from 'vitest'
import { toBattleFacts } from './battleFacts.js'
import type { Battle } from './compute/index.js'
import type { AgentBattleResult } from '../api/agent-replay-facets.js'
import wasmResults from './__golden__/wasm-results.json'
import javaBattles from './__golden__/java-battles.json'

type JavaBattle = Record<string, unknown> & { players?: Record<string, unknown>[]; error?: string }

const wasm = wasmResults as unknown as Record<string, AgentBattleResult & { error?: string }>
const java = javaBattles as unknown as Record<string, JavaBattle>

/** 已知缺口：无（上游 v0.3.8 补齐录像者车辆与阵容完整性）。每个键都必须与 Java Battle 同名同值。 */
const KNOWN_GAPS = new Set<string>()

function pick(source: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(keys.map((k) => [k, source[k] ?? null]))
}
const compared = (o: object) => Object.keys(o).filter((k) => !KNOWN_GAPS.has(k))
const without = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([k]) => !KNOWN_GAPS.has(k)))

describe('toBattleFacts —— 与 Java ReplayParser 逐字段一致（golden）', () => {
  const files = Object.keys(java).filter((f) => !java[f].error)

  it.each(files)('%s', (file) => {
    const facts: Battle = toBattleFacts(wasm[file])
    const { players, ...battle } = facts
    const javaBattle = java[file]
    expect(without(battle)).toEqual(pick(javaBattle, compared(battle)))

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

  it('damage_received null = 无证据（v0.3.16 契约）：聚合归 0，不得 NaN', () => {
    // 解析确定性收口后，无受击证据的结算方 damage_received = null（≠ 0）。
    // count() 必须把 null 归 0 进聚合——下游 performance/league-rating 的算术
    // 才不会 NaN 级联（v0.3.15 旧产物恒为数字，此用例锁前向兼容）。
    const file = files[0]
    const input = structuredClone(wasm[file])
    const first = input.players[0]
    first.damage_received = null as unknown as number
    const facts: Battle = toBattleFacts(input)
    const mine = facts.players.find((p) => p.accountId === first.account_id)!
    expect(mine.damageReceived).toBe(0)
    expect(Number.isFinite(mine.damageReceived)).toBe(true)
  })
})
