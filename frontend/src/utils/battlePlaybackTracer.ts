/** Battle Playback shot de-duplication and tracer presentation. */

import type { BattleEvent } from '../types/playback-v2.js'
import { trustedRoutePosition } from './battlePlaybackMotion.js'
import type { PoseAt, RouteLike } from './battlePlaybackMotion.js'

type TracerEvent = Pick<BattleEvent, 'type' | 'accountId' | 'targetAccountId' | 'timeSec'>

/** 炮线可见窗口基础时长（真实秒）：实际窗口 = TRACER_BASE_SEC × 播放倍速。
 * 原值 0.4s 实测太短，跟不上就看不见，整组时长按同比例加倍。 */
const TRACER_BASE_SEC = 0.8
/** 炮线全亮保持期（真实秒）：「先亮后淡」——保持后线性淡出到窗口结束。 */
const TRACER_HOLD_REAL_SEC = 0.3

/** 命中闪光生命周期（真实秒）：完成「扩散 + 峰值→淡出」，短于炮线本体。 */
const TRACER_FLASH_REAL_SEC = 0.7

/** 命中闪光到达峰值的时间（真实秒）：由 0 升至峰值（0.9），之后线性淡出到 0。 */
const TRACER_FLASH_PEAK_REAL_SEC = 0.2

/** 同一次射击的判同窗口（秒）：同 attacker/target 且时间差 ≤ 该值的 DAMAGE/KILL 只画一条炮线。 */
const SAME_SHOT_WINDOW_SEC = 0.25

/** tracerLines 的去重炮列表缓存（key = 事件数组身份；结果与事件数组同生命周期）。 */
const tracerShotsCache = new WeakMap<object, TracerEvent[]>()

/** tracerLines 的 (attacker,target) 分组去重（见 tracerLines 注释），按事件数组身份缓存。 */
function dedupTracerShots(events: Array<TracerEvent | null>) {
  const cached = tracerShotsCache.get(events)
  if (cached) return cached
  const byPair = new Map<string, TracerEvent[]>()
  for (const ev of events) {
    if (!ev || (ev.type !== 'DAMAGE' && ev.type !== 'KILL')) continue
    if (ev.accountId == null || ev.targetAccountId == null || ev.accountId === ev.targetAccountId) continue
    if (!Number.isFinite(ev.timeSec)) continue
    const key = `${ev.accountId}|${ev.targetAccountId}`
    const list = byPair.get(key)
    if (list) list.push(ev)
    else byPair.set(key, [ev])
  }
  const shots: TracerEvent[] = []
  for (const pair of byPair.values()) {
    pair.sort((a, b) => a.timeSec - b.timeSec)
    let kept: TracerEvent | null = null
    for (const ev of pair) {
      if (!kept) {
        kept = ev
        continue
      }
      if (ev.timeSec - kept.timeSec <= SAME_SHOT_WINDOW_SEC + 1e-9) {
        if (kept.type === 'KILL' && ev.type === 'DAMAGE') kept = ev
        continue
      }
      shots.push(kept)
      kept = ev
    }
    if (kept) shots.push(kept)
  }
  tracerShotsCache.set(events, shots)
  return shots
}

/**
 * 已知射击事件 → 当前可见炮线（纯函数：只依赖 now/speed，seek 与倍速天然正确，无一次性定时器）。
 * 候选 = DAMAGE 与 KILL（攻击者/目标均已解析）；同刻同 attacker/target 去重为一条（优先保留 DAMAGE）；
 * 两端都必须在事件时刻有可信位置（V2 使用 canonical positionSegments）且不是同一辆车/同一坐标才输出。
 * nowSec ∈ [timeSec, timeSec + TRACER_BASE_SEC × speed) 时可见。
 * 激光视觉派生：opacity 为「先亮后淡」（前 TRACER_HOLD_REAL_SEC × speed 秒全亮，
 * 之后线性淡出到窗口结束）；flashProgress 0→1 描述命中端闪光进度（窗口
 * TRACER_FLASH_REAL_SEC × speed 秒），flashOpacity 为峰值曲线（前
 * TRACER_FLASH_PEAK_REAL_SEC × speed 秒由 0 升至 0.9，之后线性淡出到 0；
 * flashProgress=1 时 opacity=0，组件不再渲染圆点，不残留孤立端点）。
 *
 * @param events         过滤后的 playback 事件（DAMAGE/KILL）
 * @param routesByAccount Map<accountId, VehiclePlaybackTrack | { points: [{x,y,timeSec}] }>
 * @param nowSec         当前播放时间（battle-relative 秒）
 * @param speed          播放倍速（1/2/4）
 * @param poseAt         可选：与 3D 同源的位姿通道 `(route, t) → { x, y } | null`
 *                       （只改端点取值；可信度门控仍是 canonical 观测区间）
 * @returns [{ x1, y1, x2, y2, opacity, flashProgress, flashOpacity, timeSec, attackerAccountId, targetAccountId }]
 */
