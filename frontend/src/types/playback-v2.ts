/** Playback application/view types backed by the generated HTTP contract. */

import type { PlaybackDirection, PlaybackPosition } from './playback.js'
import type { components } from '../api/generated/http-contract.js'
import { validateBattlePlaybackDataset } from '../api/contract-runtime.js'

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
export type ConsumableTransition = components['schemas']['ConsumableTransition']
export type ModuleCrewTransition = components['schemas']['ModuleCrewTransition']
export type BattleEvent = components['schemas']['BattleEvent']
export type PointsSample = components['schemas']['PointsSample']
export type BaseStateTransition = components['schemas']['BaseStateTransition']

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
