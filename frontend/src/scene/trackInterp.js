/**
 * 采样轨迹求值（3D 回放的位姿/角度插值核心）。
 *
 * 背景：facet 的位姿是**客户端滤波器输出**（filter.rs 移植，`FilteredTimeline` 60Hz 逐帧
 * 求值 = 游戏每帧渲染的位姿）。滤波器在「预测-保持」阶段（刚进 AoI 的数秒内 latency 尚未
 * 收敛到位置更新间隔）逐帧输出是**保持-跳变阶梯**；后续阶段才是平滑滑行。
 *
 * 因此渲染**以 `pose_kf`（关键帧折线）为准**：上游把 60Hz 帧序列压成折点序列（保持段两端
 * + 跳变段，实测 ≈7.5 点/秒、对帧序列偏差 ≤1cm/0.2°），在下游**在关键帧之间线性插值**即可
 * 复现客户端画面。
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
 */
export function segmentAt(t, t0, dt, n) {
  if (!(n >= 2) || !(dt > 0)) return { i: 0, f: 0 }
  const x = (t - t0) / dt
  const i = Math.max(0, Math.min(n - 2, Math.floor(x)))
  return { i, f: Math.max(0, Math.min(1, x - i)) }
}

/**
 * 关键帧折线（不规则时刻）定位：二分找到 `t` 所在段的左端点。
 * 端点外按**保持**语义（返回首段/末段并 clamp 比例）——与上游 `PoseKeyframes` 契约一致。
 * @returns {{ i: number, f: number }} i = 左关键帧下标（clamp 到 [0, K-2]），f = 段内比例
 */
export function keyframeAt(t, times) {
  const k = times.length
  if (k === 0) return { i: 0, f: 0 }
  if (k === 1 || t <= times[0]) return { i: 0, f: 0 }
  if (t >= times[k - 1]) return { i: k - 2, f: 1 }
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
  return { i: lo, f: Math.max(0, Math.min(1, f)) }
}

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
  const { i, f } = keyframeAt(t, times)
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
  const { i, f } = segmentAt(t, t0, dt, n)
  const a = get(i)
  return a + (get(i + 1) - a) * f
}
