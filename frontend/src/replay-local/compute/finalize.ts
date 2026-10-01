/**
 * 批次收尾（Java `ReplayBatchFinalizer.finalizeBatch` + `LeagueReplays.finalize` +
 * `Replays.dedupe`）：模式判定 → 去重/冲突 → League 校验与评分 → 批次汇总 → 指标 enrich。
 */

import { aggregateLeagueBatch, type LeagueRatingBatch } from './league-batch.js'
import {
  LEAGUE_FAILURE_CODE,
  calculateLeagueRating,
  classifyMode,
  copiesConsistent,
  validateLeagueBattle,
  type LeagueFailure,
  type LeagueRatingMode,
  type LeagueRatingResult,
} from './league-rating.js'
import type { Battle, ParsedEntry } from './model.js'
import { populateBattle } from './performance.js'
import type { Tankopedia } from './tankopedia.js'

/** 混合批次（普通 + 训练赛/联赛）不聚合 League Rating 时的稳定提示码。 */
export const MIXED_LEAGUE_AND_STANDARD_REPLAYS = 'MIXED_LEAGUE_AND_STANDARD_REPLAYS'

/** 去重/聚合后 0 场有效回放（Java `NoValidReplaysException`，终态 NO_VALID_REPLAYS）。 */
export class NoValidReplaysError extends Error {
  readonly code = 'NO_VALID_REPLAYS'

  constructor() {
    super('NO_VALID_REPLAYS')
    this.name = 'NoValidReplaysError'
  }
}

/** 已处理回放数据集（Java `ProcessedDataset`）：battles 已 enrich 恰好一次。 */
export interface ProcessedDataset {
  battles: Battle[]
  battleSourceNames: string[]
  /** 与 battles 对齐的稳定 sourceId（`r{sourceIndex}`）。 */
  battleSourceIds: string[]
  /** [文件名, arenaId] */
  duplicates: [string, string][]
  /** [文件名, 错误] */
  failures: [string, string][]
  /** 仅 LEAGUE_RATING 批次非 null。 */
  league: LeagueRatingBatch | null
  /** 混合批次 = MIXED_LEAGUE_AND_STANDARD_REPLAYS；其余 null。 */
  leagueUnavailableCode: string | null
}

interface Collected {
  mode: LeagueRatingMode
  battles: Battle[]
  battleSourceNames: string[]
  battleSourceIds: string[]
  duplicates: [string, string][]
  failures: [string, string][]
  leagueBatch: LeagueRatingBatch | null
}

function failed(entry: ParsedEntry): boolean {
  return entry.failureMessage !== null
}

/** 按 arenaId 去重（first-wins；Java `Replays.dedupe`）。 */
function dedupe(entries: readonly ParsedEntry[], mode: LeagueRatingMode): Collected {
  const res: Collected = { mode, battles: [], battleSourceNames: [], battleSourceIds: [], duplicates: [], failures: [], leagueBatch: null }
  const seen = new Set<string>()
  for (const entry of entries) {
    if (failed(entry)) {
      res.failures.push([entry.sourceName, entry.failureMessage as string])
      continue
    }
    const battle = entry.battle as Battle
    if (seen.has(battle.arenaId)) {
      res.duplicates.push([entry.sourceName, battle.arenaId])
      continue
    }
    seen.add(battle.arenaId)
    res.battles.push(battle)
    res.battleSourceNames.push(entry.sourceName)
    res.battleSourceIds.push(`r${entry.sourceIndex}`)
  }
  return res
}

/** league 分支：同 arena 副本一致 → 保留第一份；不一致 → 全部副本 CONFLICTING；再逐场校验与评分。 */
function collectLeague(entries: readonly ParsedEntry[]): Collected {
  const byArena = new Map<string, ParsedEntry[]>()
  for (const e of entries) {
    if (failed(e)) continue
    const arenaId = (e.battle as Battle).arenaId
    const group = byArena.get(arenaId)
    if (group === undefined) byArena.set(arenaId, [e])
    else group.push(e)
  }

  const battles: Battle[] = []
  const battleSourceNames: string[] = []
  const battleSourceIds: string[] = []
  const duplicates: [string, string][] = []
  const leagueFailures: LeagueFailure[] = []

  for (const [arenaId, copies] of byArena) {
    const conflicted = copies.length > 1 && !copiesConsistent(copies.map((c) => c.battle as Battle))
    if (conflicted) {
      for (const copy of copies) {
        leagueFailures.push({ fileName: copy.sourceName, arenaId, code: LEAGUE_FAILURE_CODE.CONFLICTING_REPLAYS_FOR_ARENA })
      }
      continue
    }
    const kept = copies[0]
    for (let i = 1; i < copies.length; i++) duplicates.push([copies[i].sourceName, arenaId])
    battles.push(kept.battle as Battle)
    battleSourceNames.push(kept.sourceName)
    battleSourceIds.push(`r${kept.sourceIndex}`)
  }

  const results: LeagueRatingResult[] = []
  const ratedBattles: Battle[] = []
  for (let i = 0; i < battles.length; i++) {
    const validation = validateLeagueBattle(battles[i])
    if (validation.length > 0) {
      leagueFailures.push({ ...validation[0], fileName: battleSourceNames[i] })
      continue
    }
    ratedBattles.push(battles[i])
    results.push(calculateLeagueRating(battles[i]))
  }

  const failures: [string, string][] = entries
    .filter(failed)
    .map((e) => [e.sourceName, e.failureMessage as string])

  return {
    mode: 'LEAGUE_RATING',
    battles,
    battleSourceNames,
    battleSourceIds,
    duplicates,
    failures,
    leagueBatch: aggregateLeagueBatch(ratedBattles, results, leagueFailures),
  }
}

/**
 * 对全部 source 的 terminal outcome 执行一次批次收尾。
 *
 * 输入 battle 不被修改：内部深拷贝后 enrich（contribution/kast/impact），返回的
 * dataset 独占这些 Battle 对象。
 *
 * @param entries 按 sourceIndex 顺序的全部 source（失败以 failureMessage 表达）
 * @param tankopedia 车辆库（场均 HP 指标需要 tankopedia base HP）
 * @throws NoValidReplaysError 去重/聚合后 0 场有效回放
 */
export function finalizeBatch(entries: readonly ParsedEntry[], tankopedia: Tankopedia): ProcessedDataset {
  const owned: ParsedEntry[] = entries.map((e) => ({
    ...e,
    battle: failed(e) || e.battle === null ? null : structuredClone(e.battle),
  }))
  const mode = classifyMode(owned.filter((e) => !failed(e)).map((e) => e.battle as Battle))
  const collected = mode === 'LEAGUE_RATING' ? collectLeague(owned) : dedupe(owned, mode)
  if (collected.battles.length === 0) throw new NoValidReplaysError()
  for (const battle of collected.battles) populateBattle(battle, tankopedia)
  return {
    battles: collected.battles,
    battleSourceNames: collected.battleSourceNames,
    battleSourceIds: collected.battleSourceIds,
    duplicates: collected.duplicates,
    failures: collected.failures,
    league: collected.mode === 'LEAGUE_RATING' ? collected.leagueBatch : null,
    leagueUnavailableCode: collected.mode === 'MIXED_UNSUPPORTED' ? MIXED_LEAGUE_AND_STANDARD_REPLAYS : null,
  }
}
