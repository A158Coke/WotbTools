/**
 * 火炮射界交互图（BlitzInfo “Gun arcs” 同构）的纯几何层。
 *
 * 方位角：0° = 车头，90° = 右舷，±180° = 车尾（俯视、车头朝上）。
 * 俯仰：`up` 为正仰角，`down` 为带符号下限（负 = 可压低，正 = 车体挡住、至少抬起）。
 *
 * 径向映射是**显示层**：半径锚点取 BlitzInfo 11.21 的 Gun arcs 数值，但**内外翻转**
 * （2026-10-27 用户要求）：**内圈 = 俯角、外圈 = 仰角**。当前半径 = 1 − BI 原半径，
 * 即 +10°=0.7126、+18°=0.8295、−3°=0.4315、−6°=0.3660；地平线仍为 0.5。
 * 只影响画面比例，不参与任何数值判定。
 */
import { pitchAtBearing } from './tankSetup'

export interface PitchBonus {
  up?: number
  down?: number
}

export interface ArcLimits {
  up: number
  down: number
}

export interface ArcSample extends ArcLimits {
  bearing: number
}

const UP_ANCHORS: Array<[number, number]> = [
  [0, 0.5],
  [10, 0.2874],
  [18, 0.1705],
  [26, 0.1036],
  [60, 0],
]

const DOWN_ANCHORS: Array<[number, number]> = [
  [0, 0.5],
  [3, 0.5685],
  [6, 0.634],
  [8, 0.6748],
  [10, 0.7126],
  [22, 1],
]

function interpolate(anchors: Array<[number, number]>, value: number) {
  if (value <= anchors[0][0]) return anchors[0][1]
  for (let i = 0; i < anchors.length - 1; i += 1) {
    const [x1, y1] = anchors[i]
    const [x2, y2] = anchors[i + 1]
    if (value <= x2) return y1 + ((value - x1) / (x2 - x1)) * (y2 - y1)
  }
  return anchors[anchors.length - 1][1]
}

/** 俯仰角 → 圆盘半径（0.5 = 地平线；仰角向内、俯角向外）。 */
export function radiusForPitch(pitch: number): number {
  // 内外翻转：BI 原半径 r 映射到 1−r（内圈俯角 / 外圈仰角）
  return pitch >= 0
    ? 1 - interpolate(UP_ANCHORS, pitch)
    : 1 - interpolate(DOWN_ANCHORS, -pitch)
}

/** 圆盘半径 → 俯仰角（分段线性反解；超出锚点范围即钳到端点）。 */
export function pitchForRadius(radius: number): number {
  // 反解：先把新半径换回 BI 原半径，再按原锚点反查
  const target = 1 - Math.min(1, Math.max(0, radius))
  const anchors = target <= 0.5 ? UP_ANCHORS : DOWN_ANCHORS
  for (let i = 0; i < anchors.length - 1; i += 1) {
    const [x1, y1] = anchors[i]
    const [x2, y2] = anchors[i + 1]
    const lo = Math.min(y1, y2)
    const hi = Math.max(y1, y2)
    if (target >= lo && target <= hi) {
      const t = (target - y1) / (y2 - y1)
      const pitch = x1 + t * (x2 - x1)
      return target <= 0.5 ? pitch : -pitch
    }
  }
  return target <= 0.5 ? anchors[anchors.length - 1][0] : -anchors[anchors.length - 1][0]
}

/** 炮塔水平射界（与 3D 同口径：钳制到 [-max, -min]；缺省/360° = 全向）。 */
export function arcBearingRange(yawLimits: any) {
  const hasYaw = yawLimits
    && Number.isFinite(Number(yawLimits.min))
    && Number.isFinite(Number(yawLimits.max))
  const a = hasYaw ? -Number(yawLimits.max) : -180
  const b = hasYaw ? -Number(yawLimits.min) : 180
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)
  const full = hi - lo >= 360 - 1e-6
  return full ? { lo: -180, hi: 180, full } : { lo, hi, full }
}

export function clampBearing(bearing: number, yawLimits: any) {
  const { lo, hi, full } = arcBearingRange(yawLimits)
  if (full) return bearing
  return Math.min(hi, Math.max(lo, bearing))
}

/** 屏幕/图形坐标 → 方位角（0 = 上，顺时针为正）。 */
export function bearingFromPoint(x: number, y: number) {
  return Math.atan2(x, -y) * 180 / Math.PI
}

function polar(bearing: number, radius: number) {
  const rad = bearing * Math.PI / 180
  const x = Math.round(radius * Math.sin(rad) * 1e4) / 1e4
  const y = Math.round(-radius * Math.cos(rad) * 1e4) / 1e4
  return `${x} ${y}`
}

/** 均匀采样当前可转射界上的俯仰极限（含两端点；步长默认 2°）。 */
export function gunArcSamples(
  pitch: any,
  yawLimits: any,
  bonus?: PitchBonus | null,
  step = 2,
): ArcSample[] {
  const { lo, hi } = arcBearingRange(yawLimits)
  const count = Math.max(2, Math.ceil((hi - lo) / Math.max(0.5, step)))
  const out: ArcSample[] = []
  for (let i = 0; i <= count; i += 1) {
    const bearing = lo + ((hi - lo) * i) / count
    out.push({ bearing, ...pitchAtBearing(pitch, bearing, bonus) })
  }
  return out
}

/**
 * 阴影带路径：外沿 = 该方位**仰角上限**、内沿 = **俯角下限**（内外翻转后的映射）。
 * 全向炮塔用两条闭合轮廓（evenodd 环形）；有限射界用单条带端盖的闭合多边形。
 */
export function gunArcBandPath(
  pitch: any,
  yawLimits: any,
  bonus?: PitchBonus | null,
  step = 2,
): string {
  if (!pitch) return ''
  const { full } = arcBearingRange(yawLimits)
  const samples = gunArcSamples(pitch, yawLimits, bonus, step)
  const outer = samples.map(sample => polar(sample.bearing, radiusForPitch(sample.up)))
  const inner = samples.slice().reverse().map(sample => polar(sample.bearing, radiusForPitch(sample.down)))
  if (full) return `M ${outer.join(' L ')} Z M ${inner.join(' L ')} Z`
  return `M ${outer.join(' L ')} L ${inner.join(' L ')} Z`
}
