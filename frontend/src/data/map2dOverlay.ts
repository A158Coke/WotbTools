/**
 * 2D 底图 OTA 覆盖层（Android 专用）：**包内兜底 + 在线校验**。
 *
 * 形状（判据与理由见 Agent 仓 docs/game-data-sources.md §5.6 与
 * docs/reference/maps.md §2026-10-16）：
 *   包内  = `src/assets/maps/*.webp`（随 APK，离线永远可用）——兜底层；
 *   远端  = Alibaba `/agent-assets/map2d/<code>.webp`（经 AgentAssetProxy 直连 + ETag 磁盘缓存）；
 *   判据  = Alibaba `/agent-assets/map2d/index.json`（逐图 sha256 + `generated`）。
 *
 * 决策规则（纯函数 `selectMap2dSources` / `pickNewestIndex`，无启发式）：
 *   1) 无包内清单（web / 旧包）⇒ 关闭通道，全部包内；
 *   2) 候选里没有**有效**索引（在线拉取失败且无持久化副本 / schema 不受支持 / 时间戳不可解析）⇒ 全部包内；
 *   3) 候选里取 **`generated` 最大**的有效索引——`index.json` 在同一 URL 下会更新（mutable），
 *      而 AgentAssetProxy 上游失败时会返回**陈旧磁盘缓存**，所以"remote 优先"会把已见过的新版
 *      覆盖成旧版（甚至 OTA 回退）。远端只在**不旧于**已持久化副本时才写回 localStorage；
 *   4) **`generated ≤ 包内 contentGeneratedAt` ⇒ 全部包内**——包内那份的内容本身就是较新的
 *      （或同一批），此时远端没有更新可拿；
 *   5) **逐图世界框/取向必须与注册表一致**（`worldBounds` + `orientation`，见下）——换了图但取景
 *      变了（裁剪、补边、换框）时 sha256/尺寸都能"看起来正常"，只有世界框能判出来；
 *   6) 逐图：`index.sha256 == 包内 sha256` ⇒ 用包内（字节相同，零流量）；不同 ⇒ 走远端。
 *   远端字节在使用前必须 sha256 校验（下载即验证），失败/取不到/几何不符 ⇒ 该图回落包内。
 *
 * ⚠️ **几何契约（索引 schemaVersion 2，Agent 仓 `tools/export_2d_basemaps.py` 起）**：
 *   2D 渲染把回放坐标按注册表 `coordinateBounds`（±300 m）线性映射到整幅图（`utils/mapView.js`），
 *   即"顶行 = +Z、左列 = +X、全幅覆盖 ±300"。**栅格分辨率不参与映射**（图与标记同框拉伸），
 *   所以唯一会错位的是**取景**——索引必须逐图声明 `worldBounds` + `orientation`，本模块据此
 *   与注册表比对后才允许换图；schemaVersion 1 的索引没有这份声明（无法判定取景）⇒ 一律不换
 *   （fail-closed 回落包内，`map2dState.status = 'schema'`）。
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
import { mapImages } from './mapImages.js'

/** map2d 索引条目（Agent 仓 INDEX_SCHEMA v2；几何契约字段见文件头）。 */
export interface Map2dIndexEntry {
  sha256?: unknown
  path?: unknown
  bytes?: unknown
  width?: unknown
  height?: unknown
  orientation?: unknown
  worldBounds?: { xMin?: unknown; xMax?: unknown; yMin?: unknown; yMax?: unknown } | null
  [key: string]: unknown
}

/** map2d 索引（schemaVersion 2；`maps` 缺省 = 旧产物，按 no-index 处理）。 */
export interface Map2dIndex {
  schemaVersion?: unknown
  generated?: unknown
  contentGeneratedAt?: unknown
  maps?: Record<string, Map2dIndexEntry | null> | null
  [key: string]: unknown
}

/** 包内清单（`/map2d-embedded.json`；contentGeneratedAt 与 COS 索引 generated 同源）。 */
export interface Map2dEmbeddedManifest {
  contentGeneratedAt?: unknown
  maps?: Record<string, { sha256?: unknown } | null> | null
  [key: string]: unknown
}

/** 世界框（注册表 coordinateBounds；几何契约的比对面）。 */
export interface Map2dBounds {
  xMin: number
  xMax: number
  yMin: number
  yMax: number
}

export interface Map2dUseEntry {
  sha256: string
  path: string
  bytes: number | null
  width: number | null
  height: number | null
}

export interface Map2dDecision {
  active: boolean
  reason: string
  index: Map2dIndex | null
  source: 'remote' | 'stored' | null
  use: Record<string, Map2dUseEntry>
  rejected: Record<string, string>
}

