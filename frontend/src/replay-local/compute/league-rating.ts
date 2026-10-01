/**
 * 单场 League Rating（V4.1）：模式判定 / 完整性校验 / 副本冲突指纹 / 归一化 / 评分 / 战队命名。
 *
 * 逐一移植 Java `com.wotb.core.rating` 的 LeagueRatingMode、LeagueRatingValidator、
 * LeagueRatingConflictDetector、LeagueRatingNormalizer、LeagueRatingCalculator、
 * LeagueTeamNamer 与 `replay.facts.TradeFacts`。浮点运算保持 Java 的运算顺序（逐位一致）。
 */

import { compareNumbers, doubleCompare, hasText, javaDoubleKey, maxBy } from './java.js'
import type { Battle, PlayerResult } from './model.js'

// ---------- 模式（LeagueRatingMode） ----------

export type LeagueRatingMode = 'STANDARD_REPLAY' | 'LEAGUE_RATING' | 'MIXED_UNSUPPORTED'

const ARENA_BONUS_TYPE_TRAINING = 2
const ARENA_BONUS_TYPE_TOURNAMENT = 4

export function isLeagueBattle(battle: Battle | null): boolean {
  const t = battle?.arenaBonusType ?? null
  return t !== null && (t === ARENA_BONUS_TYPE_TRAINING || t === ARENA_BONUS_TYPE_TOURNAMENT)
}

/** 只看成功解析的回放：全 LEAGUE → LEAGUE_RATING；全普通 → STANDARD；混合 → MIXED_UNSUPPORTED。 */
export function classifyMode(battles: readonly Battle[]): LeagueRatingMode {
  let hasLeague = false
  let hasStandard = false
  for (const battle of battles) {
    if (isLeagueBattle(battle)) hasLeague = true
    else hasStandard = true
  }
  if (hasLeague && hasStandard) return 'MIXED_UNSUPPORTED'
  return hasLeague ? 'LEAGUE_RATING' : 'STANDARD_REPLAY'
}

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

// ---------- 结果 DTO（records） ----------

/** 维度满分（V4.1 冻结，合计 1000）。 */
export const MAX_DAMAGE = 365
export const MAX_ASSIST = 110
export const MAX_KILL = 110
export const MAX_EXCHANGE = 180
export const MAX_BLOCKED = 50
export const MAX_SURVIVAL_TRADE = 75
export const MAX_SHOOTING = 110
export const MAX_FINAL = 1000

export interface PlayerLeagueRating {
  accountId: number
  nickname: string
  clan: string
  team: number
  damageScore: number
  assistScore: number
  killScore: number
  exchangeScore: number
  blockedScore: number
  survivalTradeScore: number
  shootingScore: number
  preliminary: number
  baseRating: number
  finalRating: number
  survivalState: string
  damageDealt: number
  damageAssisted: number
  kills: number
  survived: boolean
  mvp: boolean
  teamBest: boolean
}

/** 七维分数唯一有序表示（顺序 = LeagueColumns.DIM_KEYS）。 */
export function dimensionScores(p: PlayerLeagueRating): number[] {
  return [p.damageScore, p.assistScore, p.killScore, p.exchangeScore,
    p.blockedScore, p.survivalTradeScore, p.shootingScore]
}

export interface TeamLeagueRating {
  team: number
  teamRating: number
  dimensionAverages: number[]
  autoName: string | null
  nameSource: string
  teamBest: PlayerLeagueRating | null
  players: PlayerLeagueRating[]
}

export interface LeagueRatingResult {
  arenaId: string
  players: PlayerLeagueRating[]
  team1: TeamLeagueRating
  team2: TeamLeagueRating
  mvp: PlayerLeagueRating | null
  rated: boolean
}

// ---------- TradeFacts / deathSec ----------

const TRADE_AFTER_DEATH_WINDOW_SEC = 5.0

/** 业务死亡时刻（秒）：settlement lifeTime 唯一 authority；存活/非法 → 0。 */
export function deathSec(p: PlayerResult): number {
  if (p.survived) return 0
  return Number.isFinite(p.settlementLifeTimeSec) && p.settlementLifeTimeSec > 0 ? p.settlementLifeTimeSec : 0
}

/** 玩家死亡后 [0, +5]s（含边界）内的敌方死亡数。 */
export function tradedDeaths(player: PlayerResult, players: readonly PlayerResult[]): number {
  if (player.survived || players.length === 0) return 0
  const playerDeathSec = deathSec(player)
  if (playerDeathSec <= 0) return 0
  let enemyDeaths = 0
  for (const other of players) {
    if (other.team === player.team || other.survived) continue
    const enemyDeathSec = deathSec(other)
    if (enemyDeathSec <= 0) continue
    const delta = enemyDeathSec - playerDeathSec
    if (delta >= 0 && delta <= TRADE_AFTER_DEATH_WINDOW_SEC) enemyDeaths++
  }
  return Math.max(0, enemyDeaths)
}

