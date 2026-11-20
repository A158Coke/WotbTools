// 回放数据源（契约 v2）：**client-only**——本地 WASM 解析（文件不出本机），
// 无服务端通道。WotBTools Playback 拓扑不含 Business API / Agent 自托管服务端
//（评审 P0-3）；地图/地形/场景等渲染资产经 assetProvider 走配置的 remote asset origin。
//
// 解析在 Worker 里跑（playbackParse.worker.ts）：把 WASM `parsePlayback`（单场 ~95ms）
// 移出 UI 线程；主线程只做 JSON.parse 与契约校验。同一份文件（**完整内容 SHA-256**）
// 的解析结果缓存最近 3 场，重复打开直接命中。Worker 不可用时回退主线程同一条路径。
//
// WASM 产物由 CI 依据 deploy/agent/source.json 锁定的上游 Release 产物直取
//（fetch-agent-wasm.sh，sha256 + fingerprint 双重校验）到 common/assets/wasm/<ref>/，
// 经 publicDir 进 dist，线上由 /wasm/<ref>/ 伺服；产物缺失时本地通道拒绝并提示。
// 装载器与 AI/表格通道共用 `api/agent-replay-facets` 的 `loadAgentWasmModule`：versioned URL
//（URL identity = upstream commit）+ fingerprint 版本门禁，错版产物在装载阶段就抛
// `AgentWasmVersionMismatchError`，不会把别的 build 的 Agent 静默喂给渲染层。

// 契约校验复用 api/agent-replay-facets 的 validateAgentPlayback（trust-boundary
// 单一实现）：3D 路径此前只做 JSON.parse，错版 WASM 可静默载入 v1 数据（缺
// supremacy_bases/points），版本门禁形同虚设。
import { loadAgentWasmModule, validateAgentPlayback, validateAgentRecorderCamera } from '../api/agent-replay-facets.js'
import { assetProvider } from './assetProvider.js'
import { buildPitchLimits } from './pitchLimits.js'
import type { AgentPlaybackFacet } from '../api/agent-replay-facets.js'
import type { PlaybackParseKind, PlaybackParseDiagnostics } from './playbackParse.worker.js'

export type PlaybackDiagnosticEvent = { stage: string; durationMs?: number; status?: string; digest?: string }
export type PlaybackDiagnosticObserver = (event: PlaybackDiagnosticEvent) => void

// Diagnostics must never change parsing, caching or cancellation semantics.
function emitPlaybackDiagnostic(observer: PlaybackDiagnosticObserver | undefined, event: PlaybackDiagnosticEvent) {
  try { observer?.(event) } catch { /* observer is best effort */ }
}
function measured(observer: PlaybackDiagnosticObserver | undefined, stage: string, start: number) {
  if (observer) emitPlaybackDiagnostic(observer, { stage, durationMs: performance.now() - start })
}


type ReplayFile = Blob & { name?: string; lastModified?: number }
type ParseReply = { id?: number; json?: string; error?: string; diagnostics?: PlaybackParseDiagnostics }
interface ParsePending {
  resolve: (reply: ParseReply) => void
  reject: (error: unknown) => void
  signal?: AbortSignal
  watchdog: ReturnType<typeof setTimeout> | null
  onAbort: (() => void) | null
}

/**
 * 本地通道（唯一通道）：File/Blob → 浏览器文件接口 → WASM parsePlayback →
 * PlaybackData（契约 v2 时序能力）。
 */
// tank_id → 显示名（静态 tank_cache.json；资产源未配置/缺失 → 空表，label 走
// tank_{id} 兜底）。解析/身份面保持 asset-independent——此处仅补**展示名**。
let tankNamesPromise: Promise<Map<number, string>> | null = null
export function tankNamesStatic() {
  if (!tankNamesPromise) {
    tankNamesPromise = assetProvider.json<Record<string, { name?: string } | null>>('/data/tank_cache.json').then((cache) => {
      const out = new Map<number, string>()
      for (const [id, info] of Object.entries(cache || {})) {
        if (info && info.name) out.set(Number(id), info.name)
      }
      return out
    }).catch(() => {
      tankNamesPromise = null
      return new Map()
    })
  }
  return tankNamesPromise
}

