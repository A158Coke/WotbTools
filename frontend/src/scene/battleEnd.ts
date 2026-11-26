const AFTER_BATTLE_PERIOD = 4

export interface BattleEndData {
  meta?: { t_start?: number; duration?: number } | null
  periods?: Array<{ clock: number; period: number } | null | undefined> | null
}

/**
 * @returns 时间轴终点（绝对秒，落在 (t_start, meta.duration] 内）
 */
export function battleEndTime(data: BattleEndData | null | undefined): number {
  const start = Number(data?.meta?.t_start) || 0
  const streamEnd = Number(data?.meta?.duration) || 0
  const periods = Array.isArray(data?.periods) ? data.periods : []
  const afterBattle = periods.find((p) => !!p && p.period != null && p.period >= AFTER_BATTLE_PERIOD && Number(p.clock) > start)
  if (!afterBattle) return streamEnd
  return Math.min(Number(afterBattle.clock), streamEnd)
}
