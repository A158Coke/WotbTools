
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


declare const __AGENT_WASM_COMMIT__: string | undefined
declare const __AGENT_WASM_RELEASE__: string | undefined

export const AGENT_WASM_COMMIT = typeof __AGENT_WASM_COMMIT__ === 'string' ? __AGENT_WASM_COMMIT__ : 'unknown'
export const AGENT_WASM_RELEASE = typeof __AGENT_WASM_RELEASE__ === 'string' ? __AGENT_WASM_RELEASE__ : 'unknown'

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

export function agentWasmBase(commit: string = AGENT_WASM_COMMIT): string {
  return `/wasm/${commit}`
}

export function agentWasmModuleUrl(commit: string = AGENT_WASM_COMMIT): string {
  return `${agentWasmBase(commit)}/wotb_replay_wasm.js`
}

let wasmImportAttempt = 0

function agentWasmModuleUrlWithRetry(commit: string): string {
  const base = agentWasmModuleUrl(commit)
  return wasmImportAttempt > 0 ? `${base}?wasmAttempt=${wasmImportAttempt}` : base
}

export function agentWasmFingerprintUrl(commit: string = AGENT_WASM_COMMIT): string {
  return `${agentWasmBase(commit)}/fingerprint.json`
}

interface AgentWasmModule {
  parseResult?: (bytes: Uint8Array, tankNames?: string) => string
  parsePlayback?: (bytes: Uint8Array, tankNames?: string, limitsJson?: string) => string
  parseShotReplays?: (bytes: Uint8Array, limits?: string, shells?: string) => string
  parseAiReview?: (bytes: Uint8Array) => string
  parseAuthorInitialPosition?: (bytes: Uint8Array) => string
  parseRecorderCamera?: (bytes: Uint8Array) => string
  default?: () => Promise<void>
  initSync?: () => void
}

export interface AgentWasmFingerprint {
  tag: string
  upstream_commit: string
}

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

export interface AgentWasmIdentityPin {
  release: string
  commit: string
}

class FingerprintBodyError extends Error {}

export async function verifyAgentWasmFingerprint(
  expected: AgentWasmIdentityPin,
  commit: string = expected.commit,
): Promise<AgentWasmFingerprint> {
  const url = agentWasmFingerprintUrl(commit)
  const cached = fingerprintPromises.get(url)
  if (cached) return cached

  const pending = (async (): Promise<AgentWasmFingerprint> => {
    let read: { response: Response; raw: unknown }
    try {
      read = await withLoadTimeout(readFingerprintResponse(url), 'fingerprint 拉取')
    } catch (e) {
      if (e instanceof FingerprintBodyError) {
        throw mismatch(expected, { release: 'unknown', commit: 'unknown' }, `fingerprint ${url} 不是合法 JSON`)
      }
      throw mismatch(expected, { release: 'unknown', commit: 'unknown' }, `fingerprint ${url} 不可读：${String(e)}`)
    }
    const { response, raw } = read
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
  pending.catch(() => { fingerprintPromises.delete(url) })
  return pending
}

async function readFingerprintResponse(url: string): Promise<{ response: Response; raw: unknown }> {
  const timeoutMs = agentWasmLoadTimeoutMs()
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort(new DOMException(`fingerprint ${url} 超过 ${Math.round(timeoutMs / 1000)}s 未完成`, 'TimeoutError'))
  }, timeoutMs)
  const absorbAbort = () => { try { controller.signal.throwIfAborted() } catch { /* 已放弃本请求 */ } }
  controller.signal.addEventListener('abort', absorbAbort)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) return { response, raw: undefined }
    let raw: unknown
    try {
      raw = await response.json()
    } catch (e) {
      throw new FingerprintBodyError(String(e))
    }
    return { response, raw }
  } finally {
    clearTimeout(timer)
    controller.signal.removeEventListener('abort', absorbAbort)
  }
}

const WASM_LOAD_TIMEOUT_MS = 20_000

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

