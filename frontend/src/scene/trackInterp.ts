/**
 * 采样轨迹求值（3D 回放的位姿/角度插值核心）。
 *
 * 背景：客户端滤波器在刚进 AoI 的数秒内 latency 尚未收敛到位置更新间隔，60Hz 逐帧输出是
 * **保持-跳变阶梯**；后续阶段才是平滑滑行。游戏内这段阶梯被模型加载/入场遮挡，我们的查看器
 * 模型常驻，直接复现就是用户可见的"刚进视野一顿一顿"。
 *
 * 因此上游 `pose_kf`（关键帧折线）是**显示重建**：每个在场段按 10Hz 标称间隔铺满历史、
 * 从稳态 0.2s 延迟起步，段首只保留 0.2s 静止，其后输出时刻落在两个真实采样之间。折线点数
 * ≈7.5 点/秒、对重建帧偏差 ≤1cm/0.2°；下游在关键帧之间线性插值即可复现平滑画面。
 * 判定锚点（命中/炮口）仍用客户端原始 0.02s 复位语义，与这里的渲染折线分属两层。
 *
 * 为什么不能沿用「10Hz 网格 + 线性插值」：0.1s 网格与 ≈10~12Hz 的位置更新不同相 → 阶梯被
 * 混叠成速度大幅摆动的滑行（实测某 0.5s 窗内线速度 4.5→29.6 m/s，同段真值稳定；全时线
 * 最大偏差 21m），观感就是「一顿一顿 / 不连续」。曲线插值（Catmull-Rom）也不解决：它把
 * 10Hz 采样噪声插成抖动（实测全路径抖动 p90 27.5 → 53 m/s²，反而更差）。
 *
 * 旧 facet 无 `pose_kf` 时回退到网格线性插值（`sampleChannel`）——与历史行为逐值一致。
 *
 * 纯函数、无 THREE 依赖（单测锁不变量）。
 */

/** 网格步长（秒）——与上游 `playback::GRID_DT` 同值；回退路径与旧行为一致 */
export const GRID_DT = 0.1

/**
 * 均匀网格：索引与段内比例。`i` = 左采样下标（clamp 到 [0, n-2]），`f` ∈ [0,1]。
 * 网格外（t 早于首采样/晚于末采样）钳位到端点——与位姿冻结语义一致。
 *
 * 热路径用 `segmentAtInto`（写入调用方复用的对象）；本公开包装按次分配，
 * 语义逐位一致（单测锁定本函数）。
 */
export function segmentAt(t, t0, dt, n) {
  return segmentAtInto(t, t0, dt, n, { i: 0, f: 0 })
}

