// Agent 坦克/装甲/射击数据源（评审 P0-3：**client-only**，纯静态资产平面）。
//
// WotBTools Playback 拓扑无 Agent 自托管服务端——tank 数据/GLB/封面/名册全部来自
// `?assets=` 资产平面（dump-tank-data 物化的 tank/{id}.json 与 /api/tank/{id} 同一
// 形状；打包器 data/tank_cache.json；tank_images/{id}.webp），经 assetProvider 访问。
// 击穿判定为 penetration.js 客户端移植（上游 Rust calculate 同源单测）。
// 射击复现数据：本地 WASM parseShotReplays 产出，经 localStorage/sessionStorage
// 在"射击复现表 → 3D 查看器（新窗口）"间交接——无 /api/replay_shot 回退。
// 资产基址未配置时显式抛错（错误信息指导配置），不做静默降级。
import { assetProvider } from './assetProvider.js'

export { assetProvider }

// ---------- per-tank 数据（dump-tank-data 物化 → /api/tank/{id} 同形状） ----------

export async function fetchTankData(id) {
  return assetProvider.json(`/tank/${id}.json`)
}

/** 客户端 maskSlice 完整记录（装甲查看器炮管裁切面按客户端原值重建）。
 *  资产包 `/data/gunMaskSlices.json`（上游 emit_vehicle_pb 从客户端逐车 yaml 原样导出）；
 *  旧包缺该文件 → null，viewer 回退到旧标量 `gun_mask` 重建（兼容，不静默丢裁剪）。 */
let gunMaskSlicesPromise = null
export function fetchGunMaskSlices() {
  if (!gunMaskSlicesPromise) {
    gunMaskSlicesPromise = assetProvider.json('/data/gunMaskSlices.json')
      .then((doc) => (doc && typeof doc === 'object' ? doc.records || null : null))
      .catch(() => null)
    gunMaskSlicesPromise.then((records) => { if (records == null) gunMaskSlicesPromise = null })
  }
  return gunMaskSlicesPromise
}

/** 射击检视的紧凑搭载输入（config 原始顺序 / pitch_limits / shell_global_ids）：
 *  与装甲查看器同源取资产包 tank/{id}.json，按射击链所需字段投影——内嵌快照已退役
 *  （2026-10-15，随上游 shellKinds 一并改为 COS 获取，数据随包更新不再依赖前端发版）。
 *  未知/超测车型由 assetProvider 抛 HTTP 404，调用方按各自降级语义处理。 */
export async function fetchShotTankData(id) {
  const data = await fetchTankData(id)
  const configs = (Array.isArray(data?.configs) ? data.configs : []).map((config) => {
    const compact = {}
    for (const key of ['pitch_limits', 'shell_global_ids']) {
      if (key in config) compact[key] = config[key]
    }
    return compact
  })
  return { configs }
}

// ---------- 全景名册（tank_cache.json；无服务端聚合回退） ----------

let tankCachePromise = null

/** 静态 tank_cache.json（一次装载；坦克百科与 3D 选车共用同一原始缓存） */
function fetchTankCacheStatic() {
  if (!tankCachePromise) {
    tankCachePromise = assetProvider.json('/data/tank_cache.json')
      .catch((e) => {
        tankCachePromise = null
        throw e
      })
  }
  return tankCachePromise
}

/**
 * 坦克百科全量卡（含 armor 六面/shells/hp/机动/视野/俯仰）：静态 tank_cache.json 原样
 *（{id: info} 映射，字段透传）。
 */
export function fetchTankEncyclopedia() {
  return fetchTankCacheStatic()
}

// ---------- 封面图（tank_images/{id}.webp） ----------

export function tankImageUrl(id) {
  return assetProvider.url(`/tank_images/${id}.webp`)
}

let tankIconCropsPromise = null

/**
 * 逐车封面图内容框（`tank_images/crops.json`，alpha>0 紧裁，canvas 像素坐标）。
 * 客户端图标是原始画布（右侧/底部留白近半），展示层据此缩放定位以对齐旧紧裁口径
 * （换算见 utils/tankIconCrop.js）。资产源缺该文件时返回 null——展示回退原始 contain。
 */
export function loadTankIconCrops() {
  if (!tankIconCropsPromise) {
    tankIconCropsPromise = assetProvider
      .json('/tank_images/crops.json')
      .then((doc) => doc?.icons ?? null)
      .catch(() => null)
  }
  return tankIconCropsPromise
}

// ---------- 弹表（tank JSON configs 客户端构建） ----------

/**
 * 服务端 /api/shells/{id} 的客户端等价：顶级配置（configs 末位 = 默认顶级变体）的
 * 弹链 + caliber + 全局弹种 id（shell_global_ids 与 configs[].shells 同序）。
 */
