/** Agent 回放数据契约 —— WASM 装载与本地解析通道（bytes/JSON → 校验过的能力数据）。
 *  拆分自 agent-replay-facets.ts；公共入口仍为 `../agent-replay-facets.ts`。 */

import type { AgentBattleResult, AgentAuthorInitialPosition } from './resultTypes.js'
import { isObject } from './validation.js'
import type { AgentPlaybackFacet } from './playbackTypes.js'
import type { AgentAiReviewFacet } from './aiTypes.js'
import {
  validateAgentBattleResult,
  validateAgentPlayback,
  validateAgentAiReview,
  validateAgentAuthorInitialPosition,
} from './validation.js'

// ---------- WASM 装载（本地通道；build-time 固定产物，运行时不选择版本） ----------

/**
 * build-time 固化的 Agent identity（Vite `define`，来源 `deploy/agent/source.json`，
 * 见 `frontend/vite.config.js:agentWasmIdentity`）。运行期 URL 一律由它拼出：
 *
 *   /wasm/<upstream_commit>/wotb_replay_wasm.js
 *   /wasm/<upstream_commit>/wotb_replay_wasm_bg.wasm   ← wasm-bindgen wrapper 自行加载
 *   /wasm/<upstream_commit>/fingerprint.json
 *
 * **stable `/wasm/wotb_replay_wasm.js` 已废除且禁止回归**：旧 URL 会被浏览器长期缓存，
 * 新 build 与旧产物混用就会出现「同一个 frontend 加载到别人的 Agent」——错版解析要等到
 * AI Review 才以 `poses` 缺失暴露。commit-addressed 目录让 URL 与内容同身份：新 Agent
 * → 新 URL，旧 URL 永不覆盖；缓存失效靠 URL identity，不靠强制 no-cache。
 *
 * `typeof` 兜底：e2e 直接跑 `src/`（无 bundler 替换 define）时退化为占位身份，
 * 产物路径 `/wasm/unknown/` 必然 404 → `AgentWasmVersionMismatchError`，仍然 fail closed。
 */
declare const __AGENT_WASM_COMMIT__: string | undefined
declare const __AGENT_WASM_RELEASE__: string | undefined

export const AGENT_WASM_COMMIT = typeof __AGENT_WASM_COMMIT__ === 'string' ? __AGENT_WASM_COMMIT__ : 'unknown'
export const AGENT_WASM_RELEASE = typeof __AGENT_WASM_RELEASE__ === 'string' ? __AGENT_WASM_RELEASE__ : 'unknown'

/**
 * Agent identity 与产物不一致（fail-closed）。
 *
 * 场景：fingerprint 缺失/格式错误、`upstream_commit` 与 build 期 pin 不一致、
 * `tag` 与 pin 的 release 不一致——即浏览器里躺着别的 build 的 Agent 产物。
 * content-addressed 改造完成后用户不应再遇到它；它是最后一道 fail-safe，
 * 不允许继续执行到「AI Review 报 `poses` 缺失」才发现错版。
 */
export class AgentWasmVersionMismatchError extends Error {
  readonly expectedRelease: string
  readonly expectedCommit: string
  readonly actualRelease: string
  readonly actualCommit: string

  constructor(init: {
    expectedRelease: string
    expectedCommit: string
    actualRelease: string
    actualCommit: string
    reason: string
  }) {
    super(
      `agent wasm identity mismatch (${init.reason}): `
      + `build pins ${init.expectedRelease}@${init.expectedCommit}, `
      + `served ${init.actualRelease}@${init.actualCommit}`,
    )
    this.name = 'AgentWasmVersionMismatchError'
    this.expectedRelease = init.expectedRelease
    this.expectedCommit = init.expectedCommit
    this.actualRelease = init.actualRelease
    this.actualCommit = init.actualCommit
  }
}

/** 本 build 固化的 Agent 产物的 commit-addressed 目录（URL identity） */
export function agentWasmBase(commit: string = AGENT_WASM_COMMIT): string {
  return `/wasm/${commit}`
}

/** 本 build 固化的 Agent 产物入口（wasm-bindgen wrapper 从同目录加载 `_bg.wasm`） */
export function agentWasmModuleUrl(commit: string = AGENT_WASM_COMMIT): string {
  return `${agentWasmBase(commit)}/wotb_replay_wasm.js`
}

/** dynamic import 重试序号：装载挂起超时后 +1，见 loadAgentWasm 内的注释。
 *  只有超时失败才后移——正常失败（HTTP 404 / 版本不一致）URL 没坏，重试同 URL 即可。 */
