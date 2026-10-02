/**
 * WoT-Blitz-Agent 回放数据消费接口（契约 v2：独立能力，无 giant envelope）。
 *
 * 契约 SSOT：`contracts/agent/replay-facets-v2.md`。能力边界（评审裁决）：
 *   Agent Rust Core = 结果解释（BattleResult）+ 时序解释（PlaybackData / AI 事件）
 *   WotBTools = 消费/编排；名人堂（HoF）是 WotBTools 产品域——从 Result 投影，
 *   Agent 公开面不感知（v1 的 HofFacet / `{playback,ai,hof}` 信封已拆除，breaking）。
 *
 * 四条消费路径（全部本地 WASM，文件不出本机；WotBTools Playback 拓扑 client-only）：
 *  1. `parseAgentResultFromBytes`   → BattleResult（毫秒级，不物化 Playback）
 *  2. `parseAgentPlaybackFromBytes` → PlaybackData（时序）
 *  3. `parseAgentShotsFromBytes`    → 全员射击链（射击复现）
 *  4. `projectHoF(result)`          → HoF 提交行（Result 的消费方投影，纯函数）
 * 预解析 JSON 通道（`*FromJson`）用于部署面静态托管的同形状文件。
 *
 * AI 事件数据（AiReviewFacet v1，`parseAiReview`）：本模块只建模与做形状校验；
 * 语义投影在 `replay-local/canonical`（WotbTools canonical facts）——Agent DTO 不是
 * WotbTools 的领域契约。
 *
 * 语义原则：unknown ≠ 0 ≠ false —— 观测缺失一律 undefined/null；
 * 数值零只在该字段语义就是零时出现。本模块不修改上游形状，只做形状校验与装载。
 */

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
  damage_received?: number
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

// ---------- 时序能力：PlaybackData（contract v2：+Supremacy/点数/瞄准帧；版本显式门禁） ----------

export interface AgentPlaybackMeta {
  map_id: number
  map_name: string
  winner_team: number
  friendly_team: number
  author_eid: number
  t_start: number
  samples: number
  duration: number
}

/** 车辆全场时间线（列式网格；含花名册语义：nickname/tank_id/team/is_author） */
export interface AgentVehicleTrack {
  eid: number
  account_id: number
  nickname: string
  tank_id: number
  tank_name: string
  team: number
  is_author: boolean
  max_hp: number
  /** [x,y,z] × samples，0.01m 舍入 */
  pos: number[]
  hull_yaw: number[]
  hull_pitch: number[]
  turret_yaw: number[]
  gun_pitch: number[]
  hp: Array<[number, number]>
  death_t: number | null
  killer_eid: number
  shell_ids: number[]
  turret_index: number | null
  gun_index: number | null
  coverage: number[]
  /**
   * Type5 战斗装载描述符（6 × 14 字节：`[wire, state, ...12 payload]`；前 3 = consumable、
   * 后 3 = provision）。无 0A06/0B09 framing 的车辆缺省。
   */
  loadout_items?: number[][]
  /** Type5 装备 9 字节（equipment id 原值，位置序）；与 loadout_items 同缺省 */
  equipment?: number[]
}

/** Type32 消耗品生命周期（state：1=INITIALIZED 2=ACTIVATED 3=ACTIVE_ENDED_OR_COOLDOWN 255=TEARDOWN） */
export interface AgentConsumableEvent {
  clock: number
  eid: number
  wire_code: number
  state: number
  body_clock: number
  param: number
}

/** method16 模块/乘员状态（recorder-visible telemetry；仅作者车辆） */
export interface AgentModuleCrewState {
  clock: number
  vehicle_eid: number
  state_code: number
  component_code: number
  /** snake_case 组件名（left_track / engine / commander …）；未知为 "unknown" */
  component: string
  /** snake_case 状态（damaged_degraded / critical_disabled / auto_repaired_to_damaged / full_repaired_clear …） */
  state: string
  related_eid: number
}

export interface AgentPlaybackShot {
  t_fire: number
  shooter_eid: number
  target_eid?: number
  from: [number, number, number]
  to: [number, number, number]
  flight_secs: number
  shell_speed: number
  hit: boolean
  ricochet: boolean
  /** 0=无 1=未击穿 2=间隙止 3=有伤害 4=履带/模块 255=未获取 */
  game_hit_result: number
  damage: number
  is_kill: boolean
  is_author: boolean
  shell_kind?: string
  shooter_name?: string
  target_name?: string
}

