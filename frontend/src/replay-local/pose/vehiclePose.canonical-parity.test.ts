/**
 * 2D 位姿通道 ↔ canonical 原始观测的**一致性守卫**（框/轴/时间域回归锁）。
 *
 * 为什么需要：2D 渲染的"画在哪、朝哪"取自 `vehiclePose`（facet `pose_kf`/10 Hz 网格，game 系），
 * 而"可信度/事件"取自 canonical（原始 type=10 观测，battle-relative）。两者**不同源但必须同框**：
 * 只要有人弄错轴序（把高度当 z）、漏掉 `clock.startRaw` 的域换算、或把镜像从 3D 抄进 2D，
 * 差值就会从"亚米级（滤波 vs 原始）"跳到几十~几百米。本用例就是这条判据。
 *
 * 容差口径：两个通道本质不同（滤波输出 vs 原始包），所以断言的是**量级**而不是等值：
 * 逐点 |Δ| ≤ 25 m、中位 |Δ| ≤ 3 m；实测（random-battle fixture）中位 0.00 m、最大 1.2 m。
 */
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
        // 只在 canonical **观测区间内**比较：区间外 canonical 冻结在最后观测，而位姿通道是客户端
        // 滤波器的**预测延续**（3D 场景一直如此显示，2D 现与它同源）——两者本就该不同，见下一用例。
        if (!positionCoveredAtV2(track.positionSegments, t)) continue
        const p = sampleVehiclePoseGame(def, grid, t + clock!.startRaw, out)
        const dx = p.x - canon.x
        const dz = p.z - canon.y
        deltas.push(Math.hypot(dx, dz))
        // 逐点上限：框/轴/域错位是几十~几百米，这里必须挡在 25 m 内
        expect(Math.hypot(dx, dz), `t=${t} ${track.playerName} Δ=(${dx.toFixed(1)}, ${dz.toFixed(1)})m`).toBeLessThan(25)
      }
    }
    expect(deltas.length).toBeGreaterThanOrEqual(40)
    const sorted = [...deltas].sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]
    expect(median, `中位 |Δ| = ${median.toFixed(2)} m（滤波 vs 原始应亚米级）`).toBeLessThan(3)
  }, 180000)

  it('观测区间外：2D 采样时刻必须冻结在最后观测点（不跟随滤波器预测延续）', () => {
    // 2026-10-16 用户裁定：失察即停在原地（3D 里该车模型直接不显示）。
    // 实现 = `observedFreezeTimeAt` 给出采样时刻，位姿仍在 facet 通道上取（同源）、
    // 只是时刻冻结在最后 OBSERVED 段末尾 ⇒ 与 canonical 冻结值只差"网格采样 vs 段末尾"≤0.5 s。
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
        // canonical 冻结在 0.5 s 采样点、我们冻结在段末尾 ⇒ 允许 ≤20 m（快速车 0.5 s 的行程）
        expect(d, `t=${t} ${track.playerName} 冻结位置 Δ=${d.toFixed(1)} m（旧行为=滤波延续，可达百米）`).toBeLessThan(20)
      }
    }
    expect(sawUncovered, 'fixture 里应存在未观测时刻，否则本用例无意义').toBe(true)
  })

  it('位姿切面随 canonical 结果同时可得（2D 单独打开也有）', () => {
    const poseFacet = buildPoseFacet(f.playback)
    expect(poseFacet.vehicles.length).toBe(f.playback.vehicles.length)
    expect(poseFacet.samples).toBe(f.playback.meta.samples)
    // 每车都必须能与 canonical track 对上（account_id 是关键键）
    const accounts = new Set(f.playback.vehicles.map((v: any) => v.account_id))
    for (const v of poseFacet.vehicles) expect(accounts.has(v.account_id)).toBe(true)
  })
})
