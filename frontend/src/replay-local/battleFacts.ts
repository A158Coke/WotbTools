/**
 * 结算事实映射：上游 Rust Core `parseResult`（BattleSummary wire 形状）→ 批次计算消费的 `Battle`
 * 事实模型（与已退役的服务端 Java `ReplayParser` 产出的 `com.wotb.core.model.Battle` 同形）。
 *
 * 服务器没有 parser：这里是客户端唯一的「解析结果 → 计算输入」边界。每个字段的口径都与 Java
 * 逐字段对齐过（`tools/parity`，`__golden__/java-battles.json` 回归），缺字段一律向上游要，不在这里
 * 启发式推导。仅有的几条规则都是 Java 自身的投影规则，原样搬过来：
 * - 结算缺省的计数字段（承受伤害 / 胜利点 / 经验 / 银币）按 0——Java 用 `firstLong(..., 0)` 读取；
 * - 时长：结算整秒 > 0 优先，否则 meta 口径；都封顶 420 秒；
 * - 无胜方（上游 0）→ null；
 * - 阵亡却没有结算寿命 = 非法结算，整场失败（Java canonical fail-closed）。
 */
import type { AgentBattleResult, AgentResultPlayer } from '../api/agent-replay-facets.js'
import type { Battle, PlayerResult } from './compute/index.js'

/** 结算时长封顶（与 Java ReplayParser 一致：异常长的时长不进入派生指标） */
const MAX_DURATION_SEC = 420
/** 早于 2014-01-01 的时间戳视为无效（Java 同阈值） */
const MIN_VALID_TIMESTAMP_SEC = 1388534400

const count = (value: number | null | undefined): number => value ?? 0

function durationOf(result: AgentBattleResult): number | null {
  const settlement = result.result_duration_secs
  if (settlement != null && settlement > 0) return Math.min(settlement, MAX_DURATION_SEC)
  const meta = result.battle_duration_secs
  return meta > 0 ? Math.min(meta, MAX_DURATION_SEC) : null
}

function playerFacts(p: AgentResultPlayer, durationS: number | null): PlayerResult {
  const survived = p.survived === true
  const lifeTime = p.life_time_secs ?? 0
  if (!survived && lifeTime <= 0) {
    throw new Error(`Dead combatant missing settlement lifeTime: accountId=${p.account_id}`)
  }
  const battleSec = durationS ?? 0
  return {
    accountId: p.account_id,
    team: p.team,
    tankId: p.tank_id,
    nShots: p.n_shots,
    nHitsDealt: p.n_hits_dealt,
    nPenetrationsDealt: p.n_penetrations_dealt,
    damageDealt: p.damage_dealt,
    damageAssisted: p.damage_assisted_1 + p.damage_assisted_2,
    damageReceived: count(p.damage_received),
    nHitsReceived: p.n_hits_received,
    nPenetrationsReceived: p.n_penetrations_received,
    nEnemiesDamaged: p.n_enemies_damaged,
    kills: p.n_enemies_destroyed,
    damageBlocked: p.damage_blocked,
    victoryPointsEarned: count(p.victory_points_earned),
    victoryPointsSeized: count(p.victory_points_seized),
    survived,
    xp: count(p.xp),
    credits: count(p.credits),
    nickname: p.nickname || String(p.account_id),
    clan: p.clan_tag ?? '',
    prebattleGroupId: p.platoon_id ?? null,
    rank: p.rank ?? null,
    settlementResultEntityId: p.result_id ?? 0,
    settlementLifeTimeSec: lifeTime,
    settlementKillerResultEntityId: p.killer_id ?? null,
    settlementDeathReasonRaw: p.death_reason ?? null,
    killerAccountId: p.killer_account_id ?? null,
    survivalTimeSec: survived ? battleSec : Math.min(lifeTime, battleSec),
    deathTimeMillis: survived ? 0 : Math.round(lifeTime * 1000),
    // 以下由批次计算 enrichment 回填（车辆库 / 指标），解析层一律留空——与 Java ReplayParser 输出一致
    tankName: '',
    tankTier: '',
    tankType: '',
    tankNation: '',
    alphaDamage: '',
    contribution: null,
    kast: null,
    impact: null,
    // 进场血量来自时序重建，不属于结算通道
    observedMaxHp: null,
    entryHpSource: null,
    entryHp: null,
    raw: null,
  }
}

/** parseResult → Battle 事实。非法结算（阵亡缺寿命）抛错，调用方记为该文件失败。 */
export function toBattleFacts(result: AgentBattleResult): Battle {
  const durationS = durationOf(result)
  const timestamp = result.timestamp > MIN_VALID_TIMESTAMP_SEC ? result.timestamp : null
  return {
    arenaId: result.arena_id ?? '',
    winnerTeam: result.winner_team === 1 || result.winner_team === 2 ? result.winner_team : null,
    arenaBonusType: result.arena_bonus_type ?? null,
    version: result.client_version ?? '',
    mapName: result.map_key ?? '',
    durationS,
    startTime: timestamp,
    settlementStartTime: timestamp,
    settlementFinishReasonRaw: result.finish_reason ?? null,
    settlementDurationSec: result.result_duration_secs ?? null,
    recorder: result.author_nickname,
    clientVersion: result.client_version ?? '',
    players: result.players.map((p) => playerFacts(p, durationS)),
    // 上游 v0.3.8：meta playerVehicleName / 结算花名册与战绩账号集合一致性（AI 结束方式推导的守卫）
    recorderVehicle: result.author_vehicle_codename ?? '',
    rosterComplete: typeof result.roster_complete === 'boolean' ? result.roster_complete : null,
  }
}