// ---------- 解析 Worker 与解析结果缓存 ----------
// 解析（WASM `parsePlayback`，单场 95ms 量级）在 Worker 里跑，主线程只做 JSON.parse 与
// 契约校验（见 playbackParse.worker.ts 的取舍说明）。Worker 构造/崩溃时回退主线程同一条
// WASM 路径——行为与改造前一致，只是少了线程隔离。
//
// 解析任务的**生命周期所有权**（P0 review blocker 回归）：请求进 `parsePending` 后，只有
// Worker 回包/报错才结算——没有看门狗时，Worker「不回包也不报错」（装载链网络停滞一类）
// 会让后续请求无限排队、3D 永远停在「解析中」。因此：
// - 每个请求带**看门狗**：超时判定 Worker 不可信 → terminate + 在途全部失败，下次重建；
// - 每个请求可 **abort**（清空 / 换文件 / 销毁传入 signal）：被撤下的解析立即以
//   AbortError 结束、若仍在 Worker 上则整体 terminate 让出队列——旧解析不得占位。
const PLAYBACK_JSON_CACHE_MAX = 3;   // 每条 JSON 约 2–3MB，故只留最近 3 场
const playbackJsonCache = new Map<string, string>();
let parseWorker: Worker | null = null;
let parseSeq = 0;
const parsePending = new Map<number, ParsePending>();
/** 单场解析毫秒级、巨型文件秒级：120s 只兜「Worker 不回包也不报错」的真异常。 */
const PARSE_WATCHDOG_MS = 120_000;

/** abort 的规范错误形态：调用方可按 name === 'AbortError' 分流「主动撤下」与真失败。 */
function playbackParseAbortError() {
  return new DOMException('playback 解析已被撤下（清空 / 换文件 / 销毁）', 'AbortError')
}

/** 整体放弃当前 Worker：在途 / 排队请求全部按给定错误结算（清看门狗、摘 abort 监听），
 *  Worker terminate 掉，下次请求自动重建。迟到回包走 onmessage 的 `pending 不在表内`
 *  分支被忽略，不会产生未处理拒绝。 */
function abandonParseWorker(error: unknown) {
  const pendings = [...parsePending.values()];
  parsePending.clear();
  for (const pending of pendings) {
    if (pending.watchdog) clearTimeout(pending.watchdog);
    pending.signal?.removeEventListener('abort', pending.onAbort!);
    pending.reject(error);
  }
  if (parseWorker) {
    try { parseWorker.terminate(); } catch { /* 已死 */ }
    parseWorker = null;
  }
}

function wireParseWorker(worker: Worker) {
  // 返回值 = **本回包是否被认领**（true=结算了在途请求，false=迟到回包被忽略）。
  // 真实 Worker 忽略返回值；这个契约存在的意义是让注入的假 Worker（unit / browser
  // 回归）能直接观察「迟到回包无人认领」，而不是只能间接推断。
  worker.onmessage = (event: MessageEvent<ParseReply | null>) => {
    const { id, error }: ParseReply = event.data || {};
    const pending = parsePending.get(id as number);
    if (!pending) return false;   // 迟到回包（已被 abort / 看门狗结算）：无人认领，忽略
    parsePending.delete(id as number);
    if (pending.watchdog) clearTimeout(pending.watchdog);
    pending.signal?.removeEventListener('abort', pending.onAbort!);
    if (error) pending.reject(new Error(error)); else pending.resolve(event.data || {});
    return true;
  };
  // 崩溃/初始化失败：在飞请求全部失败、worker 置空待下次重建（不回退主线程——
  // 崩溃是整体性的，调用方按错误处理并可重试）
  worker.onerror = (event) => {
    abandonParseWorker(new Error(event.message || 'playback parse worker crashed'));
  };
}

