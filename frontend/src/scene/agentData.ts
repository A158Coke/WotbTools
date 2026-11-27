import { assetProvider } from './assetProvider.js'

export { assetProvider }

type TankId = number | string
type TankUpgradeOptions = { upgrade?: unknown; abilities?: unknown }
type ShotTankConfig = { pitch_limits?: unknown; shell_global_ids?: Array<number | null> }
export type ShotViewerInput = {
  index?: unknown
  shooter_tank_id?: number | null
  target_tank_id?: number | null
  shell_id?: number | null
  shooter_config_idx?: number | null
  target_config_idx?: number | null
  shell_slot?: number | null
  is_author?: boolean | null
}


const tankDataInflight = new Map()

function isMissingTankModules(error: unknown, nation: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  const modulePath = ['', 'research', 'modules', `${nation}.json`].join('/')
  return typeof nation === 'string'
    && message.includes(modulePath)
    && /HTTP 404\b/.test(message)
}

function fetchRawTankData(id: TankId) {
  const key = String(id)
  const pending = tankDataInflight.get(key)
  if (pending) return pending
  const req = assetProvider.json(`/tank/${key}.json`).finally(() => {
    tankDataInflight.delete(key)
  })
  tankDataInflight.set(key, req)
  return req
}

export function fetchTankData(id: TankId, options: TankUpgradeOptions = {}) {
  const raw = fetchRawTankData(id)
  if (options.upgrade !== 'top' && options.upgrade !== 'custom') return raw
  return raw.then(async (detail: Record<string, unknown>) => {
    if (Number(detail?.tier) !== 11) return detail
    const [{ loadTankModules }, { findTankModules }, { projectTankUpgrades }] = await Promise.all([
      import('../utils/researchCatalog.js'),
      import('../replay-local/compute/tankSetup'),
      import('../replay-local/compute/tankUpgrades'),
    ])
    let modules: unknown = null
    try {
      modules = findTankModules(await loadTankModules(detail.nation), Number(id))
    } catch (error) {
      if (!isMissingTankModules(error, detail.nation)) throw error
      return detail
    }
    const projected = projectTankUpgrades(detail, modules, options.upgrade, options.abilities)
    if (!projected.selection.available) return detail
    if (!projected.selection.supported) {
      throw new Error(`XI upgrade data unavailable: ${projected.selection.unsupported.join(', ') || id}`)
    }
    return projected.detail
  })
}

export async function fetchShotTankData(id: TankId) {
  const data = await fetchTankData(id)
  const configs = (Array.isArray(data?.configs) ? data.configs : []).map((config: Record<string, unknown>): ShotTankConfig => {
    const compact: Record<string, unknown> = {}
    for (const key of ['pitch_limits', 'shell_global_ids']) {
      if (key in config) compact[key] = config[key]
    }
    return compact
  })
  return { configs }
}


let tankCachePromise: ReturnType<typeof assetProvider.json> | null = null

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

export function fetchTankEncyclopedia() {
  return fetchTankCacheStatic()
}

export function loadTankMechanics() {
  if (!tankMechanicsPromise) {
    tankMechanicsPromise = assetProvider.json('/data/tankMechanics.json')
      .catch((e) => {
        tankMechanicsPromise = null
        throw e
      })
  }
  return tankMechanicsPromise
}

let tankMechanicsPromise: ReturnType<typeof assetProvider.json> | null = null

export function tankImageUrl(id: TankId) {
  return assetProvider.url(`/tank_images/${id}.webp`)
}

let tankIconCropsPromise: ReturnType<typeof assetProvider.json> | null = null

export function loadTankIconCrops() {
  if (!tankIconCropsPromise) {
    tankIconCropsPromise = assetProvider
      .json<{ icons?: Record<string, unknown> | null } | null>('/tank_images/crops.json')
      .then((doc) => doc?.icons ?? null)
      .catch(() => null)
  }
  return tankIconCropsPromise
}


export async function fetchShells(id: TankId, options: TankUpgradeOptions = {}) {
  const data = await fetchTankData(id, options)
  const cfgs = data.configs || []
  const cfg = cfgs.length ? cfgs[cfgs.length - 1] : null
  const shells = (cfg && cfg.shells ? cfg.shells : data.shells || []).map((s: Record<string, unknown>, i: number) => ({
    ...s,
    type: s.type,
    global_id: (cfg && cfg.shell_global_ids && cfg.shell_global_ids[i]) ?? null,
    name: s.name || '',
    penetration: s.penetration,
    damage: s.damage,
    module_damage: s.module_damage,
    explosion_radius: s.explosion_radius,
  }))
  const caliber = (cfg && Number.isFinite(cfg.caliber) && cfg.caliber > 0)
    ? cfg.caliber
    : ((Number.isFinite(data.caliber) && data.caliber > 0) ? data.caliber : 0)
  return { caliber, shells }
}


