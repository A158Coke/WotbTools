/**
 * 各工作簿的表结构（Java `com.wotb.core.export`：SingleBattleSheets / AggregateSheets /
 * LeagueSingleSheets / LeagueAggregateSheets / LeagueExcelColumns），输出纯数据 {@link WorkbookSpec}。
 *
 * 逐格与 Java 一致由 `__golden__/java-export.json` 锁定（export.golden.test.ts）。
 * 与 Java 的结构差异：Java 用 `Players.enrich` 原地改写共享 Battle 的展示字段，这里只在取值时派生。
 */

import { AGGREGATE_CORE_COLUMNS, AGGREGATE_PERFORMANCE_COLUMNS, LEAGUE_DIM_KEYS, LEAGUE_DIM_MAX, PLAYER_COLUMNS } from '../compute/columns.js'
import { compareNumbers, doubleCompare, hasText } from '../compute/java.js'
import { resultFor, type LeagueRatingBatch, type TeamLeagueSummary } from '../compute/league-batch.js'
import {
  LEAGUE_FAILURE_CODE,
  MAX_FINAL,
  dimensionScores,
  type LeagueRatingResult,
  type TeamLeagueRating,
} from '../compute/league-rating.js'
import type { Battle, PlayerResult, PlayerVehicleUsage } from '../compute/model.js'
import { aggAvg, aggregatePlayers, aggVehicleUsage, computePerformance, type Agg, type PerformanceRow } from '../compute/performance.js'
import type { Tankopedia } from '../compute/tankopedia.js'
import { duration, formatEpoch, javaDoubleToString, mapNameCn, r1, teamName } from './format.js'
import { autoFilter, newSheet, put, setCell, writeHeader, type Fill, type SheetSpec, type WorkbookSpec } from './spec.js'

/** 战队名称覆盖（仅本次导出使用）：battle = `{arenaId}:{team}` → 名；summary = 批次 teamKey → 名。 */
export interface TeamNameOverrides {
  battle: ReadonlyMap<string, string>
  summary: ReadonlyMap<string, string>
}

export interface SheetContext {
  tankopedia: Tankopedia
  /** IANA 时区；省略 = 浏览器本地时区（对应 Java `ZoneId.systemDefault()`）。 */
  timeZone?: string
}

type TitleWidth = readonly [string, number]

// ---------- Columns.PLAYER presentation（中文表头 + Excel 宽） ----------

const PLAYER_PRESENTATION: Readonly<Record<string, TitleWidth>> = {
  nickname: ['玩家', 20],
  clan: ['战队', 10],
  tank_name: ['车辆', 20],
  tank_tier: ['等级', 6],
  tank_type: ['坦克类型', 9],
  tank_nation: ['国家', 8],
  survived_label: ['存活', 6],
  kills: ['击杀', 6],
  damage_dealt: ['伤害', 8],
  damage_assisted: ['协助伤害', 9],
  damage_received: ['损失血量', 9],
  damage_blocked: ['格挡', 9],
  survival_time: ['存活时间', 10],
  n_shots: ['射击次数', 6],
  n_hits_dealt: ['命中次数', 6],
  n_penetrations_dealt: ['击穿', 6],
  hit_rate: ['命中率', 7],
  pen_rate: ['击穿率', 7],
  n_hits_received: ['被命中', 7],
  n_penetrations_received: ['被击穿', 7],
  n_enemies_damaged: ['击伤', 9],
  rank: ['军阶', 6],
}

/** 汇总表 presentation（Java `AggregateSheets.SUMMARY_PRESENTATION`）。 */
const SUMMARY_PRESENTATION: Readonly<Record<string, TitleWidth>> = {
  nickname: ['玩家', 18],
  clan: ['战队', 10],
  battles: ['场次', 6],
  wins: ['胜场', 6],
  win_rate: ['胜率%', 8],
  survival_rate: ['存活率%', 9],
  survival_time_avg: ['平均存活时间', 12],
  kills: ['总击杀', 7],
  kills_avg: ['场均击杀', 7],
  damage: ['总伤害', 9],
  damage_avg: ['场均伤害', 9],
  assisted: ['总协助伤害', 9],
  assisted_avg: ['场均协助伤害', 9],
  received_avg: ['场均损失血量', 8],
  blocked_avg: ['场均格挡', 8],
  hit_rate: ['命中率%', 8],
  pen_rate: ['击穿率%', 8],
  shots: ['总射击次数', 8],
  hits: ['总命中次数', 8],
  pens: ['总击穿次数', 8],
  enemies_damaged_avg: ['场均击伤', 9],
  tanks: ['用车', 30],
  earned_total: ['获取点数总计', 10],
  earned_avg: ['获取点数/场', 9],
  multi_damage_rate: ['多伤率%', 9],
}

