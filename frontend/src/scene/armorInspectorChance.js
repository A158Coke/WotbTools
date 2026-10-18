/**
 * Armor Inspector 击穿概率机制（客户端复刻）。
 *
 * 来源（逆向 static.wotinspector.com/ai/webapp4.5.3-4/armor-inspector.wasm）：
 * - 概率函数 `func[22167]`：穿深区间 [min,max] 被当作正态分布的 ±3σ 边界；
 *   均值 μ=(min+max)/2，σ=(max-min)/6，概率为 Φ((μ-T)/σ)，区间外夹到 1/0。
 * - Blitz 弹数据：min/max = 0.95P / 1.05P（±5%，σ=P/60）；
 *   PC 弹数据：0.75P / 1.25P（±25%，σ=P/12）。
 * - 逐层：每层用当前剩余区间算一次 CDF，然后把区间扣掉 3×该层等效厚度
 *   （`func[7696]` 的 3.0 常量）；外部模块是 flat 消耗，不参与 CDF。
 *
 * 本模块只负责“概率”，不改 penetration.js 的确定性判定。视图层把
 * 同一套 [+/-3σ, 3×厚度] 语义用于：
 * - 点击面板的击穿概率；
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
  if (!(randomization > 0)) return penetration > thickness ? 1 : 0
  const sigma = penetration * randomization / 3
  if (thickness <= penetration - 3 * sigma) return 1
  if (thickness >= penetration + 3 * sigma) return 0
  return normalCdf((penetration - thickness) / sigma)
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
  return String(layer?.name ?? layer?.part_name ?? '').startsWith('Gap ')
}

function isExternalLayer(layer) {
  if (layer?.section) return EXTERNAL_SECTIONS.has(layer.section)
  // 点击面板的 trajLayers 不带 section；外部模块没有角度，间隙层由名字区分。
  return !isGapLayer(layer) && layer?.angle == null
}

/**
 * 多层击穿概率（Armor Inspector 逐层模型）。
 *
 * - 每个实际装甲层：用当前区间算 CDF；随后剩余区间 -= 3 × 等效厚度。
 * - 外部模块：flat 消耗（remaining -= thickness），不算概率层。
 * - HEAT Gap 层：不消耗 CDF，区间对齐确定性层链的 remainBefore。
 * - 跳弹：返回 0（Armor Inspector 的 CDF 不建模跳弹分支）。
 *
 * `layers` 接受 penetration.js 的 layers（snake_case）或 tankViewer 的
 * trajLayers（camelCase）。`remaining_before`/`remainBefore` 用来吸收距离衰减、
 * 装备系数与间隙甲损耗；没有该字段时退回纯 3× 传播。
 *
 * @param {number} penetration 首层前的有效穿深（mm）
 * @param {Array<object>} layers
 * @param {number} [randomization]
 * @returns {number} 0..1
 */
export function penetrationChance(penetration, layers, randomization = ARMOR_INSPECTOR_BLITZ_RANDOMIZATION) {
  let interval = Number.isFinite(penetration) ? Math.max(0, penetration) : 0
  let chance = 1
  // 跳弹 → 续飞（trajLayers 的 seg=1）：概率按末段（真正继续飞的那一段）计算；
  // 纯跳弹仍返回 0。
  const hasContinuation = (layers || []).some(layer => layer?.seg === 1)

  for (const layer of layers || []) {
    if (layer?.seg === 1) {
      chance = 1
      interval = layerRemainingBefore(layer) ?? 0
    }
    if (layer?.ricochet) {
      if (!hasContinuation) return 0
      continue
    }

    const before = layerRemainingBefore(layer)
    if (before != null) interval = Math.min(interval, Math.max(0, before))

    if (isGapLayer(layer)) continue

    const thickness = Number.isFinite(layer?.thickness) ? layer.thickness : 0
    if (isExternalLayer(layer)) {
      interval = Math.max(0, interval - Math.max(0, thickness))
      continue
    }

    const eff = layerEffectiveThickness(layer)
    if (eff == null || !(eff > 0)) continue
    if (!(interval > 0)) return 0

    const sigma = interval * randomization / 3
    const z = (interval - eff) / Math.max(sigma, 1e-6)
    chance *= normalCdf(z)
    if (!(chance > 0)) return 0

    // Armor Inspector `func[7696]`：每层后 remaining_min/max -= 3 × thickness。
    interval = Math.max(0, interval - 3 * eff)
  }

  return Math.max(0, Math.min(1, chance))
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