/** 仅测试用：注入假 Worker（happy-dom 造不出真 Worker；注入的 Worker 会走与真实
 *  Worker 完全相同的 onmessage / onerror 装配，看门狗 / 迟到回包语义由此验证）。
 *  传 null 复位为真实创建路径。 */
let testParseWorker: Worker | (() => Worker) | null = null;
export function __setParseWorkerForTest(worker: Worker | (() => Worker) | null) {
  testParseWorker = worker;
}

// `?debug`（与 Replay3DPane 的 `window.__pbPane` 同一口径）：把上面这个注入点暴露给
// browser 回归。A → 清空 → B 的真实在途生命周期必须在**真浏览器**里验证，而 A 要确定性地
// 停在解析中，就不能用真产物（fixture server 没有 WASM）。暴露的只有「Worker 从哪来」，
// 结算 / abort / 看门狗全部仍是生产代码。
if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug')) {
  window.__pbReplaySource = { __setParseWorkerForTest };
}

function parseWorkerInstance() {
  if (parseWorker) return parseWorker;
  try {
    // 注入点可以是工厂（每次调用产出**新的**假 Worker，模拟真实 Worker 在 terminate 后重建）
    const worker = typeof testParseWorker === 'function' ? testParseWorker() : testParseWorker
      ?? new Worker(new URL('./playbackParse.worker.ts', import.meta.url), { type: 'module' });
    wireParseWorker(worker);
    parseWorker = worker;
  } catch { parseWorker = null; }
  return parseWorker;
}

/**
 * 精确区间的 ArrayBuffer：`bytes` 可能是 backing buffer 上的切片（subarray），直接取
 * `bytes.buffer` 会把无关字节一起交给消费者（Worker 解析 / 内容摘要）。整段时零拷贝复用，
 * 切片时才复制这一段——Worker 传输与 SHA-256 共用同一份区间判定，避免两套逻辑漂移。
 */
export function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError('exact replay bytes expected (Uint8Array)')
  }
  return (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? bytes.buffer
    : bytes.slice().buffer) as ArrayBuffer;
}

/**
 * Worker 传输载荷：Worker 契约是 ArrayBuffer（`playbackParse.worker.ts` 自己 `new Uint8Array`）。
 * 不转移所有权（`transfer`）：Worker 失败时主线程还要用同一份字节回退解析。
 */
export function playbackParsePayload(bytes: Uint8Array) {
  return exactArrayBuffer(bytes);
}

/**
 * 内容身份：**完整** replay bytes 的 SHA-256（hex）。
 *
 * Replay cache 是 **correctness cache**，identity 必须来自完整内容——不接受任何概率性/采样
 * 指纹：首/中/尾三个窗口可被确定性构造绕过（同名同长同 mtime、窗口内全同、窗口外一个字节
 * 不同 → 不同回放复用同一份 Playback JSON）。
 *
 * WebCrypto 不可用（非安全上下文等）时返回 `null`，调用方必须**完全不使用缓存**：
 * cache miss / 不缓存只是性能退化，错误 cache hit 是 correctness bug——绝不回退到采样 hash。
 */
export async function replayContentDigest(bytes: Uint8Array) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  const digest = await subtle.digest('SHA-256', exactArrayBuffer(bytes));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 缓存键：metadata（文件名 / 字节数 / mtime，便于可读与人工核对）+ **完整内容 SHA-256**。
 *  identity 只有摘要：metadata 相同不会命中，内容相同才会命中。
 *  WebCrypto 不可用（摘要为 null）时返回 null → 调用方本次不读也不写缓存。 */
async function fileCacheKey(fileObject: ReplayFile, bytes: Uint8Array) {
  const digest = await replayContentDigest(bytes);
  if (!digest) return null;
  return [fileObject && fileObject.name ? fileObject.name : '',
          bytes.byteLength,
          fileObject && fileObject.lastModified ? fileObject.lastModified : 0, digest].join('|');
}

