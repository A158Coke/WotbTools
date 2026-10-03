/**
 * 双方队伍总血量（3D 回放顶栏 HUD）——与上游 Agent 3D 视图同一口径：
 * 按各队全队 `max_hp` 汇总剩余血量，给「己方 / 敌方总血量条 + 数值」使用。
 *
 * 归属规则（与 pointsAt / 3D 贴地标记一致，unknown ≠ enemy）：
 * - `friendlyTeam` 未知（≠ 1/2）时谁都不归属，两队都按 0 计（不得把全队算进敌方）；
 * - 单车 `team` 不是 1/2（0 = 观察者 / 联表失败）不计入任一方。
 */
export function teamHpTotals(vehicles, friendlyTeam) {
  let hpFriend = 0, hpFriendMax = 0, hpEnemy = 0, hpEnemyMax = 0;
  const friendlyKnown = friendlyTeam === 1 || friendlyTeam === 2;
  if (friendlyKnown) {
    for (const v of vehicles) {
      const team = v.team;
      if (team !== 1 && team !== 2) continue;
      const hp = Math.max(0, Number(v.hp) || 0);
      const max = Math.max(0, Number(v.maxHp) || 0);
      if (team === friendlyTeam) { hpFriend += hp; hpFriendMax += max; } else { hpEnemy += hp; hpEnemyMax += max; }
    }
  }
  return {
    hpFriend, hpFriendMax, hpEnemy, hpEnemyMax,
    hpFriendPct: hpFriendMax > 0 ? 100 * hpFriend / hpFriendMax : 0,
    hpEnemyPct: hpEnemyMax > 0 ? 100 * hpEnemy / hpEnemyMax : 0,
  };
}
