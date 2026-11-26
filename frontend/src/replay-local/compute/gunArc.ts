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

export function radiusForPitch(pitch: number): number {
  return pitch >= 0
    ? 1 - interpolate(UP_ANCHORS, pitch)
    : 1 - interpolate(DOWN_ANCHORS, -pitch)
}

export function pitchForRadius(radius: number): number {
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

export function bearingFromPoint(x: number, y: number) {
  return Math.atan2(x, -y) * 180 / Math.PI
}

function polar(bearing: number, radius: number) {
  const rad = bearing * Math.PI / 180
  const x = Math.round(radius * Math.sin(rad) * 1e4) / 1e4
  const y = Math.round(-radius * Math.cos(rad) * 1e4) / 1e4
  return `${x} ${y}`
}

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