/** League 七维标题（Java `LeagueExcelColumns`）。 */
const DIMENSION_TITLES: Readonly<Record<string, string>> = {
  league_damage_score: '伤害评分',
  league_assist_score: '助攻评分',
  league_kill_score: '击杀评分',
  league_exchange_score: '换血效率评分',
  league_blocked_score: '阻挡评分',
  league_survival_score: '存活/互换评分',
  league_shooting_score: '射击效率评分',
}

// fail fast（同 Java 类加载期校验）：canonical key 必须全部有 presentation
for (const c of PLAYER_COLUMNS) {
  if (!(c.key in PLAYER_PRESENTATION)) throw new Error(`player column presentation missing: ${c.key}`)
}
for (const c of [...AGGREGATE_CORE_COLUMNS, ...AGGREGATE_PERFORMANCE_COLUMNS]) {
  if (!(c.key in SUMMARY_PRESENTATION)) throw new Error(`aggregate summary presentation missing for canonical key: ${c.key}`)
}
for (const key of LEAGUE_DIM_KEYS) {
  if (!(key in DIMENSION_TITLES)) throw new Error(`League dimension Excel title missing for canonical key: ${key}`)
}

function dimensionTitle(key: string): string {
  return DIMENSION_TITLES[key]
}

// ---------- 共享取值 ----------

/** Java `Players.sorted`：先队伍升序，同队伤害降序（稳定）。 */
function sortedPlayers(players: readonly PlayerResult[]): PlayerResult[] {
  return [...players].sort((a, b) => compareNumbers(a.team, b.team) || compareNumbers(b.damageDealt, a.damageDealt))
}

/** Java `SingleBattleSheets.playerColumnValue`：survival_time 渲染为时长，其余直接取列值。 */
function playerColumnValue(key: string, get: (e: { p: PlayerResult; tank: ReturnType<Tankopedia['info']> }) => unknown,
  p: PlayerResult, tankopedia: Tankopedia): unknown {
  const value = get({ p, tank: tankopedia.info(p.tankId) })
  return key === 'survival_time' ? duration(value as number | null) : value
}

function playerHeader(): TitleWidth[] {
  return PLAYER_COLUMNS.map((c) => PLAYER_PRESENTATION[c.key])
}

/** `Map.get(k)` + `!isBlank()`。 */
function override(map: ReadonlyMap<string, string>, key: string): string | null {
  const v = map.get(key)
  return v !== undefined && hasText(v) ? v : null
}

// ---------- 单场（SingleBattleSheets） ----------

type PlayerRowTail = (sheet: SheetSpec, row: number, p: PlayerResult, fill: Fill, startCol: number) => void

function writePlayers(wb: WorkbookSpec, b: Battle, ctx: SheetContext, extraHeader: TitleWidth[] | null,
  tail: PlayerRowTail | null): void {
  const ws = newSheet(wb, '玩家数据')
  const header = [...playerHeader(), ...(extraHeader ?? [])]
  writeHeader(ws, header)
  const players = sortedPlayers(b.players)
  let rIdx = 1
  for (const p of players) {
    const row = rIdx++
    const fill: Fill = p.team === 1 ? 'team1' : 'team2'
    let c = 0
    for (const column of PLAYER_COLUMNS) {
      setCell(ws, row, c++, playerColumnValue(column.key, column.get, p, ctx.tankopedia), fill, column.key)
    }
    if (tail !== null) tail(ws, row, p, fill, c)
  }
  ws.freeze = [1, 1]
  autoFilter(ws, players.length, header.length - 1)
}

