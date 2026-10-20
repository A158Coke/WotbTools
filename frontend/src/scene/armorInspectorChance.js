/**
 * Armor Inspector 击穿概率机制（客户端复刻）。
 *
 * 来源（逆向 static.wotinspector.com/ai/webapp4.5.3-4/armor-inspector.wasm）：
 * - 概率函数 `func[22167]`：穿深区间 [min,max] 被当作正态分布的 ±3σ 边界；
 *   均值 μ=(min+max)/2，σ=(max-min)/6，概率为 Φ((μ-T)/σ)，区间外夹到 1/0。
 * - Blitz 弹数据：min/max = 0.95P / 1.05P（±5%，σ=P/60）；
 *   PC 弹数据：0.75P / 1.25P（±25%，σ=P/12）。
 * - 逐层：每层用当前剩余区间算一次 CDF，然后把 **min/max 同时**扣掉一次该层
 *   等效厚度——平移不改变 σ；外部模块是 flat 消耗（同样平移），不参与 CDF。
 *   （2026-10-18 复核修正：Armor Inspector 的层区间是 1× 等效厚度扣减；
 *   此前 3× 实现会把确定性穿透误判为 0%。）
 *
 * 本模块只负责“概率”，不改 penetration.js 的确定性判定。视图层把
 * 同一套 [min/max, 1×等效厚度] 语义用于：
 * - 点击面板的击穿概率（输入必须是完整命中链，不能是确定性提前截断的层链）；
 * - 主装甲热力图着色；
 * - 跳弹续飞概率带。
 *
 * 说明：wasm 里的 CDF 是多项式近似（误差约 0.002）；这里用标准
 * Abramowitz-Stegun erf 近似（误差 ~1.5e-7），分布语义相同、数值更接近精确高斯。
 */

/** WoT Blitz 穿深随机化范围（±5%）。 */
export const ARMOR_INSPECTOR_BLITZ_RANDOMIZATION = 0.05
/** WoT PC 穿深随机化范围（±25%）。 */
export const ARMOR_INSPECTOR_PC_RANDOMIZATION = 0.25

const EXTERNAL_SECTIONS = new Set(['chassis', 'gunBarrel'])

/**
 * 标准正态 CDF，Abramowitz-Stegun 7.1.26（|误差| < 1.5e-7）。
 * @param {number} z
 * @returns {number} P(Z <= z)
 */
export function normalCdf(z) {
  if (Number.isNaN(z)) return NaN
  if (z === Infinity) return 1
  if (z === -Infinity) return 0
  const x = z / Math.SQRT2
  const sign = x < 0 ? -1 : 1
  const ax = Math.abs(x)
  const t = 1 / (1 + 0.3275911 * ax)
  const poly = (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t
  const erf = 1 - poly * Math.exp(-ax * ax)
  return 0.5 * (1 + sign * erf)
}

/**
 * 概率标题的百分比显示：不确定性不能被四舍五入成确定性。
 * 0 < chance < 1 且四舍五入为 100 时显示 `>99`（而不是 `100`），
 * 亚 1% 显示 `<1`；精确 1 才是 `100`。返回值不含 `%`。
 *
 * @param {number} chance 0..1
 * @returns {string}
 */
export function formatProbabilityPercent(chance) {
  const value = Number(chance)
  if (!(value > 0)) return '0'
  if (value >= 1) return '100'
  const pct = value * 100
  if (pct < 1) return '<1'
  if (pct >= 99.5) return '>99'
  return String(Math.round(pct))
}

/** ±range 随机化区间；randomization=0 时退化为单点（确定性穿深）。 */
function intervalFor(penetration, randomization) {
  const p = Number.isFinite(penetration) ? Math.max(0, penetration) : 0
  if (!(randomization > 0)) return { min: p, max: p }
  return { min: p * (1 - randomization), max: p * (1 + randomization) }
}

/** 区间 [min,max] 上 P(roll > thickness)。 */
function cdfForInterval(min, max, thickness) {
  if (max <= 0) return 0
  if (min === max) return min > thickness ? 1 : 0
  if (thickness <= min) return 1
  if (thickness >= max) return 0
  const sigma = (max - min) / 6
  if (!(sigma > 0)) return 0
  return normalCdf(((min + max) / 2 - thickness) / sigma)
}

/**
 * 区间 [min,max] 上的单层击穿概率（供续飞 JS/GLSL 参考共用）。
 * @param {number} min
 * @param {number} max
 * @param {number} thickness
 * @returns {number} 0..1
 */
export function penetrationChanceForInterval(min, max, thickness) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(thickness)) return 0
  return cdfForInterval(min, max, thickness)
}