let wasmImportAttempt = 0

function agentWasmModuleUrlWithRetry(commit: string): string {
  const base = agentWasmModuleUrl(commit)
  return wasmImportAttempt > 0 ? `${base}?wasmAttempt=${wasmImportAttempt}` : base
}

/** 本 build 固化的 Agent 产物清单 URL */
export function agentWasmFingerprintUrl(commit: string = AGENT_WASM_COMMIT): string {
  return `${agentWasmBase(commit)}/fingerprint.json`
}

interface AgentWasmModule {
  /** tankNamesJson 可选：`{tank_id: name}` 车型名表（上游 v0.3.1 起） */
  parseResult?: (bytes: Uint8Array, tankNames?: string) => string
  parsePlayback?: (bytes: Uint8Array, tankNames?: string, limitsJson?: string) => string
  parseShotReplays?: (bytes: Uint8Array, limits?: string, shells?: string) => string
  /** 第 4 入口（上游 v0.3.1）：AiReviewFacet JSON（花名册 + 事件流 + 结算锚点） */
  parseAiReview?: (bytes: Uint8Array) => string
  /** 第 5 入口（上游 v0.4.15）：录像者初始世界位姿 JSON，或字符串 "null" */
  parseAuthorInitialPosition?: (bytes: Uint8Array) => string
  /** 第 6 入口（上游 v0.4.21）：录像者相机状态 JSON，或字符串 "null" */
  parseRecorderCamera?: (bytes: Uint8Array) => string
  default?: () => Promise<void>
  initSync?: () => void
}

/** 产物清单（`<commit>/fingerprint.json`，与产物同目录发布） */
export interface AgentWasmFingerprint {
  /** 上游 Release tag（必须等于 `deploy/agent/source.json:artifact.release`） */
  tag: string
  /** 上游源码 commit（必须等于 `deploy/agent/source.json:ref`） */
  upstream_commit: string
}

/** 一次装载的 Agent 产物身份（URL identity + 校验过的产物清单） */
export interface AgentWasmIdentity {
  release: string
  commit: string
  fingerprint: AgentWasmFingerprint
}

let wasmPromise: Promise<AgentWasmModule> | null = null
let loadedIdentity: AgentWasmIdentity | null = null

const fingerprintPromises = new Map<string, Promise<AgentWasmFingerprint>>()

function mismatch(
  expected: AgentWasmIdentityPin,
  actual: { release: string; commit: string },
  reason: string,
): AgentWasmVersionMismatchError {
  return new AgentWasmVersionMismatchError({
    expectedRelease: expected.release,
    expectedCommit: expected.commit,
    actualRelease: actual.release,
    actualCommit: actual.commit,
    reason,
  })
}

/** build 期 pin 的 Agent identity（可显式注入，便于对装载路径做契约测试） */
export interface AgentWasmIdentityPin {
  release: string
  commit: string
}

/** fingerprint body 非法 JSON 的内部标记错误：把"body 读到了但不是 JSON"与
 *  "请求/body 停滞或网络失败"分开，前者保留既有 `不是合法 JSON` 文案（不是用户可见错误，
 *  只进 `AgentWasmVersionMismatchError` 的诊断字段）。 */
class FingerprintBodyError extends Error {}

/**
 * 读取并校验产物清单：`upstream_commit` / `tag` 必须与 build 期 pin 逐字段一致。
 *
 * 任何不一致（缺失、不可读、非法 JSON、commit/tag 不匹配）都抛
 * [`AgentWasmVersionMismatchError`]——fail closed，绝不继续解析。
 */
