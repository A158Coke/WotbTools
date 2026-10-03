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
import { loadAgentWasmModule, validateAgentPlayback } from '../api/agent-replay-facets.js'

/**
 * 本地通道（唯一通道）：File/Blob → 浏览器文件接口 → WASM parsePlayback →
 * PlaybackData（契约 v2 时序能力）。
 */
// tank_id → 显示名（静态 tank_cache.json；资产源未配置/缺失 → 空表，label 走
// tank_{id} 兜底）。解析/身份面保持 asset-independent——此处仅补**展示名**。
let tankNamesPromise = null
function tankNamesStatic() {
  if (!tankNamesPromise) {
    tankNamesPromise = assetProvider.json('/data/tank_cache.json').then((cache) => {
      const out = new Map()
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
const PLAYBACK_JSON_CACHE_MAX = 3;   // 每条 JSON 约 2–3MB，故只留最近 3 场
const playbackJsonCache = new Map();
let parseWorker = null;
let parseSeq = 0;
const parsePending = new Map();

function parseWorkerInstance() {
  if (parseWorker) return parseWorker;
  try {
    const worker = new Worker(new URL('./playbackParse.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event) => {
      const { id, json, error } = event.data || {};
      const pending = parsePending.get(id);
      if (!pending) return;
      parsePending.delete(id);
      if (error) pending.reject(new Error(error)); else pending.resolve(json);
    };
    // 崩溃/初始化失败：在飞请求全部失败并由调用方回退主线程，worker 置空待下次重建
    worker.onerror = (event) => {
      const err = new Error(event.message || 'playback parse worker crashed');
      for (const pending of parsePending.values()) pending.reject(err);
      parsePending.clear();
      parseWorker = null;
    };
    parseWorker = worker;
  } catch { parseWorker = null; }
  return parseWorker;
}

/**
 * 精确区间的 ArrayBuffer：`bytes` 可能是 backing buffer 上的切片（subarray），直接取
 * `bytes.buffer` 会把无关字节一起交给消费者（Worker 解析 / 内容摘要）。整段时零拷贝复用，
 * 切片时才复制这一段——Worker 传输与 SHA-256 共用同一份区间判定，避免两套逻辑漂移。
 */
export function exactArrayBuffer(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError('exact replay bytes expected (Uint8Array)')
  }
  return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? bytes.buffer
    : bytes.slice().buffer;
}

/**
 * Worker 传输载荷：Worker 契约是 ArrayBuffer（`playbackParse.worker.ts` 自己 `new Uint8Array`）。
 * 不转移所有权（`transfer`）：Worker 失败时主线程还要用同一份字节回退解析。
 */
export function playbackParsePayload(bytes) {
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
export async function replayContentDigest(bytes) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  const digest = await subtle.digest('SHA-256', exactArrayBuffer(bytes));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 缓存键：metadata（文件名 / 字节数 / mtime，便于可读与人工核对）+ **完整内容 SHA-256**。
 *  identity 只有摘要：metadata 相同不会命中，内容相同才会命中。
 *  WebCrypto 不可用（摘要为 null）时返回 null → 调用方本次不读也不写缓存。 */
async function fileCacheKey(fileObject, bytes) {
  const digest = await replayContentDigest(bytes);
  if (!digest) return null;
  return [fileObject && fileObject.name ? fileObject.name : '',
          bytes.byteLength,
          fileObject && fileObject.lastModified ? fileObject.lastModified : 0, digest].join('|');
}

/** 仅测试用：清空解析结果缓存（跨用例替换 WASM 桩时，同一份字节会产出不同结果） */
export function __resetPlaybackJsonCacheForTest() { playbackJsonCache.clear(); }

export async function loadFromLocalFile(fileObject) {
  const arrayBuffer = await fileObject.arrayBuffer()
  // 进入摘要 / Worker / 回退解析前统一 bytes 类型：三条路径都只认 Uint8Array
  //（此前把 ArrayBuffer 直接当字节数组用，缓存指纹恒为常量 → 同名同 mtime 的不同
  //  回放会命中彼此的结果）。
  const bytes = new Uint8Array(arrayBuffer)
  // 解析结果缓存：键 = metadata + 完整内容 SHA-256。重复打开同一场（换标签页/重进页面/
  // 重新加载同一文件）直接命中，省掉一次完整 WASM 解析；命中仍走主线程 JSON.parse
  // （约 15ms）与契约校验，形状门禁不绕过。
  const cacheKey = await fileCacheKey(fileObject, bytes)
  const cachedJson = cacheKey === null ? undefined : playbackJsonCache.get(cacheKey)
  if (cachedJson !== undefined) {
    playbackJsonCache.delete(cacheKey); playbackJsonCache.set(cacheKey, cachedJson);   // LRU 触碰
    return enrichPlayback(validateAgentPlayback(JSON.parse(cachedJson)))
  }
  const json = await parsePlaybackJsonOffThread(bytes)
  if (cacheKey !== null) {
    playbackJsonCache.set(cacheKey, json)
    if (playbackJsonCache.size > PLAYBACK_JSON_CACHE_MAX) {
      playbackJsonCache.delete(playbackJsonCache.keys().next().value)   // 最旧一条
    }
  }
  // 契约 v2 门禁：与 parseAgentPlaybackFromBytes 同一校验器（错版/陈旧 WASM
  // 在此抛出，而不是把缺字段的 v1 数据交给渲染层）
  return enrichPlayback(validateAgentPlayback(JSON.parse(json)))
}
async function parsePlaybackJsonOffThread(bytes) {
  const worker = parseWorkerInstance();
  if (worker) {
    try {
      return await new Promise((resolve, reject) => {
        const id = ++parseSeq;
        parsePending.set(id, { resolve, reject });
        // 不转移所有权：失败回退时主线程仍需这份字节（结构化克隆 1–2MB 成本可忽略）
        worker.postMessage({ id, bytes: playbackParsePayload(bytes) });
      });
    } catch (err) {
      console.warn('[playback] 解析 Worker 不可用，回退主线程解析:', err);
      parseWorker = null;
    }
  }
  const mod = await loadAgentWasmModule();
  if (typeof mod.parsePlayback !== 'function') {
    throw new Error('agent wasm: parsePlayback 缺失（产物版本早于契约 v2）')
  }
  return mod.parsePlayback(bytes);
}

/** 展示名富化（本地通道与缓存命中路径共用） */
async function enrichPlayback(data) {
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
 * 仅接受 { kind:'local', file }；server 形态在 client-only 拓扑下不存在——
 * 显式拒绝而非静默吞掉，防止调用方误以为有服务端通道。
 */
export async function loadPlaybackData(source) {
  if (source && source.kind === 'local' && source.file) {
    return loadFromLocalFile(source.file)
  }
  throw new Error('回放数据源仅支持本地文件（client-only 拓扑，无服务端通道）')
}

// ---------- 地图静态路径（logical asset path；打包器 export_asset_pack.py 布局） ----------
// 一律经 assetProvider（消费方不拼接任何基础设施域名）；无同源 /api/playback/* 回退（client-only）。
import { assetProvider } from './assetProvider.js'

let mapIndexPromise = null
/** 已点名告警过的索引 miss（按 id 去重）：同一张图反复加载不刷屏 */
const mapIndexMissWarned = new Set()

/** 一次性装载资产源索引（数字 id → key）；未配置 origin 时为空。
 *  **失败不缓存**：index.json 一次瞬时失败（CDN 抖动 / 5xx / 超时）不得把整个页面会话
 *  钉死在"无地图"上——resolvedKey 为 null 时所有地图资产 URL 都是 null，资产阶段照常
 *  走完（缺失按完成计），场景只剩占位地面/网格，用户看到"加载完成却没地图"。
 *  失败即置空 promise 并告警，下一场回放加载时重试（与 tankNamesStatic 同一模式）；
 *  成功结果仍整页缓存（每场 loadMapImage 都要查一次）。 */
export function loadMapIndex() {
  if (!assetProvider.configured()) return Promise.resolve(null)
  if (!mapIndexPromise) {
    mapIndexPromise = assetProvider.json('/index.json').catch((e) => {
      mapIndexPromise = null
      console.warn('地图资产索引加载失败（本场地图回退占位网格；下次加载重试）:', e)
      return null
    })
  }
  return mapIndexPromise
}

/** 从 mapq（id=..&name=..）解析静态 key；由调用方持有结果，不发布模块级会话状态。
 *  索引 miss（origin 已配置、索引也加载成功，但这张图的 id 不在索引里）是"这张图永远
 *  出不了地图"的一类（资产包过期 / 新图未入库），且 UI 上与"资产源没配 / 索引没拉到"
 *  无法区分——console 里点名 id。索引本身加载失败的情况由 loadMapIndex 的告警覆盖。 */
export async function resolveMapKey(mapq) {
  const id = new URLSearchParams(mapq).get('id')
  const idx = assetProvider.configured() ? await loadMapIndex() : null
  const hit = idx && idx.maps && idx.maps[String(id)]
  if (idx && !hit && id && !mapIndexMissWarned.has(String(id))) {
    mapIndexMissWarned.add(String(id))
    console.warn('地图不在资产索引中（资产包过期或缺该地图？）: id=' + id)
  }
  return hit ? hit.key : null
}

/** 测试专用：清空地图索引缓存与 miss 告警去重（模块级状态不得跨用例泄漏） */
export function __resetMapIndexForTest() {
  mapIndexPromise = null
  mapIndexMissWarned.clear()
}

/**
 * 静态模式 URL（已配置 origin 且 index 命中 → 打包器物化路径）；
 * mapKey 由当前会话显式传入；未解析/未配置 origin → null，调用方跳过该资产（无服务端回退）。
 * kind ∈ map | map-mini | terrain | terrain-meta | scenery | groundmeta | groundtex
 */
export function mapStaticUrl(kind, layer, mapKey) {
  if (!mapKey || !assetProvider.configured()) return null
  const f = (name) => assetProvider.url(`/map/${mapKey}/${name}`)
  switch (kind) {
    case 'map': return f('ground.webp')
    case 'map-mini': return f('mini.webp')
    case 'terrain': return f('terrain.u16.bin')
    case 'terrain-meta': return f('terrain.json')
    case 'scenery': return f('scenery.glb')
    case 'groundmeta': return f('ground.layers.json')
    case 'groundtex': return f(`ground/${layer}.webp`)
  }
  return null
}