export interface AgentKillEvent {
  t: number
  killer_eid: number
  victim_eid: number
  /** 0=炮弹 1=火焰 2=撞击 3=世界/环境 5=溺水 */
  cause: number
  assister_eid?: number
  death_reason?: number
}

export interface AgentAoiPresence {
  eid: number
  t_in: number
  t_out?: number
  /**
   * 开段 Type5 物化快照的原始 HP u16（上游 v0.3.5；仅战斗车辆）。每次重入各自携带——
   * 隐藏期间的掉血在重入时兑现。原样未分类：0 / ≥0xFF00 哨兵由消费方按 HpRawState 口径处理。
   */
  hp_raw?: number
}

/** Supremacy 基地状态迁移（上游 v0.2.0 wrapper12/root11 PROVEN；sparse 重建产物） */
export interface AgentSupremacyBaseTransition {
  clock: number
  /** 0..3 = A..D */
  base_id: number
  /**
   * 上游为 `Option<u8>` 且未加 skip_serializing_if —— 空 canonical 态（无主/未占领/
   * 无进度）序列化为**显式 null**，故必须建模为 `number | null`：`undefined` 表示
   * 字段本身缺失（老产物），`null` 表示"该维度为空"。渲染侧不得把 null 当作
   * 有值的 owner/capturer/progress。
   */
  owner_team?: number | null
  capturing_team?: number | null
  capture_progress?: number | null
}

/** Supremacy 实时点数采样（wrapper13/root12；仅真实广播，消费取 ≤t 最后值） */
export interface AgentSupremacyPointsSample {
  clock: number
  team: number
  points: number
}

/**
 * 单基地占领进度迁移（上游 v0.3.1 wrapper8/root8；攻防战/遭遇战共用载体）。
 * 判据为 `field2==1 && field3 存在`（0..100）——**不锁 field1**：真实回放中携带进度的族
 * 会在 field1=1/2 之间切换（Yukon 两族交替、Malinovka 仅 2、遭遇战仅 1）。
 * 不施加单调性：回落/重置原样保留。
 */
export interface AgentAssaultBaseTransition {
  clock: number
  /** 占领进度 0..100 */
  progress: number
}

/** 作者瞄准帧（Type39 投影，recorder-only；缺帧不外推，存活期按 deaths 门控） */
export interface AgentAimFrame {
  time_sec: number
  world_yaw: number
  world_pitch: number
  /** 上游 `[f32; 3]`——定长三元组，非任意长度数组 */
  ray_point: [number, number, number]
}

export interface AgentPlaybackFacet {
  version: number
  meta: AgentPlaybackMeta
  vehicles: AgentVehicleTrack[]
  shots: AgentPlaybackShot[]
  kills: AgentKillEvent[]
  periods: Array<{ clock: number; period: number; remaining_s: number; duration_s: number }>
  visibility: AgentAoiPresence[]
  /** contract v2 新能力（skip-when-empty：非争霸场缺省） */
  supremacy_bases?: AgentSupremacyBaseTransition[]
  supremacy_points?: AgentSupremacyPointsSample[]
  /** 仅作者/recorder；禁止给其他车辆伪造 */
  aim_frames?: AgentAimFrame[]
  /**
   * 单基地目标存在性（上游 v0.3.1）——**独立于是否已有占领进度**。判据为目标族发出
   * 裸初始化对以外的字段：裸初始化对 `1=1,2=1` + `1=2,2=1` 是通用广播，普通对局同样
   * 会发（62 份样本里 8 份 Regular/TrainingRoom/Any 只发这一对），不得据此判定。
   * 缺省/ false = 无已证实的单基地目标。单基地与争霸互斥（wrapper8 vs wrapper12）。
   */
  assault_objective_present?: boolean
  /** 单基地占领进度时间线（skip-when-empty：非单基地场次缺省） */
  assault_bases?: AgentAssaultBaseTransition[]
  /** Type32 消耗品生命周期（全员，AoI 内可见部分） */
  consumables?: AgentConsumableEvent[]
  /** method16 模块/乘员状态（recorder-only） */
  module_crew_states?: AgentModuleCrewState[]
}

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

