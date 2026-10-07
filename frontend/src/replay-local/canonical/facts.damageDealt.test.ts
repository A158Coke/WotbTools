import { describe, expect, it } from 'vitest'
import { fixtureFacets, requireFixtures } from '../__golden__/agentWasmNode.js'
import { toBattlePlaybackDataset } from '../playback/toBattlePlaybackDataset.js'
import { cumulativeStatsAtV2 } from '../../utils/battlePlaybackV2.js'
import { buildCanonicalReplayFacts } from './facts.js'

describe('issue 557 recorded damage evidence', () => {
  it.each([
    ['random-battle-example.wotbreplay', 6284],
    ['cw-training-15-14-example.wotbreplay', 2810],
    ['tournament-14-14-example.wotbreplay', 3637],
  ] as const)('retains the recorder damage broadcasts in %s', async (file, expected) => {
    const f = requireFixtures(await fixtureFacets(file))
    const dataset = toBattlePlaybackDataset(f.playback, f.result, f.aiReview)!
    const recorder = dataset.vehicles.find(v => v.accountId === dataset.recorderAccountId)!
    expect(recorder.damageDealtSamples!.at(-1)!.total).toBe(expected)
    expect(cumulativeStatsAtV2(dataset.events, recorder, dataset.durationSec, dataset.vehicles).dealt).toBe(expected)
    expect(dataset.vehicles.filter(v => v !== recorder).every(v => v.damageDealtSamples === undefined)).toBe(true)
    // Final settlement totals are a comparison, never the numeric source of the live curve.
    const changedResult = { ...f.result, players: f.result.players.map(p => ({ ...p, damage_dealt: 999999 })) }
    const unchanged = toBattlePlaybackDataset(f.playback, changedResult, f.aiReview)!
    expect(unchanged.vehicles.find(v => v.accountId === recorder.accountId)!.damageDealtSamples).toEqual(recorder.damageDealtSamples)
  })

  it('orders same-clock broadcasts, rejects decreases, and does not guess between Avatar sources', async () => {
    const f = requireFixtures(await fixtureFacets('random-battle-example.wotbreplay'))
    const t = f.aiReview.battle.periods.find(p => p.period === 3)!.clock
    const events = f.aiReview.events.filter(e => e.type !== 'damage_tick')
    const aiReview = { ...f.aiReview, events: [...events,
      { type: 'damage_tick' as const, t: t + 20, eid: 999999, cumulative: 600 },
      { type: 'damage_tick' as const, t: t + 10, eid: 999999, cumulative: 300 },
      { type: 'damage_tick' as const, t: t + 10, eid: 999999, cumulative: 400 },
      { type: 'damage_tick' as const, t: t + 15, eid: 999999, cumulative: 350 },
      { type: 'damage_tick' as const, t: t + 25, eid: 999999, cumulative: -1 },
    ] }
    const samples = buildCanonicalReplayFacts({ result: f.result, aiReview })!.recorderDamageDealt
    expect(samples.map(sample => sample.total)).toEqual([400, 600])
    expect(samples[0].timeSec).toBeCloseTo(10, 6)
    expect(samples[1].timeSec).toBeCloseTo(20, 6)
    aiReview.events.push({ type: 'damage_tick', t: t + 30, eid: 888888, cumulative: 900 })
    expect(buildCanonicalReplayFacts({ result: f.result, aiReview })!.recorderDamageDealt).toEqual([])
  })

  it('does not give another roster member or an unidentified recorder the Avatar total', async () => {
    const f = requireFixtures(await fixtureFacets('random-battle-example.wotbreplay'))
    const other = f.aiReview.rosters.find(r => r.account_id && r.account_id !== f.result.author_account_id)!
    const aiReview = { ...f.aiReview, events: f.aiReview.events.map(e => e.type === 'damage_tick' ? { ...e, eid: other.eid } : e) }
    expect(buildCanonicalReplayFacts({ result: f.result, aiReview })!.recorderDamageDealt).toEqual([])
    expect(buildCanonicalReplayFacts({ result: { ...f.result, author_account_id: 0 }, aiReview: f.aiReview })!.recorderDamageDealt).toEqual([])
  })
})
