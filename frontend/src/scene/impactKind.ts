export type ImpactKind = 'pen' | 'nonpen' | 'ricochet'

export interface ImpactKindShot {
  target_eid?: number | null
  hit_flags?: number
  is_author?: boolean
  game_hit_result?: number
}

export function impactKind(shot: ImpactKindShot): ImpactKind | null {
  if (shot.target_eid == null) return null
  const f = shot.hit_flags || 0
  if (shot.is_author && f) {
    if (f & 0x0008) return 'ricochet'
    if (f & (0x0010 | 0x0040 | 0x0100 | 0x1000)) return 'pen'
    return 'nonpen'
  }
  const r = shot.game_hit_result
  if (r === 3) return 'pen'
  if (r === 1 || r === 2) return 'nonpen'
  return null
}
