
export const GRID_DT = 0.1

type Sampler = (index: number) => number
type Interval = { i: number; f: number }
type Coverage = readonly number[] | null | undefined
type Span = [start: number, end: number]

export function segmentAt(t: number, t0: number, dt: number, n: number) {
  return segmentAtInto(t, t0, dt, n, { i: 0, f: 0 })
}

export function segmentAtInto(t: number, t0: number, dt: number, n: number, out: Interval) {
  if (!(n >= 2) || !(dt > 0)) {
    out.i = 0
    out.f = 0
    return out
  }
  const x = (t - t0) / dt
  const i = Math.max(0, Math.min(n - 2, Math.floor(x)))
  out.i = i
  out.f = Math.max(0, Math.min(1, x - i))
  return out
}

/**
 * 关键帧折线（不规则时刻）定位：二分找到 `t` 所在段的左端点。
 * 端点外按**保持**语义（返回首段/末段并 clamp 比例）——与上游 `PoseKeyframes` 契约一致。
 * @returns {{ i: number, f: number }} i = 左关键帧下标（clamp 到 [0, K-2]），f = 段内比例
 */
export function keyframeAt(t: number, times: ArrayLike<number>) {
  return keyframeAtInto(t, times, { i: 0, f: 0 })
}

export function keyframeAtInto(t: number, times: ArrayLike<number>, out: Interval) {
  const k = times.length
  if (k === 0 || k === 1 || t <= times[0]) {
    out.i = 0
    out.f = 0
    return out
  }
  if (t >= times[k - 1]) {
    out.i = k - 2
    out.f = 1
    return out
  }
  let lo = 0
  let hi = k - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (times[mid] <= t) lo = mid
    else hi = mid
  }
  const span = times[lo + 1] - times[lo]
  const f = span > 0 ? (t - times[lo]) / span : 0
  out.i = lo
  out.f = Math.max(0, Math.min(1, f))
  return out
}

const _kfScratch = { i: 0, f: 0 }
const _segScratch = { i: 0, f: 0 }

/**
 * 在关键帧折线上求值（标量通道：位置分量 / 角度）。
 *
 * 访问器式接口（`get(k)` + `times`）：pos 的分量列是 stride-3 的插值视图，传数组会迫使每帧
 * 分配拷贝数组（多车 × 3 列 × 60fps 的 GC 抖动）；访问器恒零分配。
 *
 * @param {(k: number) => number} get 第 k 个关键帧值（角度通道已解卷绕；pos 已含镜像符号）
 * @param {number[]} times 关键帧时刻（升序）
 * @param {number} t 回放时刻（秒）
 */
export function sampleKeyframes(get: Sampler, times: ArrayLike<number>, t: number) {
  const k = times.length
  if (k === 0) return 0
  if (k === 1) return get(0)
  const { i, f } = keyframeAtInto(t, times, _kfScratch)
  const a = get(i)
  return a + (get(i + 1) - a) * f
}

export function sampleChannel(get: Sampler, n: number, t: number, t0: number, dt: number) {
  if (n === 0) return 0
  if (n === 1) return get(0)
  const { i, f } = segmentAtInto(t, t0, dt, n, _segScratch)
  const a = get(i)
  return a + (get(i + 1) - a) * f
}

export function coverageSpanAt(coverage: Coverage, t: number): Span | null {
  if (!Array.isArray(coverage) || !Number.isFinite(t)) return null
  for (let i = 0; i + 1 < coverage.length; i += 2) {
    const start = coverage[i]
    const end = coverage[i + 1]
    if (!Number.isFinite(start) || (!Number.isFinite(end) && end !== Number.POSITIVE_INFINITY)) continue
    if (t >= start - 1e-6 && t <= end + 1e-6) return [start, end]
  }
  return null
}

export function visibilitySpanForSampling(coverage: Coverage, t: number) {
  return visibilitySpanForSamplingInto(coverage, t, [0, 0])
}