/** 归一化事件（`type` 内部标签；t = 回放原始时钟秒） */
export type AgentAiEvent =
  | { type: 'spawn'; t: number; eid: number; max_hp: number }
  | {
    type: 'shot'; t: number; shooter_eid: number; target_eid?: number; hit: boolean; ricochet: boolean
    game_hit_result: number; damage: number; is_kill: boolean; is_author: boolean; shell_kind?: string
  }
  /** method1：hp = 钳 0 的显示值；hp_raw = 原始 u16（v0.3.5，终态哨兵族原样） */
  | { type: 'damage'; t: number; victim_eid: number; hp: number; hp_raw: number; source_eid: number; cause: number }
  | { type: 'kill'; t: number; killer_eid: number; victim_eid: number; cause: number; assister_eid?: number }
  | { type: 'visibility'; t_in: number; eid: number; t_out?: number; hp_raw?: number }
  /** prop3（type=7 sub=3）血量属性广播原始值（v0.3.6；录像者自身血量常只走这一路） */
  | { type: 'health'; t: number; eid: number; hp_raw: number }
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

/**
 * AiReviewFacet 形状校验（trust boundary）。除结构外还锁定 canonical 语义**必需**的
 * v0.3.5 证据：`damage.hp_raw`（区分 HP=0 与终态哨兵）。缺失即拒绝——旧产物不得被
 * 静默投影成「哨兵 = 血量 0」的错误事实（fail closed，而不是降级猜测）。
 */
export function validateAgentAiReview(value: unknown): AgentAiReviewFacet {
  const doc = assertObject(value, 'ai_review')
  assertFacetVersion(doc.version, 'ai_review.version', AI_REVIEW_CONTRACT_VERSION)
  const battle = assertObject(doc.battle, 'ai_review.battle')
  assertArray(battle.periods, 'ai_review.battle.periods')
  for (const key of ['rosters', 'events', 'settlements']) assertArray(doc[key], `ai_review.${key}`)
  // 原始位姿是位置证据的唯一来源（回放网格是渲染滤波输出，不是观测）
  for (const key of ['poses', 'turrets']) {
    if (!Array.isArray(doc[key])) throw new Error(`agent facets: ai_review.${key} 缺失（canonical 投影需要上游 ≥ v0.3.7）`)
  }
  for (const e of doc.events as unknown[]) {
    if (!isObject(e) || typeof e.type !== 'string') throw new Error('agent facets: ai_review.events[] 必须是带 type 的对象')
    if (e.type === 'damage' && typeof e.hp_raw !== 'number') {
      throw new Error('agent facets: ai_review damage.hp_raw 缺失（canonical 投影需要上游 ≥ v0.3.7）')
    }
  }
  // prop3 血量广播是录像者血量帧的唯一来源：整场没有任何 health 事件 = 旧产物，拒绝而不是缺帧投影
  const evts = doc.events as Array<Record<string, unknown>>
  if (evts.some((e) => e.type === 'damage') && !evts.some((e) => e.type === 'health')) {
    throw new Error('agent facets: ai_review 缺 health（prop3）事件（canonical 投影需要上游 ≥ v0.3.7）')
  }
  return value as unknown as AgentAiReviewFacet
}

// ---------- 射击复现通道（parseShotReplays；上游 shots 数组同构透传） ----------

/** 全局弹种反解表条目（dump-shell-kinds 产物值形状；tanks.pb 弹种项属性） */
export interface AgentShellData {
  type: string
  penetration: number
  damage: number
  module_damage: number
  explosion_radius: number
}

/** 全局弹种反解表：{全局弹种 id(十进制串): AgentShellData}（与回放 shell_id 同域） */
export type AgentShellTable = Record<string, AgentShellData>

/**
 * 单发射击复现数据（上游 replay-core ShotReplayData；字段语义见上游
 * crates/replay-core/src/replay/combat/shots.rs——本接口只标注消费面，
 * 未知键透传保留：3D 查看器消费弹道/锚点/时间线等全部字段）。
 */
