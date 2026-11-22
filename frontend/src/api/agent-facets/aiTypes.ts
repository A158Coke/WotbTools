/** Agent 回放数据契约 —— AI 事件数据类型（AiReviewFacet v1）。
 *  拆分自 agent-replay-facets.ts；公共入口仍为 `../agent-replay-facets.ts`。 */

// ---------- AI 事件数据：AiReviewFacet（v1；上游 v0.3.5 起含原始 HP 与 method8 证据） ----------

export interface AgentAiRosterEntry {
  eid: number
  account_id?: number
  nickname?: string
  team?: number
  tank_id?: number
  tank_name: string
  is_author: boolean
}

export interface AgentArenaPeriod {
  clock: number
  /** updateArena PERIOD 原始值（1=WAITING 2=PREBATTLE 3=BATTLE 4=AFTERBATTLE） */
  period: number
  remaining_s?: number
  duration_s?: number
  [key: string]: unknown
}

/**
 * 上游 `hp_state` 闭集 —— Agent-wire 的**唯一 SSOT**（producer enum 变更只改这一处）：
 * `AiHpStateField` 由本 tuple 派生，运行期校验集合由本 tuple 构建，canonical 分类器
 * （`replay-local/canonical/hpRawState.ts`）也只复用该类型，不再各自维护枚举。
 */
export const AI_HP_STATES = ['current', 'zero', 'terminal'] as const

/** 上游血量编码分类（`hp_state`；上游 ≥ v0.4.9 恒在场，旧产物缺省）。
 *  `terminal` = 负 i16 终态哨兵（死亡面之一）——分类规则唯一定义源在上游
 *  （`combat::classify_hp_state` / `hp_terminal_normalized`），本层禁二次解释。 */
export type AiHpStateField = (typeof AI_HP_STATES)[number]

/// 供 validation.ts 的 fail-closed 校验复用（原私有，跨模块后导出）
export const AI_HP_STATE_SET: ReadonlySet<string> = new Set(AI_HP_STATES)

/**
 * AiReview 信任边界校验模式——**两条路径不混用**：
 *
 *  - `current-producer`：当前正式 pin（v0.4.9+）的 WASM 消费路径（`parseAgentAiReviewFromBytes`）。
 *    `damage`/`health.hp_state` **必填**：该版本恒输出该字段，缺字段 = producer 漂移 → fail closed，
 *    **不得**静默进入 legacy 回退（那会把 0xFFFE 档弹药架殉爆重新判成存活——本 PR 修的正是这个 bug）。
 *  - `legacy-compatible`：旧 artifact / 旧 JSON fixture / 显式 legacy 摄入。字段可缺省，
 *    缺省即 legacy raw 分类（仅 `{0x0000, 0xFFFD}` 终态，其余负值仍是未证明哨兵）。
 */
export type AiReviewValidationMode = 'current-producer' | 'legacy-compatible'

/** 归一化事件（`type` 内部标签；t = 回放原始时钟秒） */
export type AgentAiEvent =
  | { type: 'spawn'; t: number; eid: number; max_hp: number }
  | {
    type: 'shot'; t: number; shooter_eid: number; target_eid?: number; hit: boolean; ricochet: boolean
    game_hit_result: number; damage: number; is_kill: boolean; is_author: boolean; shell_kind?: string
  }
  /** method1：hp = 钳 0 的显示值；hp_raw = 原始 u16（v0.3.5，终态哨兵族原样）；
   *  v0.3.16 起 cause 未知/其他 = **255 哨兵**（唯一可判定的规范值，此前未知可能
   *  落成任意缺省值；前端击杀流不按 cause 分支，新增按原因映射的消费方须处理 255）；
   *  `hp_state` = 上游权威血量编码分类（additive、恒在场；字段缺省 = 旧产物）。 */
  | { type: 'damage'; t: number; victim_eid: number; hp: number; hp_raw: number; hp_state?: AiHpStateField; source_eid: number; cause: number }
  | { type: 'kill'; t: number; killer_eid: number; victim_eid: number; cause: number; assister_eid?: number }
  | { type: 'visibility'; t_in: number; eid: number; t_out?: number; hp_raw?: number }
  /** prop3（type=7 sub=3）血量属性广播原始值（v0.3.6；录像者自身血量常只走这一路）；
   *  `hp_state` 同 `damage`（上游权威分类；字段缺省 = 旧产物，按 hp_raw 同一规则现算） */
  | { type: 'health'; t: number; eid: number; hp_raw: number; hp_state?: AiHpStateField }
  /** method8 原始通知（v0.3.5；全变体不分类，载荷不足的字段缺省） */
  | {
    type: 'hit_notice'; t: number; eid: number; payload_len: number
    shooter_eid?: number; victim_eid?: number; result?: number; secondary?: number
  }
  | { type: 'counter'; t: number; code: number; count: number; value: number }
  | { type: 'damage_tick'; t: number; eid: number; cumulative: number }

export interface AgentAiBattleHeader {
  start_time: number
  map_id: number
  map_name: string
  room_type: string
  winner: number
  duration_secs: number | null
  meta_duration_secs?: number
  periods: AgentArenaPeriod[]
}

/** 原始世界位姿观测（type=10 未滤波，列式等长；v0.3.7） */
export interface AgentRawPoseTrack {
  eid: number
  t: number[]
  x: number[]
  y: number[]
  z: number[]
  /** 车体偏航 rad（原始域） */
  yaw: number[]
}

/** 原始 prop2 炮塔广播（u16：高 10 位相对偏航 coarse、低 6 位俯仰比例；v0.3.7） */
export interface AgentRawTurretTrack {
  eid: number
  t: number[]
  raw: number[]
}

export interface AgentAiReviewFacet {
  version: 1
  battle: AgentAiBattleHeader
  rosters: AgentAiRosterEntry[]
  events: AgentAiEvent[]
  settlements: unknown[]
  poses: AgentRawPoseTrack[]
  turrets: AgentRawTurretTrack[]
}

/** AiReviewFacet 契约版本（上游 DTO 冻结 v1；同版本只加字段/事件类型） */
export const AI_REVIEW_CONTRACT_VERSION = 1
