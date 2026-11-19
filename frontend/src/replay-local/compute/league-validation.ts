import { hasText } from './java.js'
import type { Battle, PlayerResult } from './model.js'

const TEAM_SIZE = 7
export const TOTAL_PLAYERS = 14

// ---------- 失败码（LeagueFailure） ----------

export interface LeagueFailure {
  fileName: string
  arenaId: string
  code: string
}

export const LEAGUE_FAILURE_CODE = {
  ARENA_ID_MISSING: 'LEAGUE_ARENA_ID_MISSING',
  NOT_SEVEN_VS_SEVEN: 'LEAGUE_NOT_SEVEN_VS_SEVEN',
  INVALID_TEAM: 'LEAGUE_INVALID_TEAM',
  DUPLICATE_ACCOUNT_ID: 'LEAGUE_DUPLICATE_ACCOUNT_ID',
  MISSING_TANK: 'LEAGUE_MISSING_TANK',
  ROSTER_INCOMPLETE: 'LEAGUE_ROSTER_INCOMPLETE',
  NO_DECISIVE_WINNER: 'LEAGUE_NO_DECISIVE_WINNER',
  INVALID_STAT_FACTS: 'LEAGUE_INVALID_STAT_FACTS',
  CONFLICTING_REPLAYS_FOR_ARENA: 'CONFLICTING_REPLAYS_FOR_ARENA',
} as const

// ---------- 校验（LeagueRatingValidator） ----------

const DEATH_TIME_TOLERANCE_SEC = 1.0

/** 校验一场 battle；通过返回空列表（按严重度排序，调用方取第一条；fileName 待绑定）。 */
export function validateLeagueBattle(battle: Battle): LeagueFailure[] {
  const C = LEAGUE_FAILURE_CODE
  const failures: LeagueFailure[] = []
  const arenaId = battle.arenaId
  const arena = arenaId ?? ''
  const players = battle.players ?? []
  const fail = (code: string, a: string = arena): void => {
    failures.push({ fileName: '', arenaId: a, code })
  }

  if (!hasText(arenaId)) fail(C.ARENA_ID_MISSING, '')

  if (players.length !== TOTAL_PLAYERS) fail(C.NOT_SEVEN_VS_SEVEN)
  let team1 = 0
  let team2 = 0
  let invalidTeam = false
  for (const p of players) {
    if (p.team === 1) team1++
    else if (p.team === 2) team2++
    else invalidTeam = true
  }
  if (invalidTeam) fail(C.INVALID_TEAM)
  else if (players.length === TOTAL_PLAYERS && (team1 !== TEAM_SIZE || team2 !== TEAM_SIZE)) fail(C.NOT_SEVEN_VS_SEVEN)

  const accounts = new Set<number>()
  let duplicateOrZeroAccount = false
  for (const p of players) {
    if (p.accountId === 0 || accounts.has(p.accountId)) duplicateOrZeroAccount = true
    accounts.add(p.accountId)
  }
  if (duplicateOrZeroAccount) fail(C.DUPLICATE_ACCOUNT_ID)

  if (players.some((p) => p.tankId === 0)) fail(C.MISSING_TANK)

  // #201 roster 完整性不参与 League Rating（rosterComplete 仅供 AI/reconstruction 推断）。

  const winner = battle.winnerTeam
  if (winner === null || (winner !== 1 && winner !== 2)) fail(C.NO_DECISIVE_WINNER)

  if (hasInvalidSettlementDeathTime(battle, players) || hasInvalidStatFacts(players)) fail(C.INVALID_STAT_FACTS)
  return failures
}

function hasInvalidSettlementDeathTime(battle: Battle, players: readonly PlayerResult[]): boolean {
  const s = battle.settlementDurationSec
  const duration = s !== null && Number.isFinite(s) && s > 0 ? s : battle.durationS
  for (const p of players) {
    if (p.survived) continue
    if (!Number.isFinite(p.settlementLifeTimeSec) || p.settlementLifeTimeSec <= 0) return true
    if (duration !== null && Number.isFinite(duration) && duration > 0
      && p.settlementLifeTimeSec > duration + DEATH_TIME_TOLERANCE_SEC) return true
  }
  return false
}

function hasInvalidStatFacts(players: readonly PlayerResult[]): boolean {
  for (const p of players) {
    if (p.nShots < 0 || p.nHitsDealt < 0 || p.nPenetrationsDealt < 0
      || p.damageDealt < 0 || p.damageAssisted < 0 || p.damageReceived < 0
      || p.kills < 0 || p.damageBlocked < 0
      || p.victoryPointsEarned < 0 || p.victoryPointsSeized < 0
      || p.nHitsReceived < 0 || p.nPenetrationsReceived < 0 || p.nEnemiesDamaged < 0) return true
    if (!Number.isFinite(p.settlementLifeTimeSec) || p.settlementLifeTimeSec < 0) return true
    if (p.nShots > 0 && p.nHitsDealt > p.nShots) return true
    if (p.nHitsDealt > 0 && p.nPenetrationsDealt > p.nHitsDealt) return true
  }
  return false
}
