/**
 * 回放批次计算的输入事实模型（镜像 Java `com.wotb.core.model.Battle` / `PlayerResult`
 * 的 Jackson JSON 形状，camelCase；见 `__golden__/java-battles.json`）。
 *
 * 语义保持 Java 原样：primitive 字段（int/long/double/boolean）在 JSON 里恒存在，
 * 包装类型（Integer/Long/Double）可为 null。
 */

/** 进场满血量 provenance（Java `EntryHpSource`）。 */
export type EntryHpSource = 'OBSERVED_EXACT' | 'BASE_FALLBACK' | 'UNKNOWN'

/** 一名玩家在一场战斗中的战绩（Java `PlayerResult`）。 */
export interface PlayerResult {
  accountId: number
  team: number
  tankId: number
  nShots: number
  nHitsDealt: number
  nPenetrationsDealt: number
  damageDealt: number
  damageAssisted: number
  damageReceived: number
  nHitsReceived: number
  nPenetrationsReceived: number
  nEnemiesDamaged: number
  kills: number
  damageBlocked: number
  victoryPointsEarned: number
  victoryPointsSeized: number
  survived: boolean
  xp: number
  credits: number

  nickname: string
  clan: string
  prebattleGroupId: number | null
  rank: number | null

  tankName: string

  /** PerformanceMetricsCalculator.populateBattle 回填；null = HP unknown。 */
  contribution: number | null
  kast: number | null
  impact: number | null
  observedMaxHp: number | null
  entryHpSource: EntryHpSource | null
  entryHp: number | null
  /** Java `Object`：Integer 等级或空串。 */
  tankTier: number | string
  tankType: string
  tankNation: string
  /** Java `Object`：Integer 炮伤或空串。 */
  alphaDamage: number | string

  deathTimeMillis: number

  settlementResultEntityId: number
  settlementLifeTimeSec: number
  settlementKillerResultEntityId: number | null
  settlementDeathReasonRaw: number | null
  killerAccountId: number | null

  survivalTimeSec: number

  raw: Record<string, unknown[]> | null
}

/** 一场战斗的基本信息 + 全部玩家战绩（Java `Battle`）。 */
export interface Battle {
  arenaId: string
  winnerTeam: number | null
  /** meta.json#arenaBonusType：1=随机；2=训练房；4=联赛；null=未知。 */
  arenaBonusType: number | null
  version: string
  mapName: string
  durationS: number | null
  startTime: number | null
  settlementStartTime: number | null
  settlementFinishReasonRaw: number | null
  settlementDurationSec: number | null
  recorder: string
  recorderVehicle: string
  clientVersion: string
  players: PlayerResult[]
  rosterComplete: boolean | null
}

/**
 * 一个输入文件的轻量解析结果（Java `Replays.ParsedEntry`）：
 * 成功 → `battle != null`；失败 → `failureMessage != null`（以 failureMessage 判定失败）。
 */
export interface ParsedEntry {
  sourceIndex: number
  sourceName: string
  battle: Battle | null
  failureMessage: string | null
}

/** 一名选手对某辆车的使用统计（Java `PlayerVehicleUsage`）。 */
export interface PlayerVehicleUsage {
  tankId: number
  battles: number
}