function writeBattleInfo(wb: WorkbookSpec, b: Battle, ctx: SheetContext, extraRows: [string, string][] | null,
  keyWidth: number): void {
  const ws = newSheet(wb, '战斗信息')
  put(ws, 0, 0, '战斗信息', 'title')
  const rows: [string, string | null][] = [
    ['游戏版本', b.version],
    ['地图', mapNameCn(b.mapName)],
    ['开始时间', formatEpoch(b.startTime, 'DT', ctx.timeZone)],
    ['战斗时长', duration(b.durationS)],
    ['获胜队伍', teamName(b.winnerTeam)],
    ['录像者', b.recorder],
    // 客户端：上游 parseResult 暂未提供录像者车辆，battleFacts 填 ''（单元格保留）
    ['录像者车辆', b.recorderVehicle],
    ['玩家数', String(b.players?.length ?? 0)],
    ['竞技场ID', b.arenaId],
    ...(extraRows ?? []),
  ]
  rows.forEach(([key, value], i) => {
    put(ws, i + 2, 0, key, 'bold')
    put(ws, i + 2, 1, value ?? '')
  })
  ws.cols.set(0, keyWidth)
  ws.cols.set(1, 40)
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((x) => x.toString(16).padStart(2, '0')).join('')
}

/** 原始字段（protobuf field-number 透视）；客户端 Battle.raw 恒为 null → 只有玩家/账号ID 两列。 */
function writeRaw(wb: WorkbookSpec, b: Battle): void {
  const ws = newSheet(wb, '原始字段')
  const fieldNums = new Set<number>()
  for (const p of b.players) {
    if (p.raw != null) for (const k of Object.keys(p.raw)) fieldNums.add(Number(k))
  }
  const cols = [...fieldNums].sort((x, y) => x - y)
  put(ws, 0, 0, '玩家', 'hdr')
  put(ws, 0, 1, '账号ID', 'hdr')
  cols.forEach((n, i) => put(ws, 0, i + 2, `#${n}`, 'hdr'))
  let rIdx = 1
  for (const p of sortedPlayers(b.players)) {
    const row = rIdx++
    put(ws, row, 0, p.nickname)
    put(ws, row, 1, p.accountId)
    cols.forEach((n, i) => {
      const vals = p.raw == null ? undefined : p.raw[String(n)]
      if (vals == null) return
      put(ws, row, i + 2, vals.map((v) => (v instanceof Uint8Array ? toHex(v) : String(v))).join(', '))
    })
  }
}

/** 单场工作簿：玩家数据 / 战斗信息 / 原始字段（Java `ExcelExporter.writeSingle`）。 */
export function singleWorkbook(battle: Battle, ctx: SheetContext): WorkbookSpec {
  const wb: WorkbookSpec = { sheets: [], activeTab: 0 }
  writePlayers(wb, battle, ctx, null, null)
  writeBattleInfo(wb, battle, ctx, null, 14)
  writeRaw(wb, battle)
  wb.activeTab = 0
  return wb
}

// ---------- League 单场（LeagueSingleSheets） ----------

function percent(v: number, max: number): number {
  return max <= 0 || v <= 0 ? 0 : r1(100.0 * v / max)
}

function byAccount(result: LeagueRatingResult, accountId: number) {
  return result.players.find((p) => p.accountId === accountId) ?? null
}

/** Java `LeagueRatingResult.team(int)`：1 → team1，其余 → team2。 */
function resultTeam(result: LeagueRatingResult, team: number): TeamLeagueRating {
  return team === 1 ? result.team1 : result.team2
}

