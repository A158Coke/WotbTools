/**
 * 回放交互增强的**纯函数**集合（借鉴 blitzinfo）：时间轴刻度 / 跳炮击 / 数字键骑乘。
 *
 * 刻度与查找的逻辑全部在这里，Vue 组件只做受控呈现——不引入第二份状态机；
 * 同一输入必须得到逐字段相同的结果（与 rosterState / playbackClock 同一纪律）。
 *
 * 数据源（AgentPlaybackFacet，经工作台 → playbackStore.playbackSession.scenePlayback）：
 *   shots[]  { t_fire, shooter_eid, is_author, … }   炮击事件（绝对秒，与 store.time 同一坐标系）
 *   kills[]  { t, killer_eid, victim_eid, … }        击毁事件
 *   vehicles[] / 名册行 { eid, team, … }             骑乘目标（物理队伍 team ∈ {1,2}）
 */

/** 炮击刻度只消费这三个字段（facet 的 AgentPlaybackShot 是超集）。 */
export interface ShotTickSource {
  t_fire: number
  shooter_eid?: number
  is_author?: boolean
}

/** 击毁刻度只消费时刻。 */
export interface KillTickSource {
  t: number
}

/** 骑乘目标名册行（物理队伍 team；可选显式 side 覆盖）。 */
export interface RosterVehicleLike {
  eid?: number | null
  team?: number | null
  side?: string | null
}

export interface ShotTick {
  t: number
  pct: number
  highlight: boolean
}

export interface KillTick {
  t: number
  pct: number
}

/**
 * 数字键骑乘的位次上限（blitzinfo 语义：1–7 / Shift+1–7；Blitz 单侧最多 7 辆）。
 * 越界（第 8 辆起）一律 null，不静默回绕。
 */
export const RIDE_DIGIT_MAX = 7

/**
 * 时间轴可用终点：与 PlaybackTimeline 的 min/max 语义逐字一致——
 * `duration > startTime ? duration : startTime + 1`（退化时间轴仍有 1 秒的最小量程）。
 */
function effectiveTimelineEnd(startTime: unknown, duration: unknown): number {
  const start = Number(startTime)
  const end = Number(duration)
  return end > start ? end : start + 1
}

/**
 * t（绝对秒）→ 时间轴百分比 0..100，两端越界夹取。
 * 与滑块共用同一组 [startTime, end] 端点，因此刻度位置与滑块位置天然对齐。
 * 非有限 t、非有限端点或量程退化时返回 null（该刻度不渲染，fail-closed）。
 */
export function timelineTickPercent(
  t: unknown,
  startTime: unknown,
  duration: unknown,
): number | null {
  const time = Number(t)
  if (!Number.isFinite(time)) return null
  const start = Number(startTime)
  const end = effectiveTimelineEnd(startTime, duration)
  const span = end - start
  if (!(Number.isFinite(start) && span > 0)) return null
  const pct = ((time - start) / span) * 100
  if (!Number.isFinite(pct)) return null
  return Math.max(0, Math.min(100, pct))
}

/** 炮击刻度是否高亮：作者本人（facet 直接给 is_author）或当前跟随者。 */
function shotHighlighted(shot: ShotTickSource, highlightEid: number | null): boolean {
  if (shot?.is_author === true) return true
  if (highlightEid == null) return false
  return Number(shot?.shooter_eid) === Number(highlightEid)
}

/**
 * 炮击刻度模型：shots[].t_fire → `{ t, pct, highlight }`（pct 0..100；越界/非法条目丢弃）。
 */
export function buildShotTicks(
  shots: ReadonlyArray<ShotTickSource> | null | undefined,
  startTime: unknown,
  duration: unknown,
  highlightEid: number | null = null,
): ShotTick[] {
  const out: ShotTick[] = []
  for (const shot of Array.isArray(shots) ? shots : []) {
    if (!shot) continue
    const pct = timelineTickPercent(shot.t_fire, startTime, duration)
    if (pct == null) continue
    out.push({ t: Number(shot.t_fire), pct, highlight: shotHighlighted(shot, highlightEid) })
  }
  return out
}

/**
 * 击毁刻度模型：kills[].t → `{ t, pct }`（异色点；越界/非法条目丢弃）。
 */
export function buildKillTicks(
  kills: ReadonlyArray<KillTickSource> | null | undefined,
  startTime: unknown,
  duration: unknown,
): KillTick[] {
  const out: KillTick[] = []
  for (const kill of Array.isArray(kills) ? kills : []) {
    if (!kill) continue
    const pct = timelineTickPercent(kill.t, startTime, duration)
    if (pct == null) continue
    out.push({ t: Number(kill.t), pct })
  }
  return out
}

/**
 * 刻度命中条的就近吸附：点击位置（百分比）附近 tolerancePct 内最近的刻度时刻。
 * 命中条是**单一元素**（不逐刻度布命中区）——密集炮击场刻度重叠也不挡滑块拖动。
 * 半径内无刻度时 null（调用方退回按比例 seek）。
 */
