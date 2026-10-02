/**
 * 战斗表现派生指标与跨场汇总：Java `BattleHpFacts` + `PerformanceMetricsCalculator` +
 * `Aggregator` / `Agg`。只读消费 Battle facts（populateBattle 例外：按 Java 契约回填
 * contribution/kast/impact）。
 */

import { compareNumbers, compareStrings, hasText } from './java.js'
import { deathSec, tradedDeaths } from './league-rating.js'
import type { Battle, PlayerResult, PlayerVehicleUsage } from './model.js'
import { tankMaxHpValue, type Tankopedia } from './tankopedia.js'

// ---------- BattleHpFacts ----------

const STANDARD_BATTLE_PLAYER_COUNT = 14
const EXPECTED_BATTLE_SHARE = 1.0 / STANDARD_BATTLE_PLAYER_COUNT

interface BattleAverageHp {
  value: number
  complete: boolean
}

const UNKNOWN_HP: BattleAverageHp = { value: 0, complete: false }

/** OBSERVED_EXACT → entryHp；否则 tankopedia base（Java `ObservedMaxHp.fullMaxHp`）。 */
function fullMaxHp(p: PlayerResult, tankopedia: Tankopedia): number | null {
  if (p.entryHpSource === 'OBSERVED_EXACT' && p.entryHp !== null && p.entryHp > 0) return p.entryHp
  return tankMaxHpValue(tankopedia, p.tankId)
}

/** 场均进场满血（fail-closed：14 名 team 1/2 玩家全部 HP 已知才 complete）。 */
function averageHp(battle: Battle, tankopedia: Tankopedia): BattleAverageHp {
  if (battle.players == null) return UNKNOWN_HP
  let total = 0
  let eligible = 0
  for (const player of battle.players) {
    if (player.team !== 1 && player.team !== 2) continue
    eligible++
    const hp = fullMaxHp(player, tankopedia)
    if (hp === null || hp <= 0) return UNKNOWN_HP
    total += hp
  }
  if (eligible !== STANDARD_BATTLE_PLAYER_COUNT) return UNKNOWN_HP
  return { value: total / STANDARD_BATTLE_PLAYER_COUNT, complete: true }
}

// ---------- PerformanceMetricsCalculator ----------

function safeTeam(team: number): number {
  return team === 1 || team === 2 ? team : 0
}

function cap(value: number, max: number): number {
  if (Number.isNaN(value) || !Number.isFinite(value) || value <= 0) return 0
  return Math.min(max, value)
}

function ratio(numerator: number, denominator: number): number {
  if (Number.isNaN(numerator) || !Number.isFinite(numerator) || numerator <= 0
    || Number.isNaN(denominator) || !Number.isFinite(denominator) || denominator <= 0) return 0
  return numerator / denominator
}

function roundContribution(player: PlayerResult, avgHp: number): number {
  return player.damageDealt + player.damageAssisted + player.kills * avgHp / 7.0
}

interface BattleContext {
  teamContribution: number[]
  battleDamageAssist: number
  averageHp: BattleAverageHp
}

function battleContext(battle: Battle, tankopedia: Tankopedia): BattleContext {
  const ctx: BattleContext = { teamContribution: [0, 0, 0], battleDamageAssist: 0, averageHp: averageHp(battle, tankopedia) }
  for (const player of battle.players) ctx.battleDamageAssist += player.damageDealt + player.damageAssisted
  if (ctx.averageHp.complete) {
    for (const player of battle.players) {
      ctx.teamContribution[safeTeam(player.team)] += roundContribution(player, ctx.averageHp.value)
    }
  }
  return ctx
}

function singleBattleImpact(player: PlayerResult, ctx: BattleContext): number {
  const share = ctx.battleDamageAssist === 0 ? 0 : (player.damageDealt + player.damageAssisted) / ctx.battleDamageAssist
  const index = share / EXPECTED_BATTLE_SHARE
  return 100.0 * (0.75 * index + 0.25 * player.kills)
}

function singleBattleKast(player: PlayerResult, win: boolean, traded: number, avgHp: number): number {
  const damageScore = ratio(player.damageDealt, avgHp * 1.15)
  const assistScore = ratio(player.damageAssisted, avgHp * 1.25)
  const survivalScore = player.survived && win ? 1.0 : 0.0
  const tradeScore = traded > 0 ? 1.0 : 0.0
  const combinedScore = ratio(player.damageDealt + player.damageAssisted, avgHp * 1.20)
  const kastScore = Math.max(Math.max(damageScore, assistScore), Math.max(Math.max(survivalScore, tradeScore), combinedScore))
  return cap(kastScore, 1.0)
}

function isMultiDamage(player: PlayerResult, avgHp: number): boolean {
  if (avgHp <= 0) return false
  return player.damageDealt >= avgHp * 1.5
    || (player.damageDealt >= avgHp * 1.2 && player.kills >= 1)
    || (player.damageDealt >= avgHp && player.kills >= 2)
    || player.kills >= 3
}

function isWin(battle: Battle, player: PlayerResult): boolean {
  const winner = battle.winnerTeam
  return winner !== null && winner !== 0 && player.team === winner
}

/** 单场逐玩家 contribution/kast/impact 直写 PlayerResult（Java `populateBattle`，幂等）。 */
export function populateBattle(battle: Battle, tankopedia: Tankopedia): void {
  const ctx = battleContext(battle, tankopedia)
  for (const player of battle.players) {
    let contribution: number | null = null
    let kast: number | null = null
    if (ctx.averageHp.complete) {
      const teamC = ctx.teamContribution[safeTeam(player.team)]
      const traded = tradedDeaths(player, battle.players)
      contribution = teamC === 0 ? 0 : 100.0 * roundContribution(player, ctx.averageHp.value) / teamC
      kast = 100.0 * singleBattleKast(player, isWin(battle, player), traded, ctx.averageHp.value)
    }
    player.contribution = contribution
    player.kast = kast
    player.impact = singleBattleImpact(player, ctx)
  }
}

