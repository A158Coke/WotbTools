// 3D 回放时间轴终点：比赛结束（进入战后阶段 period 4）的时刻，而不是录像流的结束。
// 录像在比赛结束后通常还会继续录一段结算画面，用 meta.duration 当终点时，
// 比赛打完进度条才走到一半、胜负横幅也要等结算画面放完才出现。
const AFTER_BATTLE_PERIOD = 4

/**
 * @param {{ meta: { t_start: number, duration: number }, periods?: Array<{ clock: number, period: number }> }} data
 * @returns {number} 时间轴终点（绝对秒，落在 (t_start, meta.duration] 内）
 */
export function battleEndTime(data) {
  const start = Number(data?.meta?.t_start) || 0
  const streamEnd = Number(data?.meta?.duration) || 0
  const periods = Array.isArray(data?.periods) ? data.periods : []
  const afterBattle = periods.find((p) => p && p.period >= AFTER_BATTLE_PERIOD && Number(p.clock) > start)
  if (!afterBattle) return streamEnd
  return Math.min(Number(afterBattle.clock), streamEnd)
}