export interface AgentShotReplay {
  index: number
  time_s: number
  damage: number
  target_name: string
  /** 受击方实体 id（作者 = method38 / 他人 = method8，服务器权威）。身份联表用
   * 此字段而非昵称反查——名字缺失/冲突时 target_name 不可作身份（上游 v0.1.9 起直传） */
  target_eid?: number
  is_kill: boolean
  shooter_eid: number
  shooter_name?: string
  is_author?: boolean
  shooter_pos: number[]
  shooter_ang: number[]
  target_pos: number[]
  target_ang: number[]
  target_turret_yaw: number
  shooter_turret_yaw: number
  /** 弹道两点（回放世界系，米）：炮口发射位置 / 弹道终点 */
  ball_a: number[]
  ball_b: number[]
  launch_velocity: number[]
  /** 命中结果位图（0x0008 跳弹 / 0x0010 击穿 / 0x1000 HE 爆炸分支…） */
  hit_flags: number
  shell_id: number
  shell_kind?: string
  shell_slot?: number
  shooter_shell_idx?: number
  /** shooter_shell_idx 所属配置（build_configs 下标；弹表域钉死，多炮坦克不再错位） */
  shooter_shell_cfg_idx?: number
  /**
   * 发射弹种完整数据（shellsJson 注入后由 WASM 反解；dump-shell-kinds 富表条目）。
   * 值为射手配置弹表口径（tanks.pb 弹种项），徽标穿深/判定直接消费。
   */
  shell?: AgentShellData
  armor_group: number
  /** 0=无 1=未击穿 2=间隙止 3=有伤害 4=履带/模块 255=未获取 */
  game_hit_result: number
  target_tank_id?: number
  shooter_tank_id?: number
  target_config_idx?: number
  shooter_config_idx?: number
  shooter_equipment?: number
  target_equipment?: number
  /** 逐发质量标注（降级/陈旧/兜底路径，UI ⚠ 悬停依据） */
  quality?: Record<string, unknown>
  [key: string]: unknown
}

// ---------- 形状校验（trust boundary：进 view model 前的结构契约锁定） ----------

const CONTRACT_VERSION = 1
/** PlaybackData 契约版本（上游 v0.2.0 起 = 2：+supremacy_bases/supremacy_points/aim_frames）。
 *  错版 WASM 在此显式拒绝，不允许被静默解析成半残数据（trust boundary）。 */
export const PLAYBACK_CONTRACT_VERSION = 2

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function assertObject(v: unknown, path: string): Record<string, unknown> {
  if (!isObject(v)) throw new Error(`agent facets: ${path} 必须是对象`)
  return v
}

function assertArray(v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) throw new Error(`agent facets: ${path} 必须是数组`)
  return v
}

/** 切面契约版本锁定（v1 切面字段口径沿用；能力拆分见契约 v2 文档） */
function assertFacetVersion(v: unknown, path: string, expected: number = CONTRACT_VERSION): void {
  if (v !== expected) {
    throw new Error(`agent facets: ${path} = ${String(v)}，不支持的契约版本（期望 ${expected}）`)
  }
}

/**
 * BattleResult 形状校验：花名册齐备 + 身份键在册。
 * 轻校验（DTO 冻结、字段全透传；时序键出现视为非法形状——结果能力不得物化时序）。
 */
export function validateAgentBattleResult(value: unknown): AgentBattleResult {
  const r = assertObject(value, 'result')
  assertArray(r.players, 'result.players')
  if (typeof r.author_account_id !== 'number') throw new Error('agent facets: result.author_account_id 必须是数值')
  for (const key of ['vehicles', 'shots', 'kills', 'periods', 'visibility']) {
    if (key in r) throw new Error(`agent facets: 结果能力不得物化时序键 ${key}`)
  }
  return value as unknown as AgentBattleResult
}

/**
 * PlaybackData 形状校验：version === PLAYBACK_CONTRACT_VERSION(2)、meta、必备数组 + v2 新键。
 * 未知键忽略 = 契约的同版本加字段策略；字段级取值语义由类型承载。
 */