// ---------- 归一化（LeagueRatingNormalizer） ----------

const TEAM_SIZE = 7
const TOTAL_PLAYERS = 14
const WILSON_Z = 1.96

function finitePositive(v: number): boolean {
  return Number.isFinite(v) && v > 0
}

function teamIndex(x: number, teamAverage: number): number {
  if (!finitePositive(x) || !finitePositive(teamAverage)) return 0
  return Math.min(1.0, x / (2.0 * teamAverage))
}

function globalIndex(x: number, all: readonly number[]): number {
  if (!finitePositive(x)) return 0
  if (all.length === 0) return 0
  const sorted = all.filter(finitePositive).sort((a, b) => doubleCompare(b, a))
  if (sorted.length === 0) return 0
  let strictlyGreater = 0
  let tied = 0
  for (const v of sorted) {
    if (v > x) strictlyGreater++
    else if (v === x) tied++
    else break
  }
  if (tied === 0) return 0
  const averageRank = strictlyGreater + (tied + 1) / 2.0
  return Math.max(0, Math.min(1.0, (TOTAL_PLAYERS - averageRank) / (TOTAL_PLAYERS - 1.0)))
}

function wilsonLowerBound(successes: number, trials: number, z: number = WILSON_Z): number {
  if (!finitePositive(trials) || trials <= 0 || successes < 0 || !Number.isFinite(successes)) return 0
  const n = trials
  const p = Math.min(1.0, successes / n)
  const z2 = z * z
  const denom = 1.0 + z2 / n
  const center = (p + z2 / (2.0 * n)) / denom
  const margin = z * Math.sqrt((p * (1.0 - p) / n) + (z2 / (4.0 * n * n))) / denom
  return Math.max(0.0, center - margin)
}

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

// ---------- 副本冲突（LeagueRatingConflictDetector） ----------

/** settlement-only 指纹：等价于 Java StringBuilder 串的相等性（玩家按 accountId 升序，重复账号后者覆盖）。 */
function fingerprint(battle: Battle): string {
  const parts = [`w=${battle.winnerTeam}`, `t=${battle.arenaBonusType}`, `d=${javaDoubleKey(battle.durationS)}`]
  if (battle.players != null) {
    const byAccount = new Map<number, PlayerResult>()
    for (const p of battle.players) byAccount.set(p.accountId, p)
    const accounts = [...byAccount.keys()].sort(compareNumbers)
    for (const account of accounts) {
      const p = byAccount.get(account) as PlayerResult
      parts.push('p=' + [p.accountId, p.team, p.tankId, p.survived, javaDoubleKey(p.settlementLifeTimeSec),
        p.settlementDeathReasonRaw, p.damageDealt, p.damageAssisted, p.damageReceived, p.damageBlocked,
        p.kills, p.nShots, p.nHitsDealt, p.nPenetrationsDealt, p.victoryPointsEarned, p.victoryPointsSeized,
        p.nHitsReceived, p.nPenetrationsReceived, p.nEnemiesDamaged].map(String).join(':'))
    }
  }
  return parts.join(';')
}

/** 同 arenaId 的全部副本与第一份 canonical 指纹一致 → true（重复）；否则冲突。 */
export function copiesConsistent(copies: readonly Battle[]): boolean {
  if (copies.length === 0) return false
  const canonical = fingerprint(copies[0])
  for (let i = 1; i < copies.length; i++) {
    if (fingerprint(copies[i]) !== canonical) return false
  }
  return true
}

// ---------- 战队命名（LeagueTeamNamer） ----------

const MAJORITY_THRESHOLD = 4
export const NAME_SOURCE_CLAN_MAJORITY = 'CLAN_MAJORITY'
export const NAME_SOURCE_UNNAMED = 'UNNAMED'

function autoName(players: readonly PlayerLeagueRating[]): string | null {
  const counts = new Map<string, number>()
  for (const p of players) {
    if (hasText(p.clan)) counts.set(p.clan, (counts.get(p.clan) ?? 0) + 1)
  }
  let majority: string | null = null
  for (const [clan, count] of counts) {
    if (count >= MAJORITY_THRESHOLD) {
      if (majority !== null && majority !== clan) return null
      majority = clan
    }
  }
  return majority
}

// ---------- 评分（LeagueRatingCalculator） ----------

