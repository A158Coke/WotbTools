import { beforeEach, describe, expect, it, vi } from 'vitest'

import tier7 from '../../../../common/tankopedia-tier7.json'
import tier8 from '../../../../common/tankopedia-tier8.json'
import tier9 from '../../../../common/tankopedia-tier9.json'
import tier10 from '../../../../common/tankopedia-tier10.json'
import { createTankopedia } from '../compute/tankopedia.js'
import { validateBattlePlaybackDataset } from '../../api/contract-runtime.js'
import { fixtureFacets, requireFixtures } from '../__golden__/agentWasmNode.js'
import { createReloadStateResolver } from '../../scene/reloadBar.js'
import { buildCanonicalReplayFacts, entityFirstSeenByAccount, resolveReplayClock } from '../canonical/facts.js'

const facets = vi.hoisted(() => ({
  parseAgentResultFromBytes: vi.fn(),
  parseAgentPlaybackFromBytes: vi.fn(),
  parseAgentAiReviewFromBytes: vi.fn(),
}))
vi.mock('../../api/agent-replay-facets.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...facets,
}))

const { parseLocalPlayback } = await import('./parseLocalPlayback.js')
const { toBattlePlaybackDataset } = await import('./toBattlePlaybackDataset.js')

const tankopedia = createTankopedia([tier7, tier8, tier9, tier10])

async function arrange(file: string) {
  const raw = await fixtureFacets(file)
  // 严格读取：fixture 被 trust boundary 拒绝时在此抛出**原始 validation error**，
  // 而不是把 null 灌进 mock、让下游崩在 `null.meta` 的二次症状上。
  expect(raw.playbackError, String(raw.playbackError)).toBeNull()
  expect(raw.aiReviewError, String(raw.aiReviewError)).toBeNull()
  const f = requireFixtures(raw)
  facets.parseAgentResultFromBytes.mockResolvedValue(f.result)
  facets.parseAgentPlaybackFromBytes.mockResolvedValue(f.playback)
  facets.parseAgentAiReviewFromBytes.mockResolvedValue(f.aiReview)
  return f
}