/**
 * 单层击穿概率：穿深 ~ N(P, (P*randomization/3)^2)，求 P(pen > T)。
 * 区间外与 Armor Inspector 一致夹到 1/0（±3σ 外不再累积尾部）。
 *
 * @param {number} penetration 当前剩余穿深（mm）
 * @param {number} thickness 该层等效厚度（mm）
 * @param {number} [randomization] 随机化范围（0.05=Blitz，0.25=PC）
 * @returns {number} 0..1
 */
export function penetrationChanceForLayer(penetration, thickness, randomization = ARMOR_INSPECTOR_BLITZ_RANDOMIZATION) {
  if (!(penetration > 0) || !Number.isFinite(thickness)) return 0
  const { min, max } = intervalFor(penetration, randomization)
  return penetrationChanceForInterval(min, max, thickness)
}

function layerEffectiveThickness(layer) {
  const eff = layer?.effective ?? layer?.eff
  return Number.isFinite(eff) ? eff : null
}

function layerRemainingBefore(layer) {
  const before = layer?.remaining_before ?? layer?.remainBefore
  return Number.isFinite(before) ? before : null
}

function isGapLayer(layer) {
  return layer?.gap === true || String(layer?.name ?? layer?.part_name ?? '').startsWith('Gap ')
}

function gapDistance(layer) {
  const direct = layer?.gap_distance ?? layer?.gapDistance
  if (Number.isFinite(direct)) return Math.max(0, direct)
  const match = /^Gap\s+([\d.]+)m/.exec(String(layer?.name ?? layer?.part_name ?? ''))
  return match ? Math.max(0, parseFloat(match[1])) : 0
}

function isExternalLayer(layer) {
  if (typeof layer?.external === 'boolean') return layer.external
  if (layer?.section) return EXTERNAL_SECTIONS.has(layer.section)
  // 点击面板的 trajLayers 不带 section；外部模块没有角度，间隙层由名字区分。
  return !isGapLayer(layer) && layer?.angle == null
}

/**
 * 多层击穿概率（Armor Inspector 逐层模型）。
 *
 * - 初始区间 [P(1-r), P(1+r)]；每个实际装甲层用当前区间算 CDF，再把
 *   min/max 同时减去一次等效厚度（σ 保持不变）。
 * - 外部模块：flat 消耗（min/max 同时减厚度），不参与 CDF；区间耗尽即 0。
 * - HEAT Gap 层：按 penetration.js 的 0.5/m 衰减缩放区间，不参与 CDF。
 * - 跳弹：确定性路径已跳弹，除非有后续续飞段，否则 0。
 * - 续飞：在**首个** seg=1 层按该层的 remaining_before 初始化一次；同一段内
 *   后续 seg=1 层不得再次清空累计概率与区间（只有再次跳弹后的新段才重置）。
 *
 * `layers` 接受 penetration.js 的 probability_layers（snake_case）或
 * tankViewer trajLayers（camelCase）。normal 层不再读取 remaining_before——
 * 它是确定性截断链的产物，不能作为概率区间来源；只有续飞段起点例外。
 *
 * @param {number} penetration 首层前的有效穿深（mm）
 * @param {Array<object>} layers 完整命中链
 * @param {number} [randomization]
 * @returns {number} 0..1
 */