/** League 单场工作簿（Java `ExcelExporter.writeSingleLeague`）。 */
export function singleLeagueWorkbook(battle: Battle, result: LeagueRatingResult, ctx: SheetContext,
  battleOverrides: ReadonlyMap<string, string>): WorkbookSpec {
  const wb: WorkbookSpec = { sheets: [], activeTab: 0 }
  const leagueHeader: TitleWidth[] = [['占点得分', 9]]
  for (const key of LEAGUE_DIM_KEYS) {
    leagueHeader.push([dimensionTitle(key), 9], ['满分', 6], ['百分比', 8])
  }
  leagueHeader.push(['总Rating', 9], ['满分', 6], ['百分比', 8])
  writePlayers(wb, battle, ctx, leagueHeader, (ws, row, p, fill, startCol) => {
    let c = startCol
    setCell(ws, row, c++, p.victoryPointsEarned, fill, 'victory_points_earned')
    const r = byAccount(result, p.accountId)
    if (r !== null) {
      const dims = dimensionScores(r)
      for (let d = 0; d < LEAGUE_DIM_KEYS.length; d++) {
        setCell(ws, row, c++, r1(dims[d]), fill, 'league_score')
        setCell(ws, row, c++, Math.trunc(LEAGUE_DIM_MAX[d]), fill, 'league_max')
        setCell(ws, row, c++, percent(dims[d], LEAGUE_DIM_MAX[d]), fill, 'league_pct')
      }
      setCell(ws, row, c++, r1(r.finalRating), fill, 'league_rating')
      setCell(ws, row, c++, Math.trunc(MAX_FINAL), fill, 'league_max')
      setCell(ws, row, c++, percent(r.finalRating, MAX_FINAL), fill, 'league_pct')
    }
  })

  const displayName = (team: TeamLeagueRating): string =>
    override(battleOverrides, `${battle.arenaId}:${team.team}`)
    ?? (team.autoName !== null && hasText(team.autoName) ? team.autoName : '待命名')
  const teamRatingLine = (team: TeamLeagueRating | null): string =>
    team === null ? '—' : `${displayName(team)}：${javaDoubleToString(r1(team.teamRating))} / 1000`
  const extra: [string, string][] = [
    ['Team 1 战队Rating', teamRatingLine(result.team1)],
    ['Team 2 战队Rating', teamRatingLine(result.team2)],
    ['全场MVP', result.mvp === null ? '' : result.mvp.nickname],
    ['Team 1 队内最佳', result.team1?.teamBest == null ? '' : result.team1.teamBest.nickname],
    ['Team 2 队内最佳', result.team2?.teamBest == null ? '' : result.team2.teamBest.nickname],
  ]
  writeBattleInfo(wb, battle, ctx, extra, 22)
  writeRaw(wb, battle)
  wb.activeTab = 0
  return wb
}

// ---------- 多场汇总（AggregateSheets） ----------

/** 结构化用车 → 文本（名称由 Tankopedia 解析；未知/空名显式退化为 #id）。 */
function vehicleUsageText(usage: readonly PlayerVehicleUsage[], tankopedia: Tankopedia): string {
  return usage.map((u) => {
    const name = tankopedia.info(u.tankId).name
    const label = hasText(name) ? name : `#${u.tankId}`
    return u.battles > 1 ? `${label}×${u.battles}` : label
  }).join(', ')
}

const CORE_BY_KEY = new Map(AGGREGATE_CORE_COLUMNS.map((c) => [c.key, c]))
const PERF_BY_KEY = new Map(AGGREGATE_PERFORMANCE_COLUMNS.map((c) => [c.key, c]))
const SUMMARY_KEYS = [...AGGREGATE_CORE_COLUMNS, ...AGGREGATE_PERFORMANCE_COLUMNS].map((c) => c.key)

function summaryValue(key: string, a: Agg, perfById: Map<number, PerformanceRow>, tankopedia: Tankopedia): unknown {
  if (key === 'survival_time_avg') return duration(CORE_BY_KEY.get(key)?.get(a) as number | null)
  if (key === 'tanks') return vehicleUsageText(aggVehicleUsage(a), tankopedia)
  const perf = PERF_BY_KEY.get(key)
  if (perf !== undefined) {
    const row = perfById.get(a.accountId)
    return row === undefined ? null : perf.get(row)
  }
  return CORE_BY_KEY.get(key)?.get(a)
}

function summarySheet(wb: WorkbookSpec, battles: readonly Battle[], ctx: SheetContext, prefix: string): void {
  const ws = newSheet(wb, `${prefix}汇总`)
  writeHeader(ws, SUMMARY_KEYS.map((k) => SUMMARY_PRESENTATION[k]))
  const perfById = computePerformance(battles, ctx.tankopedia)
  const rows = [...aggregatePlayers(battles).values()]
    .sort((x, y) => doubleCompare(aggAvg(y, y.damage), aggAvg(x, x.damage)))
  let rIdx = 1
  for (const a of rows) {
    const row = rIdx++
    SUMMARY_KEYS.forEach((key, c) => {
      setCell(ws, row, c, summaryValue(key, a, perfById, ctx.tankopedia), 'plain', c < 2 ? 'nickname' : 'x')
    })
  }
  ws.freeze = [1, 1]
  autoFilter(ws, rows.length, SUMMARY_KEYS.length - 1)
}

function resultOf(winner: number | null, team: number): string {
  if (winner === null || winner === 0) return '平'
  return team === winner ? '胜' : '负'
}

