/** TypeScript projection of the backend BattlePlaybackDataset V2 DTO. */

import type { PlaybackDirection, PlaybackHpLoss, PlaybackPosition } from './playback.js'

type PlaybackRecord = Record<string, unknown>

function isRecord(value: unknown): value is PlaybackRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function nullableInteger(value: unknown): number | null {
  return value === null || !Number.isInteger(value) ? null : value as number
}

function nullableFiniteNumber(value: unknown): boolean {
  return value === null || isFiniteNumber(value)
}

function isConfidence(value: unknown): boolean {
  return value === 'HIGH' || value === 'MEDIUM' || value === 'LOW' || value === 'UNKNOWN'
}

function isPositionSample(value: unknown): boolean {
  if (!isRecord(value)) return false
  return isFiniteNumber(value.timeSec) && isFiniteNumber(value.x) && isFiniteNumber(value.y)
    && (value.knowledge === 'OBSERVED' || value.knowledge === 'LAST_KNOWN')
}

function isPositionSegment(value: unknown): boolean {
  if (!isRecord(value)) return false
  return isFiniteNumber(value.startSec) && isFiniteNumber(value.endSec)
    && (value.knowledge === 'OBSERVED' || value.knowledge === 'LAST_KNOWN')
    && typeof value.interpolationAllowed === 'boolean'
    && Array.isArray(value.samples) && value.samples.every(isPositionSample)
}

function isOrientationSample(value: unknown): boolean {
  if (!isRecord(value)) return false
  return isFiniteNumber(value.timeSec)
    && nullableFiniteNumber(value.hullYawDeg)
    && nullableFiniteNumber(value.turretRelativeYawDeg)
    && (value.knowledge === 'CURRENT' || value.knowledge === 'LAST_KNOWN' || value.knowledge === 'UNKNOWN')
}

function isOrientationSegment(value: unknown): boolean {
  if (!isRecord(value)) return false
  return isFiniteNumber(value.startSec) && isFiniteNumber(value.endSec)
    && (value.knowledge === 'CURRENT' || value.knowledge === 'LAST_KNOWN' || value.knowledge === 'UNKNOWN')
    && Array.isArray(value.samples) && value.samples.every(isOrientationSample)
}

function isHealthTransition(value: unknown): boolean {
  if (!isRecord(value)) return false
  return isFiniteNumber(value.timeSec)
    && (value.currentHp === null || Number.isInteger(value.currentHp))
    && (value.knowledge === 'CURRENT' || value.knowledge === 'LAST_KNOWN' || value.knowledge === 'UNKNOWN')
    && typeof value.source === 'string'
    && (value.displayCapacityHp === null || Number.isInteger(value.displayCapacityHp))
    && isConfidence(value.confidence)
}

function isLifeTransition(value: unknown): boolean {
  if (!isRecord(value)) return false
  return isFiniteNumber(value.timeSec)
    && (value.lifeState === 'ALIVE' || value.lifeState === 'DESTROYED' || value.lifeState === 'UNKNOWN')
    && nullableFiniteNumber(value.destroyedKnownAtSec)
}

function isConsumableTransition(value: unknown): boolean {
  if (!isRecord(value)) return false
  return isFiniteNumber(value.timeSec)
    && (value.consumableSlot === null || Number.isInteger(value.consumableSlot))
    && (value.logicalItemId === null || typeof value.logicalItemId === 'string')
    && (value.wireCode === null || Number.isInteger(value.wireCode))
    && typeof value.state === 'string' && isConfidence(value.confidence)
}

function isModuleCrewTransition(value: unknown): boolean {
  if (!isRecord(value)) return false
  return isFiniteNumber(value.timeSec) && typeof value.component === 'string'
    && typeof value.state === 'string' && typeof value.recorderVisible === 'boolean'
    && isConfidence(value.confidence)
}

function isLoadout(value: unknown): boolean {
  if (!isRecord(value)) return false
  return (value.replayVersion === null || typeof value.replayVersion === 'string')
    && Array.isArray(value.consumables)
    && value.consumables.every(item => item === null || typeof item === 'string')
    && Array.isArray(value.consumableWireCodes)
    && value.consumableWireCodes.every(item => item === null || Number.isInteger(item))
    && Array.isArray(value.provisions)
    && value.provisions.every(item => item === null || typeof item === 'string')
    && Array.isArray(value.provisionWireCodes)
    && value.provisionWireCodes.every(item => item === null || Number.isInteger(item))
    && Array.isArray(value.equipmentIds)
    && value.equipmentIds.every(item => item === null || Number.isInteger(item))
    && isConfidence(value.confidence)
}

