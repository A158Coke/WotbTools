/**
 * Armor Inspector HE 溅射采样（Blitz legacy，wasm func7695 的反编译移植）。
 *
 * 证据与数值锚点：Agent 仓 tmp_analysis/armor-inspector/
 * HE_MECHANISM_EXACT_DECOMPILED.md（2026-10-19）。
 *
 * 语义：
 * - 以命中点沿射向反方向外移 10cm 为球心（见下），固定 20×40 世界空间方向
 *   （θ∈[-π/2,π/2)，φ∈[0,2π)，步长 π/20）；
 * - 每条射线按距离收集碰撞层，累加“主装之前（含主装）”的名义装甲；
 *   游戏 2240（f_ehc）返回的层表不去重模块：同一条射线穿过履带/轮组时，
 *   每个相遇层都参与累加（实测 AI 的 T-34 履带射线可出现 17×20mm），
 *   因此这里也不做 variant 去重，只合并同一位置、同一 section 的重合三角形；
 * - upper/lower = 0.5*damage*1.25/0.75*(1 - d/R) - Σarmor；
 * - he_max = max(upper)，he_min = max(lower)（各自取最大，不是区域最小），
 *   he_avg = (he_min+he_max)/2；最后夹 0。
 *
 * 与 Armor Inspector 的已知近似：
 * - 游戏层结构的 primaryFlag 来自碰撞材质；WotbTools 目前只有 section 分类，
 *   这里用 hull/turret/gun 作为主装。履带/外部模块永远只作前置衰减层；
 *   只命中模块/间隙甲而没有主装的射线跳过——best sample 不会选到履带。
 * - 射线起点沿**射向反方向（朝射手）**外移 ORIGIN_OFFSET（默认 10cm）：
 *   AI 插桩的每个目标，同一块主装的最小层距离都等于
 *   `0.1 × |cos(shot, plateNormal)|`（T-34 0.0496、Pz IV 0.0751、D2 0.0593、
 *   M3 0.0511、Vickers 0.0607）；沿命中法线固定偏移 5cm 只能碰巧对上 T-34，
 *   Pz IV 会少算 2.5cm 从而高估 2.87/1.73 伤害。该 0.1 有直接反编译依据：
 *   func5144 在 1c668e/1c69f6 用 -0.1 计算 `origin + dir*(t - 0.1)`，即游戏
 *   在 HE trace 前把命中点沿射向反方向退 0.1m；数值锚点只是确认。
 *   collision.glb 是单面网格，从表面起射会被 t≈0 过滤/背面剔除，所以移植
 *   也必须外移才能让点击板进入层表。没有 originDir 时才退回命中法线方向。
 */

import * as THREE from 'three'
import { raycastPackAll, raycastGridAll, RC } from './armorCollisionPack.js'

export const HE_SAMPLE = Object.freeze({
    LAT_STEPS: 20,
    LON_STEPS: 40,
    LOWER: 0.75,
    UPPER: 1.25,
    /** 射线起点沿射向反方向（朝射手）的外移量（米；数值反推，见文件头） */
    ORIGIN_OFFSET: 0.1,
})

const PRIMARY = new Set(['hull', 'turret', 'gun'])
const STEP = Math.PI / HE_SAMPLE.LAT_STEPS