/** [`segmentAt`] 的零分配形态：结果写入 `out` 并返回它。 */
export function segmentAtInto(t, t0, dt, n, out) {
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
export function keyframeAt(t, times) {
  return keyframeAtInto(t, times, { i: 0, f: 0 })
}

/** [`keyframeAt`] 的零分配形态：结果写入 `out` 并返回它。 */
export function keyframeAtInto(t, times, out) {
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
  // 首个 > t 的下标减一 = 左端点（times 升序由上游保证）
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

// 采样热路径（每车每帧 × 多通道）共用的段定位草稿：sampleKeyframes/sampleChannel
// 解构后立即使用，不跨调用持有，可安全复用（关键帧/网格插值层零分配）。
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
export function sampleKeyframes(get, times, t) {
  const k = times.length
  if (k === 0) return 0
  if (k === 1) return get(0)
  const { i, f } = keyframeAtInto(t, times, _kfScratch)
  const a = get(i)
  return a + (get(i + 1) - a) * f
}

/**
 * 均匀网格上的线性插值（**回退路径**：旧 facet / 无关键帧的通道）。
 * 网格是滤波器输出的 10Hz 采样；缺失 `pose_kf` 时与历史行为逐值一致。
 */
export function sampleChannel(get, n, t, t0, dt) {
  if (n === 0) return 0
  if (n === 1) return get(0)
  const { i, f } = segmentAtInto(t, t0, dt, n, _segScratch)
  const a = get(i)
  return a + (get(i + 1) - a) * f
}

/**
 * 位姿覆盖段（coverage 闭区间对）定位：返回包含 `t` 的段 `[start, end]`，无覆盖返回 null。
 * 浮点容差与 `poseCoveredAt` 一致（1e-6s）。
 */
export function coverageSpanAt(coverage, t) {
  if (!Array.isArray(coverage) || !Number.isFinite(t)) return null
  for (let i = 0; i + 1 < coverage.length; i += 2) {
    const start = coverage[i]
    const end = coverage[i + 1]
    // 末次可见段允许 +Infinity 终点（buildPoseFacet 对缺省 t_out 的投影）。
    if (!Number.isFinite(start) || (!Number.isFinite(end) && end !== Number.POSITIVE_INFINITY)) continue
    if (t >= start - 1e-6 && t <= end + 1e-6) return [start, end]
  }
  return null
}

/**
 * 位姿可见段定位（采样用）：优先返回包含 `t` 的段；`t` 落在两段之间时返回**前一段**
 * （最后已知），早于首段返回首段，晚于末段返回末段。与 `coverageSpanAt` 的 null 语义
 * 分开——采样器需要"夹到最近端点保持"，而不是退回无约束插值。
 *
 * 采样热路径（每车每帧）用 [`visibilitySpanForSamplingInto`]；本公开包装按次分配，
 * 语义逐位一致（单测锁定本函数）。
 */
export function visibilitySpanForSampling(coverage, t) {
  return visibilitySpanForSamplingInto(coverage, t, [0, 0])
}

/** [`visibilitySpanForSampling`] 的零分配形态：命中的 `[start, end]` 写入 `out` 并返回它。 */
export function visibilitySpanForSamplingInto(coverage, t, out) {
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
      // t 落在段间空隙：取前一段（最后已知），无前段（早于首段）取本段
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
  // 晚于末段：取末段（= prev）；无任何有效段：null
  if (!hasPrev && !hasFirst) return null
  out[0] = hasPrev ? prevStart : firstStart
  out[1] = hasPrev ? prevEnd : firstEnd
  return out
}

/** 段集合是否包含 t（闭区间 + 1e-6 容差；空/畸形 → false）。 */
export function spansContainAt(coverage, t) {
  if (!Array.isArray(coverage) || !Number.isFinite(t)) return false
  for (let i = 0; i + 1 < coverage.length; i += 2) {
    const start = coverage[i]
    const end = coverage[i + 1]
    if (!Number.isFinite(start) || (!Number.isFinite(end) && end !== Number.POSITIVE_INFINITY)) continue
    if (t >= start - 1e-6 && t <= end + 1e-6) return true
  }
  return false
}

/** 段集合中**包含 t** 的那一段的起点（闭区间 + 1e-6；无包含段 → null）。 */
export function spanStartAt(coverage, t) {
  if (!Array.isArray(coverage) || !Number.isFinite(t)) return null
  for (let i = 0; i + 1 < coverage.length; i += 2) {
    const start = coverage[i]
    const end = coverage[i + 1]
    if (!Number.isFinite(start) || (!Number.isFinite(end) && end !== Number.POSITIVE_INFINITY)) continue
    if (t >= start - 1e-6 && t <= end + 1e-6) return start
  }
  return null
}

/**
 * 覆盖段内的均匀网格采样（炮塔/炮管/侧倾等仅网格列）。
 *
 * 与 `sampleChannel` 的差别：只在 `[spanStart, spanEnd]` **内**的网格采样之间插值，
 * 不允许跨隐藏段取端点——车辆刚进视野时，旧实现会让炮塔角从前一段（可能数秒前）的
 * 值缓慢滑到新值，表现为炮塔先指错方向再回正。段内第一个网格点之前保持该点值（与
 * 网格端点保持语义一致）；段短于一个网格间隔时取段内第一个点（不猜运动）。
 */
export function sampleChannelWithin(get, n, t, t0, dt, spanStart, spanEnd) {
  if (!(n >= 1) || !(dt > 0)) return 0
  const xMin = (spanStart - t0) / dt
  const xMax = (spanEnd - t0) / dt
  let lo = Math.max(0, Math.min(n - 1, Math.ceil(xMin - 1e-9)))
  let hi = Math.max(0, Math.min(n - 1, Math.floor(xMax + 1e-9)))
  if (lo > hi) {
    // 段内没有网格点：取段末**之前**的最近证据（最后已知），不得取段后第一个点——
    // 下一可见段若在下一个 tick 前开始，会把后一段的炮塔角泄漏进这次短可见段。
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

/** Independent rigid-body sampling: never anticipate a pose or bridge an AoI gap.
 * Tracks are validated at the facet boundary. Out is reused by the scene hot path.
 */
export function sampleDetachedPose(track, t, out) {
  const spans = track.coverage, kf = track.pose_kf
  let start, end
  for (let i = 0; i < spans.length; i += 2) {
    if (t >= spans[i] && t <= spans[i + 1]) { start = spans[i]; end = spans[i + 1]; break }
  }
  if (start === undefined) return false
  const times = kf.t
  // Binary search for the last known sample; a future-only span stays invisible.
  let lo = 0, hi = times.length
  while (lo < hi) { const mid = (lo + hi) >> 1; if (times[mid] <= t) lo = mid + 1; else hi = mid }
  const a = lo - 1
  if (a < 0 || times[a] < start) return false
  const b = a + 1 < times.length && times[a + 1] <= end ? a + 1 : a
  const f = b === a ? 0 : (t - times[a]) / (times[b] - times[a])
  const mix = (channel, stride, offset) => channel[a * stride + offset]
    + (channel[b * stride + offset] - channel[a * stride + offset]) * f
  out.x = -mix(kf.pos, 3, 0)
  out.y = mix(kf.pos, 3, 1)
  out.z = mix(kf.pos, 3, 2)
  out.yaw = -mix(kf.yaw, 1, 0)
  out.pitch = mix(kf.pitch, 1, 0)
  out.roll = -mix(kf.roll, 1, 0)
  return true
}