/** 仅测试用：清空解析结果缓存（跨用例替换 WASM 桩时，同一份字节会产出不同结果） */
export function __resetPlaybackJsonCacheForTest() { playbackJsonCache.clear(); }

export async function loadFromLocalFile(fileObject: ReplayFile, signal?: AbortSignal, observer?: PlaybackDiagnosticObserver) {
  let started = observer ? performance.now() : 0
  if (signal?.aborted) throw playbackParseAbortError()
  const arrayBuffer = await fileObject.arrayBuffer()
  measured(observer, 'file.arrayBuffer', started)
  // 进入摘要 / Worker / 回退解析前统一 bytes 类型：三条路径都只认 Uint8Array
  //（此前把 ArrayBuffer 直接当字节数组用，缓存指纹恒为常量 → 同名同 mtime 的不同
  //  回放会命中彼此的结果）。
  const bytes = new Uint8Array(arrayBuffer)
  if (signal?.aborted) throw playbackParseAbortError()
  // 解析结果缓存：键 = metadata + 完整内容 SHA-256。重复打开同一场（换标签页/重进页面/
  // 重新加载同一文件）直接命中，省掉一次完整 WASM 解析；命中仍走主线程 JSON.parse
  // （约 15ms）与契约校验，形状门禁不绕过。
  started = observer ? performance.now() : 0
  const cacheKey = await fileCacheKey(fileObject, bytes)
  measured(observer, 'replay.digest', started)
  if (observer) emitPlaybackDiagnostic(observer, { stage: 'replay.identity', digest: cacheKey?.split('|').at(-1) })
  if (signal?.aborted) throw playbackParseAbortError()
  const cachedJson = cacheKey === null ? undefined : playbackJsonCache.get(cacheKey)
  if (observer) emitPlaybackDiagnostic(observer, { stage: 'json.cache', status: cachedJson !== undefined ? 'hit' : 'miss' })
  if (cachedJson !== undefined) {
    playbackJsonCache.delete(cacheKey!); playbackJsonCache.set(cacheKey!, cachedJson);   // LRU 触碰
    if (observer) {
      for (const stage of ['first.parse', 'pitchLimits.wait', 'second.parse']) {
        emitPlaybackDiagnostic(observer, { stage, status: 'skipped' })
      }
    }
    return decodePlayback(cachedJson, observer)
  }
  let json = await parsePlaybackJsonOffThread(bytes, signal, undefined, 'playback', observer, 'first')
  // 俯仰锚定两阶段：首遍拿到名册（nickname + tank_id）→ 从 tank/{id}.json 构建
  // GunPitchRange 表 → 带锚定重解析（第二遍 ~95ms）。缺省空表时 gun_pitch 走
  // hull_pitch 兜底——坡上炮管俯仰远超极限的根因。tank 数据全部缺失时跳过重解析。
  let secondParseStarted = false
  try {
    started = observer ? performance.now() : 0
    const first = JSON.parse(json)
    measured(observer, 'first.json.parse', started)
    started = observer ? performance.now() : 0
    const limits = await buildPitchLimits(first.vehicles)
    measured(observer, 'pitchLimits.wait', started)
    if (Object.keys(limits).length) {
      const limitsJson = JSON.stringify(limits)
      secondParseStarted = true
      json = await parsePlaybackJsonOffThread(bytes, signal, limitsJson, 'playback', observer, 'second')
    } else if (observer) emitPlaybackDiagnostic(observer, { stage: 'second.parse', status: 'skipped' })
  } catch (err) {
    // 会话取消必须原样上抛（调用方按 AbortError 判定归属）——不得吞成"保持首遍结果"。
    // 其余失败（锚定构建/重解析异常）：保持首遍结果（gun_pitch 兜底仍可用）。
    if ((err as Error | null)?.name === 'AbortError') throw err
    if (observer) {
      emitPlaybackDiagnostic(observer, { stage: secondParseStarted ? 'second.parse' : 'pitchLimits.wait', status: 'fallback' })
      if (!secondParseStarted) emitPlaybackDiagnostic(observer, { stage: 'second.parse', status: 'skipped' })
    }
  }
  if (cacheKey !== null) {
    playbackJsonCache.set(cacheKey, json)
    if (playbackJsonCache.size > PLAYBACK_JSON_CACHE_MAX) {
      playbackJsonCache.delete(playbackJsonCache.keys().next().value as string)   // 最旧一条
    }
  }
  // 契约 v2 门禁：与 parseAgentPlaybackFromBytes 同一校验器（错版/陈旧 WASM
  // 在此抛出，而不是把缺字段的 v1 数据交给渲染层）
  return decodePlayback(json, observer)
}

