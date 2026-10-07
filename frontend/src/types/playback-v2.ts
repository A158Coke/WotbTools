/** Playback application/view types backed by the generated HTTP contract. */

import type { PlaybackDirection, PlaybackPosition } from './playback.js'
import type { components } from '../api/generated/http-contract.js'
import { validateBattlePlaybackDataset } from '../api/contract-runtime.js'
import type { AgentPlaybackFacet, AgentVehicleTrack } from '../api/agent-replay-facets.js'

export type PlaybackCapability = components['schemas']['PlaybackCapability']
export type PositionKnowledge = components['schemas']['PositionKnowledge']
export type OrientationKnowledge = components['schemas']['OrientationKnowledge']
export type HealthKnowledge = components['schemas']['HealthKnowledge']
export type PlaybackConfidence = components['schemas']['PlaybackConfidence']
export type PlaybackLifeState = components['schemas']['PlaybackLifeState']
export type BattlePlaybackDataset = components['schemas']['BattlePlaybackDataset']
export type VehiclePlaybackTrack = components['schemas']['VehiclePlaybackTrack']
export type VehicleBattleLoadout = components['schemas']['VehicleBattleLoadout']
export type PositionSegment = components['schemas']['PositionSegment']
export type PositionSample = components['schemas']['PositionSample']
export type OrientationSegment = components['schemas']['OrientationSegment']
export type OrientationSample = components['schemas']['OrientationSample']
export type HealthTransition = components['schemas']['HealthTransition']
export type LifeTransition = components['schemas']['LifeTransition']
export type DamageLoss = components['schemas']['DamageLoss']
export type DamageDealtSample = components['schemas']['DamageDealtSample']
export type ConsumableTransition = components['schemas']['ConsumableTransition']
export type ModuleCrewTransition = components['schemas']['ModuleCrewTransition']
export type BattleEvent = components['schemas']['BattleEvent']
export type PointsSample = components['schemas']['PointsSample']
export type BaseStateTransition = components['schemas']['BaseStateTransition']

/** Local Playback telemetry, separate from the HTTP dataset and generic ReplayFacts. */
export interface PlaybackReloadTelemetry extends Pick<AgentPlaybackFacet, 'reloads' | 'reload_effective' | 'shots'> {
  /**
   * `burst_size` = 实际搭载配置的弹夹容量（弹容 N 权威，contracts/agent §4h）；
   * `turret_local`/`gun_local` = comp blob 模块局部 id（客户端证据链证据 0）；
   * `shell_ids`/`max_hp` = 证据链证据 1/2 的回放侧输入。
   */
  vehicles: Array<Pick<AgentVehicleTrack, 'eid' | 'account_id' | 'team' | 'tank_id' | 'shell_ids' | 'max_hp' | 'config_idx' | 'burst_size' | 'turret_local' | 'gun_local'>>
  /** Raw clock corresponding to the canonical 2D battle-relative t=0. */
  timeOrigin: number
  friendlyTeam: number | null
}

export function isBattlePlaybackDataset(value: unknown): value is BattlePlaybackDataset {
  return validateBattlePlaybackDataset(value).data !== null
}

/** Validate the generated wire contract; application models are built only after this boundary. */
export function parseBattlePlaybackDataset(value: unknown): BattlePlaybackDataset | null {
  return validateBattlePlaybackDataset(value).data
}

export interface HealthAtResult {
  currentHp: number | null
  knowledge: HealthKnowledge
  source: string
  displayCapacityHp: number | null
  relativeFull: boolean
  confidence: PlaybackConfidence
}

export interface LifeAtResult {
  lifeState: PlaybackLifeState
  destroyedKnownAtSec: number | null
}

export interface ConsumableRuntimeResult {
  state: string
  logicalItemId: string | null
  wireCode: number | null
}

export interface ModuleCrewResult {
  component: string
  state: string
  recorderVisible: boolean
  confidence: PlaybackConfidence
}

export type { PlaybackDirection, PlaybackPosition }