export async function verifyAgentWasmFingerprint(
  expected: AgentWasmIdentityPin,
  commit: string = expected.commit,
): Promise<AgentWasmFingerprint> {
  const url = agentWasmFingerprintUrl(commit)
  const cached = fingerprintPromises.get(url)
  if (cached) return cached

  const pending = (async (): Promise<AgentWasmFingerprint> => {
    // **整条 fingerprint request lifecycle 共用一个看门狗**（request → headers → body
    // consumption → JSON parse）。只包 `fetch()` 是不够的：fetch 在**收到 response headers
    // 后就 resolve**，CDN / 代理「headers 正常返回、body 永久不结束」时 `response.json()`
    // 会永久 pending，而这个 pending Promise 会被 `fingerprintPromises` 缓存并复用到整个
    // 页面会话——原始 P0「解析永久卡住」的 failure mode 原样保留。
    //
    // 两个机制缺一不可（见 [`readFingerprintResponse`]）：
    // 1. **竞速**（下面的 `withLoadTimeout`）：停滞的 body 既不 resolve 也不 reject，
    //    只在 catch 里判断"是不是超时"永远等不到——必须由外部让整条 await 链 reject；
    // 2. **真 abort**（`readFingerprintResponse` 内的 AbortController）：把网络请求 /
    //    body stream 真正切断（清掉连接），而不是留一个仍占着连接的请求在后台跑。
    let read: { response: Response; raw: unknown }
    try {
      read = await withLoadTimeout(readFingerprintResponse(url), 'fingerprint 拉取')
    } catch (e) {
      // 非法 JSON 保留既有诊断文案（不是用户可见错误，只进 mismatch 的 reason）
      if (e instanceof FingerprintBodyError) {
        throw mismatch(expected, { release: 'unknown', commit: 'unknown' }, `fingerprint ${url} 不是合法 JSON`)
      }
      // 超时 / 网络失败：fail closed
      throw mismatch(expected, { release: 'unknown', commit: 'unknown' }, `fingerprint ${url} 不可读：${String(e)}`)
    }
    const { response, raw } = read
    // HTTP 状态在**读 body 之前**判定：与改造前逐字一致（加了 body 看门狗不得改变
    // 404 / 5xx 的诊断语义，也不对错误响应做无谓的 body 消费）
    if (!response.ok) {
      throw mismatch(expected, { release: 'unknown', commit: 'unknown' }, `fingerprint ${url} 返回 HTTP ${response.status}`)
    }
    const doc = isObject(raw) ? raw : {}
    const actualTag = typeof doc.tag === 'string' ? doc.tag : ''
    const actualCommit = typeof doc.upstream_commit === 'string' ? doc.upstream_commit : ''
    if (!actualTag || !actualCommit) {
      throw mismatch(
        expected,
        { release: actualTag || 'unknown', commit: actualCommit || 'unknown' },
        `fingerprint ${url} 缺 tag/upstream_commit`,
      )
    }
    if (actualCommit !== expected.commit) {
      throw mismatch(expected, { release: actualTag, commit: actualCommit }, 'upstream_commit 与 build 期 pin 不一致')
    }
    if (actualTag !== expected.release) {
      throw mismatch(expected, { release: actualTag, commit: actualCommit }, 'tag 与 build 期 pin 的 release 不一致')
    }
    return { tag: actualTag, upstream_commit: actualCommit }
  })()

  fingerprintPromises.set(url, pending)
  pending.catch(() => { fingerprintPromises.delete(url) }) // 失败可重试
  return pending
}

/**
 * fingerprint 请求的**可打断读取**：headers 等待 + body 消费 + JSON parse 合成一个单元，
 * 返回 `{response, raw}`（body 必须在这里读完——`Response.json()` 只能消费一次）。
 *
 * 停滞的 `json()` 既不 resolve 也不 reject，**所以本函数自己不可能是超时的判据**：
 * 让整条链 reject 的是调用方的 `withLoadTimeout` 竞速。这里负责的是另外两件：
 * - **真 abort**：专属 AbortController 的 signal 贯穿 fetch 与 body 读取，超时到点时把
 *   网络请求 / body stream 真正切断——否则那个请求会一直占着连接（调用方已经放弃了它）；
 * - **诊断分流**：非法 JSON 抛 [`FingerprintBodyError`]，与"停滞 / 网络失败"分开归类；
 *   HTTP 状态在 body 之前就返回，保持既有 404 / 5xx 语义。
 *
 * 清理：timer 与 abort listener 都在 `finally` 里撤销——成功 / 失败 / 超时三条路径都不留残留。
 */
async function readFingerprintResponse(url: string): Promise<{ response: Response; raw: unknown }> {
  const timeoutMs = agentWasmLoadTimeoutMs()
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort(new DOMException(`fingerprint ${url} 超过 ${Math.round(timeoutMs / 1000)}s 未完成`, 'TimeoutError'))
  }, timeoutMs)
  // 超时后 body 仍在读：abort 让 body stream 判失败（实现相关，可能同步抛也可能异步抛）。
  // 本请求已经放弃，这里只负责不把它变成 unhandled rejection。
  const absorbAbort = () => { try { controller.signal.throwIfAborted() } catch { /* 已放弃本请求 */ } }
  controller.signal.addEventListener('abort', absorbAbort)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) return { response, raw: undefined }   // 状态优先：不做无谓的 body 消费
    let raw: unknown
    try {
      raw = await response.json()
    } catch (e) {
      // 与"请求/body 停滞"区分开：调用方据此保留 `不是合法 JSON` 的独立诊断语义
      throw new FingerprintBodyError(String(e))
    }
    return { response, raw }
  } finally {
    clearTimeout(timer)
    controller.signal.removeEventListener('abort', absorbAbort)
  }
}

