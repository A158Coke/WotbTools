/** 争霸实时点数采样（按 clock 升序；`pointsSamples` 投影条目）。 */
export interface SupremacySample {
  clock: number
  team: number
  points: number
}

export interface PointsAtResult {
  friend: number | null
  enemy: number | null
}

/**
 * 争霸实时点数：取 `clock <= t` 的最后一组采样，按阵营拆成 friend / enemy。
 *
 * **确定性**：无论有无采样都返回一组结果（缺省 `null / null`）——调用方每 tick 无条件
 * 写入，避免从争霸场切到普通场时把上一场的点数残留到 HUD 上（旧实现只在有采样时才写）。
 *
 * **unknown ≠ enemy**：只有 `friendlyTeam` 显式为 1 或 2 才建立 friend/enemy 映射；
 * 否则一律 `null`，绝不把某一方猜成敌方。采样里既非 friend 也非 enemy 的队伍
 * （如 `team=0` 未知）不参与统计。
 */
export function pointsAt(
  samples: readonly SupremacySample[] | null | undefined,
  t: number,
  friendlyTeam: number | null | undefined,
): PointsAtResult {
  const out: PointsAtResult = { friend: null, enemy: null }
  if (friendlyTeam !== 1 && friendlyTeam !== 2) return out
  if (!samples || !samples.length) return out
  const enemyTeam = friendlyTeam === 1 ? 2 : 1
  // 采样按 clock 升序（契约保证）：越过 t 即可停——此前用 continue 会把整表扫完（每 tick 一次）
  for (const sp of samples) {
    if (sp.clock > t) break
    if (sp.team === friendlyTeam) out.friend = sp.points
    else if (sp.team === enemyTeam) out.enemy = sp.points
  }
  return out
}

/**
 * 每 tick 无条件重算 + 变更守卫写入 store（playbackScene.tick 的接替落点，#827）：
 * 无论 `DATA.supremacy_points` 有无都写入——从争霸场切到普通场（无采样）时靠这里
 * 把 null 推上屏清残值。同值守卫避免 60Hz 的无效 reactive 写入（语义与 updateScore 同款）。
 */
export function applySupremacyPointsToStore(
  store: { pointsFriend: number | null; pointsEnemy: number | null },
  data: { supremacy_points?: SupremacySample[] | null; meta: { friendly_team?: number | null } },
  t: number,
): void {
  const pts = pointsAt(data.supremacy_points, t, data.meta.friendly_team);
  if (store.pointsFriend !== pts.friend) store.pointsFriend = pts.friend;
  if (store.pointsEnemy !== pts.enemy) store.pointsEnemy = pts.enemy;
}