describe('parseLocalPlayback', () => {
  beforeEach(() => vi.clearAllMocks())

  it('字节 → 三切面 → canonical facts → 与服务端同形状的 dataset + overview（合同校验通过）', async () => {
    const f = await arrange('cw-training-15-14-example.wotbreplay')
    const out = await parseLocalPlayback(new Uint8Array([1, 2, 3]), { tankopedia })
    expect(validateBattlePlaybackDataset(JSON.parse(JSON.stringify(out.dataset))).diagnostics).toEqual([])
    expect(out.dataset).toEqual(toBattlePlaybackDataset(f.playback!, f.result, f.aiReview!, { tankopedia }))
    expect(out.overview?.mapCode).toBe('malinovka')
    expect(out.overview?.heatmaps.friendly.dwell).toHaveLength(36)
    expect(facets.parseAgentPlaybackFromBytes).toHaveBeenCalledTimes(1)
    expect(facets.parseAgentAiReviewFromBytes).toHaveBeenCalledTimes(1)
  })

  it('复活轨道注入（上游 v0.4.8 字段形态）：DESTROYED 事件覆盖每次死亡 + 复活后血量落未知（3.1.0 review P2）', async () => {
    const f = await arrange('random-battle-example.wotbreplay')
    // 深拷贝注入，避免污染 fixture 缓存；选一辆死亡时刻足够早（+40 s 仍在场内）的车
    const playback = structuredClone(f.playback!)
    const facts = buildCanonicalReplayFacts({
      result: f.result, aiReview: f.aiReview, streamEndRaw: playback.meta.duration,
    })!
    const clock = resolveReplayClock(f.aiReview!.battle.periods, f.result, playback.meta.duration)!
    const vehicle = playback.vehicles.find((v) =>
      Number.isFinite(v.death_t) && (v.death_t as number) - clock.startRaw + 40 < clock.durationSec)!
    const deathRaw = vehicle.death_t as number
    vehicle.death_times = [deathRaw, deathRaw + 30]      // 上游：≥2 死才输出（首死 = death_t）
    vehicle.resurrection_times = [deathRaw + 15]         // 上游：非空才输出
    const ds = toBattlePlaybackDataset(playback, f.result, f.aiReview!, { tankopedia, canonicalFacts: facts })!
    // 1) DESTROYED 事件 = 轨道死亡列（canonical 每账号至多一条终态 → 只发它就会少一次爆焰）
    const destroyed = ds.events.filter((e) => e.type === 'DESTROYED' && e.accountId === vehicle.account_id)
    expect(destroyed.map((e) => Math.round(e.timeSec)))
      .toEqual([Math.round(deathRaw - clock.startRaw), Math.round(deathRaw - clock.startRaw + 30)])
    // 2) 复活后（+15 s）直到新证据：血量未知（绝不沿用死前的 0 / 终态值）
    const track = ds.vehicles.find((v) => v.accountId === vehicle.account_id)!
    const atResurrection = track.healthTransitions!.filter((h) => h.timeSec >= deathRaw - clock.startRaw + 15)
    expect(atResurrection[0]?.currentHp).toBeNull()
  })

  it('projects the session Playback without parsing it again and exposes an independent clock', async () => {
    const f = await arrange('random-battle-example.wotbreplay')
    const out = await parseLocalPlayback(new Uint8Array([1]), { tankopedia, playback: f.playback! })
    expect(facets.parseAgentPlaybackFromBytes).not.toHaveBeenCalled()
    expect(out.clock?.startRaw).toBe(resolveReplayClock(f.aiReview!.battle.periods, f.result, f.playback!.meta.duration)?.startRaw)
    expect(out.dataset).toBeTruthy()
    const facts = buildCanonicalReplayFacts({ result: f.result, aiReview: f.aiReview, streamEndRaw: f.playback.meta.duration })!
    expect(out.entityStartsByAccount).toEqual(entityFirstSeenByAccount(facts))
    expect(structuredClone(out.entityStartsByAccount)).toEqual(out.entityStartsByAccount)
  })

  it('AiReview 入口失败 → 整体失败（fail closed：血量 / 归属 / 终态证据缺失时不降级成弱证据回放）', async () => {
    await arrange('random-battle-example.wotbreplay')
    facets.parseAgentAiReviewFromBytes.mockRejectedValue(new Error('boom'))
    await expect(parseLocalPlayback(new Uint8Array([1]), { tankopedia })).rejects.toThrow('boom')
  })

  it('carries raw Playback reload evidence beside the dataset, aligned to canonical 2D time', async () => {
    const f = await arrange('cw-training-15-14-example.wotbreplay')
    const clock = resolveReplayClock(f.aiReview!.battle.periods, f.result, f.playback!.meta.duration)!
    const vehicle = f.playback!.vehicles.find((v) => v.team === f.playback!.meta.friendly_team)!
    const raw = {
      ...f.playback!,
      // Render-grid origin deliberately differs from canonical 2D battle t=0.
      meta: { ...f.playback!.meta, t_start: clock.startRaw - 20 },
      reloads: [{ eid: vehicle.eid, clock: clock.startRaw + 10, phase: 3, duration_s: 8, count: null }],
      reload_effective: [{ eid: vehicle.eid, clock: clock.startRaw, duration_s: 4 }],
      shots: [],
    }
    facets.parseAgentPlaybackFromBytes.mockResolvedValue(raw)
    const out = await parseLocalPlayback(new Uint8Array([1]), { tankopedia })
    expect(out.reloadTelemetry?.timeOrigin).toBe(clock.startRaw)
    expect(out.reloadTelemetry?.reloads).toBe(raw.reloads)
    expect(out.reloadTelemetry?.reload_effective).toBe(raw.reload_effective)
    const at = createReloadStateResolver(out.reloadTelemetry)
    expect(at(vehicle.eid, out.reloadTelemetry!.timeOrigin + 12)).toEqual([{ state: 'loading', progress: 0.5 }])
    expect(out.dataset).not.toHaveProperty('reloads')
    expect(out.dataset).not.toHaveProperty('reloadTelemetry')
  })

  it('9.8 训练室（无 period 广播，服务端 timeline 不可用）：本地同样 unavailable，与 Java 一致', async () => {
    await arrange('training-room-example.wotbreplay')
    const out = await parseLocalPlayback(new Uint8Array([1]), { tankopedia })
    expect(out.dataset).toBeNull()
    expect(out.overview).toBeNull()
    expect(out.reloadTelemetry).toBeNull()
  })
})
