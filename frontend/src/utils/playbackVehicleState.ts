import { positionCoveredAtV2, positionAtV2, orientationAtV2, lifeAt } from './battlePlaybackV2'
import { screenRotation, turretWorldYawDeg } from './battlePlayback'

type MarkerSize = {
  renderBox: { width: number; height: number }
  collisionFootprint: { width: number; height: number }
  hitTarget?: { width: number; height: number } | null
}

/**
 * 位姿通道取值（`replay-local/pose/vehiclePose.ts` 的 game 系采样结果）：
 * `y` = 游戏 z（2D 地图的纵向坐标由 mapView 负责翻转）。缺失 = 回退 canonical 原始观测。
 */
export type VehiclePoseInput = {
  x: number
  y: number
  /** 车体偏航（game 系 rad） */
  yawRad: number
  /** 炮塔相对车体偏航（rad） */
  turretRelRad: number
} | null

const HULL_HITBOX = Object.freeze({
  dedicated: Object.freeze({ w: 0.9, h: 0.9 }),
  generic: Object.freeze({ w: 0.58, h: 0.9 }),
})

const RAD2DEG = 180 / Math.PI

/**
 * Project one canonical V2 track into the render-neutral vehicle state consumed by VehicleMarker.
 *
 * 分层契约（2026-10-16）：
 * - **画在哪 / 朝哪** → `pose`（与 3D 场景同源同插值的位姿通道）；缺失时回退 canonical 观测；
 * - **可不可信** → 仍是 canonical：`covered`（观测区间）/ `lastKnown` / `pos.timeSec`（最后观测时刻）。
 */
export function projectVehicleState({
  vehicle,
  track,
  time,
  pose = null as VehiclePoseInput,
  recorderAccountId,
  model,
  markerSize = null as MarkerSize | null,
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
  const canonicalPos = positionAtV2(track.positionSegments, time)
  if (!canonicalPos) return null
  const covered = positionCoveredAtV2(track.positionSegments, time)
  const recorder = vehicle.accountId === recorderAccountId
  // 位置：位姿通道优先；timeSec 恒取 canonical（最后观测时刻，供"最后已知"面板）。
  const pos = pose && Number.isFinite(pose.x) && Number.isFinite(pose.y)
    ? { x: pose.x, y: pose.y, timeSec: canonicalPos.timeSec }
    : canonicalPos
  // 朝向：位姿通道优先；缺失时回退 canonical 原始观测（含 LAST_KNOWN 冻结语义）。
  const direction = orientationAtV2(track.orientationSegments, time)
  const hullYawDeg = pose && Number.isFinite(pose.yawRad)
    ? screenRotation(pose.yawRad * RAD2DEG)
    : (direction && Number.isFinite(direction.hullYawDeg) ? screenRotation(direction.hullYawDeg) : null)
  const turretYawDeg = pose && Number.isFinite(pose.yawRad) && Number.isFinite(pose.turretRelRad)
    ? screenRotation(turretWorldYawDeg(pose.yawRad * RAD2DEG, pose.turretRelRad * RAD2DEG))
    : (direction && Number.isFinite(direction.hullYawDeg) && Number.isFinite(direction.turretRelativeYawDeg)
        ? screenRotation(turretWorldYawDeg(direction.hullYawDeg, direction.turretRelativeYawDeg))
        : null)
  // friendly is a canonical track fact. The perspective team is presentation
  // context only and must not re-derive vehicle identity from team numbers.
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
