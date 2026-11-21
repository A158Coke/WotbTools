/** Agent 回放数据契约 —— 结果能力类型（BattleResult / 位姿 probe / 相机；DTO 冻结）。
 *  拆分自 agent-replay-facets.ts；公共入口仍为 `../agent-replay-facets.ts`。 */

// ---------- 结果能力：BattleResult（BattleSummary wire 形状，DTO 冻结） ----------

/** 单战斗者结算行（关键字段标注消费面；未知键透传保留） */
export interface AgentResultPlayer {
  account_id: number
  nickname: string
  team: number
  platoon_id?: number
  clan_tag?: string
  tank_id: number
  tank_name: string
  base_xp: number
  credits_earned: number
  n_shots: number
  n_hits_dealt: number
  n_penetrations_dealt: number
  damage_dealt: number
  damage_blocked: number
  /** 点亮协助（结算 damage_assisted_1） */
  damage_assisted_1: number
  /** 断带协助（结算 damage_assisted_2） */
  damage_assisted_2: number
  n_hits_received: number
  n_penetrations_received: number
  n_enemies_damaged: number
  n_enemies_destroyed: number
  mm_rating?: number
  display_rating?: number
  death_reason?: number
  survived?: boolean
  life_time_secs?: number
  n_enemies_spotted?: number
  destruction_assistance?: number
  gun_marks?: number
  killer_id?: number
  /** v0.3.2：#301 f23 经验（crate `base_xp` 在 11.19 语料为 0，消费方只读本字段）；结算缺该字段时缺省 */
  xp?: number
  /** v0.3.2：#301 f106 银币（同上，取代 `credits_earned`） */
  credits?: number
  /** v0.3.2：本战斗者的结算 result/entity ID（`killer_id` 引用此命名空间） */
  result_id?: number
  /** v0.3.2：击杀者账号（`killer_id` 经同场 `result_id` 联表；联不上缺省） */
  killer_account_id?: number
  /** v0.3.16：受击伤害——**可 null**（解析确定性收口：无证据 ≠ 0，未知即为 null）。
   *  消费端 battleFacts.count() 将 null 归 0 进聚合；结算单条展示若需区分
   *  「未知/0」应读原始字段。旧版（≤v0.3.15）恒为数字。 */
  damage_received?: number | null
  victory_points_earned?: number | null
  victory_points_seized?: number | null
  hitpoints_left?: number | null
  rank?: number | null
  [key: string]: unknown
}

/** 结果能力 DTO：BattleSummary（花名册/胜负/地图/全员统计；无任何时序物化） */
export interface AgentBattleResult {
  file_name: string
  timestamp: number
  datetime: string
  room_type: string
  /** meta.json arenaBonusType（名人堂准入 / 联赛模式判定） */
  arena_id?: string | null
  arena_bonus_type?: number | null
  finish_reason?: number | null
  /** 结算层整秒时长（root f5，权威）；`battle_duration_secs` 是 meta 口径 */
  result_duration_secs?: number | null
  client_version?: string | null
  map_id: number
  map_name: string
  /** v0.3.2：meta.json 原始地图代号（底图 / 语义 / i18n 键）；`map_name` 是枚举名 */
  map_key?: string | null
  /** v0.3.8：结算花名册与战绩账号集合完全一致（未读到结算 = 缺省） */
  roster_complete?: boolean | null
  /** v0.3.8：meta.json 原始 playerVehicleName（录像者车辆代号） */
  author_vehicle_codename?: string | null
  battle_duration_secs: number
  /** 1 / 2；0 = 无胜方（v0.3.3 起平局不再报成 1） */
  winner_team: number
  author_account_id: number
  author_nickname: string
  author_tank_id: number
  author_tank_name: string
  author_team: number
  author_won: boolean
  author: Record<string, unknown>
  players: AgentResultPlayer[]
  [key: string]: unknown
}

/**
 * 录像者初始世界位姿（`parseAuthorInitialPosition`，上游 v0.4.15 独立轻量能力）。
 *
 * `null` = 证据不足；未知绝不降级成 `[0,0,0]`。`position` 是 Agent 原始 replay 世界坐标
 * `[x, y, z]`（x/z 水平面、y elevation），不是 WotbTools map 坐标。
 */
export interface AgentAuthorInitialPosition {
  author_eid: number
  clock: number
  position: [number, number, number]
}

/**
 * 录像者相机状态（`parseRecorderCamera`，上游 v0.4.21 独立能力）。各列同组等长、按 clock 升序。
 * `aim.yaw` / `aim.pitch` 为弧度，`mode.raw` 是 Type23 无损 u32，`zoom.raw` 是 Type31 raw 值（单位未闭合，
 * 不得当作 FOV 度数或倍率展示）。`null` = 结构校验未通过，消费方禁用录像者视角。
 */
export interface AgentRecorderCamera {
  version: 1
  author_eid: number
  aim: { t: number[]; yaw: number[]; pitch: number[]; ray_x: number[]; ray_y: number[]; ray_z: number[] }
  mode: { t: number[]; raw: number[] }
  zoom: { t: number[]; raw: number[] }
  bloom: { t: number[]; raw: number[] }
  client_options: { backward_zoom: boolean | null }
}
