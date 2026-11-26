
export const SHOT_RESULT = Object.freeze({
  MISS: 'MISS',
  UNVERIFIED: 'UNVERIFIED',
  PENETRATION: 'PENETRATION',
  RICOCHET: 'RICOCHET',
  NO_PENETRATION: 'NO PENETRATION',
  HE_BLAST: 'HE BLAST',
  HIT: 'HIT',
})

/** @param {{target_eid?: number|null, target_name?: string|null, hit_flags?: number|null,
 *           damage?: number|null, game_hit_result?: number|null}} shot */
export function shotResultClass(shot) {
  if (!shot) return SHOT_RESULT.HIT
  const hasTarget = shot.target_eid != null || !!(shot.target_name || '').trim()
  if (!hasTarget) return SHOT_RESULT.MISS

  const f = shot.hit_flags || 0
  const r = shot.game_hit_result

  if (f) {
    if (f & 0x1000) return SHOT_RESULT.HE_BLAST
    if (f & 0x0010) return SHOT_RESULT.PENETRATION
    if (f & 0x0008) return SHOT_RESULT.RICOCHET
    return SHOT_RESULT.NO_PENETRATION
  }

  if (r === 4) return SHOT_RESULT.UNVERIFIED
  if (r === 3) return SHOT_RESULT.PENETRATION
  if (r === 1 || r === 2) return SHOT_RESULT.NO_PENETRATION
  return SHOT_RESULT.HIT
}