export function evaluateProbabilityChain(penetration, layers, randomization = ARMOR_INSPECTOR_BLITZ_RANDOMIZATION) {
  const all = layers || []
  // 空链没有可判定的层：fail-closed 返回 0%，不得默认必穿。
  if (all.length === 0) return { chance: 0, layers: [] }

  const firstContinuation = all.findIndex(layer => layer?.seg > 0)
  let startIndex = 0
  let { min, max } = intervalFor(penetration, randomization)
  if (firstContinuation >= 0) {
    const start = layerRemainingBefore(all[firstContinuation])
    ;({ min, max } = intervalFor(start != null ? start : penetration, randomization))
    startIndex = firstContinuation
  }

  let chance = 1
  let pendingSegmentReset = false
  const evaluations = []
  // 单层累计概率是 UI 的唯一层链：红色 0%、黄色 1–99%、绿色 100%。
  const record = (layer, layerChance) => {
    evaluations.push({
      ...layer,
      chance,
      probChance: chance,
      layerChance,
    })
  }
  const fail = (index, layer, layerChance = 0) => {
    chance = 0
    if (layer) record(layer, layerChance)
    // 概率归零后仍保留到首个 Primary 的完整层链：结果卡/轨迹用这条链，
    // 提前截断会让后续主装甲层行、层点与轨迹终点整段消失；剩余层统一累计 0%。
    for (let j = index + 1; j < all.length; j++) record(all[j], 0)
    return { chance: 0, layers: evaluations }
  }

  for (let i = startIndex; i < all.length; i++) {
    const layer = all[i]
    // 同一续飞段内的后续层共享区间；只有再次跳弹后的新段才重置一次。
    if (layer?.seg > 0 && i !== startIndex && pendingSegmentReset) {
      const start = layerRemainingBefore(layer)
      ;({ min, max } = intervalFor(start != null ? start : penetration, randomization))
      chance = 1
      pendingSegmentReset = false
    }

    if (layer?.ricochet) {
      const hasLaterContinuation = all.slice(i + 1).some(l => l?.seg > 0)
      if (!hasLaterContinuation) return fail(i, layer)
      record(layer, 1)
      pendingSegmentReset = true
      continue
    }

    if (isGapLayer(layer)) {
      const distance = gapDistance(layer)
      if (distance > 0) {
        // penetration.js：remainingPen -= 0.5 × remainingPen × distance
        const loss = Math.max(0, 1 - 0.5 * distance)
        min *= loss
        max *= loss
        if (max <= 0) return fail(i, layer)
      }
      record(layer, 1)
      continue
    }

    const thickness = Number.isFinite(layer?.thickness) ? Math.max(0, layer.thickness) : 0
    if (isExternalLayer(layer)) {
      min -= thickness
      max -= thickness
      if (max <= 0) return fail(i, layer)
      record(layer, 1)
      continue
    }

    const eff = layerEffectiveThickness(layer)
    if (eff == null || !(eff > 0)) {
      record(layer, 1)
      continue
    }
    if (max <= 0) return fail(i, layer)

    const layerChance = cdfForInterval(min, max, eff)
    chance *= layerChance
    if (!(chance > 0)) return fail(i, layer, layerChance)
    record(layer, layerChance)

    // Armor Inspector 层区间：每层同时平移一次等效厚度；σ 不变——不得按
    // 扣减后的均值重算 σ。此前误用 3× 会把 252AP 打 21.5+207 误判成 0%。
    min -= eff
    max -= eff
  }

  return { chance: Math.max(0, Math.min(1, chance)), layers: evaluations }
}

/**
 * 兼容旧调用：只返回总概率。
 * @param {number} penetration
 * @param {Array<object>} layers
 * @param {number} [randomization]
 * @returns {number}
 */
export function penetrationChance(penetration, layers, randomization = ARMOR_INSPECTOR_BLITZ_RANDOMIZATION) {
  return evaluateProbabilityChain(penetration, layers, randomization).chance
}

/**
 * GLSL 版本的正态 CDF（与 normalCdf 同系数），供主装甲热力图与续飞着色器注入。
 * 约束：GLSL ES 1.0（mediump/highp 由调用方声明）。
 */
export const AI_NORMAL_CDF_GLSL = `
float aiErf(float x) {
  float s = x < 0.0 ? -1.0 : 1.0;
  float ax = abs(x);
  float t = 1.0 / (1.0 + 0.3275911 * ax);
  float poly = ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  return s * (1.0 - poly * exp(-ax * ax));
}
float aiNormalCdf(float z) {
  return 0.5 * (1.0 + aiErf(z * 0.7071067811865476));
}
`
