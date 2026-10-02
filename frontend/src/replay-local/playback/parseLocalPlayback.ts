/**
 * 2D 战局回放的本地数据入口：.wotbreplay → 上游 WASM（parseResult + parsePlayback + parseAiReview
 * 的伤害事件）→ `BattlePlaybackDataset` + `MapOverview`。文件不出本机，服务器不参与。
 *
 * 在主线程跑（与 3D `AgentReplay3D` 同一装载器 `loadAgentWasm`）；单场解析是一次性成本，
 * 不需要 Worker。返回值与服务端 `fetchBattlePlaybackDataset` / `fetchMapOverviewArtifact`
 * 的 `data` 同形状，可直接喂给 BattlePlaybackPanel 现有的 `mapPlaybackV2` / `mapOverview`。
 */

import {
  parseAgentAiReviewFromBytes,
  parseAgentPlaybackFromBytes,
  parseAgentResultFromBytes,
  type AgentBattleResult,
} from '../../api/agent-replay-facets.js'
import type { BattlePlaybackDataset } from '../../types/playback-v2.js'
import { loadTankopedia, type Tankopedia } from '../compute/tankopedia.js'
import { damageEventsFromAiReview, toBattlePlaybackDataset, type AgentDamageEvent } from './toBattlePlaybackDataset.js'
import { indexMapGridProfiles, toMapOverview, type LocalMapOverview, type MapGridProfile } from './toMapOverview.js'

export interface LocalPlayback {
  /** null = 时间轴不可用（与服务端 204「unavailable」同义） */
  dataset: BattlePlaybackDataset | null
  /** null = 地图未收录 / 无位置（与服务端 map-overview 204 同义） */
  overview: LocalMapOverview | null
  result: AgentBattleResult
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
  // 伤害归因流只在 AiReview 入口（PlaybackData v2 未携带）；失败不阻断回放，退化为 shots[] 归因
  let damageEvents: AgentDamageEvent[] | null = null
  try {
    damageEvents = damageEventsFromAiReview(await parseAgentAiReviewFromBytes(bytes))
  } catch {
    damageEvents = null
  }
  const dataset = toBattlePlaybackDataset(playback, result, {
    tankopedia, damageEvents, sampleStepSec: options.sampleStepSec,
  })
  const overview = dataset ? toMapOverview(dataset, mapProfiles(), result) : null
  return { dataset, overview, result }
}