/**
 * WASM 装载链路看门狗：fingerprint（几十字节 JSON）、产物 JS（dynamic import）、
 * wasm 初始化都必须在**有限时间**内失败。浏览器 fetch / dynamic import 没有默认超时——
 * CDN / 代理把请求挂起不回包时 await 永远悬着，而 fingerprint / wasmPromise 的会话级
 * 缓存只在 reject 时清理，悬着的 Promise 会被复用到会话结束 → 3D Worker 与 Data 批量
 * 解析（同一装载链）全部永久停在「解析中」（线上用户实测的「卡解析进度条」根因）。
 * 超时按普通失败处理：缓存清空、下次调用自动重试。
 */
const WASM_LOAD_TIMEOUT_MS = 20_000

/** 测试注入点：缩短看门狗（20s 不可等待），生产代码不调用；见 [`__resetAgentWasmForTest`] 复位。 */
let wasmLoadTimeoutOverrideMs: number | null = null

function agentWasmLoadTimeoutMs(): number {
  return wasmLoadTimeoutOverrideMs ?? WASM_LOAD_TIMEOUT_MS
}

export function __setAgentWasmTimeoutForTest(ms: number | null): void {
  wasmLoadTimeoutOverrideMs = ms
}

function withLoadTimeout<T>(promise: Promise<T>, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new Error(
        `agent wasm: ${what} 超过 ${Math.round(agentWasmLoadTimeoutMs() / 1000)}s 未完成（网络停滞？已放弃本次装载，可重试）`,
      ) as Error & { wasmLoadTimeout?: boolean }
      error.wasmLoadTimeout = true
      reject(error)
    }, agentWasmLoadTimeoutMs())
    promise.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (error) => { clearTimeout(timer); reject(error) },
    )
  })
}

/**
 * 装载并校验 wasm-bindgen 产物（web target：default() 异步初始化）。
 * 保证：单次初始化、并发调用共享 Promise、失败清空缓存可重试。
 *
 * 顺序固定：**先校验 fingerprint，再 dynamic import versioned JS**（wasm-bindgen
 * wrapper 会从同一目录加载 `<commit>/wotb_replay_wasm_bg.wasm`）——错版产物在装载
 * 阶段就失败，而不是等到 AI Review 投影才发现 `poses` 缺失。
 *
 * 生产入口是 [`loadAgentWasmModule`]（它在调用本函数前先做同一份门禁 + 测试可注桩）；
 * 本函数保留导出以便契约测试直接驱动**真实**装载路径（versioned URL + dynamic import）。
 */
export function loadAgentWasm(
  expected: AgentWasmIdentityPin = { release: AGENT_WASM_RELEASE, commit: AGENT_WASM_COMMIT },
): Promise<AgentWasmModule> {
  if (!wasmPromise || !loadedIdentity
    || loadedIdentity.commit !== expected.commit || loadedIdentity.release !== expected.release) {
    wasmPromise = (async () => {
      const fingerprint = await verifyAgentWasmFingerprint(expected)
      // 运行期 URL：常量形式 + @vite-ignore 避免 bundler 构建期解析。
      // dynamic import 的 specifier 被浏览器模块表按 URL 去重：装载挂起超时后**重试同一
      // URL 只会拿回同一个悬着的模块记录**，所以超时一次就把序号后移，强制下一次调用
      // 发起真正全新的装载（相对资源 .wasm 按 import.meta.url 解析，query 不影响落点）。
      let mod: AgentWasmModule
      try {
        mod = await withLoadTimeout(
          import(/* @vite-ignore */ agentWasmModuleUrlWithRetry(expected.commit)),
          '产物 JS 装载',
        )
      } catch (error) {
        if ((error as { wasmLoadTimeout?: boolean })?.wasmLoadTimeout) wasmImportAttempt++
        throw error
      }
      if (mod.default) await withLoadTimeout(mod.default(), '产物 WASM 初始化')
      loadedIdentity = { release: expected.release, commit: expected.commit, fingerprint }
      // 排障用：用户报「解析结果不对」时，这条日志能直接证明页面实际加载的是哪个 Agent
      console.info('[agent-wasm] loaded', {
        release: loadedIdentity.release,
        commit: loadedIdentity.commit,
        url: agentWasmModuleUrl(expected.commit),
      })
      return mod
    })()
    wasmPromise.catch(() => {
      wasmPromise = null // 失败可重试
      loadedIdentity = null
    })
  }
  return wasmPromise
}