/** [teamWeight, globalWeight]：伤害/助攻/击杀/换血/阻挡。 */
const DIM_WEIGHTS: ReadonlyArray<readonly [number, number]> = [
  [0.60, 0.40],
  [0.70, 0.30],
  [0.40, 0.60],
  [0.30, 0.70],
  [0.70, 0.30],
]
const RC_TRADE = 50.0
const STATE_WIN_SURVIVED = 'WIN_SURVIVED'
const STATE_TRADE = 'TRADE'
const STATE_NONE = 'NONE'

function clamp(v: number, max: number): number {
  if (Number.isNaN(v) || !Number.isFinite(v) || v <= 0) return 0
  return Math.min(max, v)
}

function dim(max: number, weights: readonly [number, number], t: number, g: number): number {
  return clamp(max * (weights[0] * t + weights[1] * g), max)
}

function effectiveOutput(p: PlayerResult): number {
  return p.damageDealt + 0.60 * p.damageAssisted + 0.35 * p.damageBlocked
}

function rawRate(successes: number, trials: number): number {
  if (!Number.isFinite(successes) || !Number.isFinite(trials) || trials <= 0 || successes <= 0) return 0
  return Math.max(0.0, Math.min(1.0, successes / trials))
}

function teamAverages(players: readonly PlayerResult[], getter: (p: PlayerResult) => number): number[] {
  const sums = [0, 0, 0]
  const counts = [0, 0, 0]
  for (const p of players) {
    const t = p.team
    if (t === 1 || t === 2) {
      sums[t] += getter(p)
      counts[t]++
    }
  }
  return [0, counts[1] === 0 ? 0 : sums[1] / counts[1], counts[2] === 0 ? 0 : sums[2] / counts[2]]
}

/** MVP/队内最佳排序：finalRating → 胜方优先 → damage → assist → kills → accountId。 */
function mvpComparator(winnerTeam: number): (a: PlayerLeagueRating, b: PlayerLeagueRating) => number {
  return (a, b) => {
    let c = doubleCompare(a.finalRating, b.finalRating)
    if (c !== 0) return c
    c = compareNumbers(Number(a.team === winnerTeam), Number(b.team === winnerTeam))
    if (c !== 0) return c
    c = compareNumbers(a.damageDealt, b.damageDealt)
    if (c !== 0) return c
    c = compareNumbers(a.damageAssisted, b.damageAssisted)
    if (c !== 0) return c
    c = compareNumbers(a.kills, b.kills)
    if (c !== 0) return c
    return compareNumbers(a.accountId, b.accountId)
  }
}

function teamRating(team: number, players: readonly PlayerLeagueRating[], winnerTeam: number): TeamLeagueRating {
  const n = players.length
  if (n === 0) {
    return { team, teamRating: 0, dimensionAverages: [], autoName: null, nameSource: NAME_SOURCE_UNNAMED, teamBest: null, players: [] }
  }
  let sum = 0
  const dimSums = [0, 0, 0, 0, 0, 0, 0]
  for (const p of players) {
    sum += p.finalRating
    const scores = dimensionScores(p)
    for (let d = 0; d < scores.length; d++) dimSums[d] += scores[d]
  }
  const name = autoName(players)
  return {
    team,
    teamRating: sum / n,
    dimensionAverages: dimSums.map((d) => d / n),
    autoName: name,
    nameSource: name !== null ? NAME_SOURCE_CLAN_MAJORITY : NAME_SOURCE_UNNAMED,
    teamBest: maxBy(players, mvpComparator(winnerTeam)),
    players: [...players],
  }
}

