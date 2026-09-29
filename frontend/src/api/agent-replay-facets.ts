/**
 * WoT-Blitz-Agent 回放数据切面（replay facets）消费接口。
 *
 * 契约 SSOT：`contracts/agent/replay-facets-v1.md`（v1；同版本只加字段，
 * 消费方忽略未知键；不兼容变更递增顶层 `version`）。
 * 生产方：fanypcd/WoT-Blitz-Agent（MIT）。
 *
 * 三条消费路径：
 *  1. 本地 WASM：`parseAgentFacetsFromBytes(bytes)` —— 浏览器文件 → wotb-replay-wasm
 *     → 信封 JSON，文件不出本机（wasm 产物由上游 Release 或
 *     `cargo build -p wotb-replay-wasm --target wasm32-unknown-unknown` + wasm-bindgen 生成）；
 *  2. 预解析 JSON：部署面静态托管的三切面文件（同信封形状）；
 *  3. 未来服务端代理（独立上游契约，不在 `contracts/http/openapi.yaml` SSOT 约束内）。
 *
 * 语义原则（契约 §1）：unknown ≠ 0 ≠ false —— 观测缺失一律 undefined/null；
 * 数值零只在该字段语义就是零时出现。本模块不修改上游形状，只做形状校验与装载。
 */

// ---------- 契约 v1 类型（按 contracts/agent/replay-facets-v1.md §2） ----------

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

/** 车辆全场时间线（列式网格；字段语义见契约 §2.1） */
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

/** 评审切面事件（`type` 内部标签；契约 §2.2） */
export type AgentAiEvent =
  | { type: 'spawn'; t: number; eid: number; max_hp: number }
  | {
      type: 'shot'
      t: number
      shooter_eid: number
      target_eid?: number
      hit: boolean
      ricochet: boolean
      game_hit_result: number
      damage: number
      is_kill: boolean
      is_author: boolean
      shell_kind?: string
    }
  | { type: 'damage'; t: number; victim_eid: number; hp: number; source_eid: number; cause: number }
  | {
      type: 'kill'
      t: number
      killer_eid: number
      victim_eid: number
      cause: number
      assister_eid?: number
    }
  | { type: 'visibility'; t_in: number; eid: number; t_out?: number }
  /** 作者战斗反馈计数：code 1=累计伤害 2=点亮 3=击杀 5=挡伤 15=毁灭协助 17=总助攻 */
  | { type: 'counter'; t: number; code: number; count: number; value: number }
  | { type: 'damage_tick'; t: number; eid: number; cumulative: number }

export interface AgentRosterEntry {
  eid: number
  account_id?: number
  nickname?: string
  team?: number
  tank_id?: number
  tank_name: string
  is_author: boolean
}

export interface AgentAiReviewFacet {
  version: number
  battle: {
    start_time: number
    map_id: number
    map_name: string
    room_type: string
    winner: number
    /** 结算口径；未知 = null（绝不 0/0.0），meta 口径单列 meta_duration_secs */
    duration_secs: number | null
    meta_duration_secs?: number
    periods: Array<{ clock: number; period: number; remaining_s: number; duration_s: number }>
  }
  rosters: AgentRosterEntry[]
  events: AgentAiEvent[]
  settlements: Array<Record<string, unknown>>
}

export interface AgentHofFacet {
  version: number
  battle: {
    start_time: number
    map_id: number
    map_name: string
    room_type: string
    winner: number
    duration_secs: number | null
  }
  entries: Array<{
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
  }>
}

export interface AgentFacetEnvelope {
  playback: AgentPlaybackFacet
  ai: AgentAiReviewFacet
  hof: AgentHofFacet
}

// ---------- 形状校验 ----------

const CONTRACT_VERSION = 1

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function assertObject(v: unknown, path: string): Record<string, unknown> {
  if (!isObject(v)) throw new Error(`agent facets: ${path} 必须是对象`)
  return v
}