export function tracerLines(
  events: Array<TracerEvent | null> | null | undefined,
  routesByAccount: Map<unknown, RouteLike> | null | undefined,
  nowSec: number,
  speed: number,
  poseAt: PoseAt | null = null,
) {
  if (!Array.isArray(events) || !routesByAccount || !Number.isFinite(nowSec)) return []
  const rate = Number.isFinite(speed) && speed > 0 ? speed : 1
  const windowSec = TRACER_BASE_SEC * rate
  // 按 (attacker,target) 分组，组内按实际时间差去重（时间差 ≤ SAME_SHOT_WINDOW_SEC 视为同一炮，
  // 优先保留 DAMAGE）——不用固定时间桶，避免桶边界把相差 2ms 的两次事件拆成两条线。
  // 去重结果只依赖事件数组本身（回放数据解析后不可变），按数组身份缓存，
  // 避免 60fps 下每帧对全体事件重建 Map + 逐组排序。
  const shots = dedupTracerShots(events)
  const lines = []
  for (const ev of shots) {
    const t = ev.timeSec
    if (nowSec < t - 1e-6 || nowSec >= t + windowSec - 1e-9) continue
    const from = routesByAccount.get(ev.accountId)
    const to = routesByAccount.get(ev.targetAccountId)
    const a = from ? trustedRoutePosition(from, t, poseAt) : null
    const b = to ? trustedRoutePosition(to, t, poseAt) : null
    // 目标位置是画命中闪光的最低要求；射手未被侦察时没有可信位置，只出闪光不连线
    // ——绝不用最后已知位置伪造射击点。
    if (!b) continue
    const hasLine = !!a && !(Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9)
    const elapsed = nowSec - t
    const holdSec = TRACER_HOLD_REAL_SEC * rate
    const fadeSpan = windowSec - holdSec
    // 先亮后淡：保持期内全亮，之后线性淡出到窗口结束；窗口 ≤ 保持期时回退线性淡出
    const opacity = fadeSpan > 1e-9
      ? Math.max(0, Math.min(1, 1 - (elapsed - holdSec) / fadeSpan))
      : Math.max(0, Math.min(1, 1 - elapsed / windowSec))
    const flashSec = TRACER_FLASH_REAL_SEC * rate
    const flashProgress = flashSec > 1e-9
      ? Math.max(0, Math.min(1, elapsed / flashSec))
      : 1
    // 命中闪光亮度峰值曲线：前 TRACER_FLASH_PEAK_REAL_SEC 真实秒由 0 升至 0.9，之后线性淡出到 0——
    // 短促冲击闪光（0ms 不可见 → ~100ms 峰值 → ~350ms 归零），不残留实体圆点
    const flashPeak = TRACER_FLASH_PEAK_REAL_SEC / TRACER_FLASH_REAL_SEC
    const flashOpacity = flashPeak > 1e-9 && flashPeak < 1 - 1e-9
      ? (flashProgress < flashPeak
          ? (flashProgress / flashPeak) * 0.9
          : ((1 - flashProgress) / (1 - flashPeak)) * 0.9)
      : (1 - flashProgress) * 0.9
    lines.push({
      hasLine,
      x1: hasLine ? a.x : null,
      y1: hasLine ? a.y : null,
      x2: b.x,
      y2: b.y,
      opacity,
      flashProgress,
      flashOpacity,
      timeSec: t,
      attackerAccountId: ev.accountId,
      targetAccountId: ev.targetAccountId
    })
  }
  return lines
}