export function validateAgentPlayback(value: unknown): AgentPlaybackFacet {
  const pb = assertObject(value, 'playback')
  assertFacetVersion(pb.version, 'playback.version', PLAYBACK_CONTRACT_VERSION)
  assertObject(pb.meta, 'playback.meta')
  for (const key of ['vehicles', 'shots', 'kills', 'periods', 'visibility']) {
    assertArray(pb[key], `playback.${key}`)
  }
  // contract v2 新能力（上游 v0.2.0 / v0.3.1；skip-when-empty 语义）：在场时必须为数组
  for (const key of ['supremacy_bases', 'supremacy_points', 'aim_frames', 'assault_bases']) {
    if (pb[key] !== undefined) assertArray(pb[key], `playback.${key}`)
  }
  // 目标存在性必须是布尔（跳空键按"无已证实目标"解读，与 assaultObjectivePresent 同义）
  if (pb.assault_objective_present !== undefined && typeof pb.assault_objective_present !== 'boolean') {
    throw new Error('agent facets: playback.assault_objective_present 必须是布尔')
  }
  return value as unknown as AgentPlaybackFacet
}

// ---------- WASM 装载（本地通道；build-time 固定产物，运行时不选择版本） ----------

/**
 * build-time 固定的本地产物路径：WotBTools CI 依据 `deploy/agent/source.json`
 * 锁定的上游 Release 产物（sha256 校验）打包进前端 release。运行时不选择
 * upstream artifact——版本决策发生在 build/release 边界（可复现构建）。
 */
const AGENT_WASM_URL = '/wasm/wotb_replay_wasm.js'

interface AgentWasmModule {
  /** tankNamesJson 可选：`{tank_id: name}` 车型名表（上游 v0.3.1 起） */
  parseResult?: (bytes: Uint8Array, tankNames?: string) => string
  parsePlayback?: (bytes: Uint8Array, tankNames?: string) => string
  parseShotReplays?: (bytes: Uint8Array, limits?: string, shells?: string) => string
  /** 第 4 入口（上游 v0.3.1）：AiReviewFacet JSON（花名册 + 事件流 + 结算锚点） */
  parseAiReview?: (bytes: Uint8Array) => string
  default?: () => Promise<void>
  initSync?: () => void
}

let wasmPromise: Promise<AgentWasmModule> | null = null

/**
 * 惰性装载 wasm-bindgen 产物（web target：default() 异步初始化）。
 * 保证：单次初始化、并发调用共享 Promise、失败清空缓存可重试。
 */
export function loadAgentWasm(): Promise<AgentWasmModule> {
  if (!wasmPromise) {
    wasmPromise = (async () => {
      // 运行时 URL：常量形式 + @vite-ignore 避免 bundler 构建期解析
      const mod = (await import(/* @vite-ignore */ AGENT_WASM_URL)) as AgentWasmModule
      if (mod.default) await mod.default()
      return mod
    })()
    wasmPromise.catch(() => {
      wasmPromise = null // 失败可重试
    })
  }
  return wasmPromise
}

async function wasmFn<K extends keyof AgentWasmModule>(name: K): Promise<Exclude<AgentWasmModule[K], undefined>> {
  const mod = await loadAgentWasm()
  const fn = mod[name]
  if (typeof fn !== 'function') {
    throw new Error(`agent wasm: ${String(name)} 缺失（产物版本不匹配契约 v2）`)
  }
  return fn as Exclude<AgentWasmModule[K], undefined>
}

/** 已装载 WASM 产物的来源（`/wasm/fingerprint.json`，与产物同包发布；不可读 → null） */
export interface AgentWasmFingerprint { tag: string; upstream_commit: string }

let fingerprintPromise: Promise<AgentWasmFingerprint | null> | null = null

