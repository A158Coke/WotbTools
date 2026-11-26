import type { VehiclePlaybackTrack } from '../types/playback-v2.js'
import { positionCoveredAtV2, positionAtV2, orientationAtV2, lifeAt } from './battlePlaybackV2'
import { screenRotation, turretWorldYawDeg } from './battlePlayback'
import { isFiniteNumber } from '../types/primitive-guards.js'

type MarkerSize = {
  renderBox: { width: number; height: number }
  collisionFootprint: { width: number; height: number }
  hitTarget?: { width: number; height: number } | null
}

export type VehiclePoseInput = {
  x: number
  y: number
  yawRad: number
  turretRelRad: number
} | null

type ProjectVehicleStateInput = {
  vehicle: { accountId: number | null; friendly?: boolean | null; playerName?: string | null; tankName?: string | null; tankId?: number | null }
  track: VehiclePlaybackTrack
  time: number
  pose?: VehiclePoseInput
  recorderAccountId: number | null
  model: unknown
  markerSize?: MarkerSize | null
  hullImage: unknown
  turretImage: unknown
  markerLeft: (x: number) => string
  markerTop: (y: number) => string
  markerTransform: string
  overlayInverseScale: number | string
  overlayInverse: number
  translate: (key: string) => string
}

const HULL_HITBOX = Object.freeze({
  dedicated: Object.freeze({ w: 0.9, h: 0.9 }),
  generic: Object.freeze({ w: 0.58, h: 0.9 }),
})

const RAD2DEG = 180 / Math.PI

export function projectVehicleState({
  vehicle,
  track,
  time,
  pose = null,
  recorderAccountId,
  model,
  markerSize = null,
  hullImage,
  turretImage,
  markerLeft,
  markerTop,
  markerTransform,
  overlayInverseScale,
  overlayInverse,
  translate,
}: ProjectVehicleStateInput) {
  const life = lifeAt(track, time)
  const destroyed = life != null && life.lifeState === 'DESTROYED'
  const canonicalPos = positionAtV2(track.positionSegments, time)
  if (!canonicalPos) return null
  const covered = positionCoveredAtV2(track.positionSegments, time)
  const recorder = vehicle.accountId === recorderAccountId
  const pos = pose && Number.isFinite(pose.x) && Number.isFinite(pose.y)
    ? { x: pose.x, y: pose.y, timeSec: canonicalPos.timeSec }
    : canonicalPos
  const direction = orientationAtV2(track.orientationSegments, time)
  const hullYawDeg = pose && Number.isFinite(pose.yawRad)
    ? screenRotation(pose.yawRad * RAD2DEG)
    : (direction && isFiniteNumber(direction.hullYawDeg) ? screenRotation(direction.hullYawDeg) : null)
  const turretYawDeg = pose && Number.isFinite(pose.yawRad) && Number.isFinite(pose.turretRelRad)
    ? screenRotation(turretWorldYawDeg(pose.yawRad * RAD2DEG, pose.turretRelRad * RAD2DEG))
    : (direction && isFiniteNumber(direction.hullYawDeg) && isFiniteNumber(direction.turretRelativeYawDeg)
        ? screenRotation(turretWorldYawDeg(direction.hullYawDeg, direction.turretRelativeYawDeg))
        : null)
  const friendly = track.friendly === true ? true : track.friendly === false ? false : null
  return {
    vehicle,
    pos,
    covered,
    destroyed,
    destroyedKnownAtSec: life && life.lifeState === 'DESTROYED' ? life.destroyedKnownAtSec : null,
    recorder,
    friendly,
    direction,
    model,
    markerSize,
    hullImage,
    turretImage,
    hullScreenDeg: hullYawDeg,
    turretScreenDeg: turretYawDeg,
    markerStyle: { left: markerLeft(pos.x), top: markerTop(pos.y), transform: markerTransform },
    overlayInverseScale,
    overlayInverse,
    playerName: vehicle.playerName || '',
    tankName: vehicle.tankName || String(vehicle.tankId),
    hitbox: model ? HULL_HITBOX.dedicated : HULL_HITBOX.generic,
    hitTargetSize: markerSize?.hitTarget || null,
    ariaLabel: `${vehicle.playerName}: ${translate(destroyed ? 'recon.map.playback.state_destroyed' : (covered ? 'recon.map.playback.state_position_reported' : 'recon.map.playback.state_position_stale'))}`,
    lastKnown: !covered,
  }
}