/** 计算一场已通过校验的 7v7 battle 的完整 League Rating。 */
export function calculateLeagueRating(battle: Battle): LeagueRatingResult {
  const players = battle.players
  const n = players.length
  const winner = battle.winnerTeam as number

  const teamAvgDamage = teamAverages(players, (p) => p.damageDealt)
  const teamAvgAssist = teamAverages(players, (p) => p.damageAssisted)
  const teamAvgKills = teamAverages(players, (p) => p.kills)
  const teamAvgBlocked = teamAverages(players, (p) => p.damageBlocked)
  const teamAvgEffectiveOutput = teamAverages(players, effectiveOutput)

  const allDamage = players.map((p) => p.damageDealt)
  const allAssist = players.map((p) => p.damageAssisted)
  const allKills = players.map((p) => p.kills)
  const allBlocked = players.map((p) => p.damageBlocked)

  const damage: number[] = []
  const assist: number[] = []
  const kill: number[] = []
  const blocked: number[] = []
  const exchange: number[] = []
  const shooting: number[] = []
  const exchangeEff: number[] = []

  for (let i = 0; i < n; i++) {
    const p = players[i]
    const t = p.team
    damage[i] = dim(MAX_DAMAGE, DIM_WEIGHTS[0], teamIndex(p.damageDealt, teamAvgDamage[t]), globalIndex(p.damageDealt, allDamage))
    assist[i] = dim(MAX_ASSIST, DIM_WEIGHTS[1], teamIndex(p.damageAssisted, teamAvgAssist[t]), globalIndex(p.damageAssisted, allAssist))
    kill[i] = dim(MAX_KILL, DIM_WEIGHTS[2], teamIndex(p.kills, teamAvgKills[t]), globalIndex(p.kills, allKills))
    blocked[i] = dim(MAX_BLOCKED, DIM_WEIGHTS[4], teamIndex(p.damageBlocked, teamAvgBlocked[t]), globalIndex(p.damageBlocked, allBlocked))

    const o = effectiveOutput(p)
    const participation = finitePositive(teamAvgEffectiveOutput[t]) ? Math.min(1.0, o / teamAvgEffectiveOutput[t]) : 0
    const oe = o + p.damageReceived
    exchangeEff[i] = oe <= 0 ? 0 : (o / oe) * participation

    const softAcc = 0.90 * wilsonLowerBound(p.nHitsDealt, p.nShots) + 0.10 * rawRate(p.nHitsDealt, p.nShots)
    const softPen = 0.90 * wilsonLowerBound(p.nPenetrationsDealt, p.nHitsDealt) + 0.10 * rawRate(p.nPenetrationsDealt, p.nHitsDealt)
    const shootingConfidence = 0.30 * softAcc + 0.70 * softPen
    const damageParticipation = finitePositive(teamAvgDamage[t]) ? Math.min(1.0, p.damageDealt / teamAvgDamage[t]) : 0
    shooting[i] = MAX_SHOOTING * Math.min(1.0, shootingConfidence / 0.70) * damageParticipation
  }

  const teamAvgExchange = [0, 0, 0]
  {
    const sums = [0, 0, 0]
    const counts = [0, 0, 0]
    for (let i = 0; i < n; i++) {
      const t = players[i].team
      if (t === 1 || t === 2) {
        sums[t] += exchangeEff[i]
        counts[t]++
      }
    }
    for (const t of [1, 2]) teamAvgExchange[t] = counts[t] === 0 ? 0 : sums[t] / counts[t]
  }
  for (let i = 0; i < n; i++) {
    exchange[i] = dim(MAX_EXCHANGE, DIM_WEIGHTS[3],
      teamIndex(exchangeEff[i], teamAvgExchange[players[i].team]), globalIndex(exchangeEff[i], exchangeEff))
  }

  let built: PlayerLeagueRating[] = []
  for (let i = 0; i < n; i++) {
    const p = players[i]
    const preliminary = damage[i] + assist[i] + kill[i] + exchange[i] + blocked[i] + shooting[i]
    const win = p.team === winner
    let survival: number
    let state: string
    if (win && p.survived) {
      survival = MAX_SURVIVAL_TRADE
      state = STATE_WIN_SURVIVED
    } else if (!p.survived && tradedDeaths(p, players) > 0) {
      survival = RC_TRADE
      state = STATE_TRADE
    } else {
      survival = 0
      state = STATE_NONE
    }
    const base = preliminary + survival
    const finalRating = win ? Math.min(MAX_FINAL, base * 1.05) : base
    built.push({
      accountId: p.accountId, nickname: p.nickname, clan: p.clan, team: p.team,
      damageScore: damage[i], assistScore: assist[i], killScore: kill[i], exchangeScore: exchange[i],
      blockedScore: blocked[i], survivalTradeScore: survival, shootingScore: shooting[i],
      preliminary, baseRating: base, finalRating, survivalState: state,
      damageDealt: p.damageDealt, damageAssisted: p.damageAssisted, kills: p.kills, survived: p.survived,
      mvp: false, teamBest: false,
    })
  }

  const mvpOrder = mvpComparator(winner)
  const rawMvp = maxBy(built, mvpOrder)
  if (rawMvp !== null) {
    built = built.map((p) => (p.accountId === rawMvp.accountId ? { ...p, mvp: true } : p))
  }
  for (const t of [1, 2]) {
    const best = maxBy(built.filter((p) => p.team === t), mvpOrder)
    if (best !== null) {
      built = built.map((p) => (p.accountId === best.accountId ? { ...p, teamBest: true } : p))
    }
  }
  const mvp = rawMvp === null ? null : built.find((p) => p.accountId === rawMvp.accountId) ?? null

  return {
    arenaId: battle.arenaId,
    players: built,
    team1: teamRating(1, built.filter((p) => p.team === 1), winner),
    team2: teamRating(2, built.filter((p) => p.team === 2), winner),
    mvp,
    rated: true,
  }
}
