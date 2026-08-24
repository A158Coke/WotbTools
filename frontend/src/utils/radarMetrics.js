/**
 * Radar Metric Registry（review PR#134 BLOCKER 6）：
 * Player Detail Drawer 雷达图的指标注册表——每个可选指标必须自带明确、稳定的
 * normalization contract（原始值 → 0..1），组件（PlayerRatingRadar）只消费 normalized
 * ratio，禁止组件内硬编码业务公式。
 *
 * 架构边界（BLOCKER 6.13）：
 * - Radar selection 是 presentation-only 的 visualization preference；
 *   永远不能改变 final Rating（七维 League Rating 算法固定）。
 * - Table ColumnPicker 与 Radar Metric Picker 是两套完全独立的偏好（BLOCKER 6.4）。
 * - 禁止用 current batch max 做 normalization（同玩家同数值在不同 batch 形状必须一致，6.7）。
 * - Contribution / KAST / Impact 是 Performance Metrics，可以进入 Radar，但永远不是
 *   League Rating 维度；不得因为可进 Radar 就重新算进 final Rating（6.6）。
 */

import { CW_DIM_KEYS } from './playerSummaryMerge.js'

/** League Rating 维度满分（顺序与 CW_DIM_KEYS 对齐，合计 1000；后端 LeagueColumns.DIM_MAX）。 */
const LEAGUE_DIM_MAXES = [400, 100, 100, 150, 50, 100, 100]

/**
 * Impact 的稳定显示 normalization 参考值。
 *
 * Impact 公式（docs/features/performance.md，PerformanceMetricsCalculator.singleBattleImpact）：
 *   impact_battle = 100 * (0.75 * damageAssistIndex + 0.25 * kills)
 *   damageAssistIndex = damageAssistShare / (1/14)
 * 因此 impact 不是天然 0-100 capped：平均玩家（share=1/14、kills约1）约 100（par），
 * 顶尖玩家可显著大于 100（如 share=0.2、kills=2 → 100*(0.75*2.8+0.5)=260）。
 *
 * 仓库当前没有已确认的 Impact Radar 上限（PerformanceMetricsCalculator 无 cap），
 * 本 PR 建立如下稳定策略（display-only，不影响 API/表格/Calculator；Findings 待产品确认）：
 *   100 = par（平均贡献份额 + 1 击杀）；IMPACT_RADAR_REF = 200 = 2倍par，视为卓越表现上限；
 *   超出 200 的值饱和到外圈（不压平所有大于 100 的优秀表现，也不让单点无限拉伸 polygon）。
 * 该参考值不依赖任何 batch，同一玩家同一数值在任何批次形状一致。
 */
const IMPACT_RADAR_REF = 200

/** Radar 轴数量约束（BLOCKER 6.8）：min 3 / max 8 / 默认 7。 */
export const RADAR_MIN_AXES = 3
export const RADAR_MAX_AXES = 8

/** Radar 偏好 localStorage key（独立于 table column preference，BLOCKER 6.4/6.10）。 */
const RADAR_PREF_KEY = 'wotb-radar-metric-order'

const clamp01 = v => Math.max(0, Math.min(1, v))

/**
 * 指标定义：
 * - key: 数据 key（League 维度 / performance 指标）
 * - labelKey: 显示名 i18n key（player_labels.*）
 * - source: 'league'（dimensionMedians / league_* cells）| 'performance'（contribution/kast/impact cells）
 * - normalize(raw): number → 0..1（稳定、batch 无关）
 * - format(raw): 显示值（如 '78.4%'）
 */
const PERF_PCT = {
  normalize: v => clamp01(Number(v) / 100),
  format: v => (Math.round(Number(v) * 10) / 10) + '%',
}

export const RADAR_METRIC_DEFS = Object.freeze({
  // ---- League Rating 七维（默认；normalize = score / dimensionMax）----
  ...Object.fromEntries(CW_DIM_KEYS.map((key, i) => [key, {
    key,
    labelKey: 'player_labels.' + key,
    source: 'league',
    normalize: v => clamp01(Number(v) / LEAGUE_DIM_MAXES[i]),
    format: (v, i) => Math.round(Number(v)) + ' / ' + LEAGUE_DIM_MAXES[i] + ' · '
      + (Math.round(1000 * Number(v) / LEAGUE_DIM_MAXES[i]) / 10) + '%',
  }])),
  // ---- Performance Metrics（BLOCKER 6.6：可作 Radar axes，但永远不是 Rating 维度）----
  contribution: { key: 'contribution', labelKey: 'player_labels.contribution', source: 'performance', ...PERF_PCT },
  kast: { key: 'kast', labelKey: 'player_labels.kast', source: 'performance', ...PERF_PCT },
  impact: {
    key: 'impact',
    labelKey: 'player_labels.impact',
    source: 'performance',
    // 稳定参考值契约见 IMPACT_RADAR_REF（display-only，batch 无关；Findings 待产品确认）
    normalize: v => clamp01(Number(v) / IMPACT_RADAR_REF),
    format: v => (Math.round(Number(v) * 10) / 10) + '%',
  },
})

/** 默认 Radar 指标顺序 = 七维（BLOCKER 6.1：无偏好时默认体验不变）。 */
const RADAR_DEFAULT_ORDER = [...CW_DIM_KEYS]

/** 全部可选的 Radar 指标 key（picker 显示）。 */
export const RADAR_AVAILABLE_KEYS = [...CW_DIM_KEYS, 'contribution', 'kast', 'impact']

function readStoredList() {
  try {
    const raw = localStorage.getItem(RADAR_PREF_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(v => typeof v === 'string') : null
  } catch (_) {
    return null
  }
}

/**
 * 加载并净化 Radar 偏好：过滤无效/已移除 key；过滤后不足 min → fallback 默认七维（6.10）。
 */
export function loadRadarPreference() {
  const stored = readStoredList()
  if (!stored) return [...RADAR_DEFAULT_ORDER]
  const known = new Set(RADAR_AVAILABLE_KEYS)
  const sanitized = [...new Set(stored.filter(k => known.has(k)))]
  if (sanitized.length < RADAR_MIN_AXES) return [...RADAR_DEFAULT_ORDER]
  return sanitized
}

export function saveRadarPreference(order) {
  try {
    localStorage.setItem(RADAR_PREF_KEY, JSON.stringify(order))
  } catch (_) {
    // 忽略 quota/隐私模式失败，保持内存行为
  }
}

/**
 * 把指标 key + 原始值解析为雷达轴输入（缺失 → available:false，UI 显示 "--"，
 * 绝不伪装成 0/0%）。
 * @param {string} key
 * @param {*} raw 原始值（null = unavailable）
 * @param {number} [dimIndex] league 维度在七维中的 index（供 format 使用）
 * @returns {{key,label,rawValue,normalized,displayValue,available}}
 */
export function resolveRadarMetric(key, raw, dimIndex) {
  const def = RADAR_METRIC_DEFS[key]
  const label = def.labelKey
  if (raw == null || raw === '' || !Number.isFinite(Number(raw))) {
    return { key, label, rawValue: null, normalized: null, displayValue: '--', available: false }
  }
  const v = Number(raw)
  return {
    key,
    label,
    rawValue: v,
    normalized: def.normalize(v),
    displayValue: def.format(v, dimIndex),
    available: true,
  }
}