const EMBEDDED_URL = '/map2d-embedded.json'
const INDEX_URL = `${ANDROID_ASSET_BASE}/map2d/index.json`
const STORE_KEY = 'wotb.map2d.index.v1'
/** 远端索引 schema（Agent 仓 INDEX_SCHEMA）：2 起逐图带几何契约（worldBounds + orientation）。 */
const SCHEMA_VERSION = 2
/** 取向契约常量（契约不搜索：顶行 = +Z_scene、左列 = +X_scene）。 */
const ORIENTATION = 'top=+Z,left=+X'
const INDEX_TIMEOUT_MS = 8000
const IMAGE_TIMEOUT_MS = 20000

/** 任一覆盖生效即 +1：给"必须感知换图"的命令式消费方（如 2.5D 贴图）一个可 watch 的信号。 */
export const map2dRevision = ref(0)

/** map2dState.maps 条目（诊断面）。 */
export interface Map2dDiagnosticEntry {
  source: 'embedded' | 'remote' | 'pending' | 'rejected'
  reason?: string
  bytes?: number | null
}

/** 诊断面（本地测试/自检用；不含任何凭据）。 */
export interface Map2dState {
  status: 'off' | 'no-embedded' | 'no-index' | 'schema' | 'timestamp' | 'stale-index' | 'active' | 'error'
  contentGeneratedAt: string | null
  indexGenerated: string | null
  indexSource: 'remote' | 'stored' | null
  maps: Record<string, Map2dDiagnosticEntry>
}

/** 诊断面（本地测试/自检用；不含任何凭据）。 */
export const map2dState = reactive<Map2dState>({
  status: 'off',        // off | no-embedded | no-index | schema | timestamp | stale-index | active | error
  contentGeneratedAt: null,
  indexGenerated: null,
  indexSource: null,    // remote | stored | null
  maps: {},             // code → { source: embedded|remote|pending|rejected, reason?, bytes? }
})

const overrides = reactive<Record<string, { url: string; sha256: string; bytes: number }>>({})   // code → { url, sha256, bytes }
const triggered = new Set<string>()
let readyPromise: Promise<Map2dDecision> | null = null

function timeoutSignal(ms: number): { signal: AbortSignal | undefined; done: () => void } {
  if (typeof AbortController === 'undefined') return { signal: undefined, done: () => {} }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  return { signal: controller.signal, done: () => clearTimeout(timer) }
}

async function fetchJson<T = unknown>(url: string): Promise<T | null> {
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

function readStoredIndex(): Map2dIndex | null {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function writeStoredIndex(index: Map2dIndex): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(index))
  } catch {
    /* 配额/隐私模式失败不影响功能：本轮仍用远端索引 */
  }
}

/** 索引可用性：schema 受支持且 `generated` 可解析。 */
export function isValidIndex(index: Map2dIndex | null | undefined): boolean {
  if (!index || typeof index !== 'object') return false
  if (index.schemaVersion !== SCHEMA_VERSION) return false
  return Number.isFinite(Date.parse(String(index.generated ?? '')))
}

function invalidReason(index: Map2dIndex | null | undefined): string {
  if (!index || typeof index !== 'object') return 'no-index'
  if (index.schemaVersion !== SCHEMA_VERSION) return 'schema'
  return 'timestamp'
}

/**
 * 从候选（`{ index, source }`）里取 **`generated` 最大**的有效索引；全都无效返回 null。
 * 并列时按传入顺序取后者（调用方按 stored → remote 传，因此并列偏向 live 的 remote）。
 */
export function pickNewestIndex(candidates: Array<{ index: Map2dIndex | null | undefined; source: 'remote' | 'stored' }>): { index: Map2dIndex; source: 'remote' | 'stored'; time: number } | null {
  let best: { index: Map2dIndex; source: 'remote' | 'stored'; time: number } | null = null
  for (const candidate of candidates) {
    if (!isValidIndex(candidate?.index)) continue
    const time = Date.parse(String(candidate.index!.generated))
    if (!best || time >= best.time) best = { index: candidate.index!, source: candidate.source, time }
  }
  return best
}

/**
 * 纯函数：给定（远端索引、持久化索引、包内清单），决定每张地图的来源。
 * 返回 { active, reason, index, source, use: { code: { sha256, path, bytes } }, rejected }。
 *
 * `boundsByCode`（`code → coordinateBounds | undefined`）：注册表的世界框（**几何契约的比对面**）。
 * 生产调用传 `mapImages` 派生表；索引条目声明 `worldBounds`/`orientation` 且与注册表逐值一致
 * 才允许换图——见头部「几何契约」段。
 */
