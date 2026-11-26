import { MODEL_DEFINITIONS, TANK_ID_TO_MODEL } from './mapping.js'

const hullUrls = import.meta.glob('./assets/*/hull.webp', { query: '?url', import: 'default', eager: true })
const turretUrls = import.meta.glob('./assets/*/turret.webp', { query: '?url', import: 'default', eager: true })
const metadataMap = import.meta.glob('./assets/*/metadata.json', { import: 'default', eager: true })

export const PRELOAD_TIMEOUT_MS = 3000
const TRANSIENT_IMAGE_ATTEMPTS = 2

const FALLBACK_REASON = Object.freeze({
  UNKNOWN_TANK_MAPPING: 'UNKNOWN_TANK_MAPPING',
  MISSING_METADATA: 'MISSING_METADATA',
  METADATA_MODEL_KEY_MISMATCH: 'METADATA_MODEL_KEY_MISMATCH',
  INVALID_MODEL_KIND: 'INVALID_MODEL_KIND',
  MISSING_HULL_ASSET: 'MISSING_HULL_ASSET',
  MISSING_TURRET_ASSET: 'MISSING_TURRET_ASSET',
  INVALID_TURRET_METADATA: 'INVALID_TURRET_METADATA',
  IMAGE_LOAD_ERROR: 'IMAGE_LOAD_ERROR',
  IMAGE_LOAD_TIMEOUT: 'IMAGE_LOAD_TIMEOUT',
  MODULE_IMPORT_FAILURE: 'MODULE_IMPORT_FAILURE',
})

class VehicleModel {
  /** @param {{modelKey:string, kind:'turreted'|'turretless', hullSrc:string, turretSrc:string|null, turretPivot:({x:number,y:number}|null), turretRaster:(object|null), hullBounds:(object|null)}} init */
  constructor({ modelKey, kind, hullSrc, turretSrc, turretPivot, turretRaster, hullBounds }) {
    this.modelKey = modelKey
    this.kind = kind
    this.hullSrc = hullSrc
    this.turretSrc = turretSrc
    this.turretPivot = turretPivot
    this.turretRaster = turretRaster
    this.hullBounds = hullBounds
  }
}

export function modelKeyForTank(tankId) {
  return TANK_ID_TO_MODEL[String(tankId)] ?? null
}

function invalidTurretMetadata(meta) {
  const p = meta?.turretPivot
  const r = meta?.turretRaster
  return !p || !Number.isFinite(p.x) || !Number.isFinite(p.y)
    || !r || !Number.isFinite(r.pixelWidth) || !Number.isFinite(r.pixelHeight)
    || !Number.isFinite(r.pivotX) || !Number.isFinite(r.pivotY)
}

function resolveModelResult(modelKey) {
  if (!modelKey) return { ok: false, reason: FALLBACK_REASON.UNKNOWN_TANK_MAPPING }
  const def = MODEL_DEFINITIONS[modelKey]
  if (!def) return { ok: false, reason: FALLBACK_REASON.UNKNOWN_TANK_MAPPING }
  const meta = metadataMap[`./assets/${modelKey}/metadata.json`]
  if (!meta) return { ok: false, reason: FALLBACK_REASON.MISSING_METADATA }
  if (meta.modelKey !== modelKey) {
    return { ok: false, reason: FALLBACK_REASON.METADATA_MODEL_KEY_MISMATCH }
  }
  const hullSrc = hullUrls[`./assets/${modelKey}/hull.webp`]
  if (!hullSrc) return { ok: false, reason: FALLBACK_REASON.MISSING_HULL_ASSET }
  const kind = meta.kind
  if (kind !== 'turreted' && kind !== 'turretless') {
    return { ok: false, reason: FALLBACK_REASON.INVALID_MODEL_KIND }
  }
  const rawHullBounds = meta.generation?.hullBounds
  const hullBounds = rawHullBounds
    && Array.isArray(rawHullBounds.min) && Array.isArray(rawHullBounds.max)
    && rawHullBounds.min.length >= 2 && rawHullBounds.max.length >= 2
    && rawHullBounds.min.every(Number.isFinite) && rawHullBounds.max.every(Number.isFinite)
    && rawHullBounds.max[0] > rawHullBounds.min[0]
    && rawHullBounds.max[1] > rawHullBounds.min[1]
    ? Object.freeze({
      minX: rawHullBounds.min[0],
      maxX: rawHullBounds.max[0],
      minY: rawHullBounds.min[1],
      maxY: rawHullBounds.max[1],
    })
    : null
  if (kind === 'turretless') {
    return { ok: true, model: new VehicleModel({ modelKey, kind, hullSrc, turretSrc: null, turretPivot: null, turretRaster: null, hullBounds }) }
  }
  const turretSrc = turretUrls[`./assets/${modelKey}/turret.webp`]
  if (!turretSrc) return { ok: false, reason: FALLBACK_REASON.MISSING_TURRET_ASSET }
  if (invalidTurretMetadata(meta)) {
    return { ok: false, reason: FALLBACK_REASON.INVALID_TURRET_METADATA }
  }
  return { ok: true, model: new VehicleModel({
    modelKey,
    kind,
    hullSrc,
    turretSrc,
    turretPivot: meta.turretPivot,
    turretRaster: meta.turretRaster,
    hullBounds,
  }) }
}

