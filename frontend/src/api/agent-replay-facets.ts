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
 * AI 事件数据（AiReviewFacet）保持 Agent 服务端/CLI 能力（DTO 冻结 v1），
 * 不在 WASM 浏览器面——本模块不再建模。
 *
 * 语义原则：unknown ≠ 0 ≠ false —— 观测缺失一律 undefined/null；
 * 数值零只在该字段语义就是零时出现。本模块不修改上游形状，只做形状校验与装载。
 */

import { reportClientFailure } from './client-events.js'

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
  [key: string]: unknown
}

/** 结果能力 DTO：BattleSummary（花名册/胜负/地图/全员统计；无任何时序物化） */
export interface AgentBattleResult {
  file_name: string
  timestamp: number
  datetime: string
  room_type: string
  map_id: number
  map_name: string
  battle_duration_secs: number
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

// ---------- 时序能力：PlaybackData（与 v1 回放切面同形状，version 锁定不变） ----------

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
}

export interface AgentPlaybackFacet {
  version: number
  meta: AgentPlaybackMeta
  vehicles: AgentVehicleTrack[]
  shots: AgentPlaybackShot[]
  kills: AgentKillEvent[]
  periods: Array<{ clock: number; period: number; remaining_s: number; duration_s: number }>
  visibility: AgentAoiPresence[]
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
function assertFacetVersion(v: unknown, path: string): void {
  if (v !== CONTRACT_VERSION) {
    throw new Error(`agent facets: ${path} = ${String(v)}，不支持的契约版本（期望 ${CONTRACT_VERSION}）`)
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
 * PlaybackData 形状校验：version === 1、meta、vehicles/shots/kills/periods/visibility 数组。
 * 未知键忽略 = 契约的同版本加字段策略；字段级取值语义由类型承载。
 */
export function validateAgentPlayback(value: unknown): AgentPlaybackFacet {
  const pb = assertObject(value, 'playback')
  assertFacetVersion(pb.version, 'playback.version')
  assertObject(pb.meta, 'playback.meta')
  for (const key of ['vehicles', 'shots', 'kills', 'periods', 'visibility']) {
    assertArray(pb[key], `playback.${key}`)
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
  parseResult?: (bytes: Uint8Array) => string
  parsePlayback?: (bytes: Uint8Array) => string
  parseShotReplays?: (bytes: Uint8Array, limits?: string, shells?: string) => string
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
      reportClientFailure('client.wasm_load_failed', 'CLIENT_WASM_LOAD_FAILED')
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

// ---------- 本地通道：bytes → WASM → 校验过的能力数据 ----------

/** 结果能力（毫秒级）：.wotbreplay 字节 → BattleResult。文件不出本机。 */
export async function parseAgentResultFromBytes(bytes: Uint8Array): Promise<AgentBattleResult> {
  const parse = await wasmFn('parseResult')
  return validateAgentBattleResult(JSON.parse(parse(bytes)) as unknown)
}

/** 时序能力：.wotbreplay 字节 → PlaybackData。文件不出本机。 */
export async function parseAgentPlaybackFromBytes(bytes: Uint8Array): Promise<AgentPlaybackFacet> {
  const parse = await wasmFn('parsePlayback')
  return validateAgentPlayback(JSON.parse(parse(bytes)) as unknown)
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
export async function parseAgentShotsFromBytes(
  bytes: Uint8Array,
  pitchLimits?: Record<string, unknown>,
  shellTable?: AgentShellTable,
): Promise<AgentShotReplay[]> {
  const parse = await wasmFn('parseShotReplays')
  const limitsJson = pitchLimits ? JSON.stringify(pitchLimits) : undefined
  const shellsJson = shellTable ? JSON.stringify(shellTable) : undefined
  const raw = parse(bytes, limitsJson, shellsJson)
  return normalizeAgentShotIndices(assertShotArray(JSON.parse(raw) as unknown))
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