function detailSheet(wb: WorkbookSpec, battles: readonly Battle[], sourceNames: readonly string[], ctx: SheetContext,
  prefix: string): void {
  const ws = newSheet(wb, `${prefix}明细`)
  const hdrSpec: TitleWidth[] = [['文件名', 40], ['竞技场ID', 22], ['日期', 17], ['地图', 12], ['胜负', 6], ...playerHeader()]
  writeHeader(ws, hdrSpec)
  let rIdx = 1
  battles.forEach((b, i) => {
    const date = formatEpoch(b.startTime, 'DT_MIN', ctx.timeZone)
    const sourceName = i < sourceNames.length ? sourceNames[i] : ''
    const mapName = mapNameCn(b.mapName)
    for (const p of sortedPlayers(b.players)) {
      const row = rIdx++
      const head: [unknown, string][] = [
        [sourceName, 'nickname'],
        [b.arenaId, 'x'],
        [date, 'date'],
        [mapName, 'map_name'],
        [resultOf(b.winnerTeam, p.team), 'x'],
      ]
      let c = 0
      for (const [value, key] of head) setCell(ws, row, c++, value, 'plain', key)
      for (const column of PLAYER_COLUMNS) {
        setCell(ws, row, c++, playerColumnValue(column.key, column.get, p, ctx.tankopedia), 'plain', column.key)
      }
    }
  })
  ws.freeze = [2, 1]
  autoFilter(ws, rIdx - 1, hdrSpec.length - 1)
}

function battleListSheet(wb: WorkbookSpec, battles: readonly Battle[], names: readonly string[],
  duplicates: readonly [string, string][], ctx: SheetContext, prefix: string): void {
  const ws = newSheet(wb, `${prefix}战斗列表`)
  writeHeader(ws, [['序号', 6], ['日期', 17], ['地图', 12], ['时长', 9], ['获胜队', 8], ['玩家数', 7],
    ['arenaUniqueId', 22], ['文件名', 40]])
  let rIdx = 1
  battles.forEach((b, i) => {
    const row = rIdx++
    put(ws, row, 0, i + 1)
    put(ws, row, 1, formatEpoch(b.startTime, 'DT', ctx.timeZone))
    put(ws, row, 2, mapNameCn(b.mapName))
    put(ws, row, 3, duration(b.durationS))
    put(ws, row, 4, teamName(b.winnerTeam))
    put(ws, row, 5, b.players?.length ?? 0)
    put(ws, row, 6, b.arenaId)
    put(ws, row, 7, i < names.length ? names[i] : '')
  })
  if (duplicates.length > 0) {
    rIdx++
    put(ws, rIdx++, 0, '已跳过的重复上传:', 'dupLabel')
    for (const [fileName, arenaId] of duplicates) {
      const row = rIdx++
      put(ws, row, 1, fileName)
      put(ws, row, 6, arenaId)
    }
  }
}

function writeAggregateSheets(wb: WorkbookSpec, battles: readonly Battle[], sourceNames: readonly string[],
  duplicates: readonly [string, string][], ctx: SheetContext, prefix: string): void {
  summarySheet(wb, battles, ctx, prefix)
  detailSheet(wb, battles, sourceNames, ctx, prefix)
  battleListSheet(wb, battles, sourceNames, duplicates, ctx, prefix)
}

/** 多场汇总工作簿：汇总 / 明细 / 战斗列表（Java `ExcelExporter.writeAggregate`）。 */
export function aggregateWorkbook(battles: readonly Battle[], sourceNames: readonly string[],
  duplicates: readonly [string, string][], ctx: SheetContext): WorkbookSpec {
  const wb: WorkbookSpec = { sheets: [], activeTab: 0 }
  writeAggregateSheets(wb, battles, sourceNames, duplicates, ctx, '')
  return wb
}

// ---------- League 批量（LeagueAggregateSheets） ----------

function failureLabel(code: string): string {
  switch (code) {
    case LEAGUE_FAILURE_CODE.CONFLICTING_REPLAYS_FOR_ARENA: return 'arena 冲突，不评分'
    case LEAGUE_FAILURE_CODE.NOT_SEVEN_VS_SEVEN: return '非标准 7v7'
    case LEAGUE_FAILURE_CODE.ROSTER_INCOMPLETE: return '名册不完整'
    case LEAGUE_FAILURE_CODE.NO_DECISIVE_WINNER: return '平局/未知胜方'
    default: return code
  }
}