export interface PenetrationHit {
  section: string
  plate_id: number | string
  thickness: number
  normal: number[]
  point: number[]
  part_name: string
  contact_normal?: number[]
  contact_point?: number[]
  contact_thickness?: number
  contact_part_name?: string | null
}

export interface PenetrationRequest {
  shell_type: string | null
  shell_type_id?: number | null
  penetration: number
  caliber: number
  damage?: number
  explosion_radius?: number
  calibrated_shells?: number
  enhanced_armor?: boolean | number
  normalization_deg?: number | null
  ricochet_deg?: number | null
  allow_ricochet?: boolean
  require_primary?: boolean
  distance_m?: number
  penetration_far?: number
  he_splash?: unknown
  he_splash_error?: string | null
  view_dir: number[]
  hits: PenetrationHit[]
}

export interface PenetrationLayer {
  part_name: string
  contact_part_name: string | null
  contact_thickness?: number | null
  thickness: number
  effective: number
  penetrated: boolean
  ricochet: boolean
  angle_deg: number | null
  remaining_before: number
  gap: boolean
  point: number[] | null
  normal: number[] | null
  [key: string]: unknown
}

export interface HeSplashBestLayer {
  section?: string | null
  armor?: number | null
  [key: string]: unknown
}

export interface HeSplashBest {
  upper: number
  lower: number
  armor: number
  distance: number
  direction: number[] | null
  layers: HeSplashBestLayer[]
}

export interface HeSplashData {
  splash_min: number
  splash_max: number
  splash_avg: number
  full_damage: number
  explosion_radius: number
  samples: number
  best: HeSplashBest | null
  best_lower?: HeSplashBest | null
  source: string
  degraded?: boolean
  unavailable?: boolean
  reason?: string
  [key: string]: unknown
}

export interface PenetrationResult {
  result: string
  blocked_no_primary: boolean
  total_effective: number
  layers: PenetrationLayer[]
  probability_layers: PenetrationLayer[]
  probability_penetration: number
  ricochet: boolean
  ricochet_remaining_pen: number
  damage: number
  he: HeSplashData | null
  [key: string]: unknown
}

export async function judgePenetration(req: PenetrationRequest): Promise<PenetrationResult> {
  const { calculate } = await import('./penetration.js')
  const result = calculate(req) as PenetrationResult
  return result
}


const SHOTS_KEY = 'wotb_agent_shots'
const SHOTS_TTL_MS = 30 * 60 * 1000

export async function shotViewerQuery(shot: ShotViewerInput) {
  const shooterTank = shot.shooter_tank_id || 0
  const tank = shot.target_tank_id || shooterTank
  if (!tank) return null
  let hit: { cfg: number; idx: number } | null = null
  if (shot.shell_id && shooterTank) {
    try {
      const data = await fetchShotTankData(shooterTank)
      const configs = data.configs || []
      const pinned = Number.isInteger(shot.shooter_config_idx) ? configs[shot.shooter_config_idx as number] : null
      const pinnedShell = (pinned?.shell_global_ids || []).indexOf(shot.shell_id)
      if (pinnedShell >= 0) hit = { cfg: shot.shooter_config_idx as number, idx: pinnedShell }
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

export function shotBallisticLength(shot: { ball_a?: unknown; via?: unknown; ball_b?: unknown } | null | undefined) {
  if (!shot) return 0
  const pts = [shot.ball_a, ...(Array.isArray(shot.via) ? shot.via : []), shot.ball_b] as number[][]
  for (const p of pts) {
    if (!Array.isArray(p) || p.length !== 3 || !p.every((v) => Number.isFinite(v))) return 0
  }
  let len = 0
  for (let i = 1; i < pts.length; i++) {
    len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2])
  }
  return len
}

export function storeShotsForViewer(shots: unknown, meta: { battleStartRaw?: number } = {}) {
  const payload = JSON.stringify({ at: Date.now(), shots, battleStartRaw: meta.battleStartRaw ?? 0 })
  try {
    localStorage.setItem(SHOTS_KEY, payload)
  } catch { /* 配额/隐私模式：剩余通道兜底 */ }
  try {
    sessionStorage.setItem(SHOTS_KEY, payload)
  } catch { /* 同上 */ }
}

export async function fetchReplayShots() {
  for (const store of [localStorage, sessionStorage]) {
    try {
      const raw = store.getItem(SHOTS_KEY)
      if (!raw) continue
      const parsed = JSON.parse(raw)
      const shots = Array.isArray(parsed) ? parsed : parsed.shots
      const at = Array.isArray(parsed) ? 0 : parsed.at || 0
      if (Array.isArray(shots) && shots.length && Date.now() - at < SHOTS_TTL_MS) {
        const start = Array.isArray(parsed) ? 0 : Number(parsed.battleStartRaw)
        return { shots, battleStartRaw: Number.isFinite(start) ? start : 0 }
      }
    } catch { /* 损坏条目按下个通道处理 */ }
  }
  throw new Error(
    '射击复现数据缺失：请从「射击复现」页点击行进入（shots 经本地交接，无服务端通道）',
  )
}