async function decodePlayback(json: string, observer?: PlaybackDiagnosticObserver) {
  let start = observer ? performance.now() : 0
  const parsed = JSON.parse(json)
  measured(observer, 'json.parse', start)
  start = observer ? performance.now() : 0
  const validated = validateAgentPlayback(parsed)
  measured(observer, 'validation', start)
  start = observer ? performance.now() : 0
  const result = await enrichPlayback(validated)
  measured(observer, 'enrichment', start)
  return result
}
async function parsePlaybackJsonOffThread(
  bytes: Uint8Array,
  signal?: AbortSignal,
  limitsJson?: string,
  kind: PlaybackParseKind = 'playback',
  observer?: PlaybackDiagnosticObserver,
  pass = 'first',
): Promise<string> {
  if (signal?.aborted) throw playbackParseAbortError()
  const worker = parseWorkerInstance();
  if (worker) {
    try {
      const start = observer ? performance.now() : 0
      const reply = await new Promise<ParseReply>((resolve, reject) => {
        const id = ++parseSeq;
        const pending: ParsePending = { resolve, reject, signal, watchdog: null, onAbort: null };
        parsePending.set(id, pending);
        // 看门狗：Worker 不回包也不报错（装载链网络停滞一类）时不能无限「解析中」。
        // 超时判定 Worker 不可信 → 整体 terminate，在途 / 排队请求一起失败（可重试，
        // 下次请求重建 Worker）。
        pending.watchdog = setTimeout(() => {
          abandonParseWorker(new Error(
            `playback 解析 Worker ${Math.round(PARSE_WATCHDOG_MS / 1000)}s 未回包，已重建（可重试）`,
          ));
        }, PARSE_WATCHDOG_MS);
        // 被撤下的解析不能再占队列：该请求仍在 Worker 上（在途或排队）时整体 terminate；
        // 已结算（正常完成）则无事发生。
        pending.onAbort = () => {
          if (parsePending.has(id)) abandonParseWorker(playbackParseAbortError())
        };
        signal?.addEventListener('abort', pending.onAbort, { once: true });
        // 不转移所有权：失败回退时主线程仍需这份字节（结构化克隆 1–2MB 成本可忽略）
        worker.postMessage({ id, kind, bytes: playbackParsePayload(bytes), limitsJson, ...(observer ? { diagnostics: true } : {}) });
      });
      if (observer) {
        const roundtrip = performance.now() - start
        emitPlaybackDiagnostic(observer, { stage: `${pass}.worker.roundtrip`, durationMs: roundtrip })
        const d = reply.diagnostics
        if (d && Number.isFinite(d.wasmReadyMs) && d.wasmReadyMs >= 0 && Number.isFinite(d.parseMs) && d.parseMs >= 0) {
          emitPlaybackDiagnostic(observer, { stage: `${pass}.wasm.ready`, durationMs: d.wasmReadyMs })
          emitPlaybackDiagnostic(observer, { stage: `${pass}.parse`, durationMs: d.parseMs })
          const unattributed = roundtrip - d.wasmReadyMs - d.parseMs
          emitPlaybackDiagnostic(observer, unattributed >= 0
            ? { stage: `${pass}.worker.unattributed`, durationMs: unattributed }
            : { stage: `${pass}.worker.unattributed`, status: 'unavailable' })
        } else emitPlaybackDiagnostic(observer, { stage: `${pass}.worker.timing`, status: 'unavailable' })
      }
      return reply.json as string
    } catch (err) {
      if (!parseWorker) {
        // Worker 已被看门狗 / abort / onerror 整体放弃：按原样上抛——主动撤下（AbortError）
        // 不得伪装成主线程重解析，崩溃重试也应从重建 Worker 开始。
        throw err;
      }
      console.warn('[playback] 解析 Worker 不可用，回退主线程解析:', err);
      parseWorker = null;
    }
  }
  if (observer) emitPlaybackDiagnostic(observer, { stage: `${pass}.worker`, status: 'fallback' })
  let started = observer ? performance.now() : 0
  const mod = await loadAgentWasmModule();
  measured(observer, `${pass}.wasm.ready`, started)
  if (signal?.aborted) throw playbackParseAbortError()
  if (kind === 'recorder-camera') {
    if (typeof mod.parseRecorderCamera !== 'function') {
      throw new Error('agent wasm: parseRecorderCamera 缺失（产物版本早于 v0.4.21）')
    }
    return mod.parseRecorderCamera(bytes);
  }
  if (typeof mod.parsePlayback !== 'function') {
    throw new Error('agent wasm: parsePlayback 缺失（产物版本早于契约 v2）')
  }
  started = observer ? performance.now() : 0
  const json = mod.parsePlayback(bytes, undefined, limitsJson || undefined);
  measured(observer, `${pass}.parse`, started)
  return json;
}

