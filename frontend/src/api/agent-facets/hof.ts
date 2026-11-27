
import type { AgentBattleResult } from './resultTypes.js'
import { CONTRACT_VERSION } from './validation.js'


export interface HoFEntry {
  account_id: number
  nickname: string
  clan_tag?: string
  platoon_id?: number
  team: number
  tank_id: number
  tank_name: string
  damage_dealt: number
  damage_blocked: number
  damage_assisted_spot: number
  damage_assisted_track: number
  kills: number
  killer_id?: number
  survived?: boolean
  life_time_secs?: number
  n_shots: number
  n_hits: number
  n_penetrations: number
  n_enemies_damaged: number
  n_hits_received: number
  n_penetrations_received: number
  n_enemies_spotted?: number
  destruction_assistance?: number
  gun_marks?: number
  mm_rating?: number
  xp: number
  credits: number
}

export interface HoFSubmission {
  version: number
  battle: {
    start_time: number
    map_id: number
    map_name: string
    room_type: string
    winner: number
    duration_secs: null
  }
  entries: HoFEntry[]
}

export function projectHoF(result: AgentBattleResult): HoFSubmission {
  const entries: HoFEntry[] = result.players.map((p) => ({
    account_id: p.account_id,
    nickname: p.nickname,
    ...(p.clan_tag !== undefined ? { clan_tag: p.clan_tag } : {}),
    ...(p.platoon_id !== undefined ? { platoon_id: p.platoon_id } : {}),
    team: p.team,
    tank_id: p.tank_id,
    tank_name: p.tank_name,
    damage_dealt: p.damage_dealt,
    damage_blocked: p.damage_blocked,
    damage_assisted_spot: p.damage_assisted_1,
    damage_assisted_track: p.damage_assisted_2,
    kills: p.n_enemies_destroyed,
    ...(p.killer_id !== undefined ? { killer_id: p.killer_id } : {}),
    ...(p.survived !== undefined ? { survived: p.survived } : {}),
    ...(p.life_time_secs !== undefined ? { life_time_secs: p.life_time_secs } : {}),
    n_shots: p.n_shots,
    n_hits: p.n_hits_dealt,
    n_penetrations: p.n_penetrations_dealt,
    n_enemies_damaged: p.n_enemies_damaged,
    n_hits_received: p.n_hits_received,
    n_penetrations_received: p.n_penetrations_received,
    ...(p.n_enemies_spotted !== undefined ? { n_enemies_spotted: p.n_enemies_spotted } : {}),
    ...(p.destruction_assistance !== undefined ? { destruction_assistance: p.destruction_assistance } : {}),
    ...(p.gun_marks !== undefined ? { gun_marks: p.gun_marks } : {}),
    ...(p.mm_rating !== undefined ? { mm_rating: p.mm_rating } : {}),
    xp: p.base_xp,
    credits: p.credits_earned,
  }))
  return {
    version: CONTRACT_VERSION,
    battle: {
      start_time: result.timestamp,
      map_id: result.map_id,
      map_name: result.map_name,
      room_type: result.room_type,
      winner: result.winner_team,
      duration_secs: null, // root5 未解码；宁缺勿冒充
    },
    entries,
  }
}
