/**
 * 2D 底图 OTA 覆盖层（Android 专用）：**包内兜底 + 在线校验**。
 *
 * 形状（判据与理由见 Agent 仓 docs/game-data-sources.md §5.6 与
 * docs/reference/maps.md §2026-10-16）：
 *   包内  = `src/assets/maps/*.webp`（随 APK，离线永远可用）——兜底层；
 *   远端  = COS `/agent-assets/map2d/<code>.webp`（经 AgentAssetProxy 直连 + ETag 磁盘缓存）；
 *   判据  = COS `/agent-assets/map2d/index.json`（逐图 sha256 + generated 时间戳）。
 *
 * 决策规则（纯函数 `selectMap2dSources`，无启发式）：
 *   1) 无包内清单（web / 旧包）⇒ 关闭通道，全部包内；
 *   2) 无索引（在线拉取失败且无持久化副本）⇒ 全部包内；
 *   3) schemaVersion 不支持 / 时间戳不可解析 ⇒ 全部包内（fail closed）；
 *   4) **index.generated ≤ 包内 buildTime ⇒ 全部包内**——索引比本包旧时包内就是较新的一份，
 *      这条单调性规则是"APK 升级后旧缓存/旧索引不得把用户降级"的唯一保证；
 *   5) 逐图：index.sha256 == 包内 sha256 ⇒ 用包内（字节相同，零流量）；不同 ⇒ 走远端。
 *   远端字节在使用前必须 sha256 校验（Spec：下载即验证），校验失败/取不到 ⇒ 该图回落包内。
 *
 * 传输与离线缓存**复用现有 AgentAssetProxy**（条件请求 + 磁盘缓存 + 上游失败回落陈旧），
 * 因此本模块不做任何原生改动；索引在 localStorage 留一份副本，供离线时仍能判定"远端更新"。
 */

import { reactive, ref } from 'vue'
import { ANDROID_ASSET_BASE, isAndroidRuntime } from '../platform/runtime.js'

const EMBEDDED_URL = '/map2d-embedded.json'
const INDEX_URL = `${ANDROID_ASSET_BASE}/map2d/index.json`
const STORE_KEY = 'wotb.map2d.index.v1'
const SCHEMA_VERSION = 1
const INDEX_TIMEOUT_MS = 8000
const IMAGE_TIMEOUT_MS = 20000

/** 任一覆盖生效即 +1：给"必须感知换图"的命令式消费方（如 2.5D 贴图）一个可 watch 的信号。 */
export const map2dRevision = ref(0)

/** 诊断面（本地测试/自检用；不含任何凭据）。 */
export const map2dState = reactive({
  status: 'off',        // off | no-embedded | no-index | schema | timestamp | stale-index | active | error
  buildTime: null,
  indexGenerated: null,
  indexSource: null,    // remote | stored | null
  maps: {},             // code → { source: embedded|remote|pending|rejected, reason?, bytes? }
})

const overrides = reactive({})   // code → { url, sha256, bytes }
const triggered = new Set()
let readyPromise = null
let decisionCache = null

function timeoutSignal(ms) {
  if (typeof AbortController === 'undefined') return { signal: undefined, done: () => {} }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  return { signal: controller.signal, done: () => clearTimeout(timer) }
}

async function fetchJson(url) {
  const { signal, done } = timeoutSignal(INDEX_TIMEOUT_MS)
  try {
    const response = await fetch(url, { signal, cache: 'no-store' })
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  } finally {
    done()
  }
}

function readStoredIndex() {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function writeStoredIndex(index) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(index))
  } catch {
    /* 配额/隐私模式失败不影响功能：本轮仍用远端索引 */
  }
}

/**
 * 纯函数：给定（远端索引、持久化索引、包内清单），决定每张地图的来源。
 * 返回 { active, reason, index, use: { code: { sha256, path, bytes } } }。
 */
export function selectMap2dSources({ remoteIndex = null, storedIndex = null, embedded = null } = {}) {
  const embeddedMaps = embedded && typeof embedded === 'object' ? embedded.maps : null
  if (!embeddedMaps || typeof embeddedMaps !== 'object' || Object.keys(embeddedMaps).length === 0) {
    return { active: false, reason: 'no-embedded', index: null, use: {} }
  }
  const index = remoteIndex || storedIndex
  if (!index) return { active: false, reason: 'no-index', index: null, use: {} }
  if (index.schemaVersion !== SCHEMA_VERSION) return { active: false, reason: 'schema', index, use: {} }
  const indexTime = Date.parse(String(index.generated ?? ''))
  const buildTime = Date.parse(String(embedded.buildTime ?? ''))
  if (!Number.isFinite(indexTime) || !Number.isFinite(buildTime)) {
    return { active: false, reason: 'timestamp', index, use: {} }
  }
  if (indexTime <= buildTime) return { active: false, reason: 'stale-index', index, use: {} }
  const use = {}
  const indexMaps = index.maps && typeof index.maps === 'object' ? index.maps : {}
  for (const [code, entry] of Object.entries(indexMaps)) {
    const local = embeddedMaps[code]
    if (!local || !entry) continue
    if (typeof entry.sha256 !== 'string' || typeof entry.path !== 'string') continue
    if (entry.sha256 === local.sha256) continue   // 字节相同 ⇒ 包内那份就是最新，零流量
    use[code] = { sha256: entry.sha256, path: entry.path, bytes: Number.isFinite(entry.bytes) ? entry.bytes : null }
  }
  return { active: true, reason: remoteIndex ? 'remote-index' : 'stored-index', index, use }
}

