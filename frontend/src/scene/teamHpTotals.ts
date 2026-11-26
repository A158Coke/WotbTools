
export interface TeamHpVehicle {
  team?: number | null
  hp?: number | null
  maxHp?: number | null
}

export interface TeamHpTotals {
  hpFriend: number
  hpFriendMax: number
  hpEnemy: number
  hpEnemyMax: number
  hpFriendPct: number
  hpEnemyPct: number
}

export type FriendlyTeam = 1 | 2

export function teamHpTotals(vehicles: readonly TeamHpVehicle[], friendlyTeam: number | null | undefined): TeamHpTotals {
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

export function perspectiveScore(score1: number, score2: number, friendlyTeam: number | null | undefined): { scoreFriend: number; scoreEnemy: number } {
  if (friendlyTeam === 1) return { scoreFriend: score1, scoreEnemy: score2 }
  if (friendlyTeam === 2) return { scoreFriend: score2, scoreEnemy: score1 }
  return { scoreFriend: 0, scoreEnemy: 0 }
}