export function visibilitySpanForSamplingInto(coverage: Coverage, t: number, out: Span) {
  if (!Array.isArray(coverage) || !Number.isFinite(t)) return null
  let hasFirst = false
  let firstStart = 0
  let firstEnd = 0
  let hasPrev = false
  let prevStart = 0
  let prevEnd = 0
  for (let i = 0; i + 1 < coverage.length; i += 2) {
    const start = coverage[i]
    const end = coverage[i + 1]
    if (!Number.isFinite(start) || (!Number.isFinite(end) && end !== Number.POSITIVE_INFINITY)) continue
    if (!hasFirst) {
      hasFirst = true
      firstStart = start
      firstEnd = end
    }
    if (t < start - 1e-6) {
      out[0] = hasPrev ? prevStart : start
      out[1] = hasPrev ? prevEnd : end
      return out
    }
    if (t <= end + 1e-6) {
      out[0] = start
      out[1] = end
      return out
    }
    hasPrev = true
    prevStart = start
    prevEnd = end
  }
  if (!hasPrev && !hasFirst) return null
  out[0] = hasPrev ? prevStart : firstStart
  out[1] = hasPrev ? prevEnd : firstEnd
  return out
}

export function spansContainAt(coverage: Coverage, t: number) {
  if (!Array.isArray(coverage) || !Number.isFinite(t)) return false
  for (let i = 0; i + 1 < coverage.length; i += 2) {
    const start = coverage[i]
    const end = coverage[i + 1]
    if (!Number.isFinite(start) || (!Number.isFinite(end) && end !== Number.POSITIVE_INFINITY)) continue
    if (t >= start - 1e-6 && t <= end + 1e-6) return true
  }
  return false
}

export function spanStartAt(coverage: Coverage, t: number) {
  if (!Array.isArray(coverage) || !Number.isFinite(t)) return null
  for (let i = 0; i + 1 < coverage.length; i += 2) {
    const start = coverage[i]
    const end = coverage[i + 1]
    if (!Number.isFinite(start) || (!Number.isFinite(end) && end !== Number.POSITIVE_INFINITY)) continue
    if (t >= start - 1e-6 && t <= end + 1e-6) return start
  }
  return null
}

export function sampleChannelWithin(
  get: Sampler, n: number, t: number, t0: number, dt: number, spanStart: number, spanEnd: number,
) {
  if (!(n >= 1) || !(dt > 0)) return 0
  const xMin = (spanStart - t0) / dt
  const xMax = (spanEnd - t0) / dt
  let lo = Math.max(0, Math.min(n - 1, Math.ceil(xMin - 1e-9)))
  let hi = Math.max(0, Math.min(n - 1, Math.floor(xMax + 1e-9)))
  if (lo > hi) {
    hi = Math.max(0, Math.min(n - 1, Math.floor(xMax + 1e-9)))
    lo = hi
  }
  if (hi === lo) return get(lo)
  const x = Math.max(lo, Math.min(hi, (t - t0) / dt))
  const i = Math.min(hi - 1, Math.floor(x))
  const f = Math.max(0, Math.min(1, x - i))
  const a = get(i)
  return a + (get(i + 1) - a) * f
}

export function sampleDetachedPose(
  track: {
    coverage: ArrayLike<number>
    pose_kf: Record<'t' | 'pos' | 'yaw' | 'pitch' | 'roll', ArrayLike<number>>
  },
  t: number,
  out: { x: number; y: number; z: number; yaw: number; pitch: number; roll: number },
) {
  const spans = track.coverage, kf = track.pose_kf
  let start: number | undefined, end: number | undefined
  for (let i = 0; i < spans.length; i += 2) {
    if (t >= spans[i] && t <= spans[i + 1]) { start = spans[i]; end = spans[i + 1]; break }
  }
  if (start === undefined) return false
  const times = kf.t
  let lo = 0, hi = times.length
  while (lo < hi) { const mid = (lo + hi) >> 1; if (times[mid] <= t) lo = mid + 1; else hi = mid }
  const a = lo - 1
  if (a < 0 || times[a] < start) return false
  const b = a + 1 < times.length && times[a + 1] <= end! ? a + 1 : a
  const f = b === a ? 0 : (t - times[a]) / (times[b] - times[a])
  const mix = (channel: ArrayLike<number>, stride: number, offset: number) => channel[a * stride + offset]
    + (channel[b * stride + offset] - channel[a * stride + offset]) * f
  out.x = -mix(kf.pos, 3, 0)
  out.y = mix(kf.pos, 3, 1)
  out.z = mix(kf.pos, 3, 2)
  out.yaw = -mix(kf.yaw, 1, 0)
  out.pitch = mix(kf.pitch, 1, 0)
  out.roll = -mix(kf.roll, 1, 0)
  return true
}
