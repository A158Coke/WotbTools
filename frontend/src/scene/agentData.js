// Agent 坦克/装甲/射击数据源（静态资产面优先，同源服务端回退）。
//
// 上游 tankViewer.js 与 Agent 自托管 Web 面耦合（/api/tank、/api/tank_filter、
// /api/shells、/api/penetrate、/api/replay_shot、/api/tank_image）；WotBTools 的
// 部署面是纯静态资产包（契约 §13：?assets=<基址> 指向 COS 镜像）。本层把每类数据
// 的"静态路径物化 / 服务端回退"收敛到单点：
// - 静态：dump-tank-data 物化的 tank/{id}.json（与 /api/tank/{id} 同一 tank_data_value
//   形状）、打包器 data/tank_cache.json（735 辆全景卡）、tank_images/{id}.webp；
// - 回退：Agent 自托管（同源 /api/*）行为不变——场景层无感切换；
// - 击穿判定无静态物可回退：penetration.js 客户端移植（上游 Rust calculate 同源单测）。
// - 射击复现数据：本地 WASM parseShotReplays 产出 shots 数组，经 sessionStorage
//   在"射击复现表 → 3D 查看器（新窗口）"间交接；无交接时回退 /api/replay_shot
//  （Agent 自托管 viewer 链）。
import { assetBase, assetUrl } from './assetBase.js'

export { assetUrl }

// ---------- per-tank 数据（dump-tank-data 物化 → /api/tank/{id} 同形状） ----------

export function tankDataUrl(id) {
  return assetBase() ? assetUrl(`/tank/${id}.json`) : `/api/tank/${id}`
}

export async function fetchTankData(id) {
  const resp = await fetch(tankDataUrl(id))
  if (!resp.ok) throw new Error(`tank data ${id}: HTTP ${resp.status}`)
  return resp.json()
}

// ---------- 全景名册（tank_cache.json → /api/tank_filter / /api/tanks 同形状） ----------

let tankFilterPromise = null
let tankCachePromise = null

/** 静态 tank_cache.json（一次装载，名册/百科两通道共享） */
function fetchTankCacheStatic() {
  if (!tankCachePromise) {
    tankCachePromise = fetch(assetUrl('/data/tank_cache.json'))
      .then((r) => {
        if (!r.ok) throw new Error(`tank_cache: HTTP ${r.status}`)
        return r.json()
      })
      .catch((e) => {
        tankCachePromise = null
        throw e
      })
  }
  return tankCachePromise
}

