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

function validPolylineLegs(shot) {
  const via = Array.isArray(shot.via) ? shot.via : []
  const legs = shot.leg_secs
  return via.length > 0
    && Array.isArray(legs)
    && legs.length === via.length + 1
    && legs.every((x) => Number.isFinite(x) && x > 0)
}

/** 折线点表：`[[x,y,z], ...]`（长度 ≥ 2：至少 from→to） */
export function pathPointsOf(shot) {
  // via 与 leg_secs 是一组 additive 数据：只有两者形状同时有效才消费折线。
  // partial / malformed facet 必须整体退化到历史 from→to 直线；否则 points=N 段而
  // timings=1 段时，pointAt 会在 fallback 结束瞬间从 via[0] 跳到最终 to。
  const via = Array.isArray(shot.via) ? shot.via : []
  return validPolylineLegs(shot) ? [shot.from, ...via, shot.to] : [shot.from, shot.to]
}

/**
 * 各段时长（秒）：只有 `via` / `leg_secs` 这一组 additive 数据整体合法时才消费分段；
 * 缺省或形状/数值不符时整体退化为单段 `fallbackSecs`（旧切面 = from→to 直线）。
 */
export function legSecsOf(shot, fallbackSecs) {
  return validPolylineLegs(shot) ? shot.leg_secs : [fallbackSecs]
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

/**
 * 折线上沿时间推进的点：`t` 落在第 k 段时按该段线性插值（段内匀速，符合"段速度"语义）。
 * `t ≤ 首段起点` → 首点；`t ≥ 末段终点` → 末点。
 */
export function pointAt(points, legEnds, t, t0) {
  return pointAtInto(points, legEnds, t, t0, [])
}

/** pointAt 的零分配变体：结果写入 `out`（[x,y,z]）并返回它。每帧每弹的热路径用这个。 */
export function pointAtInto(points, legEnds, t, t0, out) {
  const n = legEnds.length
  if (n === 0) return copy3(points[0], out)
  if (t <= t0) return copy3(points[0], out)
  if (t >= legEnds[n - 1]) return copy3(points[points.length - 1], out)
  let k = 0
  while (k < n - 1 && t > legEnds[k]) k++
  const segStart = k === 0 ? t0 : legEnds[k - 1]
  const span = legEnds[k] - segStart
  const f = span > 0 ? (t - segStart) / span : 0
  const a = points[k]
  const b = points[k + 1]
  out[0] = a[0] + (b[0] - a[0]) * f
  out[1] = a[1] + (b[1] - a[1]) * f
  out[2] = a[2] + (b[2] - a[2]) * f
  return out
}

function copy3(p, out) {
  out[0] = p[0]; out[1] = p[1]; out[2] = p[2]
  return out
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
  return pointAtArcInto(points, arcEnds, s, [])
}

/** pointAtArc 的零分配变体：结果写入 `out`（[x,y,z]）并返回它。每帧每弹的热路径用这个。 */
export function pointAtArcInto(points, arcEnds, s, out) {
  if (arcEnds.length === 0 || !(s > 0)) return copy3(points[0], out)
  if (s >= arcEnds[arcEnds.length - 1]) return copy3(points[points.length - 1], out)
  let k = 0
  while (k < arcEnds.length - 1 && s > arcEnds[k]) k++
  const segStart = k === 0 ? 0 : arcEnds[k - 1]
  const span = arcEnds[k] - segStart
  const f = span > 0 ? (s - segStart) / span : 0
  const a = points[k]
  const b = points[k + 1]
  out[0] = a[0] + (b[0] - a[0]) * f
  out[1] = a[1] + (b[1] - a[1]) * f
  out[2] = a[2] + (b[2] - a[2]) * f
  return out
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