function isVehiclePlaybackTrack(value: unknown): value is VehiclePlaybackTrack {
  if (!isRecord(value)) return false
  return Number.isInteger(value.accountId) && typeof value.playerName === 'string'
    && Number.isInteger(value.tankId) && typeof value.tankName === 'string'
    && typeof value.tankClass === 'string'
    && (value.tankTier === null || Number.isInteger(value.tankTier))
    && Number.isInteger(value.team) && typeof value.friendly === 'boolean'
    && (value.loadout === null || isLoadout(value.loadout))
    && Array.isArray(value.positionSegments) && value.positionSegments.every(isPositionSegment)
    && Array.isArray(value.orientationSegments) && value.orientationSegments.every(isOrientationSegment)
    && Array.isArray(value.healthTransitions) && value.healthTransitions.every(isHealthTransition)
    && Array.isArray(value.lifeTransitions) && value.lifeTransitions.every(isLifeTransition)
    && Array.isArray(value.consumableTransitions) && value.consumableTransitions.every(isConsumableTransition)
    && Array.isArray(value.moduleCrewTransitions) && value.moduleCrewTransitions.every(isModuleCrewTransition)
}

function isBattleEvent(value: unknown): boolean {
  if (!isRecord(value)) return false
  return typeof value.type === 'string' && isFiniteNumber(value.timeSec)
    && (value.accountId === null || Number.isInteger(value.accountId))
    && (value.targetAccountId === null || Number.isInteger(value.targetAccountId))
    && (value.observedHpLoss === null || Number.isInteger(value.observedHpLoss))
}

function isShotTrack(value: unknown): boolean {
  if (!isRecord(value)) return false
  return Number.isInteger(value.shooterAccountId) && isFiniteNumber(value.launchTimeSec)
    && nullableFiniteNumber(value.terminalTimeSec)
    && (value.resolution === null || typeof value.resolution === 'string')
}

function isPointsSample(value: unknown): boolean {
  if (!isRecord(value)) return false
  return isFiniteNumber(value.timeSec) && Number.isInteger(value.team) && Number.isInteger(value.points)
}

export type PlaybackCapability = 'FULL' | 'PARTIAL' | 'UNAVAILABLE'
export type PositionKnowledge = 'OBSERVED' | 'LAST_KNOWN'
export type OrientationKnowledge = 'CURRENT' | 'LAST_KNOWN' | 'UNKNOWN'
export type HealthKnowledge = 'CURRENT' | 'LAST_KNOWN' | 'UNKNOWN'
export type PlaybackConfidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN'
export type PlaybackLifeState = 'ALIVE' | 'DESTROYED' | 'UNKNOWN'

export interface BattlePlaybackDataset {
  durationSec: number
  mapCode: string | null
  friendlyTeam: number | null
  recorderAccountId: number | null
  vehicles: VehiclePlaybackTrack[]
  events: BattleEvent[]
  shots: ShotTrack[]
  pointsSamples: PointsSample[]
  limitations: string[]
  capability: PlaybackCapability
  arenaBonusType: number | null
}

/**
 * Validate the stable dataset envelope before handing external JSON to playback.
 * Older cached responses may omit additive fields, so those fields are optional at
 * the transport boundary while present values still receive shape validation.
 */
export function isBattlePlaybackDataset(value: unknown): value is BattlePlaybackDataset {
  if (!isRecord(value)) return false
  if (!isFiniteNumber(value.durationSec)) return false
  if (value.mapCode !== null && typeof value.mapCode !== 'string') return false
  if (value.friendlyTeam !== null && !Number.isInteger(value.friendlyTeam)) return false
  if (value.recorderAccountId !== null && !Number.isInteger(value.recorderAccountId)) return false
  if (!Array.isArray(value.vehicles) || !value.vehicles.every(isVehiclePlaybackTrack)) return false
  if (!Array.isArray(value.events) || !value.events.every(isBattleEvent)) return false
  if (!Array.isArray(value.shots) || !value.shots.every(isShotTrack)) return false
  if (!Array.isArray(value.pointsSamples) || !value.pointsSamples.every(isPointsSample)) return false
  if (!Array.isArray(value.limitations) || !value.limitations.every(item => typeof item === 'string')) return false
  if (value.capability !== 'FULL' && value.capability !== 'PARTIAL' && value.capability !== 'UNAVAILABLE') return false
  if (value.arenaBonusType !== null && !Number.isInteger(value.arenaBonusType)) return false
  return true
}

