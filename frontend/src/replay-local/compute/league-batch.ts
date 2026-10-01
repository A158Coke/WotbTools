/**
 * League Rating 批次汇总（V6 projection）：Java `LeagueRatingBatchAggregator` +
 * `LeagueBatchRatingCalculator` + `LeagueRatingBatch`。
 *
 * rating/维度累加沿用 Java 的 `BigDecimal` 精确十进制求和（{@link DecimalSum}），
 * 投影时再 `doubleValue()`——与 double 逐项累加结果不同，必须照搬才能逐位一致。
 */

import { DecimalSum, compareNumbers, compareStrings } from './java.js'
import {
  MAX_FINAL,
  NAME_SOURCE_UNNAMED,
  dimensionScores,
  type LeagueFailure,
  type LeagueRatingResult,
  type TeamLeagueRating,
} from './league-rating.js'
import type { Battle, PlayerResult, PlayerVehicleUsage } from './model.js'

const DIM_COUNT = 7
const V6_ANCHOR = 475.0
const PLAYER_PRIOR_WEIGHT = 5
const TEAM_PRIOR_WEIGHT = 1

export interface PlayerLeagueSummary {
  accountId: number
  nickname: string
  clan: string
  ratedBattles: number
  rating: number
  observedMean: number
  dimensionMeans: number[]
  mvpCount: number
  wins: number
  damageTotal: number
  assistTotal: number
  killsTotal: number
  vehicleUsage: PlayerVehicleUsage[]
}

export interface TeamLeagueSummary {
  teamKey: string
  autoName: string | null
  nameSource: string
  ratedBattles: number
  rating: number
  observedMean: number
  dimensionMeans: number[]
  wins: number
  arenaTeams: string[]
}

/** 一个训练赛/联赛批次的完整 League Rating（battleResults 只含 eligible 场次）。 */
export interface LeagueRatingBatch {
  battleResults: LeagueRatingResult[]
  playerSummaries: PlayerLeagueSummary[]
  teamSummaries: TeamLeagueSummary[]
  failures: LeagueFailure[]
}

/** 按 arenaId identity 查找该场评分（不依赖数组 index）。 */
export function resultFor(batch: LeagueRatingBatch, arenaId: string | null): LeagueRatingResult | null {
  if (arenaId === null) return null
  return batch.battleResults.find((r) => r.arenaId === arenaId) ?? null
}

// ---------- LeagueBatchRatingCalculator ----------

function validateAggregate(sum: number, ratedBattleCount: number): void {
  if (ratedBattleCount < 0) throw new RangeError(`ratedBattleCount must not be negative, got ${ratedBattleCount}`)
  if (!Number.isFinite(sum)) throw new RangeError(`aggregate sum must be finite, got ${sum}`)
  if (ratedBattleCount === 0) {
    if (sum !== 0.0) throw new RangeError(`empty aggregate must have sum 0, got ${sum}`)
    return
  }
  if (sum < 0.0 || sum > ratedBattleCount * MAX_FINAL) {
    throw new RangeError(`aggregate sum must be within [0, count * 1000], got ${sum}`)
  }
}

function observedMean(sum: number, count: number): number {
  validateAggregate(sum, count)
  // Java 返回 null 后被 DTO 拆箱：count 恒 >= 1（只为评分场次建 acc）。
  return sum / count
}

function project(sum: number, count: number, priorWeight: number): number {
  validateAggregate(sum, count)
  const projected = (sum + priorWeight * V6_ANCHOR) / (count + priorWeight)
  if (!Number.isFinite(projected) || projected < 0.0 || projected > MAX_FINAL) {
    throw new RangeError(`V6 Rating projection is outside [0, 1000]: ${projected}`)
  }
  return projected
}

function requireObservation(rating: number): void {
  if (!Number.isFinite(rating) || rating < 0.0 || rating > MAX_FINAL) {
    throw new RangeError(`V4.1 Final Rating must be finite and within [0, 1000], got ${rating}`)
  }
}

// ---------- LeagueRatingBatchAggregator ----------

interface PlayerAcc {
  nickname: string
  clan: string
  ratedBattles: number
  ratingSum: DecimalSum
  dimensionSums: DecimalSum[]
  mvpCount: number
  wins: number
  damageTotal: number
  assistTotal: number
  killsTotal: number
  vehicleCounts: Map<number, number>
}

interface TeamAcc {
  autoName: string | null
  nameSource: string
  ratedBattles: number
  ratingSum: DecimalSum
  dimensionSums: DecimalSum[]
  wins: number
  arenaTeams: string[]
}

function zeroSums(): DecimalSum[] {
  return Array.from({ length: DIM_COUNT }, () => new DecimalSum())
}

/** 批次 team key：多数军团标签优先，否则 `arenaId:team`。 */
export function teamKey(battle: Battle, team: TeamLeagueRating): string {
  if (team.autoName !== null && team.autoName !== '') return `clan:${team.autoName}`
  return `${battle.arenaId}:${team.team}`
}

