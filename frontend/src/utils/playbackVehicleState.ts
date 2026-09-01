import { positionCoveredAtV2, positionAtV2, orientationAtV2, lifeAt } from './battlePlaybackV2'
import { screenRotation, turretWorldYawDeg } from './battlePlayback'

const HULL_HITBOX = Object.freeze({
  dedicated: Object.freeze({ w: 0.9, h: 0.9 }),
  generic: Object.freeze({ w: 0.58, h: 0.9 }),
})

/**
 * Project one canonical V2 track into the render-neutral vehicle state consumed by VehicleMarker.
 * All replay facts come from the V2 track; callers provide presentation mapping and asset decisions.
 */
export function projectVehicleState({
  vehicle,
  track,
  time,
  recorderAccountId,
  model,
  hullImage,
  turretImage,
  markerLeft,
  markerTop,
  markerTransform,
  overlayInverseScale,
  overlayInverse,
  translate,
}) {
  const life = lifeAt(track, time)
  const destroyed = life != null && life.lifeState === 'DESTROYED'
  const pos = positionAtV2(track.positionSegments, time)
  if (!pos) return null
  const covered = positionCoveredAtV2(track.positionSegments, time)
  const recorder = vehicle.accountId === recorderAccountId
  const direction = orientationAtV2(track.orientationSegments, time)
  // friendly is a canonical track fact. The perspective team is presentation
  // context only and must not re-derive vehicle identity from team numbers.
  const friendly = track.friendly === true ? true : track.friendly === false ? false : null
  const hullDeg = direction ? screenRotation(direction.hullYawDeg) : null
  const turretDeg = direction
    ? screenRotation(turretWorldYawDeg(direction.hullYawDeg, direction.turretRelativeYawDeg))
    : null
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
    hullImage,
    turretImage,
    hullScreenDeg: destroyed ? (hullDeg == null ? 0 : hullDeg) : hullDeg,
    turretScreenDeg: destroyed ? (turretDeg == null ? 0 : turretDeg) : turretDeg,
    markerStyle: { left: markerLeft(pos.x), top: markerTop(pos.y), transform: markerTransform },
    overlayInverseScale,
    overlayInverse,
    playerName: vehicle.playerName || '',
    tankName: vehicle.tankName || String(vehicle.tankId),
    hitbox: model ? HULL_HITBOX.dedicated : HULL_HITBOX.generic,
    ariaLabel: `${vehicle.playerName}: ${translate(destroyed ? 'recon.map.playback.state_destroyed' : (covered ? 'recon.map.playback.state_position_reported' : 'recon.map.playback.state_position_stale'))}`,
    lastKnown: !covered,
  }
}