export function selectMap2dSources({ remoteIndex = null, storedIndex = null, embedded = null, boundsByCode = {} }: {
  remoteIndex?: Map2dIndex | null
  storedIndex?: Map2dIndex | null
  embedded?: Map2dEmbeddedManifest | null
  /** code → 注册表 coordinateBounds（几何契约的比对面；生产调用传 mapImages 派生表） */
  boundsByCode?: Record<string, Map2dBounds | undefined>
} = {}): Map2dDecision {
  const embeddedMaps = embedded && typeof embedded === 'object' ? embedded.maps : null
  if (!embeddedMaps || typeof embeddedMaps !== 'object' || Object.keys(embeddedMaps).length === 0) {
    return { active: false, reason: 'no-embedded', index: null, source: null, use: {}, rejected: {} }
  }
  const newest = pickNewestIndex([
    { index: storedIndex, source: 'stored' },
    { index: remoteIndex, source: 'remote' },
  ])
  if (!newest) {
    const supplied = remoteIndex || storedIndex
    return { active: false, reason: supplied ? invalidReason(remoteIndex || storedIndex) : 'no-index',
             index: null, source: null, use: {}, rejected: {} }
  }
  const contentStamp = Date.parse(String(embedded?.contentGeneratedAt ?? ''))
  if (!Number.isFinite(contentStamp)) {
    return { active: false, reason: 'timestamp', index: newest.index, source: newest.source, use: {}, rejected: {} }
  }
  if (newest.time <= contentStamp) {
    return { active: false, reason: 'stale-index', index: newest.index, source: newest.source, use: {}, rejected: {} }
  }
  const use: Record<string, Map2dUseEntry> = {}
  const rejected: Record<string, string> = {}
  const indexMaps = newest.index.maps && typeof newest.index.maps === 'object' ? newest.index.maps : {}
  for (const [code, entry] of Object.entries(indexMaps)) {
    const local = embeddedMaps[code]
    if (!local || !entry) continue
    if (typeof entry.sha256 !== 'string' || typeof entry.path !== 'string') continue
    if (!geometryMatches(entry, boundsByCode[code])) { rejected[code] = 'geometry'; continue }
    if (entry.sha256 === local.sha256) continue   // 字节相同 ⇒ 包内那份就是最新，零流量
    use[code] = {
      sha256: entry.sha256,
      path: entry.path,
      bytes: typeof entry.bytes === 'number' && Number.isFinite(entry.bytes) ? entry.bytes : null,
      width: typeof entry.width === 'number' && Number.isFinite(entry.width) ? entry.width : null,
      height: typeof entry.height === 'number' && Number.isFinite(entry.height) ? entry.height : null,
    }
  }
  return { active: true, reason: newest.source === 'remote' ? 'remote-index' : 'stored-index',
           index: newest.index, source: newest.source, use, rejected }
}

/**
 * 几何契约判定（**只有 schemaVersion 2 的索引才带这些字段**）：
 * 取向常量逐字相等、像素尺寸为正方形、世界框与注册表 `coordinateBounds` 逐值相等
 * （无注册表条目 ⇒ 判否）。任何一项不成立 ⇒ 该图不换（回落包内）。
 */
export function geometryMatches(entry: Map2dIndexEntry | null | undefined, bounds: Map2dBounds | null | undefined): boolean {
  if (!entry || typeof entry !== 'object') return false
  if (entry.orientation !== ORIENTATION) return false
  if (!(Number.isFinite(entry.width) && Number.isFinite(entry.height)) || entry.width !== entry.height) return false
  const wb = entry.worldBounds
  if (!wb || typeof wb !== 'object') return false
  if (!bounds || typeof bounds !== 'object') return false
  const b = bounds as Map2dBounds
  return (['xMin', 'xMax', 'yMin', 'yMax'] as const).every((k) => {
    const v = wb[k]
    return typeof v === 'number' && Number.isFinite(v) && v === b[k]
  })
}