export function loadAgentWasm(
  expected: AgentWasmIdentityPin = { release: AGENT_WASM_RELEASE, commit: AGENT_WASM_COMMIT },
): Promise<AgentWasmModule> {
  if (!wasmPromise || !loadedIdentity
    || loadedIdentity.commit !== expected.commit || loadedIdentity.release !== expected.release) {
    wasmPromise = (async () => {
      const fingerprint = await verifyAgentWasmFingerprint(expected)
      // 运行期 URL：常量形式 + @vite-ignore 避免 bundler 构建期解析。
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
      console.info('[agent-wasm] loaded', {
        release: loadedIdentity.release,
        commit: loadedIdentity.commit,
        url: agentWasmModuleUrl(expected.commit),
      })
      return mod
    })()
    wasmPromise.catch(() => {
      wasmPromise = null
      loadedIdentity = null
    })
  }
  return wasmPromise
}

export function agentWasmIdentity(): AgentWasmIdentity | null {
  return loadedIdentity
}

let wasmModuleResolver: ((expected: AgentWasmIdentityPin) => Promise<AgentWasmModule>) | null = null

export function __setAgentWasmResolverForTest(
  resolver: ((expected: AgentWasmIdentityPin) => Promise<AgentWasmModule>) | null,
): void {
  wasmModuleResolver = resolver
}

export function __resetAgentWasmForTest(): void {
  wasmModuleResolver = null
  wasmPromise = null
  loadedIdentity = null
  wasmLoadTimeoutOverrideMs = null
  fingerprintPromises.clear()
}

export async function loadAgentWasmModule(
  expected: AgentWasmIdentityPin = { release: AGENT_WASM_RELEASE, commit: AGENT_WASM_COMMIT },
): Promise<AgentWasmModule> {
  await verifyAgentWasmFingerprint(expected)
  const resolver = wasmModuleResolver
  if (resolver) return resolver(expected)
  return loadAgentWasm(expected)
}

export async function loadAgentWasmFingerprint(): Promise<AgentWasmFingerprint> {
  await loadAgentWasm()
  const identity = loadedIdentity
  if (!identity) throw new Error('agent wasm: identity 未建立')
  return identity.fingerprint
}

export async function wasmFn<K extends keyof AgentWasmModule>(name: K): Promise<Exclude<AgentWasmModule[K], undefined>> {
  const mod = await loadAgentWasmModule({ release: AGENT_WASM_RELEASE, commit: AGENT_WASM_COMMIT })
  const fn = mod[name]
  if (typeof fn !== 'function') {
    throw new Error(`agent wasm: ${String(name)} 缺失（产物版本不匹配契约 v2）`)
  }
  return fn as Exclude<AgentWasmModule[K], undefined>
}


export async function parseAgentResultFromBytes(bytes: Uint8Array): Promise<AgentBattleResult> {
  const parse = await wasmFn('parseResult')
  return validateAgentBattleResult(JSON.parse(parse(bytes)) as unknown)
}

export function tankNamesJson(table: Record<number, string>): string {
  return JSON.stringify(table)
}

export async function parseAgentPlaybackFromBytes(
  bytes: Uint8Array, tankNames?: string,
): Promise<AgentPlaybackFacet> {
  const parse = await wasmFn('parsePlayback')
  return validateAgentPlayback(JSON.parse(parse(bytes, tankNames)) as unknown)
}

export async function parseAgentAiReviewFromBytes(bytes: Uint8Array): Promise<AgentAiReviewFacet> {
  const parse = await wasmFn('parseAiReview')
  return validateAgentAiReview(JSON.parse(parse(bytes)) as unknown, 'current-producer')
}

export async function parseAgentAuthorInitialPositionFromBytes(
  bytes: Uint8Array,
): Promise<AgentAuthorInitialPosition | null> {
  const parse = await wasmFn('parseAuthorInitialPosition')
  return validateAgentAuthorInitialPosition(JSON.parse(parse(bytes)) as unknown)
}


export function parseAgentResultFromJson(json: string | unknown): AgentBattleResult {
  const value = typeof json === 'string' ? (JSON.parse(json) as unknown) : json
  return validateAgentBattleResult(value)
}

export function parseAgentPlaybackFromJson(json: string | unknown): AgentPlaybackFacet {
  const value = typeof json === 'string' ? (JSON.parse(json) as unknown) : json
  return validateAgentPlayback(value)
}
