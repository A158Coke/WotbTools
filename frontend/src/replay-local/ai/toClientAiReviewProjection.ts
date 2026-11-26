
import type { components } from '../../api/generated/http-contract.js'
import type { AgentAiReviewFacet, AgentBattleResult, AgentPlaybackFacet } from '../../api/agent-replay-facets.js'
import { buildCanonicalReplayFacts, type CanonicalReplayFacts } from '../canonical/facts.js'
import { classifyHpRaw } from '../canonical/hpRawState.js'

export type ClientAiReviewProjection = components['schemas']['ClientAiReviewProjection']

export interface AgentEngineInfo {
  release: string
  commit: string
}

export const UNAVAILABLE_EVIDENCE = ['PACKET_DECODE_COVERAGE', 'SHOT_LIFECYCLE', 'TARGETING', 'AMMUNITION'] as const

export const AI_LIMITATION = {
  CLOCK_ESTIMATED: 'CLOCK_ESTIMATED',
  REPLAY_STREAM_TRUNCATED: 'REPLAY_STREAM_TRUNCATED',
} as const

const BASE_IDS = ['A', 'B', 'C', 'D'] as const

export interface ProjectionInput {
  result: AgentBattleResult
  playback: AgentPlaybackFacet
  aiReview: AgentAiReviewFacet
  engine: AgentEngineInfo
}

export function toClientAiReviewProjection(input: ProjectionInput): ClientAiReviewProjection | null {
  const facts = buildCanonicalReplayFacts({
    result: input.result, aiReview: input.aiReview, streamEndRaw: input.playback.meta.duration,
  })
  if (!facts || facts.entities.size === 0) return null
  return project(facts, input)
}

function project(facts: CanonicalReplayFacts, input: ProjectionInput): ClientAiReviewProjection {
  const start = facts.clock.startRaw
  const raw = (battleSec: number) => battleSec + start
  const combatant = (eid: number) => facts.entities.has(eid)
  const entityIds = [...facts.entities.keys()].sort((a, b) => a - b)

  const positions = entityIds.flatMap((eid) => {
    const p = facts.poses.get(eid)
    if (!p || p.t.length === 0) return []
    const samples: number[] = []
    for (let i = 0; i < p.t.length; i++) samples.push(raw(p.t[i]), p.x[i], p.y[i], p.z[i], p.yaw[i])
    return [{ entityId: eid, stride: 5 as const, samples }]
  })
  const turrets = entityIds.flatMap((eid) => {
    const tr = facts.turrets.get(eid)
    if (!tr || tr.t.length === 0) return []
    const samples: number[] = []
    for (let i = 0; i < tr.t.length; i++) samples.push(raw(tr.t[i]), tr.relYawDeg[i])
    return [{ entityId: eid, stride: 2 as const, samples }]
  })

  const prop3Health: ClientAiReviewProjection['prop3Health'] = []
  for (const e of input.aiReview.events) {
    if (e.type === 'health' && combatant(e.eid)) {
      prop3Health.push({
        entityId: e.eid, rawClockSec: e.t, hpRaw: e.hp_raw,
        hpState: classifyHpRaw(e.hp_raw, e.hp_state),
      })
    }
  }

  const limitations = [...facts.mappingLimitations, ...facts.perspectiveLimitations]
  if (facts.clock.estimated) limitations.push(AI_LIMITATION.CLOCK_ESTIMATED)
  if (facts.streamTruncated) limitations.push(AI_LIMITATION.REPLAY_STREAM_TRUNCATED)

  const pb = input.playback
  return {
    engine: { agentRelease: input.engine.release, agentCommit: input.engine.commit },
    clock: {
      battleStartRawClockSec: start,
      battleDurationSec: facts.clock.durationSec,
      estimated: facts.clock.estimated,
      battleEndRawClockSec: facts.battleEndSec === null ? null : raw(facts.battleEndSec),
      streamEndRawClockSec: facts.streamEndSec === null ? null : raw(facts.streamEndSec),
    },
    perspective: {
      recorderAccountId: facts.recorderAccountId,
      perspectiveTeam: facts.perspectiveTeam,
      recorderEntityIds: [...facts.recorderEntityIds],
      winnerTeam: facts.winnerTeam,
    },
    participants: entityIds.map((eid) => {
      const e = facts.entities.get(eid)!
      return { entityId: eid, accountId: e.accountId, nickname: e.nickname, team: e.team, tankId: e.tankId, recorder: e.recorder }
    }),
    observationWindows: entityIds.flatMap((eid) => (facts.observation.get(eid) ?? []).map((w) => ({
      entityId: eid,
      fromRawClockSec: raw(w.fromSec),
      toRawClockSec: w.toSec === null ? null : raw(w.toSec),
      materializationHp: w.materializationHp,
    }))),
    positions,
    turrets,
    prop3Health,
    healthEvents: facts.healthEvents.filter((h) => combatant(h.entityId)).map((h) => ({
      entityId: h.entityId, rawClockSec: raw(h.t), hpRaw: h.hpRaw, hpState: h.rawState,
      sourceEntityId: h.sourceEntityId, causeFlag: h.causeFlag,
    })),
    damageNotices: facts.damageNotices.map((n) => ({
      rawClockSec: raw(n.t), kind: n.kind, envelopeEntityId: n.envelopeEntityId,
      attackerEntityId: n.attackerEntityId, victimEntityId: n.victimEntityId,
      primaryResult: n.primaryResult, secondaryResult: n.secondaryResult,
    })),
    periods: input.aiReview.battle.periods.map((p) => ({ rawClockSec: p.clock, period: p.period })),
    objectives: {
      supremacyPoints: (pb.supremacy_points ?? []).map((p) => ({ rawClockSec: p.clock, team: p.team, points: p.points })),
      supremacyBases: (pb.supremacy_bases ?? []).flatMap((b) => {
        const baseId = BASE_IDS[b.base_id]
        return baseId ? [{
          rawClockSec: b.clock, baseId, ownerTeam: b.owner_team ?? null,
          capturingTeam: b.capturing_team ?? null, captureProgress: b.capture_progress ?? null,
        }] : []
      }),
      assaultObjectivePresent: pb.assault_objective_present === true,
      assaultBases: (pb.assault_bases ?? []).map((a) => ({ rawClockSec: a.clock, captureProgress: a.progress })),
    },
    limitations,
    unavailableEvidence: [...UNAVAILABLE_EVIDENCE],
  }
}