export async function fetchShells(id) {
  const data = await fetchTankData(id)
  const cfgs = data.configs || []
  const cfg = cfgs.length ? cfgs[cfgs.length - 1] : null
  const shells = (cfg && cfg.shells ? cfg.shells : data.shells || []).map((s, i) => ({
    // 判定字段（type_id / normalization / ricochet / penetration_far / caliber）必须原样保留：
    // 这里曾只挑显示字段，导致走该回退路径的弹体丢失转正角/弹种 id，判定只能 fail-closed。
    ...s,
    type: s.type,
    // 全局弹种 id（与回放 shell_id 同域）：射击复现按 shell_id 反查槽位弹种用
    global_id: (cfg && cfg.shell_global_ids && cfg.shell_global_ids[i]) ?? null,
    name: s.name || '',
    penetration: s.penetration,
    damage: s.damage,
    module_damage: s.module_damage,
    explosion_radius: s.explosion_radius,
  }))
  // 口径缺失返回 0（调用方 fail-closed），不再静默用 120mm。
  const caliber = (cfg && Number.isFinite(cfg.caliber) && cfg.caliber > 0)
    ? cfg.caliber
    : ((Number.isFinite(data.caliber) && data.caliber > 0) ? data.caliber : 0)
  return { caliber, shells }
}

// ---------- 击穿判定（客户端移植；wire 形状与 /api/penetrate 响应一致） ----------

export async function judgePenetration(req) {
  const { calculate } = await import('./penetration.js')
  return calculate(req)
}

// ---------- 射击复现数据交接（射击复现表 → 3D 查看器新窗口；无服务端通道） ----------

const SHOTS_KEY = 'wotb_agent_shots'
const SHOTS_TTL_MS = 30 * 60 * 1000

/** Both the shot list and viewer navigation must resolve the same mounted gun / shell pair. */
export async function shotViewerQuery(shot) {
  const shooterTank = shot.shooter_tank_id || 0
  const tank = shot.target_tank_id || shooterTank
  if (!tank) return null
  let hit = null
  if (shot.shell_id && shooterTank) {
    try {
      const data = await fetchShotTankData(shooterTank)
      const configs = data.configs || []
      const pinned = Number.isInteger(shot.shooter_config_idx) ? configs[shot.shooter_config_idx] : null
      const pinnedShell = (pinned?.shell_global_ids || []).indexOf(shot.shell_id)
      if (pinnedShell >= 0) hit = { cfg: shot.shooter_config_idx, idx: pinnedShell }
      for (let ci = configs.length - 1; !hit && ci >= 0; ci--) {
        const idx = (configs[ci].shell_global_ids || []).indexOf(shot.shell_id)
        if (idx >= 0) hit = { cfg: ci, idx }
      }
    } catch { /* Keep the existing slot fallback when local inputs are unavailable. */ }
  }
  const shellIdx = hit ? hit.idx : (shot.is_author && shot.shell_slot != null) ? shot.shell_slot : null
  return {
    view: 'agent-armor', tank: String(tank),
    ...(shooterTank ? { shooter: String(shooterTank) } : {}),
    shot: String(shot.index),
    ...(shellIdx != null ? { shell: String(shellIdx) } : {}),
    ...(hit ? { scfg: String(hit.cfg) } : {}),
    ...(shot.target_config_idx != null ? { config: String(shot.target_config_idx) } : {}),
    world: '1', heatmap: '1',
  }
}

/**
 * 射击复现表把 parseShotReplays 的 shots 数组存入本地交接通道。
 * localStorage 为主（跨窗口同源共享，新开查看器窗口必定可取）；
 * sessionStorage 镜像为辅（部分环境的新窗口会继承 opener 的会话存储）。
 * 30 分钟 TTL：过期条目视同不存在，防止陈旧数据渗入后续查看。
 */
/**
 * 服务器解码弹道长度（米）：`ball_a → via… → ball_b` 折线总长（跳弹/穿透续段逐段计入，
 * 与飞行顺序一致）。射击复现的"交战距离"以此为准（实弹飞行到命中点所走的距离，
 * 而非相机到命中点的直线距离——用户裁定 2026-10-13）。字段缺失/非法返回 0，
 * 调用方回退相机距离。
 */
export function shotBallisticLength(shot) {
  if (!shot) return 0
  const pts = [shot.ball_a, ...(Array.isArray(shot.via) ? shot.via : []), shot.ball_b]
  for (const p of pts) {
    if (!Array.isArray(p) || p.length !== 3 || !p.every((v) => Number.isFinite(v))) return 0
  }
  let len = 0
  for (let i = 1; i < pts.length; i++) {
    len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2])
  }
  return len
}

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
 * 查看器取射击数据（client-only：仅本地交接通道）。
 * 无交接（直接打开带 shot= 的 URL 而未经射击复现表）→ 显式报错指导入口，
 * 不静默回退任何服务端。返回形状固定 {shots:[...]}（tankViewer 消费端 d.shots || d）。
 */
export async function fetchReplayShots() {
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
  throw new Error(
    '射击复现数据缺失：请从「射击复现」页点击行进入（shots 经本地交接，无服务端通道）',
  )
}
