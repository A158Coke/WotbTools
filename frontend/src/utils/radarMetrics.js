/**
 * Radar Metric Registry（review PR#134 BLOCKER 6 + BLOCKER 3）：
 * Player Detail Drawer 雷达图的指标注册表——每个可选指标必须自带明确、稳定的
 * normalization contract（原始值 → 0..1），组件（PlayerRatingRadar）只消费 normalized
 * ratio，禁止组件内硬编码业务公式。
 *
 * 架构边界（BLOCKER 6.13）：
 * - Radar selection 是 presentation-only 的 visualization preference；
 *   永远不能改变 final Rating（七维 League Rating 算法固定）。
 * - Table ColumnPicker 与 Radar Metric Picker 是两套完全独立的偏好（BLOCKER 6.4）。
 * - 禁止用 current batch max 做 normalization（同玩家同数值在不同 batch 形状必须一致，6.7）。
 * - Contribution / KAST 是 Performance Metrics，可作 Radar axes，但永远不是
 *   League Rating 维度；不得因为可进 Radar 就重新算进 final Rating（6.6）。
 * - Impact（review PR#134 BLOCKER 3）：当前仓库没有已确认的 Impact 稳定 normalization
 *   contract（PerformanceMetricsCalculator 无 cap、Impact 可显著大于 100），因此
 *   Impact 暂时<b>不是</b> Radar axis candidate——它继续完整保留在表格 / Drawer
 *   表现指标区 / 排序 / ColumnPicker / 导出，只是不入 Radar。将来若产品确认稳定的
 *   batch 无关 normalization 参考值，再把 Impact 注册进 RADAR_METRIC_DEFS 即可
 *   （Registry 扩展点保留，见 RADAR_AVAILABLE_KEYS / resolveRadarMetric）。
 */

import { CW_DIM_KEYS } from './playerSummaryMerge.js'

/** League Rating 维度满分（顺序与 CW_DIM_KEYS 对齐，合计 1000；后端 LeagueColumns.DIM_MAX）。 */
const LEAGUE_DIM_MAXES = [400, 100, 100, 150, 50, 100, 100]

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
 * - source: 'league'（dimensionMedians / league_* cells）| 'performance'（contribution/kast cells）
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
  // ---- Performance Metrics（BLOCKER 6.6：可作 Radar axes，但永远不是 Rating 维度；
  //      BLOCKER 3：Impact 无稳定 normalization contract，暂不入 Radar）----
  contribution: { key: 'contribution', labelKey: 'player_labels.contribution', source: 'performance', ...PERF_PCT },
  kast: { key: 'kast', labelKey: 'player_labels.kast', source: 'performance', ...PERF_PCT },
})

/** 默认 Radar 指标顺序 = 七维（BLOCKER 6.1：无偏好时默认体验不变）。 */
const RADAR_DEFAULT_ORDER = [...CW_DIM_KEYS]

/** 全部可选的 Radar 指标 key（picker 显示；BLOCKER 3：不含 impact）。 */
export const RADAR_AVAILABLE_KEYS = [...CW_DIM_KEYS, 'contribution', 'kast']

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