export function loadAgentWasmFingerprint(): Promise<AgentWasmFingerprint | null> {
  if (!fingerprintPromise) {
    fingerprintPromise = fetch('/wasm/fingerprint.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => (j && typeof j.tag === 'string' && typeof j.upstream_commit === 'string' ? j as AgentWasmFingerprint : null))
      .catch(() => null)
  }
  return fingerprintPromise
}

// ---------- 本地通道：bytes → WASM → 校验过的能力数据 ----------

/** 结果能力（毫秒级）：.wotbreplay 字节 → BattleResult。文件不出本机。 */
export async function parseAgentResultFromBytes(bytes: Uint8Array): Promise<AgentBattleResult> {
  const parse = await wasmFn('parseResult')
  return validateAgentBattleResult(JSON.parse(parse(bytes)) as unknown)
}

/**
 * 车型名表注入参数（可选）：`{tank_id: name}` JSON 串。注入后 `tank_name` 为真实车型名；
 * 不注入时 `tank_name` 为 `tank_{id}`（**不是空串**——上游 v0.3.1 起文档与实现统一）。
 */
export function tankNamesJson(table: Record<number, string>): string {
  return JSON.stringify(table)
}

/** 时序能力：.wotbreplay 字节 → PlaybackData。文件不出本机。 */
export async function parseAgentPlaybackFromBytes(
  bytes: Uint8Array, tankNames?: string,
): Promise<AgentPlaybackFacet> {
  const parse = await wasmFn('parsePlayback')
  return validateAgentPlayback(JSON.parse(parse(bytes, tankNames)) as unknown)
}

/** AI 事件数据（第 4 入口）：.wotbreplay 字节 → 校验过的 AiReviewFacet。文件不出本机。 */
export async function parseAgentAiReviewFromBytes(bytes: Uint8Array): Promise<AgentAiReviewFacet> {
  const parse = await wasmFn('parseAiReview')
  return validateAgentAiReview(JSON.parse(parse(bytes)) as unknown)
}

function assertShotArray(v: unknown): AgentShotReplay[] {
  if (!Array.isArray(v)) throw new Error('agent shots: 顶层必须是 shots 数组')
  for (const s of v) {
    if (!isObject(s) || typeof s.index !== 'number') {
      throw new Error('agent shots: 每发必须是有数值 index 的对象')
    }
  }
  return v as AgentShotReplay[]
}

// ---------- 射击复现包装契约（上游 v0.1.9：fail-visible，不再静默吞作者链） ----------

/** 他人宽松路径统计（fail-soft 边界透明化；字段语义见上游 OtherShotsExtraction） */
export interface AgentShotsOthersStats {
  total_launches: number
  skipped_no_endpoint: number
  skipped_no_target_state: number
  muzzle_fallback: number
}

/** parseShotReplays 输出（上游 v0.1.9 契约；旧裸数组产物归一化进同一形状） */
export interface AgentShotsOutcome {
  shots: AgentShotReplay[]
  /** 作者严格路径状态："error" 时 shots 仅含他人宽松路径，author_error 携带原因 */
  author_path: 'ok' | 'error'
  /** strict 失败链式原因（仅 author_path="error" 时存在） */
  author_error?: string
  /** 作者 Avatar 实体 eid（0 = 未解析；旧裸数组产物不可知 → 0） */
  author_eid: number
  /** 他人宽松路径跳过/兜底统计（旧产物不可知 → 全 0） */
  others: AgentShotsOthersStats
}

const ZERO_OTHERS: AgentShotsOthersStats = {
  total_launches: 0,
  skipped_no_endpoint: 0,
  skipped_no_target_state: 0,
  muzzle_fallback: 0,
}

/**
 * 包装/裸数组双形状归一化（trust boundary）：v0.1.9 起上游输出
 * `{shots, author_path, author_error?, author_eid, others}`——对象形状的
 * `author_path` 只接受 "ok" | "error"（缺失或其他值 throw，drift 显形）；
 * 旧产物为裸数组（author 状态不可知 → ok/eid=0/others 全 0，消费面按缺数据处理）。
 */
export function normalizeAgentShotsOutcome(v: unknown): AgentShotsOutcome {
  if (Array.isArray(v)) {
    return { shots: assertShotArray(v), author_path: 'ok', author_eid: 0, others: { ...ZERO_OTHERS } }
  }
  if (!isObject(v) || !Array.isArray(v.shots)) {
    throw new Error('agent shots: 顶层必须是 shots 数组或 {shots, ...} 包装对象')
  }
  // trust boundary 严格化：author_path 只收 "ok" | "error"（缺失/其他值一律 throw）——
  // schema drift / 错版 WASM 不允许被静默伪装成正常解析
  if (v.author_path !== 'ok' && v.author_path !== 'error') {
    throw new Error('agent shots: author_path 必须是 "ok" | "error"')
  }
  const authorPath = v.author_path
  if (authorPath === 'error' && typeof v.author_error !== 'string') {
    throw new Error('agent shots: author_path="error" 必须携带 author_error')
  }
  const o = (isObject(v.others) ? v.others : {}) as Record<string, unknown>
  const num = (x: unknown) => (typeof x === 'number' && x >= 0 ? x : 0)
  return {
    shots: assertShotArray(v.shots),
    author_path: authorPath,
    ...(authorPath === 'error' ? { author_error: v.author_error as string } : {}),
    author_eid: typeof v.author_eid === 'number' ? v.author_eid : 0,
    others: {
      total_launches: num(o.total_launches),
      skipped_no_endpoint: num(o.skipped_no_endpoint),
      skipped_no_target_state: num(o.skipped_no_target_state),
      muzzle_fallback: num(o.muzzle_fallback),
    },
  }
}

/**
 * 命中判定（唯一权威 = `target_eid` 在案）。上游 v0.1.9 起 Playback/AI 切面与
 * 逐发数据统一 `hit: target_eid.is_some()`（method38/method8 服务器权威）；消费端
 * 一律走本函数，不再按 is_author 分叉 hit_flags/昵称启发式——author 的
 * `target_eid=Some 且 hit_flags=0` 是合法在案命中，按旧法会误判 miss 并污染
 * hitRate/penRate 分母。breaking：旧产物（无 target_eid）一律按未命中——
 * 3D 尚在 feature flag，允许 breaking，不保留双语义。
 */
export function isShotHit(s: Pick<AgentShotReplay, 'target_eid'>): boolean {
  return s.target_eid != null
}

/**
 * 射击链花名册富化（消费端编排；上游服务端 /api/replay/shots 注入字段的客户端等价）：
 * - target_tank_id / shooter_tank_id：受击方/射手实体 → tank_id；
 * - shooter_team：'ally' / 'enemy'（相对回放作者阵营）。
 * 联表键 = **eid**（vehicles[].eid ↔ shot.shooter_eid/target_eid）——eid 是
 * 身份域主键；此前按昵称联表，名称冲突取首匹配、名字缺失（如受击方昵称损坏）
 * 即断链，均已在上游 v0.1.9 eid 直传后消除。昵称仅作显示。
 */
export function enrichShotsFromRoster(parsedShots: AgentShotReplay[], vehicles: Array<{ eid: number; nickname?: string; team?: number; tank_id?: number; is_author?: boolean }>): void {
  const byEid = new Map<number, { team?: number; tank_id?: number }>()
  for (const r of vehicles || []) {
    if (r && typeof r.eid === 'number') byEid.set(r.eid, r)
  }
  // 阵营分类只接受显式 1/2（与名册分组同一规则）：team=0/未知绝不归入任一队——
  // unknown 车辆常带 tank_id=0 恰好被富化外层挡住，但非零 tank_id 的 unknown
  // 一旦走 `team !== authorTeam → enemy` 就会把白色未知染成敌方红（3D 炮线）
  const authorTeamRaw = (vehicles || []).find((r) => r.is_author)?.team
  const authorTeam = authorTeamRaw === 1 || authorTeamRaw === 2 ? authorTeamRaw : undefined
  const knownSide = (t?: number): t is 1 | 2 => t === 1 || t === 2
  for (const s of parsedShots) {
    const target = s.target_eid != null ? byEid.get(s.target_eid) : undefined
    if (target?.tank_id) s.target_tank_id = target.tank_id
    const shooterEntry = byEid.get(s.shooter_eid)
    if (shooterEntry?.tank_id) {
      s.shooter_tank_id = shooterEntry.tank_id
    }
    // 阵营分类独立于车型富化：车型识别失败（tank_id=0）≠ 阵营未知——
    // 已知敌方只是缺车型时，仍必须正确分类为 enemy（评审 blocker 回归点）
    if (authorTeam != null && knownSide(shooterEntry?.team)) {
      s.shooter_team = shooterEntry.team === authorTeam ? 'ally' : 'enemy'
    }
  }
}

/**
 * 全局重编号（上游 Web /api/replay/shots 同规则，src/web/mod.rs：
 * `all_shots.sort_by(time_s)` + `s.index = i + 1`）。WASM parseShotReplays 的
 * 作者严格 + 他人宽松两路各自持局部 index（上游 shots.rs:1581 注明"合并后由
 * 调用方按 time_s 全局重编号"），消费方必须收敛，否则 shot= 查错弹。
 */
export function normalizeAgentShotIndices(shots: AgentShotReplay[]): AgentShotReplay[] {
  const sorted = shots.slice().sort((a, b) => {
    const ta = a.time_s ?? a.fire_time ?? 0
    const tb = b.time_s ?? b.fire_time ?? 0
    return ta - tb
  })
  sorted.forEach((s, i) => {
    s.index = i + 1
  })
  return sorted
}

/**
 * 射击复现能力：.wotbreplay 字节 → 全员射击链（time_s 排序 + 全局重编号）。
 * `pitchLimits` 可选：俯仰锚定表 {昵称: {dep, ele, front?, back?, transition?}}
 * （GunPitchRange serde 形状，消费方由资产面 tank/{id}.json 的 pitch_limits 组装
 * dep=max、ele=−min）——注入后 prop2 俯仰按车型极限解码（服务端同级质量）；
 * 缺省空表时俯仰降级标记如实透传（客户端路径数据边界，非错误）。
 * `shellTable` 可选：全局弹种反解表（dump-shell-kinds 富表，AgentShellTable）——
 * 注入后带 shell_id 的弹补齐 `shell_kind` 与 `shell`（完整弹数据，服务端
 * /api/replay/shots 注入语义同构）；缺省时无弹种反解（旧产物兼容路径由
 * 消费组件自行富化）。
 */
/**
 * 射击复现能力：.wotbreplay 字节 → 射击链包装（time_s 排序 + 全局重编号）。
 * 输出形状见 [`AgentShotsOutcome`]（上游 v0.1.9：author_path fail-visible；
 * 旧裸数组产物自动归一化）。
 * `pitchLimits` 可选：俯仰锚定表 {昵称: {dep, ele, front?, back?, transition?}}
 * （GunPitchRange serde 形状，消费方由资产面 tank/{id}.json 的 pitch_limits 组装
 * dep=max、ele=−min）——注入后 prop2 俯仰按车型极限解码（服务端同级质量）；
 * 缺省空表时俯仰降级标记如实透传（客户端路径数据边界，非错误）。
 * `shellTable` 可选：全局弹种反解表（dump-shell-kinds 富表，AgentShellTable）——
 * 注入后带 shell_id 的弹补齐 `shell_kind` 与 `shell`（完整弹数据，服务端
 * /api/replay/shots 注入语义同构）；缺省时无弹种反解（旧产物兼容路径由
 * 消费组件自行富化）。
 */
export async function parseAgentShotsFromBytes(
  bytes: Uint8Array,
  pitchLimits?: Record<string, unknown>,
  shellTable?: AgentShellTable,
): Promise<AgentShotsOutcome> {
  const parse = await wasmFn('parseShotReplays')
  const limitsJson = pitchLimits ? JSON.stringify(pitchLimits) : undefined
  const shellsJson = shellTable ? JSON.stringify(shellTable) : undefined
  const raw = parse(bytes, limitsJson, shellsJson)
  const outcome = normalizeAgentShotsOutcome(JSON.parse(raw) as unknown)
  outcome.shots = normalizeAgentShotIndices(outcome.shots)
  return outcome
}

/** 预解析 JSON 通道（部署面静态文件/服务端代理共用） */
export function parseAgentResultFromJson(json: string | unknown): AgentBattleResult {
  const value = typeof json === 'string' ? (JSON.parse(json) as unknown) : json
  return validateAgentBattleResult(value)
}

/** 预解析 JSON 通道（部署面静态文件/服务端代理共用） */
export function parseAgentPlaybackFromJson(json: string | unknown): AgentPlaybackFacet {
  const value = typeof json === 'string' ? (JSON.parse(json) as unknown) : json
  return validateAgentPlayback(value)
}

// ---------- HoF 投影（WotBTools 产品域；上游不再提供 HofFacet） ----------

/** HoF 单场提交行（原上游 HofFacet 投影语义；字段缺失按 undefined 透传） */
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
    /** 结算口径整秒时长；上游 root5 未解码恒 null（宁缺勿冒充） */
    duration_secs: null
  }
  entries: HoFEntry[]
}

/**
 * HoF 提交 = BattleResult 的纯投影（上游 HofFacet.from_settlement 同一映射，
 * 职责移入消费方——评审 P0-1：Agent 不感知 WotBTools 的 HoF 产品域）。
 * 纯函数，不触碰时序数据；提交仍可携带 original .wotbreplay（Business API 侧
 * replay 是 evidence/storage，不做 server-side replay verification）。
 */
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
