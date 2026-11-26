
import {
  parseAgentAiReviewFromBytes,
  parseAgentPlaybackFromBytes,
  parseAgentResultFromBytes,
  type AgentBattleResult,
  type AgentPlaybackFacet,
} from '../../api/agent-replay-facets.js'
import type { BattlePlaybackDataset, PlaybackReloadTelemetry } from '../../types/playback-v2.js'
import { loadTankopedia, type Tankopedia } from '../compute/tankopedia.js'
import { toBattlePlaybackDataset } from './toBattlePlaybackDataset.js'
import { indexMapGridProfiles, toMapOverview, type LocalMapOverview, type MapGridProfile } from './toMapOverview.js'
import { buildCanonicalReplayFacts, entityFirstSeenByAccount, resolveReplayClock } from '../canonical/facts.js'
import { buildPoseFacet, type PoseFacet } from '../pose/vehiclePose.js'

export interface LocalPlayback {
  dataset: BattlePlaybackDataset | null
  overview: LocalMapOverview | null
  entityStartsByAccount?: Map<number, Map<number, number | null>>
  result: AgentBattleResult
  clock: ReturnType<typeof resolveReplayClock>
  reloadTelemetry: PlaybackReloadTelemetry | null
  poseFacet: PoseFacet | null
}

export interface ParseLocalPlaybackOptions {
  tankopedia?: Tankopedia
  sampleStepSec?: number
  playback?: AgentPlaybackFacet
}

let profiles: Map<string, MapGridProfile> | null = null

function mapProfiles(): Map<string, MapGridProfile> {
  if (!profiles) {
    profiles = indexMapGridProfiles(Object.values(import.meta.glob('../../../../common/map-semantics/*.semantic.json', {
      eager: true, import: 'default',
    })))
  }
  return profiles
}

let tankopediaPromise: Promise<Tankopedia> | null = null

export async function parseLocalPlayback(
  input: File | Blob | ArrayBuffer | Uint8Array,
  options: ParseLocalPlaybackOptions = {},
): Promise<LocalPlayback> {
  const bytes = input instanceof Uint8Array ? input
    : input instanceof ArrayBuffer ? new Uint8Array(input)
      : new Uint8Array(await input.arrayBuffer())
  if (!options.tankopedia && !tankopediaPromise) {
    tankopediaPromise = loadTankopedia()
    tankopediaPromise.catch(() => { tankopediaPromise = null })
  }
  const tankopedia = options.tankopedia ?? await tankopediaPromise!
  const result = await parseAgentResultFromBytes(bytes)
  const playback = options.playback ?? await parseAgentPlaybackFromBytes(bytes)
  const aiReview = await parseAgentAiReviewFromBytes(bytes)
  const facts = buildCanonicalReplayFacts({ result, aiReview, streamEndRaw: playback.meta.duration })
  const entityStartsByAccount = facts ? entityFirstSeenByAccount(facts) : new Map()
  const dataset = toBattlePlaybackDataset(playback, result, aiReview, {
    tankopedia, sampleStepSec: options.sampleStepSec, canonicalFacts: facts,
  })
  const overview = dataset ? toMapOverview(dataset, mapProfiles(), result) : null
  const clock = resolveReplayClock(aiReview.battle.periods, result, playback.meta.duration)
  const reloadTelemetry: PlaybackReloadTelemetry | null = dataset && clock ? {
    timeOrigin: clock.startRaw,
    friendlyTeam: dataset.friendlyTeam,
    vehicles: playback.vehicles.map(({
      eid, account_id, team, tank_id, shell_ids, max_hp, config_idx, burst_size, turret_local, gun_local,
    }) => ({ eid, account_id, team, tank_id, shell_ids, max_hp, config_idx, burst_size, turret_local, gun_local })),
    reloads: playback.reloads,
    reload_effective: playback.reload_effective,
    shots: playback.shots,
  } : null
  const poseFacet = playback ? buildPoseFacet(playback, entityStartsByAccount) : null
  return { dataset, overview, result, reloadTelemetry, clock, entityStartsByAccount, poseFacet }
}
