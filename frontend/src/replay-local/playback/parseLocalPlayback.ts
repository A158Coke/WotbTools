/**
 * 2D 战局回放的本地数据入口：.wotbreplay → 上游 WASM（parseResult + parsePlayback + parseAiReview）
 * → WotbTools canonical facts → `BattlePlaybackDataset` + `MapOverview`。文件不出本机，服务器不参与。
 * 三个切面缺一不可：AiReview 承载血量 / 归属 / 终态的原始证据，失败即整体失败（fail closed，
 * 不退化成弱证据归因）。
 *
 * 在主线程跑（与 3D `AgentReplay3D` 同一装载器 `loadAgentWasmModule`：commit-addressed
 * URL + fingerprint 版本门禁）；单场解析是一次性成本，
 * 不需要 Worker。返回值与服务端 `fetchBattlePlaybackDataset` / `fetchMapOverviewArtifact`
 * 的 `data` 同形状，可直接喂给 BattlePlaybackPanel 现有的 `mapPlaybackV2` / `mapOverview`。
 */

import {
  parseAgentAiReviewFromBytes,
  parseAgentPlaybackFromBytes,
  parseAgentResultFromBytes,
  type AgentBattleResult,
} from '../../api/agent-replay-facets.js'
import type { BattlePlaybackDataset, PlaybackReloadTelemetry } from '../../types/playback-v2.js'
import { loadTankopedia, type Tankopedia } from '../compute/tankopedia.js'
import { toBattlePlaybackDataset } from './toBattlePlaybackDataset.js'
import { indexMapGridProfiles, toMapOverview, type LocalMapOverview, type MapGridProfile } from './toMapOverview.js'
import { resolveReplayClock } from '../canonical/facts.js'

export interface LocalPlayback {
  /** null = 时间轴不可用（与服务端 204「unavailable」同义） */
  dataset: BattlePlaybackDataset | null
  /** null = 地图未收录 / 无位置（与服务端 map-overview 204 同义） */
  overview: LocalMapOverview | null
  result: AgentBattleResult
  /** Presentation-only raw Playback telemetry; never promoted into canonical ReplayFacts. */
  reloadTelemetry: PlaybackReloadTelemetry | null
}

export interface ParseLocalPlaybackOptions {
  tankopedia?: Tankopedia
  sampleStepSec?: number
}

let profiles: Map<string, MapGridProfile> | null = null

/** 地图档案（`common/map-semantics/*.semantic.json`，与 BattlePlayback.vue 同一份打包数据）。 */
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
  const playback = await parseAgentPlaybackFromBytes(bytes)
  const aiReview = await parseAgentAiReviewFromBytes(bytes)
  const dataset = toBattlePlaybackDataset(playback, result, aiReview, {
    tankopedia, sampleStepSec: options.sampleStepSec,
  })
  const overview = dataset ? toMapOverview(dataset, mapProfiles(), result) : null
  // The dataset's clock comes from AI event evidence. Do not substitute Playback meta.t_start:
  // its render-grid origin may include the pre-battle period.
  const clock = resolveReplayClock(aiReview.battle.periods, result, playback.meta.duration)
  const reloadTelemetry: PlaybackReloadTelemetry | null = dataset && clock ? {
    timeOrigin: clock.startRaw,
    friendlyTeam: dataset.friendlyTeam,
    vehicles: playback.vehicles.map(({ eid, account_id, team, tank_id }) => ({ eid, account_id, team, tank_id })),
    reloads: playback.reloads,
    reload_effective: playback.reload_effective,
    shots: playback.shots,
  } : null
  return { dataset, overview, result, reloadTelemetry }
}