async function init() {
  if (!isAndroidRuntime()) {
    map2dState.status = 'off'
    return { active: false, reason: 'off', use: {} }
  }
  const embedded = await fetchJson(EMBEDDED_URL)
  if (!embedded) {
    map2dState.status = 'no-embedded'
    return { active: false, reason: 'no-embedded', use: {} }
  }
  map2dState.buildTime = embedded.buildTime ?? null
  const remote = await fetchJson(INDEX_URL)
  if (remote) writeStoredIndex(remote)
  const decision = selectMap2dSources({
    remoteIndex: remote,
    storedIndex: readStoredIndex(),
    embedded,
  })
  map2dState.status = decision.active ? 'active' : decision.reason
  map2dState.indexGenerated = decision.index?.generated ?? null
  map2dState.indexSource = decision.active ? decision.reason : null
  for (const code of Object.keys(embedded.maps)) {
    map2dState.maps[code] = decision.use[code]
      ? { source: 'pending', bytes: decision.use[code].bytes }
      : { source: 'embedded' }
  }
  return decision
}

/** 共享一次初始化（首次真正需要 2D 底图时才触发，不占启动时间）。 */
export function ensureMap2dReady() {
  if (!readyPromise) readyPromise = init().catch(() => ({ active: false, reason: 'error', use: {} }))
  return readyPromise
}

async function sha256Hex(buffer) {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) return null                       // 无 SubtleCrypto ⇒ 无法校验 ⇒ 不启用远端
  const digest = await subtle.digest('SHA-256', buffer)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * 取该 code 的可用 URL（远端已校验并通过时返回 blob URL；否则 null = 沿用包内）。
 * 供命令式消费方（2.5D 贴图）await；2D 渲染走 `map2dSrc`（同步 + 反应式）。
 */
export async function ensureMap2dImage(code) {
  const decision = await ensureMap2dReady()
  const want = decision && decision.active ? decision.use[code] : null
  if (!want) return null
  if (overrides[code]) return overrides[code].url
  const { signal, done } = timeoutSignal(IMAGE_TIMEOUT_MS)
  try {
    const response = await fetch(`${ANDROID_ASSET_BASE}/${want.path}`, { signal })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const buffer = await response.arrayBuffer()
    if (want.bytes != null && buffer.byteLength !== want.bytes) throw new Error('size mismatch')
    const digest = await sha256Hex(buffer)
    if (!digest) throw new Error('no-subtle-crypto')
    if (digest !== want.sha256) throw new Error('sha256 mismatch')
    const url = URL.createObjectURL(new Blob([buffer], { type: 'image/webp' }))
    overrides[code] = { url, sha256: want.sha256, bytes: buffer.byteLength }
    map2dState.maps[code] = { source: 'remote', bytes: buffer.byteLength }
    map2dRevision.value += 1
    return url
  } catch (error) {
    map2dState.maps[code] = { source: 'rejected', reason: String(error?.message || error) }
    return null                                   // fail closed：回落包内
  } finally {
    done()
  }
}

/**
 * 2D 渲染层用的同步解析：返回当前应加载的 URL，并**惰性**触发该图的升级（不阻塞渲染）。
 * 在 computed 中调用即可获得反应式更新（overrides 是 reactive）。
 */
export function map2dSrc(code, fallbackSrc) {
  const override = overrides[code]
  if (override) return override.url
  if (code && !triggered.has(code)) {
    triggered.add(code)
    void ensureMap2dImage(code).catch(() => {})
  }
  return fallbackSrc
}

/** 测试/自检用：清空模块内状态（不改 localStorage）。 */
export function __resetMap2dForTests() {
  readyPromise = null
  decisionCache = null
  triggered.clear()
  for (const code of Object.keys(overrides)) delete overrides[code]
  for (const code of Object.keys(map2dState.maps)) delete map2dState.maps[code]
  map2dState.status = 'off'
  map2dState.buildTime = null
  map2dState.indexGenerated = null
  map2dState.indexSource = null
  map2dRevision.value = 0
}

if (typeof window !== 'undefined' && (isAndroidRuntime() || import.meta.env?.DEV)) {
  window.__wotbMap2d = map2dState
}