/**
 * 录像者相机状态：与 Playback 分开解析，只有 3D 需要它。走同一 Worker 与 session
 * 取消语义；返回 `null` 表示上游结构校验未通过。
 */
export async function loadRecorderCameraFromFile(fileObject: ReplayFile, signal?: AbortSignal) {
  if (signal?.aborted) throw playbackParseAbortError()
  const bytes = new Uint8Array(await fileObject.arrayBuffer())
  const json = await parsePlaybackJsonOffThread(bytes, signal, undefined, 'recorder-camera')
  return validateAgentRecorderCamera(JSON.parse(json))
}

/** 展示名富化（本地通道与缓存命中路径共用） */
async function enrichPlayback(data: AgentPlaybackFacet) {
  // 展示名富化：客户端 WASM 无 tank_names（数据边界），按静态资产补齐；
  // 仅补空值，不覆盖上游已有名。失败不阻断回放（兜底显示 tank_{id}）
  try {
    const names = await tankNamesStatic()
    if (names.size) {
      for (const v of data.vehicles || []) {
        if (v.tank_id && !v.tank_name) v.tank_name = names.get(v.tank_id) || ''
      }
    }
  } catch { /* 资产缺失：兜底显示 */ }
  return data
}

/**
 * 统一入口（playbackScene.loadData 委托至此）。
 * 仅接受 { kind:'local', file, signal? }；server 形态在 client-only 拓扑下不存在——
 * 显式拒绝而非静默吞掉，防止调用方误以为有服务端通道。`signal` 是解析任务的
 * session 所有权：清空 / 换文件 / 销毁时由调用方 abort，被撤下的解析立即以
 * AbortError 结束并让出 Worker 队列，不再无限排队。
 */
export async function loadPlaybackData(source: { kind?: string; file?: ReplayFile; signal?: AbortSignal; observer?: PlaybackDiagnosticObserver } | null | undefined) {
  if (source && source.kind === 'local' && source.file) {
    return loadFromLocalFile(source.file, source.signal, source.observer)
  }
  throw new Error('回放数据源仅支持本地文件（client-only 拓扑，无服务端通道）')
}

// 地图静态路径已拆至 replayMapAssets.ts（行数预算）；符号原地转出口，消费方导入路径不变。
export {
  loadMapIndex,
  resolveMapKey,
  __resetMapIndexForTest,
  mapCoverUrl,
  map2dCanonicalUrl,
  loadMap2dIndex,
  __resetMap2dIndexForTest,
  resolveMap2dBasemap,
  mapStaticUrl,
} from './replayMapAssets.js'
