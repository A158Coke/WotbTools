export interface SupremacySample {
  clock: number
  team: number
  points: number
}

export interface PointsAtResult {
  friend: number | null
  enemy: number | null
}

export function pointsAt(
  samples: readonly SupremacySample[] | null | undefined,
  t: number,
  friendlyTeam: number | null | undefined,
): PointsAtResult {
  const out: PointsAtResult = { friend: null, enemy: null }
  if (friendlyTeam !== 1 && friendlyTeam !== 2) return out
  if (!samples || !samples.length) return out
  const enemyTeam = friendlyTeam === 1 ? 2 : 1
  for (const sp of samples) {
    if (sp.clock > t) break
    if (sp.team === friendlyTeam) out.friend = sp.points
    else if (sp.team === enemyTeam) out.enemy = sp.points
  }
  return out
}

export function applySupremacyPointsToStore(
  store: { pointsFriend: number | null; pointsEnemy: number | null },
  data: { supremacy_points?: SupremacySample[] | null; meta: { friendly_team?: number | null } },
  t: number,
): void {
  const pts = pointsAt(data.supremacy_points, t, data.meta.friendly_team);
  if (store.pointsFriend !== pts.friend) store.pointsFriend = pts.friend;
  if (store.pointsEnemy !== pts.enemy) store.pointsEnemy = pts.enemy;
}