function leaguePlayerSummaries(wb: WorkbookSpec, batch: LeagueRatingBatch): void {
  const ws = newSheet(wb, '选手汇总')
  writeHeader(ws, [
    ['玩家', 20], ['战队', 10], ['评分场次', 8], ['总Rating', 12], ['Observed Mean', 12],
    ...LEAGUE_DIM_KEYS.map((key): TitleWidth => [`${dimensionTitle(key)}平均`, 10]),
    ['MVP次数', 8], ['胜场', 6], ['总伤害', 9], ['总助攻', 9], ['总击杀', 8],
  ])
  let rIdx = 1
  for (const s of batch.playerSummaries) {
    const row = rIdx++
    let c = 0
    setCell(ws, row, c++, s.nickname, 'plain', 'nickname')
    setCell(ws, row, c++, s.clan, 'plain', 'clan')
    setCell(ws, row, c++, s.ratedBattles, 'plain', 'rated_battles')
    setCell(ws, row, c++, r1(s.rating), 'plain', 'league_rating')
    setCell(ws, row, c++, r1(s.observedMean), 'plain', 'league_observed_mean')
    for (const d of s.dimensionMeans) setCell(ws, row, c++, r1(d), 'plain', 'league_score')
    setCell(ws, row, c++, s.mvpCount, 'plain', 'mvp_count')
    setCell(ws, row, c++, s.wins, 'plain', 'wins')
    setCell(ws, row, c++, s.damageTotal, 'plain', 'damage_total')
    setCell(ws, row, c++, s.assistTotal, 'plain', 'assist_total')
    setCell(ws, row, c++, s.killsTotal, 'plain', 'kills_total')
  }
  ws.freeze = [1, 1]
}

function leagueTeamSummaries(wb: WorkbookSpec, batch: LeagueRatingBatch, summaryOverrides: ReadonlyMap<string, string>): void {
  const ws = newSheet(wb, '战队汇总')
  writeHeader(ws, [
    ['战队', 20], ['评分场次', 8], ['战队Rating', 12], ['Observed Mean', 12],
    ...LEAGUE_DIM_KEYS.map((key): TitleWidth => [`${dimensionTitle(key)}平均`, 10]),
    ['胜场', 6],
  ])
  const displayName = (s: TeamLeagueSummary): string =>
    override(summaryOverrides, s.teamKey) ?? (s.autoName !== null && hasText(s.autoName) ? s.autoName : '待命名')
  let rIdx = 1
  for (const s of batch.teamSummaries) {
    const row = rIdx++
    let c = 0
    setCell(ws, row, c++, displayName(s), 'plain', 'team_name')
    setCell(ws, row, c++, s.ratedBattles, 'plain', 'rated_battles')
    setCell(ws, row, c++, r1(s.rating), 'plain', 'league_rating')
    setCell(ws, row, c++, r1(s.observedMean), 'plain', 'league_observed_mean')
    for (const d of s.dimensionMeans) setCell(ws, row, c++, r1(d), 'plain', 'league_score')
    setCell(ws, row, c++, s.wins, 'plain', 'wins')
  }
  ws.freeze = [1, 1]
}

function leagueBattleDetails(wb: WorkbookSpec, battles: readonly Battle[], sourceNames: readonly string[],
  batch: LeagueRatingBatch, ctx: SheetContext, battleOverrides: ReadonlyMap<string, string>): void {
  const ws = newSheet(wb, '每场明细')
  writeHeader(ws, [
    ['文件名', 20], ['竞技场ID', 16], ['队伍', 6], ['玩家', 20], ['车辆', 16], ['伤害', 8], ['总Rating', 9],
    ...LEAGUE_DIM_KEYS.map((key): TitleWidth => [dimensionTitle(key), 9]),
  ])
  const battleTeamName = (battle: Battle, result: LeagueRatingResult, team: number): string => {
    const named = override(battleOverrides, `${battle.arenaId}:${team}`)
    if (named !== null) return named
    const teamRating = resultTeam(result, team)
    if (teamRating?.autoName != null && hasText(teamRating.autoName)) return teamRating.autoName
    return `Team ${team}`
  }
  const tankId = (battle: Battle, accountId: number): number =>
    battle.players.find((pr) => pr.accountId === accountId)?.tankId ?? 0
  let rIdx = 1
  battles.forEach((battle, i) => {
    const result = resultFor(batch, battle.arenaId)
    if (result === null) return
    const sourceName = sourceNames.length > i ? sourceNames[i] : ''
    for (const p of result.players) {
      const row = rIdx++
      let c = 0
      setCell(ws, row, c++, sourceName, 'plain', 'nickname')
      setCell(ws, row, c++, battle.arenaId, 'plain', 'clan')
      setCell(ws, row, c++, battleTeamName(battle, result, p.team), 'plain', 'team_name')
      setCell(ws, row, c++, p.nickname, 'plain', 'nickname')
      setCell(ws, row, c++, ctx.tankopedia.info(tankId(battle, p.accountId)).name, 'plain', 'tank_name')
      setCell(ws, row, c++, p.damageDealt, 'plain', 'damage_dealt')
      setCell(ws, row, c++, r1(p.finalRating), 'plain', 'league_rating')
      for (const score of dimensionScores(p)) setCell(ws, row, c++, r1(score), 'plain', 'league_score')
    }
  })
  ws.freeze = [1, 1]
}

