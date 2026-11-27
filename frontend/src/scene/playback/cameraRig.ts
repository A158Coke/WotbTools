import type { AgentRecorderCamera } from '../../api/agent-replay-facets.js'

export type RecorderCameraFacet = AgentRecorderCamera

export interface CameraVec3 {
  x: number
  y: number
  z: number
}

export interface RecorderCameraSample {
  rawMode: number
  mode: string
  zoomRaw: number | null
  yaw: number
  pitch: number
  rayX: number
  rayY: number
  rayZ: number
  bloomRaw: number | null
}

export const CAMERA_MODE = Object.freeze({ ARCADE: 'ARCADE', SNIPER: 'SNIPER', UNKNOWN: 'UNKNOWN' })

export const BASE_FOV_DEG = 55
const MODE_BLEND_SEC = 0.25
export const ARCADE_BOOM_M = 14
const ARCADE_HEIGHT_M = 4
export const ANCHOR_HEIGHT_M = 2.2
export const BACKWARD_ZOOM_SCALE = 1.35
export const FOLIAGE_CLIP_SCOPED_M = 25
export const FOLIAGE_CLIP_ARCADE_M = ARCADE_BOOM_M + 6
const BACKWARD_ZOOM_TAU_SEC = 0.25
const REVERSE_WINDOW_SEC = 0.2
const REVERSE_MIN_SPEED_MPS = 0.5

const ZOOM_RAW_MIN = 6.75
const ZOOM_RAW_MAX = 54
const MODE_DEFAULT_RAW = 1
const MODE_CODE_MASK = 0x7fffffff
const ZOOM_SESSION_SLACK_SEC = 0.02

const RETICLE_BASE_RAD = 0.01
const RETICLE_MIN_PX = 10
const RETICLE_MAX_VIEWPORT = 0.2

function lastIndexAtOrBefore(values: ArrayLike<number>, t: number): number {
  let lo = 0
  let hi = values.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (values[mid] <= t) { found = mid; lo = mid + 1 } else hi = mid - 1
  }
  return found
}

function modeOf(raw: number): string {
  const code = raw & MODE_CODE_MASK
  if (code === 1) return CAMERA_MODE.ARCADE
  if (code === 0) return CAMERA_MODE.SNIPER
  return CAMERA_MODE.UNKNOWN
}

export function recorderModeAt(facet: RecorderCameraFacet, t: number): string {
  const index = lastIndexAtOrBefore(facet.mode.t, t)
  return modeOf(index >= 0 ? facet.mode.raw[index] : MODE_DEFAULT_RAW)
}

function zoomInSession(zoom: RecorderCameraFacet['zoom'], sessionStart: number, sessionEnd: number, t: number): number | null {
  const floor = sessionStart - ZOOM_SESSION_SLACK_SEC
  const index = lastIndexAtOrBefore(zoom.t, t)
  if (index >= 0 && zoom.t[index] >= floor) return zoom.raw[index]
  const next = index + 1
  return next < zoom.t.length && zoom.t[next] <= sessionEnd ? zoom.raw[next] : null
}

export function sampleRecorderCamera(facet: RecorderCameraFacet, t: number, out: RecorderCameraSample = {} as RecorderCameraSample): RecorderCameraSample {
  const modeIndex = lastIndexAtOrBefore(facet.mode.t, t)
  const rawMode = modeIndex >= 0 ? facet.mode.raw[modeIndex] : MODE_DEFAULT_RAW
  out.rawMode = rawMode
  out.mode = modeOf(rawMode)
  out.zoomRaw = null
  if (rawMode !== MODE_DEFAULT_RAW && modeIndex >= 0) {
    const sessionEnd = modeIndex + 1 < facet.mode.t.length ? facet.mode.t[modeIndex + 1] : Infinity
    out.zoomRaw = zoomInSession(facet.zoom, facet.mode.t[modeIndex], sessionEnd, t)
  }

  const aim = facet.aim
  const last = aim.t.length - 1
  const index = Math.max(0, Math.min(last, lastIndexAtOrBefore(aim.t, t)))
  const next = Math.min(last, index + 1)
  const span = aim.t[next] - aim.t[index]
  const ratio = span > 0 ? Math.max(0, Math.min(1, (t - aim.t[index]) / span)) : 0
  const mix = (column: ArrayLike<number>): number => column[index] + (column[next] - column[index]) * ratio
  out.yaw = mix(aim.yaw)
  out.pitch = mix(aim.pitch)
  out.rayX = mix(aim.ray_x)
  out.rayY = mix(aim.ray_y)
  out.rayZ = mix(aim.ray_z)

  const bloomIndex = lastIndexAtOrBefore(facet.bloom.t, t)
  out.bloomRaw = bloomIndex >= 0 ? facet.bloom.raw[bloomIndex] : null
  return out
}

export function aimDirectionScene(yaw: number, pitch: number, out: CameraVec3 = {} as CameraVec3): CameraVec3 {
  const horizontal = Math.cos(pitch)
  out.x = -Math.sin(yaw) * horizontal
  out.y = Math.sin(pitch)
  out.z = Math.cos(yaw) * horizontal
  return out
}

export function arcadeCameraPosition(anchor: CameraVec3, direction: CameraVec3, boom: number, out: CameraVec3 = {} as CameraVec3): CameraVec3 {
  const length = Math.hypot(direction.x, direction.z) || 1
  out.x = anchor.x - (direction.x / length) * boom
  out.y = anchor.y + ARCADE_HEIGHT_M * (boom / ARCADE_BOOM_M)
  out.z = anchor.z - (direction.z / length) * boom
  return out
}

export function isReversing(previous: CameraVec3, current: CameraVec3, hullYaw: number): boolean {
  const along = (current.x - previous.x) * Math.sin(hullYaw) + (current.z - previous.z) * Math.cos(hullYaw)
  return along / REVERSE_WINDOW_SEC < -REVERSE_MIN_SPEED_MPS
}
export const REVERSE_SAMPLE_OFFSET_SEC = REVERSE_WINDOW_SEC

export function backwardZoomScale(current: number, reversing: boolean, dt: number): number {
  const target = reversing ? BACKWARD_ZOOM_SCALE : 1
  return target + (current - target) * Math.exp(-Math.max(0, dt) / BACKWARD_ZOOM_TAU_SEC)
}

export function fovFromZoomRaw(raw: number): number {
  if (!Number.isFinite(raw)) return BASE_FOV_DEG
  return Math.max(ZOOM_RAW_MIN, Math.min(ZOOM_RAW_MAX, raw))
}

export function reticleRadiusPx({ bloomRaw, fovDeg, viewportH }: { bloomRaw: number | null; fovDeg: number; viewportH: number }): number {
  const bloom = typeof bloomRaw === 'number' && Number.isFinite(bloomRaw) ? bloomRaw : 1
  const halfFov = (fovDeg * Math.PI) / 360
  const radius = (Math.tan(bloom * RETICLE_BASE_RAD) / Math.tan(halfFov)) * (viewportH / 2)
  return Math.max(RETICLE_MIN_PX, Math.min(viewportH * RETICLE_MAX_VIEWPORT, radius))
}

export function blendProgress(elapsedSec: number): number {
  const ratio = Math.max(0, Math.min(1, elapsedSec / MODE_BLEND_SEC))
  return ratio * ratio * (3 - 2 * ratio)
}
