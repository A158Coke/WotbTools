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
 * 失败语义：resolve 失败（缺 metadata / 未知 tankId）→ null（generic）；
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

/** modelKey → 正式资产；缺失/结构非法 → null（fallback generic）。 */
export function resolveModel(modelKey) {
  if (!modelKey) return null
  const def = MODEL_DEFINITIONS[modelKey]
  if (!def) return null
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
 * module-lifetime preload cache（current-page cache，计划 §12；页面刷新自然清空，
 * 不做 localStorage/IndexedDB/persistent cache）。
 *
 * modelKey 级状态机（Map 值）：
 * - undefined         未请求；
 * - Promise           in-flight（并发去重：同一 modelKey 的并发请求共享同一个 Promise，
 *                     实际只加载一次；两个 BattlePlayback 实例/快速切换不会重复 preload）；
 * - { ok: true, model } 已成功——后续 battle 直接复用，不再调用 imageLoader；
 * - { ok: false }     已失败（resolve 失败 / 图片加载或超时失败）——页面生命周期内
 *                     不再重试：失败原因通常稳定（缺资产/网络），避免切换 replay 时
 *                     反复等待 3s timeout；单车 generic fallback 语义不变。
 */
const preloadCache = new Map()

/**
 * 单个 modelKey 的 preload（带 cache + in-flight 去重）。
 * 返回 { ok: true, model } | { ok: false }。
 */
async function preloadModel(modelKey, { timeoutMs, imageLoader }) {
  const existing = preloadCache.get(modelKey)
  if (existing) return existing // in-flight Promise 或已固化结果（await 非 thenable 直接返回）
  const task = (async () => {
    try {
      const model = resolveModel(modelKey)
      if (!model) {
        console.error(`[vehicle-models] resolve 失败 modelKey=${modelKey} → generic fallback`)
        return { ok: false }
      }
      const urls = [model.hullSrc]
      if (model.turretSrc) urls.push(model.turretSrc)
      const loaded = await Promise.all(urls.map((u) => imageLoader(u, timeoutMs))).then((r) => r.every(Boolean))
      if (!loaded) {
        console.error(`[vehicle-models] preload 超时/失败 modelKey=${modelKey} → generic fallback`)
        return { ok: false }
      }
      return { ok: true, model }
    } catch (e) {
      // imageLoader 异常也按失败缓存——cache 永不留 rejected promise（避免悬挂/未处理 rejection）
      console.error(`[vehicle-models] preload 异常 modelKey=${modelKey} → generic fallback`, e)
      return { ok: false }
    }
  })()
  preloadCache.set(modelKey, task) // 先存 in-flight，去重并发
  const result = await task
  preloadCache.set(modelKey, result) // 固化（成功/失败都缓存，页面生命周期内不再重试）
  return result
}

/**
 * 战局级 preload（计划 §12/§13）：
 * - 输入本场全部 tankIds；只处理 Tier X modelKeys；
 * - module-lifetime cache：已成功/已失败的 modelKey 不重复解析、不重复调用 imageLoader；
 * - 并发请求同一 modelKey 共享 in-flight Promise（实际只加载一次）；
 * - 单个 modelKey 失败 → failed（该车型 fallback generic，不整场 fallback）；
 * - 返回 { resolved: Map<modelKey, VehicleModel>, failed: Set<modelKey>,
 *   byTank: Map<tankId, modelKey|null> }（byTank 供渲染侧直接查单车决策）。
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
      const result = await preloadModel(modelKey, { timeoutMs, imageLoader })
      if (result.ok) resolved.set(modelKey, result.model)
      else failed.add(modelKey)
    }),
  )
  return { resolved, failed, byTank }
}
