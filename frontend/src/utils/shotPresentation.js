/** Shared presentation of recorded shot facts; this never recomputes a hit or damage. */
export function shotResultBadge(s, t) {
  const f = s.hit_flags || 0
  if (!f) {
    if (s.target_eid == null) return { text: t('agentShots.res_miss'), tone: 'neutral' }
    const r = s.game_hit_result
    if (r === 3) return { text: t('agentShots.res_pen'), tone: 'success' }
    if (r === 4) return { text: t('agentShots.res_track'), tone: 'info' }
    // eid 在案 = 命中已知；r 未知（255/0/缺）只能证明"结果未知"，不得伪装成未击穿
    if (r == null || r === 255 || r === 0) return { text: t('agentShots.res_hit_unknown'), tone: 'warning' }
    return { text: t('agentShots.res_nopen'), tone: 'danger' }
  }
  if (f & 0x1000) return { text: 'HE', tone: 'warning' }
  if (f & 0x0010) return { text: t('agentShots.res_pen'), tone: 'success' }
  if (f & 0x0008) return { text: t('agentShots.res_ric'), tone: 'warning' }
  return { text: t('agentShots.res_nopen'), tone: 'danger' }
}