function leagueBattleList(wb: WorkbookSpec, battles: readonly Battle[], sourceNames: readonly string[],
  duplicates: readonly [string, string][], batch: LeagueRatingBatch): void {
  const ws = newSheet(wb, '战斗列表')
  writeHeader(ws, [['文件名', 20], ['竞技场ID', 16], ['地图', 16], ['获胜队伍', 8], ['时长', 8], ['状态', 14]])
  const battleArenaIds = new Set(battles.map((b) => b.arenaId))
  const codeByArena = new Map<string, string>()
  for (const f of batch.failures) if (!codeByArena.has(f.arenaId)) codeByArena.set(f.arenaId, f.code)
  let rIdx = 1
  battles.forEach((battle, i) => {
    const row = rIdx++
    let c = 0
    setCell(ws, row, c++, sourceNames.length > i ? sourceNames[i] : '', 'plain', 'nickname')
    setCell(ws, row, c++, battle.arenaId, 'plain', 'clan')
    setCell(ws, row, c++, mapNameCn(battle.mapName), 'plain', 'tank_name')
    setCell(ws, row, c++, teamName(battle.winnerTeam), 'plain', 'battles')
    setCell(ws, row, c++, duration(battle.durationS), 'plain', 'damage_dealt')
    const code = codeByArena.get(battle.arenaId)
    const status = resultFor(batch, battle.arenaId) !== null ? '已评分'
      : code !== undefined ? failureLabel(code)
        : '未评分'
    setCell(ws, row, c++, status, 'plain', 'nickname')
  })
  for (const [fileName, arenaId] of duplicates) {
    const row = rIdx++
    setCell(ws, row, 0, fileName, 'plain', 'nickname')
    setCell(ws, row, 1, arenaId, 'plain', 'clan')
    setCell(ws, row, 5, '重复', 'plain', 'nickname')
  }
  for (const f of batch.failures) {
    if (battleArenaIds.has(f.arenaId)) continue
    const row = rIdx++
    setCell(ws, row, 0, f.fileName, 'plain', 'nickname')
    setCell(ws, row, 1, f.arenaId, 'plain', 'clan')
    setCell(ws, row, 5, failureLabel(f.code), 'plain', 'nickname')
  }
  ws.freeze = [1, 1]
}

/** League 批量工作簿：Replay 汇总/明细/战斗列表 + 选手汇总/战队汇总/每场明细/战斗列表（Java `writeAggregateLeague`）。 */
export function aggregateLeagueWorkbook(battles: readonly Battle[], sourceNames: readonly string[],
  duplicates: readonly [string, string][], batch: LeagueRatingBatch, ctx: SheetContext,
  overrides: TeamNameOverrides): WorkbookSpec {
  const wb: WorkbookSpec = { sheets: [], activeTab: 0 }
  writeAggregateSheets(wb, battles, sourceNames, duplicates, ctx, 'Replay ')
  leaguePlayerSummaries(wb, batch)
  leagueTeamSummaries(wb, batch, overrides.summary)
  leagueBattleDetails(wb, battles, sourceNames, batch, ctx, overrides.battle)
  leagueBattleList(wb, battles, sourceNames, duplicates, batch)
  wb.activeTab = 0
  return wb
}
