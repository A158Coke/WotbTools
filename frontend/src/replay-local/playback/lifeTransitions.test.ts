import { expect, it } from 'vitest'
import { lifeTransitions } from './toBattlePlaybackDataset.js'
import type { CanonicalReplayFacts, HpSample } from '../canonical/facts.js'

// 生命投影（issue #622）：上游复活轨道在场 → 死亡/复活交替（SSOT 取代采样扫描）；
// 缺省 → prop3 alive=false 终态路径（行为与既往逐位一致，golden 锁定）。

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
