
export interface ShotTickSource {
  t_fire: number
  shooter_eid?: number
  is_author?: boolean
}

export interface KillTickSource {
  t: number
}

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

export const RIDE_DIGIT_MAX = 7

function effectiveTimelineEnd(startTime: unknown, duration: unknown): number {
  const start = Number(startTime)
  const end = Number(duration)
  return end > start ? end : start + 1
}

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

function shotHighlighted(shot: ShotTickSource, highlightEid: number | null): boolean {
  if (shot?.is_author === true) return true
  if (highlightEid == null) return false
  return Number(shot?.shooter_eid) === Number(highlightEid)
}

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

function sortedShotTimes(shots: ReadonlyArray<ShotTickSource> | null | undefined): number[] {
  const times: number[] = []
  for (const shot of Array.isArray(shots) ? shots : []) {
    const t = Number(shot?.t_fire)
    if (Number.isFinite(t)) times.push(t)
  }
  return times.sort((a, b) => a - b)
}

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
  return null
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
