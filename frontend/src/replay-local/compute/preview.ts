/**
 * Preview 投影（Java `Mapper.toPreviewResponse` 8 参版本 + `dto/*`）：ProcessedDataset →
 * 与 `/api/replay/processing-jobs/{id}/result` 同形状的 JSON（字段名 / null / 数组顺序 / 数值
 * 均与 Jackson 序列化一致）。
 *
 * 与 Java 的唯一结构差异：Java 在此处 `Players.enrich` 原地改写共享 Battle 的
 * tankName/tankTier 等展示字段；这里只在投影时派生，不修改 dataset（输出相同）。
 */

import {
  AGGREGATE_CORE_COLUMNS,
  AGGREGATE_PERFORMANCE_COLUMNS,
  LEAGUE_DIM_KEYS,
  LEAGUE_DIM_MAX,
  LEAGUE_OBSERVED_MEAN,
  LEAGUE_RATING,
  PLAYER_COLUMNS,
  VICTORY_POINTS_EARNED,
} from './columns.js'
import type { ProcessedDataset } from './finalize.js'
import { compareIgnoreCase, compareNumbers, doubleCompare, hasText, javaTrim, r1 } from './java.js'
import { resultFor, teamKey, type LeagueRatingBatch, type PlayerLeagueSummary } from './league-batch.js'
import {
  MAX_FINAL,
  dimensionScores,
  type LeagueRatingResult,
  type PlayerLeagueRating,
  type TeamLeagueRating,
} from './league-rating.js'
import type { Battle, PlayerResult, PlayerVehicleUsage } from './model.js'
import { aggAvg, aggregatePlayers, computePerformance, type Agg, type PerformanceRow } from './performance.js'
import type { Tankopedia } from './tankopedia.js'

// ---------- DTO（Java records，字段顺序同 Jackson 输出） ----------

export interface ColumnDef {
  key: string
  num: boolean
}

export interface PlayerRowDto {
  cells: Record<string, unknown>
  team: number
  accountId: number
  vehicleId: number
}

export interface AggRowDto {
  cells: Record<string, unknown>
  team: number
  accountId: number
}

export interface LeagueTeamDto {
  team: number
  teamKey: string
  teamRating: number
  dimensionAverages: number[]
  autoName: string | null
  nameSource: string
  teamBestNickname: string
  teamBestAccountId: number
}

export interface LeagueBattleDto {
  mvpNickname: string
  mvpAccountId: number
  team1BestNickname: string
  team1BestAccountId: number
  team2BestNickname: string
  team2BestAccountId: number
  team1: LeagueTeamDto | null
  team2: LeagueTeamDto | null
}

export interface BattleDto {
  arenaId: string
  mapName: string
  version: string
  durationS: number | null
  startTime: number | null
  winnerTeam: number | null
  sourceId: string | null
  sourceName: string
  players: PlayerRowDto[]
  league: LeagueBattleDto | null
}

export interface LeagueColumnDef {
  key: string
  num: boolean
  max: number
  fixed: boolean
  defaultVisible: boolean
  group: string
}

export interface LeagueVehicleUsageDto {
  tankId: number
  tankName: string
  battles: number
}

export interface LeaguePlayerSummaryDto {
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
  mostUsedVehicle: LeagueVehicleUsageDto | null
}

