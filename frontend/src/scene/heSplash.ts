
import * as THREE from 'three'
import type { Plane, Vector3 } from 'three'
import { raycastGridAll, RC, isClippedModuleHit } from './armorCollisionPack.js'
import type { BuildRicochetGridResult, CollisionPack, CollisionPackFailure } from './armorCollisionPack.js'

export interface HeRayHit {
  t: number
  section: string
  thickness: number
  variant?: number | null
  point?: Vector3 | null
}

export interface HeLayer {
  armor: number
  primary: boolean
  distance: number
  section: string
}

export interface HeSampleOpts {
  damage: number
  explosionRadius: number
  liningFactor?: number
}

export interface HeRaySample {
  armor: number
  distance: number
  upper: number
  lower: number
  valid: boolean
}

export interface HeBestSample {
  upper: number
  lower: number
  armor: number
  distance: number
  index: number
  layers: HeLayer[]
  direction?: number[]
}

export interface HeSplashResult {
  min: number
  max: number
  avg: number
  samples: number
  best: HeBestSample | null
  bestLower: HeBestSample | null
  sampleStats: HeRaySample[] | null
  origin?: number[]
  inwardLayers?: HeLayer[]
}

export const HE_SAMPLE = Object.freeze({
    LAT_STEPS: 20,
    LON_STEPS: 40,
    LOWER: 0.75,
    UPPER: 1.25,
    ORIGIN_OFFSET: 0.1,
})

const PRIMARY = new Set(['hull', 'turret', 'gun'])
const STEP = Math.PI / HE_SAMPLE.LAT_STEPS

export const HE_SAMPLE_DIRECTIONS: readonly Vector3[] = Object.freeze((() => {
    const dirs: Vector3[] = []
    for (let i = 0; i < HE_SAMPLE.LON_STEPS; i++) {
        const phi = i * STEP
        const cosPhi = Math.cos(phi)
        const sinPhi = Math.sin(phi)
        for (let j = 0; j < HE_SAMPLE.LAT_STEPS; j++) {
            const theta = -Math.PI / 2 + j * STEP
            const cosTheta = Math.cos(theta)
            dirs.push(Object.freeze(new THREE.Vector3(
                cosPhi * cosTheta,
                sinPhi * cosTheta,
                Math.sin(theta),
            )))
        }
    }
    return dirs
})())

/**
 * 单条射线的碰撞命中 → 采样层列表。
 * 与游戏 2240（f_ehc）同口径：按距离累加每个相遇层，不做模块 variant 去重
 * （AI 的履带/轮组层会连续累加，见文件头）；同一位置同 section 的重合三角形
 * 只算一层（射线掠过四边形对角线时是同一块板，不是两层）。收集到首个主装（含）为止。
 *
 * @param hits 单条射线的碰撞命中列表
 * @returns 采样层列表（首个主装截断）
 */
export function heLayersFromHits(hits: readonly HeRayHit[]): HeLayer[] {
    const layers: HeLayer[] = []
    for (const h of hits) {
        const prev = layers[layers.length - 1]
        if (prev && Math.abs(h.t - prev.distance) < 1e-6 && h.section === prev.section) continue
        const primary = PRIMARY.has(h.section)
        layers.push({ armor: h.thickness, primary, distance: h.t, section: h.section })
        if (primary) break
    }
    return layers
}

/**
 * 单条射线（原始命中列表）→ 采样值：与 `computeHeSplash([heLayersFromHits(hits)], …)`
 * 同一口径，但不物化层对象/样本统计。热力图每顶点只读 avg，构建时 52 万条射线
 * 若都建层数组和 sampleStats 会产生上百万个小对象，这是纯分配开销。
 *
 * @param hits 单条射线的原始命中列表
 * @param opts damage / explosionRadius / liningFactor
 * @returns 名义装甲与归一化前 upper/lower（valid=false = 无主装）
 */
