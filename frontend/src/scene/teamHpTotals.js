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
  }
}

/**
 * 顶栏比分的**阵营视角映射**：内核的击杀计数是物理的（score1 = team 1 击杀、score2 = team 2），
 * 而顶栏布局是「己方 HP | 己方比分 : 敌方比分 | 敌方 HP」——比分必须和两侧血条同一视角，
 * 否则 `friendly_team = 2` 时会出现「己方血条 + team1 比分」的错位（颜色也会反）。
 * `friendlyTeam` 未知时保持物理顺序（此时两侧血量都按 0 计，视角标注本身不成立）。
 */
export function perspectiveScore(score1, score2, friendlyTeam) {
  if (friendlyTeam === 2) return { scoreFriend: score2, scoreEnemy: score1 }
  return { scoreFriend: score1, scoreEnemy: score2 }
}
