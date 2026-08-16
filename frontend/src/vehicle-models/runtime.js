/**
 * 生产 runtime 车型资产解析（PR2 — Dedicated Tier X Models in Battle Playback）。
 *
 * 职责（计划 §11–§13、§18）：
 * - tankId → modelKey（mapping，单一事实源）；
 * - modelKey → 正式资产（hull.webp / turret.webp / metadata，Vite 静态打包 URL）；
 * - 战局级 preload：只预加载当前战局实际出现的 Tier X base models（dedupe：同 modelKey
 *   只解析/加载一次）；3s 超时/失败 → 该 modelKey 标记 failed（单车 fallback generic，
 *   不整场 fallback）；
 * - current-page cache（模块生命周期 = 页面生命周期；不做跨 replay persistent cache）。
 *
 * Bundle 分离：本模块含全部 'vehicle-models/assets' 引用（import.meta.glob），
 * 必须由调用方**动态 import**（BattlePlayback 在 preload 时 await import 本模块），
 * 保证主入口 bundle 不含车型资产标记（scripts/check-bundle-separation.mjs 门禁）。
 *
 * 失败语义：resolve 失败（缺 metadata / confirmPending / 未知 tankId）→ null（generic）；
 * preload 图片解码超时/失败 → 该 modelKey failed（generic fallback）。静默，console.error 记录。
 */
import { MODEL_DEFINITIONS, TANK_ID_TO_MODEL } from './mapping.js'

// Vite 静态打包：?url 输出为同源静态文件 URL（确定性路径，build 后 hash 命名）
const hullUrls = import.meta.glob('./assets/*/hull.webp', { query: '?url', import: 'default', eager: true })
const turretUrls = import.meta.glob('./assets/*/turret.webp', { query: '?url', import: 'default', eager: true })
const metadataMap = import.meta.glob('./assets/*/metadata.json', { import: 'default', eager: true })

/** 默认 preload 超时（计划 §13：3 秒）。 */
export const PRELOAD_TIMEOUT_MS = 3000

/**
 * 解析后的车型资产（dedicated runtime contract）。
 * 仅供 resolveModel 内部构造；外部通过 resolveModel / preloadBattleModels 消费实例
 * （无外部直接构造/继承需求，不导出——避免无人消费的公共 API）。
 */
class VehicleModel {
  /** @param {{modelKey:string, kind:'turreted'|'turretless', hullSrc:string, turretSrc:string|null, turretPivot:({x:number,y:number}|null), turretRaster:(object|null)}} init */
  constructor({ modelKey, kind, hullSrc, turretSrc, turretPivot, turretRaster }) {
    this.modelKey = modelKey
    this.kind = kind
    this.hullSrc = hullSrc
    this.turretSrc = turretSrc
    this.turretPivot = turretPivot
    this.turretRaster = turretRaster
  }
}

/** tankId → modelKey（无 mapping → null = 非 Tier X / 未确认车型 → generic）。 */
export function modelKeyForTank(tankId) {
  return TANK_ID_TO_MODEL[String(tankId)] ?? null
}

/** modelKey → 正式资产；缺失/confirmPending/结构非法 → null（fallback generic）。 */
export function resolveModel(modelKey) {
  if (!modelKey) return null
  const def = MODEL_DEFINITIONS[modelKey]
  if (!def || def.confirmPending) return null
  const meta = metadataMap[`./assets/${modelKey}/metadata.json`]
  if (!meta || meta.modelKey !== modelKey) return null
  const hullSrc = hullUrls[`./assets/${modelKey}/hull.webp`]
  if (!hullSrc) return null
  const kind = meta.kind
  if (kind !== 'turreted' && kind !== 'turretless') return null
  if (kind === 'turretless') {
    return new VehicleModel({ modelKey, kind, hullSrc, turretSrc: null, turretPivot: null, turretRaster: null })
  }
  const turretSrc = turretUrls[`./assets/${modelKey}/turret.webp`]
  if (!turretSrc || !meta.turretPivot || !meta.turretRaster) return null
  return new VehicleModel({
    modelKey,
    kind,
    hullSrc,
    turretSrc,
    turretPivot: meta.turretPivot,
    turretRaster: meta.turretRaster,
  })
}

/** 单图预加载：onload/onerror 或超时（不抛错——超时按失败处理）。 */
function loadImage(url, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false
    let timer = null
    const finish = (ok) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      img.onload = null
      img.onerror = null
      resolve(ok)
    }
    const img = new Image()
    timer = setTimeout(() => finish(false), timeoutMs)
    img.onload = () => finish(true)
    img.onerror = () => finish(false)
    img.src = url
  })
}

/**
 * 战局级 preload（计划 §12/§13）：
 * - 输入本场全部 tankIds；只处理 Tier X modelKeys（dedupe：Set）；
 * - 并行解析 + 图片预加载；单个 modelKey 超时/失败 → failed（该车型 fallback generic）；
 * - 返回 { resolved: Map<modelKey, VehicleModel>, failed: Set<modelKey>,
 *   byTank: Map<tankId, modelKey|null> }（byTank 供渲染侧直接查单车决策）；
 * - 不做整场 fallback（其他车型照常）。
 * @param {number[]|string[]} tankIds
 * @param {{timeoutMs?:number, imageLoader?:(url:string, timeoutMs:number)=>Promise<boolean>}} [opts] 测试注入
 */
export async function preloadBattleModels(tankIds, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? PRELOAD_TIMEOUT_MS
  const imageLoader = opts.imageLoader ?? loadImage
  const modelKeys = new Set()
  const byTank = new Map()
  for (const id of tankIds || []) {
    const key = modelKeyForTank(id)
    byTank.set(String(id), key)
    if (key) modelKeys.add(key)
  }
  const resolved = new Map()
  const failed = new Set()
  await Promise.all(
    [...modelKeys].map(async (modelKey) => {
      const model = resolveModel(modelKey)
      if (!model) {
        failed.add(modelKey)
        console.error(`[vehicle-models] resolve 失败 modelKey=${modelKey} → generic fallback`)
        return
      }
      const urls = [model.hullSrc]
      if (model.turretSrc) urls.push(model.turretSrc)
      const ok = await Promise.all(urls.map((u) => imageLoader(u, timeoutMs))).then((r) => r.every(Boolean))
      if (ok) {
        resolved.set(modelKey, model)
      } else {
        failed.add(modelKey)
        console.error(`[vehicle-models] preload 超时/失败 modelKey=${modelKey} → generic fallback`)
      }
    }),
  )
  return { resolved, failed, byTank }
}
