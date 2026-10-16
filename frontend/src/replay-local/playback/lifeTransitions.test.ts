import { expect, it } from 'vitest'
import { healthTransitions, lifeTransitions, respawnDestroyedTimes } from './toBattlePlaybackDataset.js'
import type { CanonicalReplayFacts, HpSample } from '../canonical/facts.js'

// 复活轨道（issue #622）的三处投影：生命交替 / 血量未知边界 / DESTROYED 事件时刻（3.1.0 review P2）。
// 上游复活轨道在场 → 它取代采样扫描成为死亡/复活时刻 SSOT；缺省 → 既有路径（行为与既往逐位一致，
// golden 锁定）。

const EID = 101
const START = 30 // battle startRaw；上游死亡/复活时刻是原始时钟

function factsWith(samples: HpSample[]): CanonicalReplayFacts {
  return {
    clock: { startRaw: START, durationSec: 120, estimated: false },
    hpSamples: new Map([[EID, samples]]),
    observation: new Map([[EID, []]]),
    poses: new Map(),
  } as unknown as CanonicalReplayFacts
}

const prop3Dead = (t: number): HpSample => ({
  t, entityId: EID, hp: 0, kind: 'PROP3', rawState: null, alive: false, exact: true, order: 0,
})
const prop3Alive = (t: number, hp: number): HpSample => ({
  t, entityId: EID, hp, kind: 'PROP3', rawState: null, alive: true, exact: true, order: 0,
})

const FIRST_SEEN = new Map([[EID, 0]])

it('无复活轨道：prop3 alive=false 终态路径不变（DESTROYED 不可逆）', () => {
  // 采样：存活(1s) → 死(10s) → 之后即使有 alive=true 采样也不回 ALIVE（既往口径）
  const facts = factsWith([prop3Alive(1, 900), prop3Dead(10), prop3Alive(20, 900)])
  const out = lifeTransitions(facts, [EID], FIRST_SEEN, 120)
  expect(out.map((x) => [x.timeSec, x.lifeState])).toEqual([
    [1, 'ALIVE'],
    [10, 'DESTROYED'],
  ])
  expect(out[1]).toMatchObject({ destroyedKnownAtSec: 10 })
})

it('复活轨道在场：死亡→复活→再死 交替（上游时刻为 SSOT，采样不再定死终态）', () => {
  const facts = factsWith([prop3Alive(1, 900), prop3Dead(10), prop3Alive(20, 900)])
  const respawn = new Map([[
    EID,
    { deaths: [10, 58.5], resurrections: [20] }, // battle-relative
  ]])
  const out = lifeTransitions(facts, [EID], FIRST_SEEN, 120, respawn)
  expect(out.map((x) => [x.timeSec, x.lifeState])).toEqual([
    [1, 'ALIVE'],
    [10, 'DESTROYED'],
    [20, 'ALIVE'],
    [58.5, 'DESTROYED'],
  ])
  expect(out[1]).toMatchObject({ destroyedKnownAtSec: 10 })
  expect(out[3]).toMatchObject({ destroyedKnownAtSec: 58.5 })
})

it('复活轨道在场但采样链无复活证据（method1 载体）：复活点仍产出 ALIVE 迁移', () => {
  // hpSamples 只有死亡前的存活采样（prop3 不携带复活后的血量）——复活轨道独立成立
  const facts = factsWith([prop3Alive(1, 900)])
  const respawn = new Map([[EID, { deaths: [10], resurrections: [18] }]])
  const out = lifeTransitions(facts, [EID], FIRST_SEEN, 120, respawn)
  expect(out.map((x) => [x.timeSec, x.lifeState])).toEqual([
    [1, 'ALIVE'],
    [10, 'DESTROYED'],
    [18, 'ALIVE'],
  ])
})

it('单死 + 复活（death_times 缺省形态）：上游 death_t 兜底首死', () => {
  const facts = factsWith([])
  const respawn = new Map([[EID, { deaths: [10], resurrections: [18] }]])
  const out = lifeTransitions(facts, [EID], FIRST_SEEN, 120, respawn)
  expect(out.map((x) => [x.timeSec, x.lifeState])).toEqual([
    [10, 'DESTROYED'],
    [18, 'ALIVE'],
  ])
})

// ---- 血量投影：复活后必须落"未知"边界，绝不沿用死前值（3.1.0 review P2） ----

it('复活后无新血量证据 → 血量落未知（currentHp null），不显示死前的 0/终态值', () => {
  const facts = factsWith([prop3Alive(1, 900), prop3Dead(10)])
  const respawn = new Map([[EID, { deaths: [10], resurrections: [20] }]])
  const out = healthTransitions(facts, [EID], FIRST_SEEN, 120, false, null, respawn)
  expect(out.map((x) => [x.timeSec, x.currentHp])).toEqual([
    [1, 900],
    [10, 0],
    [20, null],
  ])
  expect(out[2]).toMatchObject({ knowledge: 'LAST_KNOWN', confidence: 'UNKNOWN' })
})

it('复活后新证据到达 → 未知边界被采样覆盖；证据在查询时刻之后时不得提前使用（窗口 [复活, t]）', () => {
  const facts = factsWith([prop3Alive(1, 900), prop3Dead(10), prop3Alive(25, 700)])
  const respawn = new Map([[EID, { deaths: [10], resurrections: [20] }]])
  const out = healthTransitions(facts, [EID], FIRST_SEEN, 120, false, null, respawn)
  expect(out.map((x) => [x.timeSec, x.currentHp])).toEqual([
    [1, 900],
    [10, 0],
    [20, null],
    [25, 700],
  ])
})

it('无复活轨道：血量投影与既往逐位一致（无未知边界）', () => {
  const facts = factsWith([prop3Alive(1, 900), prop3Dead(10), prop3Alive(20, 900)])
  const out = healthTransitions(facts, [EID], FIRST_SEEN, 120, false, null)
  expect(out.map((x) => [x.timeSec, x.currentHp])).toEqual([
    [1, 900],
    [10, 0],
    [20, 900],
  ])
})

// ---- DESTROYED 事件时刻：复活模式账号用完整死亡列（2D 爆焰按事件生成，缺一条就少爆一次） ----

it('DESTROYED 事件时刻表：复活模式账号给全部死亡时刻；非复活模式账号不在表内（维持 canonical 终态）', () => {
  const facts = {
    ...factsWith([]),
    entities: new Map([[EID, { accountId: 42 }]]),
  } as unknown as CanonicalReplayFacts
  const respawn = new Map([
    [EID, { deaths: [10, 58.5], resurrections: [20] }],
    [202, { deaths: [5], resurrections: [] }],      // 单死无复活 = 非复活模式 → 不在表内
    [303, { deaths: [], resurrections: [8] }],       // 无死亡时刻 → 不接管（不丢 canonical 终态）
  ])
  expect([...respawnDestroyedTimes(facts, respawn)]).toEqual([[42, [10, 58.5]]])
})