/**
 * 信封形状校验（fail-fast；未知键忽略 = 契约的同版本加字段策略）。
 * 只锁结构性不变量（version/三切面/数组/花名册可联表），字段级语义由类型承载。
 */
export function validateAgentFacetEnvelope(value: unknown): AgentFacetEnvelope {
  const env = assertObject(value, 'envelope')
  if (env.version !== CONTRACT_VERSION) {
    throw new Error(`agent facets: 不支持的契约版本 ${String(env.version)}（期望 ${CONTRACT_VERSION}）`)
  }
  for (const key of ['playback', 'ai', 'hof']) {
    if (!(key in env)) throw new Error(`agent facets: 缺 ${key} 切面`)
  }

  const playback = assertObject(env.playback, 'playback')
  assertObject(playback.meta, 'playback.meta')
  if (!Array.isArray(playback.vehicles)) throw new Error('agent facets: playback.vehicles 必须是数组')

  const ai = assertObject(env.ai, 'ai')
  if (!Array.isArray(ai.rosters)) throw new Error('agent facets: ai.rosters 必须是数组')
  if (!Array.isArray(ai.events)) throw new Error('agent facets: ai.events 必须是数组')
  // 可见性事件必须可联表（契约 §2.2：裸 EID 不泄漏）
  const rosterEids = new Set<number>((ai.rosters as Array<Record<string, unknown>>).map((r) => r.eid as number))
  for (const e of ai.events as Array<Record<string, unknown>>) {
    if (e.type === 'visibility' && !rosterEids.has(e.eid as number)) {
      throw new Error(`agent facets: visibility eid ${e.eid} 不在花名册`)
    }
  }

  const hof = assertObject(env.hof, 'hof')
  if (!Array.isArray(hof.entries)) throw new Error('agent facets: hof.entries 必须是数组')

  return value as unknown as AgentFacetEnvelope
}

// ---------- WASM 装载（本地通道） ----------

export interface AgentWasmOptions {
  /** wasm-bindgen 产物 JS 入口；默认 `/wasm/wotb_replay_wasm.js`（产物不入库，由上游 Release 或构建脚本提供） */
  wasmUrl?: string
}

interface AgentWasmModule {
  parseReplayFacets(bytes: Uint8Array): string
  default?: () => Promise<void>
  initSync?: () => void
}

let wasmPromise: Promise<AgentWasmModule> | null = null

/** 惰性装载 wasm-bindgen 产物（web target：default() 异步初始化；幂等） */
export function loadAgentWasm(options: AgentWasmOptions = {}): Promise<AgentWasmModule> {
  if (!wasmPromise) {
    const url = options.wasmUrl ?? '/wasm/wotb_replay_wasm.js'
    wasmPromise = (async () => {
      // 运行时 URL：变量形式避免 bundler 构建期解析
      const spec = url
      const mod = (await import(/* @vite-ignore */ spec)) as AgentWasmModule
      if (mod.default) await mod.default()
      if (typeof mod.parseReplayFacets !== 'function') {
        throw new Error('agent wasm: parseReplayFacets 缺失（产物版本不匹配）')
      }
      return mod
    })()
    wasmPromise.catch(() => {
      wasmPromise = null // 失败可重试
    })
  }
  return wasmPromise
}

/**
 * 本地通道：.wotbreplay 字节 → WASM 解析 → 校验过的三切面信封。
 * 文件不出本机（契约 §6 纯客户端）。
 */
export async function parseAgentFacetsFromBytes(
  bytes: Uint8Array,
  options: AgentWasmOptions = {},
): Promise<AgentFacetEnvelope> {
  const mod = await loadAgentWasm(options)
  const env = JSON.parse(mod.parseReplayFacets(bytes)) as unknown
  return validateAgentFacetEnvelope(env)
}

/** 预解析 JSON 通道（部署面静态文件/服务端代理共用） */
export function parseAgentFacetsFromJson(json: string | unknown): AgentFacetEnvelope {
  const value = typeof json === 'string' ? (JSON.parse(json) as unknown) : json
  return validateAgentFacetEnvelope(value)
}
