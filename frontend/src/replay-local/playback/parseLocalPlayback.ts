/**
 * 战局回放 canonical 投影入口（2D / 3D session 共用）：.wotbreplay → 上游 WASM（parseResult + parsePlayback + parseAiReview）
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
  type AgentPlaybackFacet,
} from '../../api/agent-replay-facets.js'
import type { BattlePlaybackDataset, PlaybackReloadTelemetry } from '../../types/playback-v2.js'
import { loadTankopedia, type Tankopedia } from '../compute/tankopedia.js'
import { toBattlePlaybackDataset } from './toBattlePlaybackDataset.js'
import { indexMapGridProfiles, toMapOverview, type LocalMapOverview, type MapGridProfile } from './toMapOverview.js'
import { buildCanonicalReplayFacts, entityFirstSeenByAccount, resolveReplayClock } from '../canonical/facts.js'
import { buildPoseFacet, type PoseFacet } from '../pose/vehiclePose.js'

export interface LocalPlayback {
  /** null = 时间轴不可用（与服务端 204「unavailable」同义） */
  dataset: BattlePlaybackDataset | null
  /** null = 地图未收录 / 无位置（与服务端 map-overview 204 同义） */
  overview: LocalMapOverview | null
  /** Workspace-only identity evidence; not part of the HTTP dataset. Battle-relative seconds. */
  entityStartsByAccount?: Map<number, Map<number, number | null>>
  result: AgentBattleResult
  /** Raw scene seconds → canonical seconds; independent of reload presentation. */
  clock: ReturnType<typeof resolveReplayClock>
  /** Presentation-only raw Playback telemetry; never promoted into canonical ReplayFacts. */
  reloadTelemetry: PlaybackReloadTelemetry | null
  /**
   * 2D 俯视渲染用的**位姿通道**（playback facet 的瘦身投影：pose_kf + 网格列 + coverage）。
   * 与 3D 场景同源同插值（`replay-local/pose/vehiclePose.ts`）；canonical `dataset` 仍是
   * 可信度 / 事件 / 血量的唯一权威。facet 不可得时 null（调用方回退 canonical 观测）。
   */
  poseFacet: PoseFacet | null
}

export interface ParseLocalPlaybackOptions {
  tankopedia?: Tankopedia
  sampleStepSec?: number
  /** Already decoded by the workspace Worker path; do not parse Playback again. */
  playback?: AgentPlaybackFacet
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
  const playback = options.playback ?? await parseAgentPlaybackFromBytes(bytes)
  const aiReview = await parseAgentAiReviewFromBytes(bytes)
  const facts = buildCanonicalReplayFacts({ result, aiReview, streamEndRaw: playback.meta.duration })
  const entityStartsByAccount = facts ? entityFirstSeenByAccount(facts) : new Map()
  const dataset = toBattlePlaybackDataset(playback, result, aiReview, {
    tankopedia, sampleStepSec: options.sampleStepSec, canonicalFacts: facts,
  })
  const overview = dataset ? toMapOverview(dataset, mapProfiles(), result) : null
  // The dataset's clock comes from AI event evidence. Do not substitute Playback meta.t_start:
  // its render-grid origin may include the pre-battle period.
  const clock = resolveReplayClock(aiReview.battle.periods, result, playback.meta.duration)
  const reloadTelemetry: PlaybackReloadTelemetry | null = dataset && clock ? {
    timeOrigin: clock.startRaw,
    friendlyTeam: dataset.friendlyTeam,
    // config_idx / burst_size / turret_local / gun_local 透传：弹容 N 的证据链输入
    // 随实际搭载配置走（contracts/agent §4h；客户端证据链见 reloadBar.resolveMountedConfig）
    vehicles: playback.vehicles.map(({
      eid, account_id, team, tank_id, shell_ids, max_hp, config_idx, burst_size, turret_local, gun_local,
    }) => ({ eid, account_id, team, tank_id, shell_ids, max_hp, config_idx, burst_size, turret_local, gun_local })),
    reloads: playback.reloads,
    reload_effective: playback.reload_effective,
    shots: playback.shots,
  } : null
  // 位姿通道（瘦身投影）：2D 俯视与 3D 场景共用同一采样器，故这里把 facet 的位姿列随结果带出。
  // 实体身份证据（entityStartsByAccount）一并带上：多实体账号（AoI 重入 / 复活换实体）的活跃
  // 实体选择必须用与 3D 死亡归属同源的 canonical 证据，否则会在重入前采样到后一个实体。
  const poseFacet = playback ? buildPoseFacet(playback, entityStartsByAccount) : null
  return { dataset, overview, result, reloadTelemetry, clock, entityStartsByAccount, poseFacet }
}