/** Normalize additive/legacy cache omissions, then return only a validated dataset. */
export function parseBattlePlaybackDataset(value: unknown): BattlePlaybackDataset | null {
  if (!isRecord(value)) return null
  // These fields define the authoritative dataset envelope. Additive metadata
  // (map/friendly/recorder/arena) may be absent in older cached responses, but
  // an otherwise empty object must never be promoted to a usable FULL dataset.
  const requiredEnvelope = ['durationSec', 'vehicles', 'events', 'shots', 'pointsSamples', 'capability']
  if (requiredEnvelope.some(key => !(key in value))) return null
  if (!isFiniteNumber(value.durationSec)) return null
  if (value.capability !== 'FULL' && value.capability !== 'PARTIAL' && value.capability !== 'UNAVAILABLE') return null
  if ('vehicles' in value && !Array.isArray(value.vehicles)) return null
  if ('events' in value && !Array.isArray(value.events)) return null
  if ('shots' in value && !Array.isArray(value.shots)) return null
  if ('pointsSamples' in value && !Array.isArray(value.pointsSamples)) return null
  if ('limitations' in value && (!Array.isArray(value.limitations)
    || !value.limitations.every(item => typeof item === 'string'))) return null
  if ('mapCode' in value && value.mapCode !== null && typeof value.mapCode !== 'string') return null
  if ('friendlyTeam' in value && value.friendlyTeam !== null && !Number.isInteger(value.friendlyTeam)) return null
  if ('recorderAccountId' in value && value.recorderAccountId !== null && !Number.isInteger(value.recorderAccountId)) return null
  if ('arenaBonusType' in value && value.arenaBonusType !== null && !Number.isInteger(value.arenaBonusType)) return null
  const limitations = Array.isArray(value.limitations) && value.limitations.every(item => typeof item === 'string')
    ? value.limitations as string[] : []
  const capability = value.capability
  const normalized: BattlePlaybackDataset = {
    durationSec: isFiniteNumber(value.durationSec) ? value.durationSec : 0,
    mapCode: value.mapCode === null || typeof value.mapCode === 'string' ? value.mapCode ?? null : null,
    friendlyTeam: nullableInteger(value.friendlyTeam),
    recorderAccountId: nullableInteger(value.recorderAccountId),
    vehicles: Array.isArray(value.vehicles) ? value.vehicles : [],
    events: Array.isArray(value.events) ? value.events : [],
    shots: Array.isArray(value.shots) ? value.shots : [],
    pointsSamples: Array.isArray(value.pointsSamples) ? value.pointsSamples : [],
    limitations,
    capability,
    arenaBonusType: nullableInteger(value.arenaBonusType),
  }
  return isBattlePlaybackDataset(normalized) ? normalized : null
}

export interface VehiclePlaybackTrack {
  accountId: number
  playerName: string
  tankId: number
  tankName: string
  tankClass: string
  tankTier: number | null
  team: number
  friendly: boolean
  loadout: VehicleBattleLoadout | null
  positionSegments: PositionSegment[]
  orientationSegments: OrientationSegment[]
  healthTransitions: HealthTransition[]
  lifeTransitions: LifeTransition[]
  consumableTransitions: ConsumableTransition[]
  moduleCrewTransitions: ModuleCrewTransition[]
}

export interface VehicleBattleLoadout {
  replayVersion: string | null
  consumables: Array<string | null>
  consumableWireCodes: Array<number | null>
  provisions: Array<string | null>
  provisionWireCodes: Array<number | null>
  equipmentIds: Array<number | null>
  confidence: PlaybackConfidence
}

export interface PositionSegment {
  startSec: number
  endSec: number
  knowledge: PositionKnowledge
  interpolationAllowed: boolean
  samples: PositionSample[]
}

export interface PositionSample extends PlaybackPosition {
  knowledge: PositionKnowledge
}

export interface OrientationSegment {
  startSec: number
  endSec: number
  knowledge: OrientationKnowledge
  samples: OrientationSample[]
}

export interface OrientationSample extends PlaybackDirection {
  knowledge: OrientationKnowledge
}

export interface HealthTransition {
  timeSec: number
  currentHp: number | null
  knowledge: HealthKnowledge
  source: string
  displayCapacityHp: number | null
  confidence: PlaybackConfidence
}

export interface LifeTransition {
  timeSec: number
  lifeState: PlaybackLifeState
  destroyedKnownAtSec: number | null
}

export interface ConsumableTransition {
  timeSec: number
  consumableSlot: number | null
  logicalItemId: string | null
  wireCode: number | null
  state: string
  confidence: PlaybackConfidence
}

export interface ModuleCrewTransition {
  timeSec: number
  component: string
  state: string
  recorderVisible: boolean
  confidence: PlaybackConfidence
}

export interface BattleEvent {
  type: string
  timeSec: number
  accountId: number | null
  targetAccountId: number | null
  observedHpLoss: number | null
}

export interface ShotTrack {
  shooterAccountId: number
  launchTimeSec: number
  terminalTimeSec: number | null
  resolution: string | null
}

export interface PointsSample {
  timeSec: number
  team: number
  points: number
}

export interface HealthAtResult {
  currentHp: number | null
  knowledge: HealthKnowledge
  source: string
  displayCapacityHp: number | null
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

/** Compatibility view produced by v2VehicleView for existing legacy projections. */
export interface V2VehicleView {
  accountId: number
  playerName: string
  tankId: number
  tankName: string
  team: number
  tankType: string
  healthTransitions: HealthTransition[]
  lifeTransitions: LifeTransition[]
  deathSec: number | null
  hpLosses: PlaybackHpLoss[]
  positionIntervals: Array<Pick<PositionSegment, 'startSec' | 'endSec'>>
  directionSamples: Array<Pick<OrientationSample, 'timeSec' | 'hullYawDeg' | 'turretRelativeYawDeg'>>
  positionSegments: PositionSegment[]
  orientationSegments: OrientationSegment[]
  loadout: VehicleBattleLoadout | null
}
