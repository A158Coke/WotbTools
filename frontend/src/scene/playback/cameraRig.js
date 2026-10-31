// 录像者相机的纯数学：不依赖 Three，scene 负责接线。
// 回放只证明瞄准方向、开镜时机与缩放 raw 值；第三人称机位和准星绝对尺寸都是重建。

export const CAMERA_MODE = Object.freeze({ ARCADE: 'ARCADE', SNIPER: 'SNIPER', UNKNOWN: 'UNKNOWN' })

/** 渲染默认 FOV（度），与 playback/renderer.js 的相机同值。 */
export const BASE_FOV_DEG = 55
const MODE_BLEND_SEC = 0.25
export const ARCADE_BOOM_M = 14
const ARCADE_HEIGHT_M = 4
export const ANCHOR_HEIGHT_M = 2.2
export const BACKWARD_ZOOM_SCALE = 1.35
/** 视野穿透半径（米）：Arcade 要盖住相机到本车这一段，两者都是校准值。 */
export const FOLIAGE_CLIP_SCOPED_M = 25
export const FOLIAGE_CLIP_ARCADE_M = ARCADE_BOOM_M + 6
const BACKWARD_ZOOM_TAU_SEC = 0.25
const REVERSE_WINDOW_SEC = 0.2
const REVERSE_MIN_SPEED_MPS = 0.5

const ZOOM_RAW_MIN = 6.75
const ZOOM_RAW_MAX = 54
const MODE_DEFAULT_RAW = 1
const MODE_CODE_MASK = 0x7fffffff
/** Type31 相对 session 边界的时钟容差，与上游结构校验同值。 */
const ZOOM_SESSION_SLACK_SEC = 0.02

const RETICLE_BASE_RAD = 0.01
const RETICLE_MIN_PX = 10
const RETICLE_MAX_VIEWPORT = 0.2

/** `values` 中最后一个 ≤ t 的下标；全部大于 t 时返回 -1。 */
function lastIndexAtOrBefore(values, t) {
  let lo = 0
  let hi = values.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (values[mid] <= t) { found = mid; lo = mid + 1 } else hi = mid - 1
  }
  return found
}

function modeOf(raw) {
  const code = raw & MODE_CODE_MASK
  if (code === 1) return CAMERA_MODE.ARCADE
  if (code === 0) return CAMERA_MODE.SNIPER
  return CAMERA_MODE.UNKNOWN
}

/**
 * Type31 只在当前开镜 session 内取最近样本：连续流的保持误差约 8ms，而稀疏流线性插值
 * 会凭空造出数秒的缓变。session 刚开始还没有样本时取本 session 的第一个样本。
 */
function zoomInSession(zoom, sessionStart, sessionEnd, t) {
  const floor = sessionStart - ZOOM_SESSION_SLACK_SEC
  const index = lastIndexAtOrBefore(zoom.t, t)
  if (index >= 0 && zoom.t[index] >= floor) return zoom.raw[index]
  const next = index + 1
  return next < zoom.t.length && zoom.t[next] <= sessionEnd ? zoom.raw[next] : null
}

/** 回放时刻 t 的录像者相机状态；无内部游标，seek 与顺播结果一致。 */
export function sampleRecorderCamera(facet, t, out = {}) {
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
  const mix = (column) => column[index] + (column[next] - column[index]) * ratio
  out.yaw = mix(aim.yaw)
  out.pitch = mix(aim.pitch)
  out.rayX = mix(aim.ray_x)
  out.rayY = mix(aim.ray_y)
  out.rayZ = mix(aim.ray_z)

  const bloomIndex = lastIndexAtOrBefore(facet.bloom.t, t)
  out.bloomRaw = bloomIndex >= 0 ? facet.bloom.raw[bloomIndex] : null
  return out
}

/** 游戏系瞄准角 → 场景系单位方向（场景系 = 游戏系 x 取负）。 */
export function aimDirectionScene(yaw, pitch, out = {}) {
  const horizontal = Math.cos(pitch)
  out.x = -Math.sin(yaw) * horizontal
  out.y = Math.sin(pitch)
  out.z = Math.cos(yaw) * horizontal
  return out
}

/** Arcade 机位：从车辆锚点沿瞄准水平方向后退并抬高。 */
export function arcadeCameraPosition(anchor, direction, boom, out = {}) {
  const length = Math.hypot(direction.x, direction.z) || 1
  out.x = anchor.x - (direction.x / length) * boom
  out.y = anchor.y + ARCADE_HEIGHT_M * (boom / ARCADE_BOOM_M)
  out.z = anchor.z - (direction.z / length) * boom
  return out
}

/** 倒车判定：比较最近一段位移与车体前向，无内部状态，seek 后立即正确。 */
export function isReversing(previous, current, hullYaw) {
  const along = (current.x - previous.x) * Math.sin(hullYaw) + (current.z - previous.z) * Math.cos(hullYaw)
  return along / REVERSE_WINDOW_SEC < -REVERSE_MIN_SPEED_MPS
}
export const REVERSE_SAMPLE_OFFSET_SEC = REVERSE_WINDOW_SEC

/** 倒车拉远的呈现平滑；这一段是重建，不是回放数据。 */
export function backwardZoomScale(current, reversing, dt) {
  const target = reversing ? BACKWARD_ZOOM_SCALE : 1
  return target + (current - target) * Math.exp(-Math.max(0, dt) / BACKWARD_ZOOM_TAU_SEC)
}

/**
 * raw → 渲染垂直 FOV 的唯一映射点。这是校准映射，不是单位结论：
 * Type31 的物理单位未闭合，以原客户端对照结果为准。
 */
export function fovFromZoomRaw(raw) {
  if (!Number.isFinite(raw)) return BASE_FOV_DEG
  return Math.max(ZOOM_RAW_MIN, Math.min(ZOOM_RAW_MAX, raw))
}

/** 扩散圆像素半径：bloom 视为角半径按当前 FOV 投影，绝对尺寸是校准值，不是协议结论。 */
export function reticleRadiusPx({ bloomRaw, fovDeg, viewportH }) {
  const bloom = Number.isFinite(bloomRaw) ? bloomRaw : 1
  const halfFov = (fovDeg * Math.PI) / 360
  const radius = (Math.tan(bloom * RETICLE_BASE_RAD) / Math.tan(halfFov)) * (viewportH / 2)
  return Math.max(RETICLE_MIN_PX, Math.min(viewportH * RETICLE_MAX_VIEWPORT, radius))
}

/** 模式切换的呈现缓动进度。 */
export function blendProgress(elapsedSec) {
  const ratio = Math.max(0, Math.min(1, elapsedSec / MODE_BLEND_SEC))
  return ratio * ratio * (3 - 2 * ratio)
}