/** 已装载 Agent 产物的身份（未装载 → null）；与 [`loadAgentWasm`] 同一校验结果 */
export function agentWasmIdentity(): AgentWasmIdentity | null {
  return loadedIdentity
}

/**
 * 测试注入点：以桩替换 WASM 模块解析（回归测试需在不依赖真实产物的前提下
 * 走完解析路径）。生产代码不调用；传 null 复位。
 */
let wasmModuleResolver: ((expected: AgentWasmIdentityPin) => Promise<AgentWasmModule>) | null = null

export function __setAgentWasmResolverForTest(
  resolver: ((expected: AgentWasmIdentityPin) => Promise<AgentWasmModule>) | null,
): void {
  wasmModuleResolver = resolver
}

/** 测试注入点：清空装载/清单缓存（每个用例独立驱动装载路径）。生产代码不调用。 */
export function __resetAgentWasmForTest(): void {
  wasmModuleResolver = null
  wasmPromise = null
  loadedIdentity = null
  wasmLoadTimeoutOverrideMs = null
  fingerprintPromises.clear()
}

/**
 * 装载模块：**先校验 fingerprint（URL identity），再解析模块**——表格 / 3D / AI
 * 三个通道共用这一个入口，版本门禁只有一份实现。测试可注入模块桩（resolver），
 * 但 fingerprint 门禁仍然生效（桩只替换"模块从哪来"，不替换"产物身份对不对"）。
 */
export async function loadAgentWasmModule(
  expected: AgentWasmIdentityPin = { release: AGENT_WASM_RELEASE, commit: AGENT_WASM_COMMIT },
): Promise<AgentWasmModule> {
  await verifyAgentWasmFingerprint(expected)
  const resolver = wasmModuleResolver
  if (resolver) return resolver(expected)
  return loadAgentWasm(expected)
}

/**
 * 已装载 WASM 产物的来源（`/wasm/<commit>/fingerprint.json`，与产物同目录发布）。
 * 先装载再读，返回值一定已过 build 期 pin 校验——不一致时抛
 * [`AgentWasmVersionMismatchError`]，不再返回 null 让调用方"猜"产物版本。
 */
export async function loadAgentWasmFingerprint(): Promise<AgentWasmFingerprint> {
  await loadAgentWasm()
  const identity = loadedIdentity
  if (!identity) throw new Error('agent wasm: identity 未建立')
  return identity.fingerprint
}

/** WASM 模块函数装载入口（射击复现通道共用；原文件私有实现，语义不变） */
export async function wasmFn<K extends keyof AgentWasmModule>(name: K): Promise<Exclude<AgentWasmModule[K], undefined>> {
  const mod = await loadAgentWasmModule({ release: AGENT_WASM_RELEASE, commit: AGENT_WASM_COMMIT })
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

/**
 * AI 事件数据（第 4 入口）：.wotbreplay 字节 → 校验过的 AiReviewFacet。文件不出本机。
 *
 * 这是**当前正式 pin（v0.4.9+）的 WASM 消费路径**，因此走 `current-producer` 严格口径：
 * `damage`/`health.hp_state` 必填，缺字段直接拒绝（fail closed）。
 */
export async function parseAgentAiReviewFromBytes(bytes: Uint8Array): Promise<AgentAiReviewFacet> {
  const parse = await wasmFn('parseAiReview')
  return validateAgentAiReview(JSON.parse(parse(bytes)) as unknown, 'current-producer')
}

/**
 * 录像者初始世界位姿（独立轻量 probe，上游 v0.4.15）：.wotbreplay 字节 →
 * `{ author_eid, clock, position }` 或 `null`。不构建 ReplayModel / PlaybackData /
 * AiReviewFacet，也不修改 `parseResult`；只有显式调用本函数才执行该 probe。
 */
export async function parseAgentAuthorInitialPositionFromBytes(
  bytes: Uint8Array,
): Promise<AgentAuthorInitialPosition | null> {
  const parse = await wasmFn('parseAuthorInitialPosition')
  return validateAgentAuthorInitialPosition(JSON.parse(parse(bytes)) as unknown)
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
