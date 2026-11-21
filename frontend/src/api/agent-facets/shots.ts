/** Agent 回放数据契约 —— 射击复现通道（shots 归一化 / 富化 / 全局重编号）。
 *  拆分自 agent-replay-facets.ts；公共入口仍为 `../agent-replay-facets.ts`。 */

import type { AgentShotReplay, AgentShellTable } from './shotTypes.js'
import { isObject } from './validation.js'
import { wasmFn } from './wasm.js'

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
  /** 他人宽松路径跳过/兜底统计（上游 v0.4.20 起：仅他人路径 Ok 时存在；旧产物不可知 → 全 0） */
  others?: AgentShotsOthersStats
  /** 他人宽松路径内部不变量破坏原因（上游 v0.4.20 起，仅 others 缺失时存在；
   * 数据缺失照旧走 skipped_* 统计，不会出现该键。消费方必须呈现，不静默当全 0） */
  others_error?: string
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
  // 上游 v0.4.20：others 与 others_error 互斥（他人路径内部不变量破坏 → 缺 others 带
  // others_error；数据缺失照旧 skipped_*）。两者皆缺 = schema drift，拒绝显形。
  if (v.others === undefined && v.others_error === undefined) {
    throw new Error('agent shots: others 与 others_error 必须有其一（上游 v0.4.20 互斥契约）')
  }
  return {
    shots: assertShotArray(v.shots),
    author_path: authorPath,
    ...(authorPath === 'error' ? { author_error: v.author_error as string } : {}),
    author_eid: typeof v.author_eid === 'number' ? v.author_eid : 0,
    ...(typeof v.others_error === 'string' ? { others_error: v.others_error } : {}),
    ...(v.others === undefined
      ? {}
      : {
          others: {
            total_launches: num(o.total_launches),
            skipped_no_endpoint: num(o.skipped_no_endpoint),
            skipped_no_target_state: num(o.skipped_no_target_state),
            muzzle_fallback: num(o.muzzle_fallback),
          },
        }),
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