/** 固定球面方向表（模块加载时构造一次；世界坐标，不随装甲法线旋转）。 */
export const HE_SAMPLE_DIRECTIONS = Object.freeze((() => {
    const dirs = []
    for (let i = 0; i < HE_SAMPLE.LON_STEPS; i++) {
        const phi = i * STEP
        const cosPhi = Math.cos(phi)
        const sinPhi = Math.sin(phi)
        for (let j = 0; j < HE_SAMPLE.LAT_STEPS; j++) {
            const theta = -Math.PI / 2 + j * STEP
            const cosTheta = Math.cos(theta)
            // 与 Armor Inspector 对齐的固定网格（2026-10-19 实测锚点）：
            //   (cosφ·cosθ, sinφ·cosθ, sinθ)
            // 这是游戏坐标的 z-up 公式。WotbTools 的装甲 GLB 世界轴与游戏
            // 采样网格在这个口径下一致（T-34 正面 he_min/he_max 逐位吻合）；
            // 不要再“修正”成 Three.js 的 y-up 形式——那会把 800 方向整体旋转，
            // best sample 改打别的板，伤害即偏离 AI。
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
 * @param {Array<{t:number, section:string, thickness:number, variant:string|null}>} hits
 * @returns {Array<{armor:number, primary:boolean, distance:number, section:string}>}
 */
export function heLayersFromHits(hits) {
    const layers = []
    for (const h of hits) {
        const prev = layers[layers.length - 1]
        if (prev && Math.abs(h.t - prev.distance) < 1e-6 && h.section === prev.section) continue
        const primary = PRIMARY.has(h.section)
        layers.push({ armor: h.thickness, primary, distance: h.t, section: h.section })
        if (primary) break
    }
    // 履带/外部模块永远不是主装：它们只作为前置衰减层参与累加。
    // 只命中履带/炮管而没有主装的射线不是有效样本（Armor Inspector 的
    // primaryFlag 只落在 hull/turret/gun 上；best sample 不会选到履带）。
    return layers
}

/**
 * 纯函数：800 条（或任意条）层链 → he_min/he_max/he_avg。
 *
 * @param {Array<Array<{armor:number, primary:boolean, distance:number}>>} rays
 * @param {{damage:number, explosionRadius:number, liningFactor?:number}} opts
 * @returns {{min:number, max:number, avg:number, samples:number,
 *   best:{upper:number, lower:number, armor:number, distance:number, index:number,
 *   layers:Array<object>}|null, bestLower:object|null,
 *   sampleStats:Array<{armor:number, distance:number, upper:number, lower:number, valid:boolean}>}|null}
 */
export function computeHeSplash(rays, { damage, explosionRadius, liningFactor = 1.0 }) {
    if (!(damage > 0) || !(explosionRadius > 0) || !Array.isArray(rays)) return null
    let maxUpper = -Infinity
    let maxLower = -Infinity
    let best = null
    let bestLower = null
    let samples = 0
    const sampleStats = new Array(rays.length)
    for (let i = 0; i < rays.length; i++) {
        const layers = rays[i]
        // 与 func7695 一致：距离判断用“上一层距离”，因此可能多吃一个刚越过 R 的层；
        // 累加包含主装层，遇到 primary 即停。
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
        // 方向化热力图用：每一条射线的名义装甲和归一化前 upper/lower。
        // 无效方向（没有主装）保留 valid=false，渲染层据此透明。
        sampleStats[i] = { armor, distance: dist, upper, lower, valid: hitPrimary }
    }
    if (!samples) return null
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
 *   grid?:object}} opts
 *   originDir = 命中点指向射手/相机的外向单位向量（优先）；缺省时退回 normal。
 *   grid = buildRicochetGrid() 结果；提供时 800 条射线走 DDA，避免全扫三角形（评审 P1）。
 * @returns {ReturnType<typeof computeHeSplash>}
 */
export function sampleHeSplash(pack, origin, opts) {
    const { originDir, normal, damage, explosionRadius, liningFactor = 1.0 } = opts
    if (!pack || !pack.ok || !origin || !(damage > 0) || !(explosionRadius > 0)) return null
    const offset = opts.originOffset != null ? opts.originOffset : HE_SAMPLE.ORIGIN_OFFSET
    const ro = origin.clone()
    const out = originDir || normal
    if (out && offset !== 0) {
        const n = out.clone().normalize()
        ro.addScaledVector(n, offset)
    }
    const rays = new Array(HE_SAMPLE_DIRECTIONS.length)
    for (let i = 0; i < HE_SAMPLE_DIRECTIONS.length; i++) {
        const hits = opts.grid && opts.grid.ok
            ? raycastGridAll(opts.grid, ro, HE_SAMPLE_DIRECTIONS[i], RC.MIN_CONTINUATION_T)
            : raycastPackAll(pack, ro, HE_SAMPLE_DIRECTIONS[i], RC.MIN_CONTINUATION_T)
        rays[i] = heLayersFromHits(hits || [])
    }
    const result = computeHeSplash(rays, { damage, explosionRadius, liningFactor })
    if (result) {
        // 方向化热力图/半径球的真实爆点：沿射向外移后的 origin（不是点击表面点）。
        result.origin = [ro.x, ro.y, ro.z]
        // 可视化/诊断：记录 max-upper / max-lower 两个样本的方向（世界系）。
        for (const key of ['best', 'bestLower']) {
            const sample = result[key]
            if (!sample) continue
            const idx = rays.indexOf(sample.layers)
            const dir = idx >= 0 ? HE_SAMPLE_DIRECTIONS[idx] : null
            if (dir) sample.direction = [dir.x, dir.y, dir.z]
        }
    }
    return result
}