export function resolveModel(modelKey) {
  const result = resolveModelResult(modelKey)
  return result.ok ? result.model : null
}

function loadImage(url, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false
    let timer = null
    const finish = (result) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      img.onload = null
      img.onerror = null
      resolve(result)
    }
    const img = new Image()
    timer = setTimeout(() => finish({ ok: false, reason: FALLBACK_REASON.IMAGE_LOAD_TIMEOUT }), timeoutMs)
    img.onload = () => finish({ ok: true })
    img.onerror = () => finish({ ok: false, reason: FALLBACK_REASON.IMAGE_LOAD_ERROR })
    img.src = url
  })
}

const preloadCache = new Map()

async function preloadModel(modelKey, { timeoutMs, imageLoader }) {
  const existing = preloadCache.get(modelKey)
  if (existing) return existing
  const task = (async () => {
    try {
      const resolved = resolveModelResult(modelKey)
      if (!resolved.ok) {
        console.error(`[vehicle-models] fallback reason=${resolved.reason} modelKey=${modelKey}`)
        return resolved
      }
      const model = resolved.model
      const urls = [model.hullSrc]
      if (model.turretSrc) urls.push(model.turretSrc)
      const loaded = await Promise.all(urls.map(async (url) => {
        let last = { ok: false, reason: FALLBACK_REASON.IMAGE_LOAD_ERROR }
        for (let attempt = 0; attempt < TRANSIENT_IMAGE_ATTEMPTS; attempt += 1) {
          try {
            const value = await imageLoader(url, timeoutMs)
            if (value === true || (value && typeof value === 'object' && value.ok === true)) {
              last = { ok: true }
            } else {
              last = {
                ok: false,
                reason: value?.reason === FALLBACK_REASON.IMAGE_LOAD_TIMEOUT
                  ? FALLBACK_REASON.IMAGE_LOAD_TIMEOUT
                  : FALLBACK_REASON.IMAGE_LOAD_ERROR,
              }
            }
            if (last?.ok) return last
          } catch {
            last = { ok: false, reason: FALLBACK_REASON.IMAGE_LOAD_ERROR }
          }
        }
        return last
      }))
      const failedLoad = loaded.find((item) => !item?.ok)
      if (failedLoad) {
        console.error(`[vehicle-models] fallback reason=${failedLoad.reason} modelKey=${modelKey}`)
        return { ok: false, reason: failedLoad.reason || FALLBACK_REASON.IMAGE_LOAD_ERROR }
      }
      return { ok: true, model }
    } catch {
      console.error(`[vehicle-models] fallback reason=${FALLBACK_REASON.IMAGE_LOAD_ERROR} modelKey=${modelKey}`)
      return { ok: false, reason: FALLBACK_REASON.IMAGE_LOAD_ERROR }
    }
  })()
  preloadCache.set(modelKey, task)
  const result = await task
  preloadCache.set(modelKey, result)
  return result
}

/**
 * 战局级 preload：
 * - 输入本场全部 tankIds；只处理 Tier X modelKeys；
 * - module-lifetime cache：已成功/已失败的 modelKey 不重复解析、不重复调用 imageLoader；
 * - 并发请求同一 modelKey 共享 in-flight Promise（实际只加载一次）；
 * - 单个 modelKey 失败 → failed（该车型 fallback generic，不整场 fallback）；
 * - 返回 { resolved: Map<modelKey, VehicleModel>, failed: Set<modelKey>,
 *   failureReasons: Map<tankId|modelKey, string>, byTank: Map<tankId, modelKey|null> }
 *   （byTank 供渲染侧直接查单车决策）。
 * @param {number[]|string[]} tankIds
 * @param {{timeoutMs?:number, imageLoader?:(url:string, timeoutMs:number)=>Promise<boolean|{ok:boolean,reason?:string}>}} [opts] 测试注入
 */
export async function preloadBattleModels(tankIds, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? PRELOAD_TIMEOUT_MS
  const imageLoader = opts.imageLoader ?? loadImage
  const modelKeys = new Set()
  const byTank = new Map()
  const failureReasons = new Map()
  for (const id of tankIds || []) {
    const key = modelKeyForTank(id)
    byTank.set(String(id), key)
    if (key) modelKeys.add(key)
    else failureReasons.set(String(id), FALLBACK_REASON.UNKNOWN_TANK_MAPPING)
  }
  const resolved = new Map()
  const failed = new Set()
  await Promise.all(
    [...modelKeys].map(async (modelKey) => {
      const result = await preloadModel(modelKey, { timeoutMs, imageLoader })
      if (result.ok) resolved.set(modelKey, result.model)
      else {
        failed.add(modelKey)
        failureReasons.set(modelKey, result.reason || FALLBACK_REASON.IMAGE_LOAD_ERROR)
      }
    }),
  )
  return { resolved, failed, failureReasons, byTank }
}
