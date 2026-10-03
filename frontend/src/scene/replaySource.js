// 回放数据源（契约 v2）：**client-only**——本地 WASM 解析（文件不出本机），
// 无服务端通道。WotBTools Playback 拓扑不含 Business API / Agent 自托管服务端
//（评审 P0-3）；地图/地形/场景等渲染资产经 assetProvider 走配置的 remote asset origin。
//
// 解析在 Worker 里跑（playbackParse.worker.ts）：把 WASM `parsePlayback`（单场 ~95ms）
// 移出 UI 线程；主线程只做 JSON.parse 与契约校验。同一份文件（名+长+mtime+采样指纹）
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
 * Worker 传输载荷：Worker 契约是 ArrayBuffer（`playbackParse.worker.ts` 自己 `new Uint8Array`）。
 * 若 bytes 是 backing buffer 上的切片，必须只发这一段——否则会把无关字节一起交给解析器。
 * 不转移所有权（`transfer`）：Worker 失败时主线程还要用同一份字节回退解析。
 */
export function playbackParsePayload(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError('playback parse payload expects Uint8Array')
  }
  return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? bytes.buffer
    : bytes.slice().buffer;
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

/** 缓存键：文件名 + 字节数 + mtime + **采样指纹**（首/中/尾各 ≤4KB 的 FNV-1a）。
 *  只靠文件名/长度/mtime 会让「同名同长同 mtime 但内容不同」的两份回放互相串用；
 *  全量哈希 1–2MB 又要几毫秒，采样窗口足够区分真实回放（成本 ~0.05ms）。
 *  `bytes` 必须是 Uint8Array：ArrayBuffer 没有 `length` 与索引语义，采样会退化成常量
 *  指纹（正是本函数此前失效的原因），所以这里显式 fail loud。 */
function fileCacheKey(fileObject, bytes) {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError('fileCacheKey expects Uint8Array replay bytes')
  }
  const n = bytes.byteLength;
  let h = 2166136261;
  const window = 4096;
  const step = Math.max(1, Math.floor(n / 3));
  // 去重 start：小文件（n < 3×window）三个窗口会重叠，重复读同一段纯属浪费
  for (const start of new Set([0, step, Math.max(0, n - window)])) {
    const end = Math.min(n, start + window);
    for (let i = start; i < end; i++) { h ^= bytes[i]; h = Math.imul(h, 16777619); }
  }
  h = (h >>> 0).toString(36);
  return [fileObject && fileObject.name ? fileObject.name : '',
          n,
          fileObject && fileObject.lastModified ? fileObject.lastModified : 0, h].join('|');
}

/** 仅测试用：清空解析结果缓存（跨用例替换 WASM 桩时，同一份字节会产出不同结果） */
export function __resetPlaybackJsonCacheForTest() { playbackJsonCache.clear(); }

export async function loadFromLocalFile(fileObject) {
  const arrayBuffer = await fileObject.arrayBuffer()
  // 进入指纹 / Worker / 回退解析前统一 bytes 类型：三条路径都只认 Uint8Array
  //（此前把 ArrayBuffer 直接当字节数组用，缓存指纹恒为常量 → 同名同 mtime 的不同
  //  回放会命中彼此的结果）。
  const bytes = new Uint8Array(arrayBuffer)
  // 解析结果缓存：以（文件名, 字节数, mtime, 采样指纹）为键缓存 JSON 字符串。重复打开同一场
  // （换标签页/重进页面/重新加载同一文件）直接命中，省掉一次完整 WASM 解析；
  // 命中仍走主线程 JSON.parse（约 15ms）与契约校验，形状门禁不绕过。
  const cacheKey = fileCacheKey(fileObject, bytes)
  const cachedJson = playbackJsonCache.get(cacheKey)
  if (cachedJson !== undefined) {
    playbackJsonCache.delete(cacheKey); playbackJsonCache.set(cacheKey, cachedJson);   // LRU 触碰
    return enrichPlayback(validateAgentPlayback(JSON.parse(cachedJson)))
  }
  const json = await parsePlaybackJsonOffThread(bytes)
  playbackJsonCache.set(cacheKey, json)
  if (playbackJsonCache.size > PLAYBACK_JSON_CACHE_MAX) {
    playbackJsonCache.delete(playbackJsonCache.keys().next().value)   // 最旧一条
  }
  // 契约 v2 门禁：与 parseAgentPlaybackFromBytes 同一校验器（错版/陈旧 WASM
  // 在此抛出，而不是把缺字段的 v1 数据交给渲染层）
  return enrichPlayback(validateAgentPlayback(JSON.parse(json)))
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
let currentMapKey = null

/** 一次性装载资产源索引（数字 id → key）；未配置 origin 时为空 */
export function loadMapIndex() {
  if (!assetProvider.configured()) return Promise.resolve(null)
  if (!mapIndexPromise) {
    mapIndexPromise = assetProvider.json('/index.json').catch(() => null)
  }
  return mapIndexPromise
}

/** 从 mapq（id=..&name=..）解析当前地图的静态 key；结果缓存供同步取用 */
export async function resolveMapKey(mapq) {
  const id = new URLSearchParams(mapq).get('id')
  const idx = assetProvider.configured() ? await loadMapIndex() : null
  currentMapKey = (idx && idx.maps && idx.maps[String(id)]) ? idx.maps[String(id)].key : null
  return currentMapKey
}

/**
 * 静态模式 URL（已配置 origin 且 index 命中 → 打包器物化路径）；
 * key 未解析/未配置 origin → null，调用方跳过该资产（无服务端回退）。
 * kind ∈ map | map-mini | terrain | terrain-meta | scenery | groundmeta | groundtex
 */
export function mapStaticUrl(kind, layer) {
  if (!currentMapKey || !assetProvider.configured()) return null
  const f = (name) => assetProvider.url(`/map/${currentMapKey}/${name}`)
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
