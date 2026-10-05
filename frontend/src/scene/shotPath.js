/**
 * 弹道折线求值（跳弹/穿透续段；契约 §4g 的 `via` / `leg_secs`）。
 *
 * 上游把同一发炮弹的弹道拆成段链：`from → via[0] → … → to`，其中 `to` 是 **method20 服务器
 * 终点**（弹道最终停止点；跳弹后会落在出射方向延长线上，比如天上），各段时长 `leg_secs`
 * 按几何/段速度给出（`len(leg_secs) == len(via) + 1`；**不用包时钟**——包钟 10Hz 量化，
 * 跳弹常与发射同刻，用钟会得到零长段）。直射弹 `via` 为空、单段。
 *
 * 纯函数、无 THREE 依赖（单测锁不变量）。
 */

/** 折线点表：`[[x,y,z], ...]`（长度 ≥ 2：至少 from→to） */
export function pathPointsOf(shot) {
  const pts = [shot.from]
  for (const v of shot.via || []) pts.push(v)
  pts.push(shot.to)
  return pts
}

/**
 * 各段时长（秒）：优先用 `leg_secs`（与点表等长 - 1）；缺省/形状不符时退化为单段
 * `fallbackSecs`（旧切面 = 直线弹）。
 */
export function legSecsOf(shot, fallbackSecs) {
  const pts = pathPointsOf(shot)
  const legs = shot.leg_secs
  if (Array.isArray(legs) && legs.length === pts.length - 1 && legs.every((x) => Number.isFinite(x) && x > 0)) {
    return legs
  }
  return [fallbackSecs]
}

/** 各段结束时刻（累计）：`[t0+leg0, t0+leg0+leg1, …]`（长度 = 段数） */
export function legEndTimes(legSecs, t0) {
  const out = []
  let acc = t0
  for (const l of legSecs) {
    acc += l
    out.push(acc)
  }
  return out
}

/** 折线总时长（秒） */
export function pathTotalSecs(legSecs) {
  return legSecs.reduce((a, b) => a + b, 0)
}

/**
 * 折线上沿时间推进的点：`t` 落在第 k 段时按该段线性插值（段内匀速，符合"段速度"语义）。
 * `t ≤ 首段起点` → 首点；`t ≥ 末段终点` → 末点。
 */
export function pointAt(points, legEnds, t, t0) {
  const n = legEnds.length
  if (n === 0) return points[0]
  if (t <= t0) return points[0]
  if (t >= legEnds[n - 1]) return points[points.length - 1]
  let k = 0
  while (k < n - 1 && t > legEnds[k]) k++
  const segStart = k === 0 ? t0 : legEnds[k - 1]
  const span = legEnds[k] - segStart
  const f = span > 0 ? (t - segStart) / span : 0
  const a = points[k]
  const b = points[k + 1]
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]
}

/** 各段长度（米）+ 累计弧长：`[l0, l0+l1, …]`（长度 = 段数） */
export function legArcEnds(points) {
  const out = []
  let acc = 0
  for (let k = 0; k + 1 < points.length; k++) {
    const a = points[k]
    const b = points[k + 1]
    acc += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
    out.push(acc)
  }
  return out
}

/**
 * 折线上**总弧长 s 处**的点（s 从 `from` 起算，超出末端 → 末点）。
 * 用于炮弹拖尾：头部按时间推进 → 换算成弧长 → 尾部落在其后 `TRACER_LEN` 米处
 * （跳弹拐角时尾巴跟着折线弯）。
 */
export function pointAtArc(points, arcEnds, s) {
  if (arcEnds.length === 0 || !(s > 0)) return points[0]
  if (s >= arcEnds[arcEnds.length - 1]) return points[points.length - 1]
  let k = 0
  while (k < arcEnds.length - 1 && s > arcEnds[k]) k++
  const segStart = k === 0 ? 0 : arcEnds[k - 1]
  const span = arcEnds[k] - segStart
  const f = span > 0 ? (s - segStart) / span : 0
  const a = points[k]
  const b = points[k + 1]
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]
}

/**
 * 头部**当前所在弧长**（时间 t 落在第 k 段 → 前 k 段全长 + 段内比例 × 本段长；段内匀速，
 * 故时间比例 = 弧长比例）。
 */
export function arcAtTime(points, legEnds, arcEnds, t, t0) {
  const n = legEnds.length
  if (n === 0) return 0
  if (t <= t0) return 0
  if (t >= legEnds[n - 1]) return arcEnds[arcEnds.length - 1]
  let k = 0
  while (k < n - 1 && t > legEnds[k]) k++
  const segStart = k === 0 ? t0 : legEnds[k - 1]
  const span = legEnds[k] - segStart
  const f = span > 0 ? (t - segStart) / span : 0
  const before = k === 0 ? 0 : arcEnds[k - 1]
  return before + (arcEnds[k] - before) * f
}
