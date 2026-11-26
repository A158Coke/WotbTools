import type { AgentBattleResult, AgentResultPlayer } from '../api/agent-replay-facets.js'
import type { Battle, PlayerResult } from './compute/index.js'
import { gunMarksCount } from '../utils/gunMarks.js'

const MAX_DURATION_SEC = 420
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
    gunMarks: gunMarksCount(p.gun_marks),
    settlementResultEntityId: p.result_id ?? 0,
    settlementLifeTimeSec: lifeTime,
    settlementKillerResultEntityId: p.killer_id ?? null,
    settlementDeathReasonRaw: p.death_reason ?? null,
    killerAccountId: p.killer_account_id ?? null,
    survivalTimeSec: survived ? battleSec : Math.min(lifeTime, battleSec),
    deathTimeMillis: survived ? 0 : Math.round(lifeTime * 1000),
    tankName: '',
    tankTier: '',
    tankType: '',
    tankNation: '',
    alphaDamage: '',
    contribution: null,
    kast: null,
    impact: null,
    observedMaxHp: null,
    entryHpSource: null,
    entryHp: null,
    raw: null,
  }
}

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
    recorderVehicle: result.author_vehicle_codename ?? '',
    rosterComplete: typeof result.roster_complete === 'boolean' ? result.roster_complete : null,
  }
}