export function nearestTickTime(
  ticks: ReadonlyArray<{ t: number; pct: number }> | null | undefined,
  pct: unknown,
  tolerancePct: unknown,
): number | null {
  const pos = Number(pct)
  const tolerance = Number(tolerancePct)
  if (!Number.isFinite(pos) || !Number.isFinite(tolerance) || tolerance < 0) return null
  let best: number | null = null
  let bestDist = Infinity
  for (const tick of Array.isArray(ticks) ? ticks : []) {
    const tickPct = Number(tick?.pct)
    const t = Number(tick?.t)
    if (!Number.isFinite(tickPct) || !Number.isFinite(t)) continue
    const dist = Math.abs(tickPct - pos)
    if (dist <= tolerance && dist < bestDist) {
      bestDist = dist
      best = t
    }
  }
  return best
}

/**
 * 命中条无近邻刻度时的按比例时间（与滑块 min/max 同语义；原生轨道点击的等价换算）。
 * 非有限 pct / 量程退化时 null。
 */
export function tickPercentToTime(
  pct: unknown,
  startTime: unknown,
  duration: unknown,
): number | null {
  const pos = Number(pct)
  if (!Number.isFinite(pos)) return null
  const start = Number(startTime)
  const end = effectiveTimelineEnd(startTime, duration)
  const span = end - start
  if (!(Number.isFinite(start) && span > 0)) return null
  return start + (Math.max(0, Math.min(100, pos)) / 100) * span
}

/** 有序化炮击时刻表（防御性拷贝 + 丢弃非有限值；facet 的 shots 按约定升序，此处不信任输入顺序）。 */
function sortedShotTimes(shots: ReadonlyArray<ShotTickSource> | null | undefined): number[] {
  const times: number[] = []
  for (const shot of Array.isArray(shots) ? shots : []) {
    const t = Number(shot?.t_fire)
    if (Number.isFinite(t)) times.push(t)
  }
  return times.sort((a, b) => a - b)
}

/**
 * t 之前最近的一发炮击时刻（严格早于 t；当前时刻恰在某发上时返回更早的一发）。
 * 没有更早的炮击时 null —— 调用方保持不动。
 */
export function findPrevShotTime(
  shots: ReadonlyArray<ShotTickSource> | null | undefined,
  t: unknown,
): number | null {
  const times = sortedShotTimes(shots)
  const now = Number(t)
  if (!Number.isFinite(now)) return null
  for (let i = times.length - 1; i >= 0; i--) {
    if (times[i] < now) return times[i]
  }
  return null
}

/**
 * t 之后最近的一发炮击时刻（严格晚于 t；当前时刻恰在某发上时返回更晚的一发）。
 * 没有更晚的炮击时 null —— 调用方保持不动。
 */
export function findNextShotTime(
  shots: ReadonlyArray<ShotTickSource> | null | undefined,
  t: unknown,
): number | null {
  const times = sortedShotTimes(shots)
  const now = Number(t)
  if (!Number.isFinite(now)) return null
  for (const time of times) {
    if (time > now) return time
  }
  return null
}

/** 单车侧别判定：显式 `side` 字段（'ally'|'enemy'）优先；否则按 `team` 与 allyTeam 对照。
 *  allyTeam 未知（null）时无侧别 → fail-closed，不猜测「team 1 = 己方」。 */
function vehicleSide(
  vehicle: RosterVehicleLike,
  allyTeam: number | null,
): 'ally' | 'enemy' | null {
  const side = typeof vehicle?.side === 'string' ? vehicle.side.toLowerCase() : null
  if (side === 'ally') return 'ally'
  if (side === 'enemy') return 'enemy'
  if (allyTeam !== 1 && allyTeam !== 2) return null
  if (vehicle?.team === allyTeam) return 'ally'
  if (vehicle?.team === 1 || vehicle?.team === 2) return 'enemy'
  return null // 未知阵营（team 0 / null）：绝不并进任何一队
}

/**
 * 数字键骑乘目标：vehicles 按名册顺序分侧取第 digit 辆。
 *
 * @param vehicles 名册序（Replay3DPane 传 `[...roster.team1, ...roster.team2]`；顺序即名册呈现顺序）
 * @param digit 1 起的位次（键盘侧只发 1–7；函数内再卡 RIDE_DIGIT_MAX）
 * @param isShift true = 敌方（Shift+1–7），false = 己方（1–7）
 * @param allyTeam 己方物理队伍号（1|2；null = 权威阵营未知，骑乘整体禁用）
 * @returns 目标 eid；位次越界 / 无侧别 / 输入非法时 null（键盘层保持不动）
 */
export function rosterRideTarget(
  vehicles: ReadonlyArray<RosterVehicleLike> | null | undefined,
  digit: unknown,
  isShift: boolean,
  allyTeam: number | null = null,
): number | null {
  if (!Array.isArray(vehicles)) return null
  const n = Number(digit)
  if (!Number.isInteger(n) || n < 1 || n > RIDE_DIGIT_MAX) return null
  const ally: number[] = []
  const enemy: number[] = []
  for (const vehicle of vehicles) {
    // eid 缺失（null/undefined）不得折算成 0 号实体（Number(null) === 0）
    if (!vehicle || vehicle.eid == null) continue
    const eid = Number(vehicle.eid)
    if (!Number.isFinite(eid)) continue
    const side = vehicleSide(vehicle, allyTeam)
    if (side === 'ally') ally.push(eid)
    else if (side === 'enemy') enemy.push(eid)
  }
  const lane = isShift ? enemy : ally
  const target = lane[n - 1]
  return Number.isFinite(target) ? target : null
}