async function init(): Promise<Map2dDecision> {
  if (!isAndroidRuntime()) {
    map2dState.status = 'off'
    return { active: false, reason: 'off', index: null, source: null, use: {}, rejected: {} }
  }
  const embedded = await fetchJson<Map2dEmbeddedManifest>(EMBEDDED_URL)
  if (!embedded) {
    map2dState.status = 'no-embedded'
    return { active: false, reason: 'no-embedded', index: null, source: null, use: {}, rejected: {} }
  }
  map2dState.contentGeneratedAt = (embedded.contentGeneratedAt ?? null) as string | null
  const stored = readStoredIndex()
  const remote = await fetchJson<Map2dIndex>(INDEX_URL)
  // 只在远端**不旧于**已持久化副本时覆盖：proxy 的陈旧缓存不得把见过的新版打回去。
  if (remote && isValidIndex(remote)) {
    const remoteTime = Date.parse(String(remote.generated))
    const storedTime = stored && isValidIndex(stored) ? Date.parse(String(stored.generated)) : Number.NEGATIVE_INFINITY
    if (remoteTime >= storedTime) writeStoredIndex(remote)
  }
  const decision = selectMap2dSources({ remoteIndex: remote, storedIndex: readStoredIndex(), embedded, boundsByCode: registryBounds() })
  map2dState.status = (decision.active ? 'active' : decision.reason) as Map2dState['status']
  map2dState.indexGenerated = (decision.index?.generated ?? null) as string | null
  map2dState.indexSource = decision.source
  for (const code of Object.keys(embedded.maps ?? {})) {
    if (decision.use[code]) map2dState.maps[code] = { source: 'pending', bytes: decision.use[code].bytes }
    else if (decision.rejected?.[code]) map2dState.maps[code] = { source: 'rejected', reason: decision.rejected[code] }
    else map2dState.maps[code] = { source: 'embedded' }
  }
  return decision
}

/** 注册表世界框（几何契约的比对面）：`code → coordinateBounds`。 */
function registryBounds(): Record<string, Map2dBounds> {
  const out: Record<string, Map2dBounds> = {}
  for (const [code, entry] of Object.entries(mapImages || {})) {
    if (entry && entry.coordinateBounds) out[code] = entry.coordinateBounds
  }
  return out
}

/** 共享一次初始化（首次真正需要 2D 底图时才触发，不占启动时间）。 */
export function ensureMap2dReady(): Promise<Map2dDecision> {
  if (!readyPromise) {
    readyPromise = init().catch((): Map2dDecision => ({
      active: false, reason: 'error', index: null, source: null, use: {}, rejected: {},
    }))
  }
  return readyPromise
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) return null                       // 无 SubtleCrypto ⇒ 无法校验 ⇒ 不启用远端
  const digest = await subtle.digest('SHA-256', buffer)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * 取该 code 的可用 URL（远端已校验并通过时返回 blob URL；否则 null = 沿用包内）。
 * 供命令式消费方（2.5D 贴图）在**后台** await；2D 渲染走 `map2dSrc`（同步 + 反应式）。
 */
export async function ensureMap2dImage(code: string): Promise<string | null> {
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
    // 字节校验通过后**再验解码几何**：索引声明的像素尺寸必须与实际解码一致（防"索引写 1254²
    // 实际是别的取景/尺寸"——sha256 只能证明拿到的就是索引描述的那份字节，不能证明取景正确）。
    try {
      await assertDecodedGeometry(url, want)
    } catch (error) {
      URL.revokeObjectURL(url)
      throw error
    }
    overrides[code] = { url, sha256: want.sha256, bytes: buffer.byteLength }
    map2dState.maps[code] = { source: 'remote', bytes: buffer.byteLength }
    map2dRevision.value += 1
    return url
  } catch (error) {
    map2dState.maps[code] = { source: 'rejected', reason: String((error as Error)?.message || error) }
    return null                                   // fail closed：回落包内
  } finally {
    done()
  }
}

/** 解码远端底图并核对像素尺寸（与索引声明一致；WebView/浏览器共用同一路径）。 */
async function assertDecodedGeometry(url: string, want: Map2dUseEntry): Promise<void> {
  if (!(typeof want.width === 'number' && typeof want.height === 'number')) throw new Error('geometry:no-dims')
  const image = new Image()
  image.src = url
  if (typeof image.decode === 'function') await image.decode()
  else await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject })
  if (image.naturalWidth !== want.width || image.naturalHeight !== want.height) {
    throw new Error(`geometry:${image.naturalWidth}x${image.naturalHeight}≠${want.width}x${want.height}`)
  }
}

/**
 * 2D 渲染层用的同步解析：返回当前应加载的 URL，并**惰性**触发该图的升级（不阻塞渲染）。
 * 在 computed 中调用即可获得反应式更新（overrides 是 reactive）。
 */
export function map2dSrc(code: string, fallbackSrc: string): string {
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
  map2dState.indexSource = null  // reset
  map2dRevision.value = 0
}

if (typeof window !== 'undefined' && (isAndroidRuntime() || import.meta.env?.DEV)) {
  window.__wotbMap2d = map2dState
}
