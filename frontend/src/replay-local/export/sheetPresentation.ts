import { AGGREGATE_CORE_COLUMNS, AGGREGATE_PERFORMANCE_COLUMNS, LEAGUE_DIM_KEYS, PLAYER_COLUMNS } from '../compute/columns.js'

export type TitleWidth = readonly [string, number]

// ---------- Columns.PLAYER presentation（中文表头 + Excel 宽） ----------

export const PLAYER_PRESENTATION: Readonly<Record<string, TitleWidth>> = {
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
  gun_marks: ['环线', 7],
}

/** 汇总表 presentation（Java `AggregateSheets.SUMMARY_PRESENTATION`）。 */
export const SUMMARY_PRESENTATION: Readonly<Record<string, TitleWidth>> = {
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

export function dimensionTitle(key: string): string {
  return DIMENSION_TITLES[key]
}

