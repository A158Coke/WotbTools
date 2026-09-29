/**
 * WoT-Blitz-Agent 回放数据切面（replay facets）消费接口。
 *
 * 契约 SSOT：`contracts/agent/replay-facets-v1.md`（v1；同版本只加字段，
 * 消费方忽略未知键；不兼容变更递增顶层 `version`）。
 * 生产方：fanypcd/WoT-Blitz-Agent（MIT）。
 *
 * 三条消费路径：
 *  1. 本地 WASM：`parseAgentFacetsFromBytes(bytes)` —— 浏览器文件 → wotb-replay-wasm
 *     → 信封 JSON，文件不出本机；
 *  2. 预解析 JSON：部署面静态托管的三切面文件（同信封形状）；
 *  3. 未来服务端代理（独立上游契约，不在 `contracts/http/openapi.yaml` SSOT 约束内）。
 *
 * WASM 归属（评审结论）：Agent 仓库是 external read-only upstream dependency——
 * WotBTools CI 读取 `deploy/agent/source.json` 锁定的完整上游 commit SHA，
 * 自行 checkout 构建 wasm-bindgen 产物并打包进前端 release。**运行时不选择
 * upstream artifact**：本模块装载 build-time 固定的 `/wasm/` 本地产物，
 * 不暴露 wasmUrl 之类的运行时选择。
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
  /** 作者战斗反馈计数：code 低字节=基类型（1=累计伤害 2=点亮 3=击杀 5=挡伤 15=毁灭协助 17=总助攻），高字节=同类型内序号（上游 v0.1.6 复合编码修正） */
  | { type: 'counter'; t: number; code: number; seq: number; count: number; value: number }
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

// ---------- 形状校验（trust boundary：完整结构契约锁定） ----------

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

/** 切面/信封契约版本锁定（v1；不兼容变更递增，消费方 fail-fast） */
function assertContractVersion(v: unknown, path: string): void {
  if (v !== CONTRACT_VERSION) {
    throw new Error(`agent facets: ${path} = ${String(v)}，不支持的契约版本（期望 ${CONTRACT_VERSION}）`)
  }
}

/**
 * 信封形状校验（trust boundary：进 view model 前的完整结构契约锁定）。
 *
 * 锁定面（缺一即抛，杜绝"伪装成校验的 unsafe cast"）：
 * - playback/ai/hof 三切面各顶层 version === 1（契约 §1："三个切面顶层均带
 *   version: 1"；上游 envelope_json 组装的信封 `{playback,ai,hof}` 自身无版本键——
 *   版本语义在切面层，消费方对信封未知键忽略）
 * - playback：meta、vehicles/shots/kills/periods/visibility 数组
 * - ai：battle、rosters/events/settlements 数组
 * - hof：battle、entries 数组
 * 语义不变量：visibility.eid ∈ rosters[].eid（裸 EID 不泄漏）。
 * 未知键忽略 = 契约的同版本加字段策略；字段级取值语义由类型承载。
 */
export function validateAgentFacetEnvelope(value: unknown): AgentFacetEnvelope {
  const env = assertObject(value, 'envelope')

  const playback = assertObject(env.playback, 'playback')
  assertContractVersion(playback.version, 'playback.version')
  assertObject(playback.meta, 'playback.meta')
  for (const key of ['vehicles', 'shots', 'kills', 'periods', 'visibility']) {
    assertArray(playback[key], `playback.${key}`)
  }

  const ai = assertObject(env.ai, 'ai')
  assertContractVersion(ai.version, 'ai.version')
  assertObject(ai.battle, 'ai.battle')
  assertArray(ai.rosters, 'ai.rosters')
  const events = assertArray(ai.events, 'ai.events')
  assertArray(ai.settlements, 'ai.settlements')

  const hof = assertObject(env.hof, 'hof')
  assertContractVersion(hof.version, 'hof.version')
  assertObject(hof.battle, 'hof.battle')
  assertArray(hof.entries, 'hof.entries')

  // 语义不变量：可见性事件必须可联表（契约 §2.2：裸 EID 不泄漏）
  const rosterEids = new Set<number>((ai.rosters as Array<Record<string, unknown>>).map((r) => r.eid as number))
  for (const e of events as Array<Record<string, unknown>>) {
    if (isObject(e) && e.type === 'visibility' && !rosterEids.has(e.eid as number)) {
      throw new Error(`agent facets: visibility eid ${String(e.eid)} 不在花名册`)
    }
  }

  return value as unknown as AgentFacetEnvelope
}

// ---------- WASM 装载（本地通道） ----------

/**
 * build-time 固定的本地产物路径：WotBTools CI 依据 `deploy/agent/source.json`
 * 锁定的上游 SHA 构建 wasm-bindgen 产物并打包进前端 release。运行时不选择
 * upstream artifact——版本决策发生在 build/release 边界（可复现构建）。
 */
const AGENT_WASM_URL = '/wasm/wotb_replay_wasm.js'

interface AgentWasmModule {
  parseReplayFacets(bytes: Uint8Array): string
  default?: () => Promise<void>
  initSync?: () => void
}

let wasmPromise: Promise<AgentWasmModule> | null = null

/**
 * 惰性装载 wasm-bindgen 产物（web target：default() 异步初始化）。
 * 保证：单次初始化、并发调用共享 Promise、失败清空缓存可重试、产物形状校验。
 * 不提供运行时版本选择——版本由 WotBTools CI 在构建时决定。
 */
export function loadAgentWasm(): Promise<AgentWasmModule> {
  if (!wasmPromise) {
    wasmPromise = (async () => {
      // 运行时 URL：常量形式 + @vite-ignore 避免 bundler 构建期解析
      const mod = (await import(/* @vite-ignore */ AGENT_WASM_URL)) as AgentWasmModule
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
export async function parseAgentFacetsFromBytes(bytes: Uint8Array): Promise<AgentFacetEnvelope> {
  const mod = await loadAgentWasm()
  const env = JSON.parse(mod.parseReplayFacets(bytes)) as unknown
  return validateAgentFacetEnvelope(env)
}

/** 预解析 JSON 通道（部署面静态文件/服务端代理共用） */
export function parseAgentFacetsFromJson(json: string | unknown): AgentFacetEnvelope {
  const value = typeof json === 'string' ? (JSON.parse(json) as unknown) : json
  return validateAgentFacetEnvelope(value)
}

// ---------- 射击复现通道（parseShotReplays；上游 shots 数组同构透传） ----------

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
 * 本地通道：.wotbreplay 字节 → WASM parseShotReplays → 全员射击链数组
 * （time_s 排序 + 全局重编号，与 /api/replay/shots 响应同构：
 * 作者严格路径 + 他人宽松路径合并，含弹道/命中判定/逐发质量标记/双方渲染锚点）；
 * 文件不出本机（契约 §6）。
 */
export async function parseAgentShotsFromBytes(bytes: Uint8Array): Promise<AgentShotReplay[]> {
  const mod = await loadAgentWasm()
  const modWithShots = mod as AgentWasmModule & { parseShotReplays?: (b: Uint8Array) => string }
  if (typeof modWithShots.parseShotReplays !== 'function') {
    throw new Error('agent wasm: parseShotReplays 缺失（产物版本早于 v0.1.6）')
  }
  return normalizeAgentShotIndices(assertShotArray(JSON.parse(modWithShots.parseShotReplays(bytes)) as unknown))
}
