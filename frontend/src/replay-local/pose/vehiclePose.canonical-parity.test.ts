import { beforeAll, describe, expect, it } from 'vitest'
import { fixtureFacets, requireFixtures, type FixtureFacets } from '../__golden__/agentWasmNode.js'
import { buildCanonicalReplayFacts, resolveReplayClock } from '../canonical/facts.js'
import { toBattlePlaybackDataset } from '../playback/toBattlePlaybackDataset.js'
import { observedFreezeTimeAt, positionAtV2, positionCoveredAtV2 } from '../../utils/battlePlaybackV2.js'
import { buildPoseFacet, sampleVehiclePoseGame } from './vehiclePose.js'

let f: FixtureFacets & { playback: any; aiReview: any }

beforeAll(async () => {
  f = requireFixtures(await fixtureFacets('random-battle-example.wotbreplay')) as never
}, 120000)

describe('2D 位姿通道（facet）与 canonical 观测同框', () => {
  it('逐车逐时刻 |Δ| 保持亚米~米级（轴序 / 时间域 / 镜像回归锁）', () => {
    const facts = buildCanonicalReplayFacts({ result: f.result, aiReview: f.aiReview, streamEndRaw: f.playback.meta.duration })
    expect(facts).toBeTruthy()
    const clock = resolveReplayClock(f.aiReview.battle.periods, f.result, f.playback.meta.duration)
    expect(clock).toBeTruthy()
    const dataset = toBattlePlaybackDataset(f.playback, f.result, f.aiReview, { canonicalFacts: facts })
    expect(dataset).toBeTruthy()

    const poseFacet = buildPoseFacet(f.playback)
    const grid = { tStart: poseFacet.tStart, samples: poseFacet.samples }
    const defByAccount = new Map(poseFacet.vehicles.map((v) => [v.account_id, v]))
    const out = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, turretAbs: 0, turretRel: 0, gunPitch: 0 }

    const deltas: number[] = []
    for (const track of dataset!.vehicles) {
      const def = defByAccount.get(track.accountId)
      if (!def) continue
      for (const t of [5, 20, 40, 60, 90, 120, 160, 200, 240]) {
        const canon = positionAtV2(track.positionSegments, t)
        if (!canon) continue
        if (!positionCoveredAtV2(track.positionSegments, t)) continue
        const p = sampleVehiclePoseGame(def, grid, t + clock!.startRaw, out)
        const dx = p.x - canon.x
        const dz = p.z - canon.y
        deltas.push(Math.hypot(dx, dz))
        expect(Math.hypot(dx, dz), `t=${t} ${track.playerName} Δ=(${dx.toFixed(1)}, ${dz.toFixed(1)})m`).toBeLessThan(25)
      }
    }
    expect(deltas.length).toBeGreaterThanOrEqual(40)
    const sorted = [...deltas].sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]
    expect(median, `中位 |Δ| = ${median.toFixed(2)} m（滤波 vs 原始应亚米级）`).toBeLessThan(3)
  }, 180000)

  it('观测区间外：2D 采样时刻必须冻结在最后观测点（不跟随滤波器预测延续）', () => {
    const facts = buildCanonicalReplayFacts({ result: f.result, aiReview: f.aiReview, streamEndRaw: f.playback.meta.duration })!
    const clock = resolveReplayClock(f.aiReview.battle.periods, f.result, f.playback.meta.duration)!
    const dataset = toBattlePlaybackDataset(f.playback, f.result, f.aiReview, { canonicalFacts: facts })!
    const poseFacet = buildPoseFacet(f.playback)
    const grid = { tStart: poseFacet.tStart, samples: poseFacet.samples }
    const defByAccount = new Map(poseFacet.vehicles.map((v) => [v.account_id, v]))
    const out = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, turretAbs: 0, turretRel: 0, gunPitch: 0 }
    let sawUncovered = false
    for (const track of dataset.vehicles) {
      const def = defByAccount.get(track.accountId)
      if (!def) continue
      for (const t of [5, 20, 40, 60, 90, 120, 160, 200, 240]) {
        const canon = positionAtV2(track.positionSegments, t)
        if (!canon || positionCoveredAtV2(track.positionSegments, t)) continue
        sawUncovered = true
        const freezeAt = observedFreezeTimeAt(track.positionSegments, t)
        expect(freezeAt, `t=${t} ${track.playerName} 观测过就必须有冻结时刻`).not.toBeNull()
        const p = sampleVehiclePoseGame(def, grid, freezeAt! + clock.startRaw, out)
        const d = Math.hypot(p.x - canon.x, p.z - canon.y)
        expect(d, `t=${t} ${track.playerName} 冻结位置 Δ=${d.toFixed(1)} m（旧行为=滤波延续，可达百米）`).toBeLessThan(20)
      }
    }
    expect(sawUncovered, 'fixture 里应存在未观测时刻，否则本用例无意义').toBe(true)
  })

  it('位姿切面随 canonical 结果同时可得（2D 单独打开也有）', () => {
    const poseFacet = buildPoseFacet(f.playback)
    expect(poseFacet.vehicles.length).toBe(f.playback.vehicles.length)
    expect(poseFacet.samples).toBe(f.playback.meta.samples)
    const accounts = new Set(f.playback.vehicles.map((v: any) => v.account_id))
    for (const v of poseFacet.vehicles) expect(accounts.has(v.account_id)).toBe(true)
  })
})