export function heSampleFromHits(hits: readonly HeRayHit[] | null | undefined, { damage, explosionRadius, liningFactor = 1.0 }: HeSampleOpts): HeRaySample {
    let armor = 0
    let dist = 0
    let hitPrimary = false
    let prevT = Infinity
    let prevSection: string | null = null
    if (Array.isArray(hits)) {
        for (const h of hits) {
            if (!(dist < explosionRadius)) break
            if (h.section === prevSection && Math.abs(h.t - prevT) < 1e-6) continue
            armor += h.thickness * liningFactor
            dist = h.t
            prevT = h.t
            prevSection = h.section
            if (PRIMARY.has(h.section)) { hitPrimary = true; break }
        }
    }
    if (!hitPrimary) return { armor, distance: dist, upper: 0, lower: 0, valid: false }
    const falloff = 1 - dist / explosionRadius
    return {
        armor, distance: dist,
        upper: 0.5 * damage * HE_SAMPLE.UPPER * falloff - armor,
        lower: 0.5 * damage * HE_SAMPLE.LOWER * falloff - armor,
        valid: true,
    }
}

/**
 * 纯函数：800 条（或任意条）层链 → he_min/he_max/he_avg。
 *
 * `samples === 0` 是**权威结果**：采样跑了，但没有任何射线在 R 内遇到主装
 * （func7695 对这类样本 `skip`）。它不是“采样器不可用”——后者由
 * `sampleHeSplash` 的 pack/grid 前置条件以 null 表达，调用方必须报错而不是回退。
 *
 * @param {Array<Array<{armor:number, primary:boolean, distance:number}>>} rays
 * @param {{damage:number, explosionRadius:number, liningFactor?:number}} opts
 * @returns {{min:number, max:number, avg:number, samples:number,
 *   best:{upper:number, lower:number, armor:number, distance:number, index:number,
 *   layers:Array<object>}|null, bestLower:object|null,
 *   sampleStats:Array<{armor:number, distance:number, upper:number, lower:number, valid:boolean}>}|null}
 *   null 仅表示入参非法（damage/radius 非正、rays 非数组）。
 */
export function computeHeSplash(rays: readonly (readonly HeLayer[] | null | undefined)[] | null | undefined, opts: HeSampleOpts): HeSplashResult | null {
    const { damage, explosionRadius, liningFactor = 1.0 } = opts
    if (!(damage > 0) || !(explosionRadius > 0) || !Array.isArray(rays)) return null
    let maxUpper = -Infinity
    let maxLower = -Infinity
    let best: HeBestSample | null = null
    let bestLower: HeBestSample | null = null
    let samples = 0
    const sampleStats: HeRaySample[] = new Array(rays.length)
    for (let i = 0; i < rays.length; i++) {
        const layers = rays[i]
        let armor = 0
        let dist = 0
        let hitPrimary = false
        if (Array.isArray(layers) && layers.length > 0) {
            for (const layer of layers) {
                if (!(dist < explosionRadius)) break
                armor += layer.armor * liningFactor
                dist = layer.distance
                if (layer.primary) { hitPrimary = true; break }
            }
        }
        let upper = 0
        let lower = 0
        if (hitPrimary) {
            samples++
            const falloff = 1 - dist / explosionRadius
            upper = 0.5 * damage * HE_SAMPLE.UPPER * falloff - armor
            lower = 0.5 * damage * HE_SAMPLE.LOWER * falloff - armor
            if (upper > maxUpper) {
                maxUpper = upper
                best = { upper, lower, armor, distance: dist, layers, index: i }
            }
            if (lower > maxLower) {
                maxLower = lower
                bestLower = { upper, lower, armor, distance: dist, layers, index: i }
            }
        }
        sampleStats[i] = { armor, distance: dist, upper, lower, valid: hitPrimary }
    }
    const min = Math.max(maxLower, 0)
    const max = Math.max(maxUpper, 0)
    return { min, max, avg: (min + max) / 2, samples, best, bestLower, sampleStats }
}