export interface LeagueTeamSummaryDto {
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

export interface LeagueFailureDto {
  fileName: string
  arenaId: string
  code: string
}

export interface LeagueRatingDto {
  mode: 'LEAGUE_RATING'
  columns: LeagueColumnDef[]
  playerSummaries: LeaguePlayerSummaryDto[]
  teamSummaries: LeagueTeamSummaryDto[]
  playerSummaryColumns: ColumnDef[]
  teamSummaryColumns: ColumnDef[]
  failures: LeagueFailureDto[]
  /** 恒为 0 的 wire 兼容槽位（Java `LeagueRatingQualityDto`，deprecated）。 */
  ratingQuality: { unknownDeathTimePlayers: number }
}

export interface PreviewResponse {
  battles: BattleDto[]
  aggregate: AggRowDto[]
  duplicates: [string, string][]
  failures: [string, string][]
  playerColumns: ColumnDef[]
  aggregateColumns: ColumnDef[]
  league: LeagueRatingDto | null
  leagueUnavailableCode: string | null
  leagueMode: boolean
}

// ---------- 列定义 ----------

function playerColumns(): ColumnDef[] {
  return PLAYER_COLUMNS.map((c) => ({ key: c.key, num: c.num }))
}

function aggregateColumns(): ColumnDef[] {
  return [...AGGREGATE_CORE_COLUMNS, ...AGGREGATE_PERFORMANCE_COLUMNS].map((c) => ({ key: c.key, num: c.num }))
}

function leaguePlayerColumns(): ColumnDef[] {
  return [
    { key: 'nickname', num: false },
    { key: LEAGUE_RATING, num: true },
    ...PLAYER_COLUMNS.filter((c) => c.key !== 'nickname').map((c) => ({ key: c.key, num: c.num })),
    ...LEAGUE_DIM_KEYS.map((key) => ({ key, num: true })),
    { key: VICTORY_POINTS_EARNED, num: true },
  ]
}

function leagueColumnDefs(): LeagueColumnDef[] {
  return [
    { key: LEAGUE_RATING, num: true, max: MAX_FINAL, fixed: true, defaultVisible: true, group: 'rating' },
    ...LEAGUE_DIM_KEYS.map((key, d) => ({ key, num: true, max: LEAGUE_DIM_MAX[d], fixed: false, defaultVisible: false, group: 'rating' })),
    { key: VICTORY_POINTS_EARNED, num: true, max: 0, fixed: false, defaultVisible: false, group: 'battle' },
  ]
}

function numericColumns(keys: readonly string[]): ColumnDef[] {
  return keys.map((key) => ({ key, num: true }))
}

function leaguePlayerSummaryColumns(): ColumnDef[] {
  return [
    { key: 'nickname', num: false },
    { key: 'clan', num: false },
    ...numericColumns(['battles', 'rated_battles', LEAGUE_RATING, LEAGUE_OBSERVED_MEAN, ...LEAGUE_DIM_KEYS,
      'mvp_count', 'wins', 'damage_total', 'assist_total', 'kills_total']),
  ]
}

function leagueTeamSummaryColumns(): ColumnDef[] {
  return [
    { key: 'team_name', num: false },
    ...numericColumns(['rated_battles', LEAGUE_RATING, LEAGUE_OBSERVED_MEAN, ...LEAGUE_DIM_KEYS, 'wins']),
  ]
}

// ---------- VehicleCodes ----------

function classCode(value: string): string {
  if (!hasText(value)) return 'OTHER'
  switch (javaTrim(value)) {
    case '重坦': case 'Heavy tank': case 'HEAVY_TANK': return 'HEAVY_TANK'
    case '中坦': case 'Medium tank': case 'MEDIUM_TANK': return 'MEDIUM_TANK'
    case '轻坦': case 'Light tank': case 'LIGHT_TANK': return 'LIGHT_TANK'
    case 'TD': case 'Tank destroyer': case 'TANK_DESTROYER': return 'TANK_DESTROYER'
    default: return 'OTHER'
  }
}

function nationCode(value: string): string {
  if (!hasText(value)) return 'OTHER'
  switch (javaTrim(value)) {
    case '中国': case 'China': case 'CHINA': return 'CHINA'
    case '德国': case 'Germany': case 'GERMANY': return 'GERMANY'
    case '日本': case 'Japan': case 'JAPAN': return 'JAPAN'
    case '欧洲': case 'European': case 'EUROPE': return 'EUROPE'
    case '法国': case 'France': case 'FRANCE': return 'FRANCE'
    case '美国': case 'USA': return 'USA'
    case '苏联': case 'USSR': return 'USSR'
    case '英国': case 'UK': return 'UK'
    default: return 'OTHER'
  }
}

// ---------- Battle / 单场 ----------

/** 统一排序：先队伍升序，同队按伤害降序（稳定）。 */
function sortedPlayers(players: readonly PlayerResult[]): PlayerResult[] {
  return [...players].sort((a, b) => compareNumbers(a.team, b.team) || compareNumbers(b.damageDealt, a.damageDealt))
}

function playerCells(p: PlayerResult, tankopedia: Tankopedia): Record<string, unknown> {
  const tank = tankopedia.info(p.tankId)
  const cells: Record<string, unknown> = {}
  for (const c of PLAYER_COLUMNS) {
    switch (c.key) {
      case 'tank_type': cells[c.key] = classCode(tank.type); break
      case 'tank_nation': cells[c.key] = nationCode(tank.nation); break
      case 'survived_label': cells[c.key] = p.survived ? 'SURVIVED' : 'DESTROYED'; break
      default: cells[c.key] = c.get({ p, tank })
    }
  }
  return cells
}

function toBattle(b: Battle, sourceId: string | null, sourceName: string, tankopedia: Tankopedia,
  league: LeagueRatingResult | null, leagueMode: boolean): BattleDto {
  const leagueByAccount = new Map<number, PlayerLeagueRating>()
  for (const plr of league?.players ?? []) leagueByAccount.set(plr.accountId, plr)
  const rows: PlayerRowDto[] = []
  for (const p of sortedPlayers(b.players)) {
    const cells = playerCells(p, tankopedia)
    if (league !== null) {
      const plr = leagueByAccount.get(p.accountId)
      if (plr !== undefined) {
        cells[LEAGUE_RATING] = r1(plr.finalRating)
        const scores = dimensionScores(plr)
        LEAGUE_DIM_KEYS.forEach((key, d) => { cells[key] = r1(scores[d]) })
      }
      cells[VICTORY_POINTS_EARNED] = p.victoryPointsEarned
    } else if (leagueMode) {
      cells[VICTORY_POINTS_EARNED] = p.victoryPointsEarned
    }
    rows.push({ cells, team: p.team, accountId: p.accountId, vehicleId: p.tankId })
  }
  return {
    arenaId: b.arenaId,
    mapName: b.mapName,
    version: b.version,
    durationS: b.durationS,
    startTime: b.startTime,
    winnerTeam: b.winnerTeam,
    sourceId,
    sourceName,
    players: rows,
    league: leagueBattleDto(league, b),
  }
}

function leagueBattleDto(league: LeagueRatingResult | null, battle: Battle): LeagueBattleDto | null {
  if (league === null) return null
  const t1 = league.team1.teamBest
  const t2 = league.team2.teamBest
  return {
    mvpNickname: league.mvp?.nickname ?? '',
    mvpAccountId: league.mvp?.accountId ?? 0,
    team1BestNickname: t1?.nickname ?? '',
    team1BestAccountId: t1?.accountId ?? 0,
    team2BestNickname: t2?.nickname ?? '',
    team2BestAccountId: t2?.accountId ?? 0,
    team1: leagueTeamDto(league.team1, battle),
    team2: leagueTeamDto(league.team2, battle),
  }
}

function leagueTeamDto(team: TeamLeagueRating, battle: Battle): LeagueTeamDto {
  return {
    team: team.team,
    teamKey: teamKey(battle, team),
    teamRating: r1(team.teamRating),
    dimensionAverages: team.dimensionAverages.map(r1),
    autoName: team.autoName,
    nameSource: team.nameSource,
    teamBestNickname: team.teamBest?.nickname ?? '',
    teamBestAccountId: team.teamBest?.accountId ?? 0,
  }
}

// ---------- 汇总 ----------

function toAggregate(aggMap: Map<number, Agg>, perfById: Map<number, PerformanceRow>): AggRowDto[] {
  const list = [...aggMap.values()].sort((x, y) => doubleCompare(aggAvg(y, y.damage), aggAvg(x, x.damage)))
  return list.map((a) => {
    const cells: Record<string, unknown> = {}
    for (const c of AGGREGATE_CORE_COLUMNS) cells[c.key] = c.get(a)
    const perf = perfById.get(a.accountId)
    for (const c of AGGREGATE_PERFORMANCE_COLUMNS) cells[c.key] = perf === undefined ? null : c.get(perf)
    return { cells, team: a.team, accountId: a.accountId }
  })
}

// ---------- League 批次汇总 ----------

function isAuthoritativeName(name: string | null): name is string {
  if (name === null) return false
  const trimmed = javaTrim(name)
  return trimmed !== '' && !trimmed.startsWith('#')
}

/** 最常使用坦克：只取最大使用场次候选，排除占位名，按官方名忽略大小写 → tankId 升序。 */
function mostUsedVehicle(usage: readonly PlayerVehicleUsage[], tankopedia: Tankopedia): LeagueVehicleUsageDto | null {
  if (usage.length === 0) return null
  const maxBattles = Math.max(...usage.map((u) => u.battles))
  const candidates = usage
    .filter((u) => u.battles === maxBattles)
    .map((u) => {
      const name = tankopedia.info(u.tankId).name
      return { tankId: u.tankId, battles: u.battles, name: isAuthoritativeName(name) ? name : null }
    })
    .filter((c): c is { tankId: number; battles: number; name: string } => isAuthoritativeName(c.name))
    .sort((a, b) => compareIgnoreCase(a.name, b.name) || compareNumbers(a.tankId, b.tankId))
  if (candidates.length === 0) return null
  const best = candidates[0]
  return { tankId: best.tankId, tankName: best.name, battles: best.battles }
}

function leaguePlayerSummary(s: PlayerLeagueSummary, tankopedia: Tankopedia): LeaguePlayerSummaryDto {
  return {
    accountId: s.accountId,
    nickname: s.nickname,
    clan: s.clan,
    ratedBattles: s.ratedBattles,
    rating: s.rating,
    observedMean: r1(s.observedMean),
    dimensionMeans: s.dimensionMeans.map(r1),
    mvpCount: s.mvpCount,
    wins: s.wins,
    damageTotal: s.damageTotal,
    assistTotal: s.assistTotal,
    killsTotal: s.killsTotal,
    mostUsedVehicle: mostUsedVehicle(s.vehicleUsage, tankopedia),
  }
}

function leagueDto(league: LeagueRatingBatch, tankopedia: Tankopedia): LeagueRatingDto {
  return {
    mode: 'LEAGUE_RATING',
    columns: leagueColumnDefs(),
    playerSummaries: league.playerSummaries.map((s) => leaguePlayerSummary(s, tankopedia)),
    teamSummaries: league.teamSummaries.map((s) => ({
      teamKey: s.teamKey,
      autoName: s.autoName,
      nameSource: s.nameSource,
      ratedBattles: s.ratedBattles,
      rating: s.rating,
      observedMean: r1(s.observedMean),
      dimensionMeans: s.dimensionMeans.map(r1),
      wins: s.wins,
      arenaTeams: [...s.arenaTeams],
    })),
    playerSummaryColumns: leaguePlayerSummaryColumns(),
    teamSummaryColumns: leagueTeamSummaryColumns(),
    failures: league.failures.map((f) => ({ fileName: f.fileName, arenaId: f.arenaId, code: f.code })),
    ratingQuality: { unknownDeathTimePlayers: 0 },
  }
}

/**
 * 由已处理的 dataset 构建完整 Preview 响应（League 模式 ⇔ dataset.league != null）。
 * 每场 Rating 按 arenaId identity 绑定；多场或 League 批次输出基础 Replay Aggregate。
 */
export function toPreviewResponse(dataset: ProcessedDataset, tankopedia: Tankopedia): PreviewResponse {
  const { battles, league } = dataset
  const battlesDto = battles.map((battle, i) => toBattle(
    battle,
    i < dataset.battleSourceIds.length ? dataset.battleSourceIds[i] : null,
    i < dataset.battleSourceNames.length ? dataset.battleSourceNames[i] : '',
    tankopedia,
    league === null ? null : resultFor(league, battle.arenaId),
    league !== null,
  ))
  const shouldAggregate = battles.length > 1 || league !== null
  const aggregate = shouldAggregate
    ? toAggregate(aggregatePlayers(battles), computePerformance(battles, tankopedia))
    : []
  const duplicates = dataset.duplicates.map(([a, b]): [string, string] => [a, b])
  const failures = dataset.failures.map(([a, b]): [string, string] => [a, b])
  if (league !== null) {
    return {
      battles: battlesDto, aggregate, duplicates, failures,
      playerColumns: leaguePlayerColumns(), aggregateColumns: aggregateColumns(),
      league: leagueDto(league, tankopedia), leagueUnavailableCode: null, leagueMode: true,
    }
  }
  return {
    battles: battlesDto, aggregate, duplicates, failures,
    playerColumns: playerColumns(), aggregateColumns: aggregateColumns(),
    league: null, leagueUnavailableCode: dataset.leagueUnavailableCode, leagueMode: false,
  }
}