/** 静态 tank_cache.json → tank_filter 行形状 [{id,name,tier,nation,type}]（字段超集透传） */
function tankCacheToFilter(cache) {
  return Object.entries(cache)
    .map(([id, info]) => ({
      id: Number(id),
      name: (info && info.name) || '',
      tier: (info && info.tier) ?? 0,
      nation: (info && info.nation) || 'unknown',
      type: (info && info.type) || 'unknown',
      is_premium: !!(info && info.is_premium),
    }))
    .filter((t) => t.name)
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** 坦克名册（3D 查看器选择器）：静态 tank_cache.json 优先，服务端 /api/tank_filter 回退 */
export function fetchTankFilter() {
  if (assetBase()) {
    if (!tankFilterPromise) {
      tankFilterPromise = fetchTankCacheStatic().then(tankCacheToFilter)
    }
    return tankFilterPromise
  }
  return fetch('/api/tank_filter').then((r) => {
    if (!r.ok) throw new Error(`tank_filter: HTTP ${r.status}`)
    return r.json()
  })
}

/**
 * 坦克百科全量卡（含 armor 六面/shells/hp/机动/视野/俯仰）：静态 tank_cache.json 原样
 *（{id: info} 映射，字段透传），服务端 /api/tanks 聚合回退。
 */
export function fetchTankEncyclopedia() {
  if (assetBase()) return fetchTankCacheStatic()
  return fetch('/api/tanks').then((r) => {
    if (!r.ok) throw new Error(`tanks: HTTP ${r.status}`)
    return r.json()
  })
}

// ---------- 封面图（tank_images/{id}.webp → /api/tank_image/{id}） ----------

export function tankImageUrl(id) {
  return assetBase() ? assetUrl(`/tank_images/${id}.webp`) : `/api/tank_image/${id}`
}

// ---------- 弹表（tank JSON configs 构建 → /api/shells/{id} 同形状） ----------

/**
 * 服务端 /api/shells/{id} 的客户端等价：顶级配置（configs 末位 = 默认顶级变体）的
 * 弹链 + caliber + 全局弹种 id（shell_global_ids 与 configs[].shells 同序）。
 */
export async function fetchShells(id) {
  if (!assetBase()) {
    const resp = await fetch(`/api/shells/${id}`)
    if (!resp.ok) throw new Error(`shells ${id}: HTTP ${resp.status}`)
    return resp.json()
  }
  const data = await fetchTankData(id)
  const cfgs = data.configs || []
  const cfg = cfgs.length ? cfgs[cfgs.length - 1] : null
  const shells = (cfg && cfg.shells ? cfg.shells : data.shells || []).map((s, i) => ({
    type: s.type,
    // 全局弹种 id（与回放 shell_id 同域）：射击复现按 shell_id 反查槽位弹种用
    global_id: (cfg && cfg.shell_global_ids && cfg.shell_global_ids[i]) ?? null,
    name: s.name || '',
    penetration: s.penetration,
    damage: s.damage,
    module_damage: s.module_damage,
    explosion_radius: s.explosion_radius,
  }))
  return { caliber: (cfg && cfg.caliber) || data.caliber || 120, shells }
}

// ---------- 击穿判定（客户端移植；wire 形状与 /api/penetrate 响应一致） ----------

export async function judgePenetration(req) {
  const { calculate } = await import('./penetration.js')
  return calculate(req)
}

// ---------- 射击复现数据交接（射击复现表 → 3D 查看器新窗口） ----------

const SHOTS_KEY = 'wotb_agent_shots'
const SHOTS_TTL_MS = 30 * 60 * 1000

/**
 * 射击复现表把 parseShotReplays 的 shots 数组存入本地交接通道。
 * localStorage 为主（跨窗口同源共享，新开查看器窗口必定可取）；
 * sessionStorage 镜像为辅（部分环境的新窗口会继承 opener 的会话存储）。
 * 30 分钟 TTL：过期条目视同不存在，防止陈旧数据渗入后续查看。
 */
export function storeShotsForViewer(shots) {
  const payload = JSON.stringify({ at: Date.now(), shots })
  try {
    localStorage.setItem(SHOTS_KEY, payload)
  } catch { /* 配额/隐私模式：剩余通道兜底 */ }
  try {
    sessionStorage.setItem(SHOTS_KEY, payload)
  } catch { /* 同上 */ }
}

/**
 * 查看器取射击数据：本地交接优先（WotBTools 纯客户端链），
 * 无交接（直接打开 URL/旧链）回退 Agent 自托管 /api/replay_shot。
 * 返回形状兼容两种来源：{shots:[...]} 或裸数组（tankViewer 消费端 d.shots || d）。
 */
export async function fetchReplayShots() {
  const readLocal = () => {
    for (const store of [localStorage, sessionStorage]) {
      try {
        const raw = store.getItem(SHOTS_KEY)
        if (!raw) continue
        const parsed = JSON.parse(raw)
        const shots = Array.isArray(parsed) ? parsed : parsed.shots
        const at = Array.isArray(parsed) ? 0 : parsed.at || 0
        if (Array.isArray(shots) && shots.length && Date.now() - at < SHOTS_TTL_MS) {
          return { shots }
        }
      } catch { /* 损坏条目按下个通道处理 */ }
    }
    return null
  }
  const local = readLocal()
  if (local) return local
  const resp = await fetch('/api/replay_shot')
  if (!resp.ok) throw new Error(`replay_shot: HTTP ${resp.status}`)
  return resp.json()
}