/**
 * 碰撞包 → 800 条射线的 HE 采样。
 *
 * @param {object} pack buildPack() 结果
 * @param {THREE.Vector3} origin 命中点（世界坐标）
 * @param {{originDir?:THREE.Vector3, normal?:THREE.Vector3, damage:number,
 *   explosionRadius:number, liningFactor?:number, originOffset?:number,
 *   grid?:object, clipPlane?:THREE.Plane, directions?:Array<THREE.Vector3>}} opts
 *   originDir = 命中点指向射手/相机的外向单位向量（优先）；缺省时退回 normal。
 *   grid = buildRicochetGrid() 结果，**必须有**：800 条射线走 DDA；网格缺失/失败
 *   即 fail-closed 返回 null，禁止回退 800×triTotal 的暴力全扫（评审 P1）。
 *   directions = 可选方向子集（热力图预计算用低分辨率方向表）；缺省固定 800 方向。
 *   clipPlane = 当前 gun_mask 裁切面；被裁掉的炮管命中与点击链一样不参与采样（评审 P2）。
 *   lean = true 时只累计 min/max/avg（热力图逐顶点场），不物化层链与 sampleStats；
 *   lean 结果的 best/bestLower/sampleStats 为 null，只有 min/max/avg/samples/origin。
 *   lean 是逐顶点热力图：无有效样本的顶点按透明处理，继续用 null（这是正常场值，
 *   不是“采样器不可用”）；面板路径不使用 lean。
 * @returns {ReturnType<typeof computeHeSplash>}
 *   null = 采样器**跑不了**（pack/grid/入参不合法），调用方必须报错或显式降级，
 *   不得用单射线公式冒充采样结果。samples === 0 = 跑了但没有有效射线（权威 0）。
 */
export interface SampleHeSplashOpts extends HeSampleOpts {
  originDir?: Vector3 | null
  normal?: Vector3 | null
  grid?: BuildRicochetGridResult | null
  directions?: readonly Vector3[] | null
  clipPlane?: Plane | null
  originOffset?: number | null
  twoSidedSpaced?: boolean
  lean?: boolean
}

export function sampleHeSplash(
  pack: CollisionPack | CollisionPackFailure | null | undefined,
  origin: Vector3 | null | undefined,
  opts: SampleHeSplashOpts,
): HeSplashResult | null {
    const { originDir, normal, damage, explosionRadius, liningFactor = 1.0 } = opts
    if (!pack || !pack.ok || !origin || !(damage > 0) || !(explosionRadius > 0)) return null
    if (!opts.grid || !opts.grid.ok) return null
    const dirs: readonly Vector3[] = Array.isArray(opts.directions) && opts.directions.length
        ? opts.directions : HE_SAMPLE_DIRECTIONS
    const offset = opts.originOffset != null ? opts.originOffset : HE_SAMPLE.ORIGIN_OFFSET
    const clipPlane = opts.clipPlane || null
    const twoSidedSpaced = opts.twoSidedSpaced !== false
    const lean = opts.lean === true
    const ro = origin.clone()
    const out = originDir || normal
    if ((!out || out.lengthSq?.() === 0) && offset !== 0) return null
    if (out && offset !== 0) {
        const n = out.clone().normalize()
        ro.addScaledVector(n, offset)
    }
    const rays: HeLayer[][] = lean ? [] : new Array<HeLayer[]>(dirs.length)
    let leanMin = -Infinity, leanMax = -Infinity, leanSamples = 0
    const tMax = explosionRadius + 1e-4
    for (let i = 0; i < dirs.length; i++) {
        const raw = raycastGridAll(opts.grid, ro, dirs[i], RC.MIN_CONTINUATION_T, tMax, twoSidedSpaced) || []
        const hits = clipPlane
            ? raw.filter(h => !isClippedModuleHit(h.section, h.point, clipPlane))
            : raw
        if (lean) {
            const s = heSampleFromHits(hits, { damage, explosionRadius, liningFactor })
            if (!s.valid) continue
            leanSamples++
            if (s.upper > leanMax) leanMax = s.upper
            if (s.lower > leanMin) leanMin = s.lower
        } else {
            rays[i] = heLayersFromHits(hits)
        }
    }
    if (lean) {
        if (!leanSamples) return null
        const min = Math.max(leanMin, 0)
        const max = Math.max(leanMax, 0)
        return {
            min, max, avg: (min + max) / 2, samples: leanSamples,
            origin: [ro.x, ro.y, ro.z],
            best: null, bestLower: null, sampleStats: null,
        }
    }
    const result = computeHeSplash(rays, { damage, explosionRadius, liningFactor })
    if (result) {
        result.origin = [ro.x, ro.y, ro.z]
        if (Array.isArray(opts.directions) && opts.directions.length) {
            result.inwardLayers = rays[rays.length - 1] || []
        }
        for (const key of ['best', 'bestLower'] as const) {
            const sample = result[key]
            if (!sample) continue
            const idx = rays.indexOf(sample.layers)
            const dir = idx >= 0 ? dirs[idx] : null
            if (dir) sample.direction = [dir.x, dir.y, dir.z]
        }
    }
    return result
}