function dimensionMeans(sums: readonly DecimalSum[], ratedBattles: number): number[] {
  return sums.map((s) => (ratedBattles === 0 ? 0.0 : s.doubleValue() / ratedBattles))
}

/** 汇总一批已评分的 league 场次（battles 与 results 按下标对齐）。 */
export function aggregateLeagueBatch(battles: readonly Battle[], results: readonly LeagueRatingResult[],
  failures: readonly LeagueFailure[]): LeagueRatingBatch {
  const players = new Map<number, PlayerAcc>()
  const teams = new Map<string, TeamAcc>()
  for (let i = 0; i < Math.min(battles.length, results.length); i++) {
    const battle = battles[i]
    const result = results[i]
    if (!result.rated) continue
    const winner = battle.winnerTeam
    const playerByAccount = new Map<number, PlayerResult>()
    for (const pr of battle.players ?? []) playerByAccount.set(pr.accountId, pr)

    for (const p of result.players) {
      let acc = players.get(p.accountId)
      if (acc === undefined) {
        acc = {
          nickname: '', clan: '', ratedBattles: 0, ratingSum: new DecimalSum(), dimensionSums: zeroSums(),
          mvpCount: 0, wins: 0, damageTotal: 0, assistTotal: 0, killsTotal: 0, vehicleCounts: new Map(),
        }
        players.set(p.accountId, acc)
      }
      acc.nickname = p.nickname
      acc.clan = p.clan
      acc.ratedBattles++
      requireObservation(p.finalRating)
      acc.ratingSum.add(p.finalRating)
      const scores = dimensionScores(p)
      for (let d = 0; d < scores.length; d++) acc.dimensionSums[d].add(scores[d])
      if (p.mvp) acc.mvpCount++
      if (winner !== null && p.team === winner) acc.wins++
      acc.damageTotal += p.damageDealt
      acc.assistTotal += p.damageAssisted
      acc.killsTotal += p.kills
      const pr = playerByAccount.get(p.accountId)
      if (pr !== undefined) acc.vehicleCounts.set(pr.tankId, (acc.vehicleCounts.get(pr.tankId) ?? 0) + 1)
    }

    for (const team of [result.team1, result.team2]) {
      if (team.players.length === 0) continue
      const key = teamKey(battle, team)
      let acc = teams.get(key)
      if (acc === undefined) {
        acc = {
          autoName: null, nameSource: NAME_SOURCE_UNNAMED, ratedBattles: 0, ratingSum: new DecimalSum(),
          dimensionSums: zeroSums(), wins: 0, arenaTeams: [],
        }
        teams.set(key, acc)
      }
      acc.autoName = team.autoName
      acc.nameSource = team.nameSource
      acc.ratedBattles++
      requireObservation(team.teamRating)
      acc.ratingSum.add(team.teamRating)
      if (team.dimensionAverages.length !== DIM_COUNT) {
        throw new RangeError(`Team dimension average count must be ${DIM_COUNT}, got ${team.dimensionAverages.length}`)
      }
      for (let d = 0; d < team.dimensionAverages.length; d++) acc.dimensionSums[d].add(team.dimensionAverages[d])
      if (winner !== null && team.team === winner) acc.wins++
      acc.arenaTeams.push(`${battle.arenaId}:${team.team}`)
    }
  }

  const playerSummaries: PlayerLeagueSummary[] = []
  for (const [accountId, acc] of players) {
    const sum = acc.ratingSum.doubleValue()
    playerSummaries.push({
      accountId, nickname: acc.nickname, clan: acc.clan, ratedBattles: acc.ratedBattles,
      rating: project(sum, acc.ratedBattles, PLAYER_PRIOR_WEIGHT),
      observedMean: observedMean(sum, acc.ratedBattles),
      dimensionMeans: dimensionMeans(acc.dimensionSums, acc.ratedBattles),
      mvpCount: acc.mvpCount, wins: acc.wins,
      damageTotal: acc.damageTotal, assistTotal: acc.assistTotal, killsTotal: acc.killsTotal,
      vehicleUsage: [...acc.vehicleCounts]
        .map(([tankId, battles]) => ({ tankId, battles }))
        .sort((a, b) => compareNumbers(a.tankId, b.tankId)),
    })
  }
  const teamSummaries: TeamLeagueSummary[] = []
  for (const [key, acc] of teams) {
    const sum = acc.ratingSum.doubleValue()
    teamSummaries.push({
      teamKey: key, autoName: acc.autoName, nameSource: acc.nameSource, ratedBattles: acc.ratedBattles,
      rating: project(sum, acc.ratedBattles, TEAM_PRIOR_WEIGHT),
      observedMean: observedMean(sum, acc.ratedBattles),
      dimensionMeans: dimensionMeans(acc.dimensionSums, acc.ratedBattles),
      wins: acc.wins, arenaTeams: [...acc.arenaTeams],
    })
  }
  playerSummaries.sort((a, b) => compareNumbers(a.accountId, b.accountId))
  teamSummaries.sort((a, b) => compareStrings(a.teamKey, b.teamKey))
  return { battleResults: [...results], playerSummaries, teamSummaries, failures: [...failures] }
}
