/**
 * 客户端回放批次计算（取代服务端 Java `ReplayBatchFinalizer` + `Mapper.toPreviewResponse`）。
 *
 * 用法：
 *   const tankopedia = await loadTankopedia()
 *   const dataset = finalizeBatch(entries, tankopedia)    // 0 场有效 → NoValidReplaysError
 *   const result = toPreviewResponse(dataset, tankopedia) // = /processing-jobs/{id}/result 形状
 *
 * 与 Java 的逐字段一致性由 `__golden__/` 基准锁定（见 compute.golden.test.ts）。
 */

export type { Battle, EntryHpSource, ParsedEntry, PlayerResult, PlayerVehicleUsage } from './model.js'
export { finalizeBatch, NoValidReplaysError, MIXED_LEAGUE_AND_STANDARD_REPLAYS, type ProcessedDataset } from './finalize.js'
export type { LeagueRatingBatch, PlayerLeagueSummary, TeamLeagueSummary } from './league-batch.js'
export type { LeagueFailure, LeagueRatingResult, PlayerLeagueRating, TeamLeagueRating } from './league-rating.js'
export { toPreviewResponse } from './preview.js'
export type {
  AggRowDto,
  BattleDto,
  ColumnDef,
  LeagueBattleDto,
  LeagueColumnDef,
  LeagueFailureDto,
  LeaguePlayerSummaryDto,
  LeagueRatingDto,
  LeagueTeamDto,
  LeagueTeamSummaryDto,
  LeagueVehicleUsageDto,
  PlayerRowDto,
  PreviewResponse,
} from './preview.js'
export { createTankopedia, loadTankopedia, type TankInfo, type Tankopedia } from './tankopedia.js'
