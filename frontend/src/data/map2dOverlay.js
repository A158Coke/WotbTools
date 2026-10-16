/**
 * 2D 底图 OTA 覆盖层（Android 专用）：**包内兜底 + 在线校验**。
 *
 * 形状（判据与理由见 Agent 仓 docs/game-data-sources.md §5.6 与
 * docs/reference/maps.md §2026-10-16）：
 *   包内  = `src/assets/maps/*.webp`（随 APK，离线永远可用）——兜底层；
 *   远端  = COS `/agent-assets/map2d/<code>.webp`（经 AgentAssetProxy 直连 + ETag 磁盘缓存）；
 *   判据  = COS `/agent-assets/map2d/index.json`（逐图 sha256 + `generated`）。
 *
 * 决策规则（纯函数 `selectMap2dSources` / `pickNewestIndex`，无启发式）：
 *   1) 无包内清单（web / 旧包）⇒ 关闭通道，全部包内；
 *   2) 候选里没有**有效**索引（在线拉取失败且无持久化副本 / schema 不支持 / 时间戳不可解析）⇒ 全部包内；
 *   3) 候选里取 **`generated` 最大**的有效索引——`index.json` 在同一 URL 下会更新（mutable），
 *      而 AgentAssetProxy 上游失败时会返回**陈旧磁盘缓存**，所以"remote 优先"会把已见过的新版
 *      覆盖成旧版（甚至 OTA 回退）。远端只在**不旧于**已持久化副本时才写回 localStorage；
 *   4) **`generated ≤ 包内 contentGeneratedAt` ⇒ 全部包内**——包内那份的内容本身就是较新的
 *      （或同一批），此时远端没有更新可拿；
 *   5) 逐图：`index.sha256 == 包内 sha256` ⇒ 用包内（字节相同，零流量）；不同 ⇒ 走远端。
 *   远端字节在使用前必须 sha256 校验（下载即验证），失败/取不到 ⇒ 该图回落包内。
 *
 * ⚠️ `contentGeneratedAt` 是**底图内容自身的生成时刻**（Agent 仓导出时写进 `map2d-source.json`，
 * 与 COS 索引的 `generated` 同源），**不是** CI 构建时间：用 wall-clock 会把"内容其实更新"
 * 判成更旧（Android stage 晚于 COS 发布才构建时永久拒绝升级），也会让同一 commit 的两次构建
 * 产出不同字节的 bundle。**不要在这个字段上引入 `new Date()`。**
 *
 * 传输与离线缓存复用现有 AgentAssetProxy（条件请求 + 磁盘缓存 + 上游失败回落陈旧），
 * 因此本模块不做任何原生改动。
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
  contentGeneratedAt: null,
  indexGenerated: null,
  indexSource: null,    // remote | stored | null
  maps: {},             // code → { source: embedded|remote|pending|rejected, reason?, bytes? }
})

const overrides = reactive({})   // code → { url, sha256, bytes }
const triggered = new Set()
let readyPromise = null

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

/** 索引可用性：schema 受支持且 `generated` 可解析。 */
export function isValidIndex(index) {
  if (!index || typeof index !== 'object') return false
  if (index.schemaVersion !== SCHEMA_VERSION) return false
  return Number.isFinite(Date.parse(String(index.generated ?? '')))
}

function invalidReason(index) {
  if (!index || typeof index !== 'object') return 'no-index'
  if (index.schemaVersion !== SCHEMA_VERSION) return 'schema'
  return 'timestamp'
}

/**
 * 从候选（`{ index, source }`）里取 **`generated` 最大**的有效索引；全都无效返回 null。
 * 并列时按传入顺序取后者（调用方按 stored → remote 传，因此并列偏向 live 的 remote）。
 */
export function pickNewestIndex(candidates) {
  let best = null
  for (const candidate of candidates) {
    if (!isValidIndex(candidate?.index)) continue
    const time = Date.parse(String(candidate.index.generated))
    if (!best || time >= best.time) best = { index: candidate.index, source: candidate.source, time }
  }
  return best
}

/**
 * 纯函数：给定（远端索引、持久化索引、包内清单），决定每张地图的来源。
 * 返回 { active, reason, index, source, use: { code: { sha256, path, bytes } } }。
 */
export function selectMap2dSources({ remoteIndex = null, storedIndex = null, embedded = null } = {}) {
  const embeddedMaps = embedded && typeof embedded === 'object' ? embedded.maps : null
  if (!embeddedMaps || typeof embeddedMaps !== 'object' || Object.keys(embeddedMaps).length === 0) {
    return { active: false, reason: 'no-embedded', index: null, source: null, use: {} }
  }
  const newest = pickNewestIndex([
    { index: storedIndex, source: 'stored' },
    { index: remoteIndex, source: 'remote' },
  ])
  if (!newest) {
    const supplied = remoteIndex || storedIndex
    return { active: false, reason: supplied ? invalidReason(remoteIndex || storedIndex) : 'no-index',
             index: null, source: null, use: {} }
  }
  const contentStamp = Date.parse(String(embedded.contentGeneratedAt ?? ''))
  if (!Number.isFinite(contentStamp)) {
    return { active: false, reason: 'timestamp', index: newest.index, source: newest.source, use: {} }
  }
  if (newest.time <= contentStamp) {
    return { active: false, reason: 'stale-index', index: newest.index, source: newest.source, use: {} }
  }
  const use = {}
  const indexMaps = newest.index.maps && typeof newest.index.maps === 'object' ? newest.index.maps : {}
  for (const [code, entry] of Object.entries(indexMaps)) {
    const local = embeddedMaps[code]
    if (!local || !entry) continue
    if (typeof entry.sha256 !== 'string' || typeof entry.path !== 'string') continue
    if (entry.sha256 === local.sha256) continue   // 字节相同 ⇒ 包内那份就是最新，零流量
    use[code] = { sha256: entry.sha256, path: entry.path, bytes: Number.isFinite(entry.bytes) ? entry.bytes : null }
  }
  return { active: true, reason: newest.source === 'remote' ? 'remote-index' : 'stored-index',
           index: newest.index, source: newest.source, use }
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
  map2dState.contentGeneratedAt = embedded.contentGeneratedAt ?? null
  const stored = readStoredIndex()
  const remote = await fetchJson(INDEX_URL)
  // 只在远端**不旧于**已持久化副本时覆盖：proxy 的陈旧缓存不得把见过的新版打回去。
  if (isValidIndex(remote)) {
    const remoteTime = Date.parse(String(remote.generated))
    const storedTime = isValidIndex(stored) ? Date.parse(String(stored.generated)) : Number.NEGATIVE_INFINITY
    if (remoteTime >= storedTime) writeStoredIndex(remote)
  }
  const decision = selectMap2dSources({ remoteIndex: remote, storedIndex: readStoredIndex(), embedded })
  map2dState.status = decision.active ? 'active' : decision.reason
  map2dState.indexGenerated = decision.index?.generated ?? null
  map2dState.indexSource = decision.source ?? null
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
 * 供命令式消费方（2.5D 贴图）在**后台** await；2D 渲染走 `map2dSrc`（同步 + 反应式）。
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
  triggered.clear()
  for (const code of Object.keys(overrides)) delete overrides[code]
  for (const code of Object.keys(map2dState.maps)) delete map2dState.maps[code]
  map2dState.status = 'off'
  map2dState.contentGeneratedAt = null
  map2dState.indexGenerated = null
  map2dState.indexSource = null
  map2dRevision.value = 0
}

if (typeof window !== 'undefined' && (isAndroidRuntime() || import.meta.env?.DEV)) {
  window.__wotbMap2d = map2dState
}