/** 跨场表现聚合行（只保留 Preview 投影消费的字段：多伤率 + HP eligibility）。 */
export interface PerformanceRow {
  accountId: number
  multiDamageRate: number
  hpEligible: boolean
}

/** 跨场表现聚合（Java `compute`；多伤率只计 HP 已知场次）。 */
export function computePerformance(battles: readonly Battle[], tankopedia: Tankopedia): Map<number, PerformanceRow> {
  const acc = new Map<number, { kastBattles: number; multiDamageBattles: number; multiDamageEligible: number }>()
  for (const battle of battles) {
    const ctx = battleContext(battle, tankopedia)
    for (const player of battle.players) {
      let row = acc.get(player.accountId)
      if (row === undefined) {
        row = { kastBattles: 0, multiDamageBattles: 0, multiDamageEligible: 0 }
        acc.set(player.accountId, row)
      }
      if (!ctx.averageHp.complete) continue
      row.kastBattles++
      row.multiDamageEligible++
      if (isMultiDamage(player, ctx.averageHp.value)) row.multiDamageBattles++
    }
  }
  const out = new Map<number, PerformanceRow>()
  for (const [accountId, row] of acc) {
    out.set(accountId, {
      accountId,
      multiDamageRate: row.multiDamageEligible === 0 ? 0 : 100.0 * row.multiDamageBattles / row.multiDamageEligible,
      hpEligible: row.kastBattles > 0,
    })
  }
  return out
}

// ---------- Aggregator / Agg ----------

/** 一位选手的跨场累计（Java `Agg`）。 */
export interface Agg {
  accountId: number
  nickname: string
  clan: string
  team: number
  lastTime: number
  battles: number
  wins: number
  survived: number
  kills: number
  damage: number
  assisted: number
  received: number
  blocked: number
  earned: number
  shots: number
  hits: number
  pens: number
  enemiesDamaged: number
  survivalSum: number
  survivalKnownBattles: number
  /** vehicleId → battles（Java TreeMap，按 key 升序）。 */
  vehicleBattles: Map<number, number>
}

export function aggAvg(a: Agg, total: number): number {
  return a.battles === 0 ? 0 : total / a.battles
}

export function aggWinRate(a: Agg): number {
  return a.battles === 0 ? 0 : 100.0 * a.wins / a.battles
}

export function aggSurvivalRate(a: Agg): number {
  return a.battles === 0 ? 0 : 100.0 * a.survived / a.battles
}

/** 全部场次 survival time 可证明才可计算；否则 null。 */
export function aggSurvivalTimeAvg(a: Agg): number | null {
  return a.battles > 0 && a.survivalKnownBattles === a.battles ? a.survivalSum / a.battles : null
}

export function aggHitRate(a: Agg): number | null {
  return a.shots === 0 ? null : 100.0 * a.hits / a.shots
}

export function aggPenRate(a: Agg): number | null {
  return a.hits === 0 ? null : 100.0 * a.pens / a.hits
}

/** 用车统计：场次降序 → tankId 十进制字符串升序。 */
export function aggVehicleUsage(a: Agg): PlayerVehicleUsage[] {
  return [...a.vehicleBattles]
    .sort((x, y) => compareNumbers(y[1], x[1]) || compareStrings(String(x[0]), String(y[0])))
    .map(([tankId, battles]) => ({ tankId, battles }))
}

function canonicalSurvivalSec(battle: Battle, player: PlayerResult): number {
  if (player.survived) return battle.durationS !== null && battle.durationS > 0 ? battle.durationS : 0
  return deathSec(player)
}

/** 跨场次按 accountId 汇总（插入顺序 = 首次出现顺序）。 */
export function aggregatePlayers(battles: readonly Battle[]): Map<number, Agg> {
  const map = new Map<number, Agg>()
  for (const b of battles) {
    const winner = b.winnerTeam
    const start = b.startTime ?? 0
    for (const p of b.players) {
      let a = map.get(p.accountId)
      if (a === undefined) {
        a = {
          accountId: p.accountId, nickname: '', clan: '', team: 0, lastTime: -1,
          battles: 0, wins: 0, survived: 0, kills: 0, damage: 0, assisted: 0, received: 0, blocked: 0,
          earned: 0, shots: 0, hits: 0, pens: 0, enemiesDamaged: 0, survivalSum: 0, survivalKnownBattles: 0,
          vehicleBattles: new Map(),
        }
        map.set(p.accountId, a)
      }
      if (start >= a.lastTime) {
        a.lastTime = start
        a.nickname = hasText(p.nickname) ? p.nickname : String(p.accountId)
        a.clan = p.clan ?? ''
        a.team = p.team
      }
      a.battles++
      if (winner !== null && winner !== 0 && p.team === winner) a.wins++
      if (p.survived) a.survived++
      const survivalSec = canonicalSurvivalSec(b, p)
      if (survivalSec > 0) {
        a.survivalSum += survivalSec
        a.survivalKnownBattles++
      }
      a.kills += p.kills
      a.damage += p.damageDealt
      a.assisted += p.damageAssisted
      a.received += p.damageReceived
      a.blocked += p.damageBlocked
      a.shots += p.nShots
      a.hits += p.nHitsDealt
      a.pens += p.nPenetrationsDealt
      a.enemiesDamaged += p.nEnemiesDamaged
      a.earned += p.victoryPointsEarned
      a.vehicleBattles.set(p.tankId, (a.vehicleBattles.get(p.tankId) ?? 0) + 1)
    }
  }
  return map
}
