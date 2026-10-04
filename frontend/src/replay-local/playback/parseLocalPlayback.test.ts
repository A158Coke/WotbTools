import { beforeEach, describe, expect, it, vi } from 'vitest'

import tier7 from '../../../../common/tankopedia-tier7.json'
import tier8 from '../../../../common/tankopedia-tier8.json'
import tier9 from '../../../../common/tankopedia-tier9.json'
import tier10 from '../../../../common/tankopedia-tier10.json'
import { createTankopedia } from '../compute/tankopedia.js'
import { validateBattlePlaybackDataset } from '../../api/contract-runtime.js'
import { fixtureFacets, requireFixtures } from '../__golden__/agentWasmNode.js'
import { createReloadStateResolver } from '../../scene/reloadBar.js'
import { resolveReplayClock } from '../canonical/facts.js'

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
