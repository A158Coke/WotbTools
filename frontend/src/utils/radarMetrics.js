/**
 * Radar Metric Registry：
 * Player Detail Drawer 雷达图的指标注册表——每个可选指标必须自带明确、稳定的
 * normalization contract（原始值 → 0..1），组件（PlayerRatingRadar）只消费 normalized
 * ratio，禁止组件内硬编码业务公式。
 *
 * 架构边界：
 * - Radar selection 是 presentation-only 的 visualization preference；
 *   永远不能改变 final Rating（七维 League Rating 算法固定）。
 * - Table ColumnPicker 与 Radar Metric Picker 是两套完全独立的偏好。
 * - 禁止用 current batch max 做 normalization（同玩家同数值在不同 batch 形状必须一致）。
 * - 禁止复制后端 domain max 常量：League 维度满分由后端 resp.league.columns
 *   （key/max 元数据）提供，resolveRadarMetric 必须消费该 metadata（缺失 → 该轴
 *   unavailable "--"，不伪造 0/0%）。
 * - Contribution / KAST 是 Performance Metrics，可作 Radar axes，但永远不是
 *   League Rating 维度；不得因为可进 Radar 就重新算进 final Rating。
 * - Impact：当前仓库没有已确认的 Impact 稳定 normalization contract
 *   （PerformanceMetricsCalculator 无 cap、Impact 可显著大于 100），因此
 *   Impact 不是 Radar axis candidate——它继续完整保留在表格 / Drawer
 *   表现指标区 / 排序 / ColumnPicker / 导出，只是不入 Radar。
 */

import { CW_DIM_KEYS } from './playerSummaryMerge.js'

/** Radar 轴数量约束：min 3 / max 8 / 默认 7。 */
export const RADAR_MIN_AXES = 3
export const RADAR_MAX_AXES = 8

/** Radar 偏好 localStorage key（独立于 table column preference）。 */
const RADAR_PREF_KEY = 'wotb-radar-metric-order'

const clamp01 = v => Math.max(0, Math.min(1, v))

/**
 * 指标定义：
 * - key: 数据 key（League 维度 / performance 指标）
 * - labelKey: 显示名 i18n key（player_labels.*）
 * - source: 'league'（dimensionMedians / league_* cells）| 'performance'（contribution/kast cells）
 * League 维度的 normalize/format 不在此闭包——满分来自后端 metadata（maxByKey），
 * 由 resolveRadarMetric 按 raw / column.max 计算（后端唯一事实源）。
 */
const PERF_PCT = {
  normalize: v => clamp01(Number(v) / 100),
  format: v => (Math.round(Number(v) * 10) / 10) + '%',
}

export const RADAR_METRIC_DEFS = Object.freeze({
  // ---- League Rating 七维（默认；normalize = raw / 后端 column.max）----
  ...Object.fromEntries(CW_DIM_KEYS.map(key => [key, {
    key,
    labelKey: 'player_labels.' + key,
    source: 'league',
  }])),
  // ---- Performance Metrics（可作 Radar axes，但永远不是 Rating 维度；Impact 无稳定 contract 不入 Radar）----
  contribution: { key: 'contribution', labelKey: 'player_labels.contribution', source: 'performance', ...PERF_PCT },
  kast: { key: 'kast', labelKey: 'player_labels.kast', source: 'performance', ...PERF_PCT },
})

/** 默认 Radar 指标顺序 = 七维（无偏好时默认体验不变）。 */
const RADAR_DEFAULT_ORDER = [...CW_DIM_KEYS]

/** 全部可选的 Radar 指标 key（picker 显示；不含 impact）。 */
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
 * 加载并净化 Radar 偏好：过滤无效/已移除 key；过滤后不足 min → fallback 默认七维。
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
 * League 维度满分来自后端 metadata（maxByKey = resp.league.columns 的 key → max）；
 * 后端未提供满分（max 缺失/非有限/<=0）→ 该轴 unavailable（不伪造归一化）。
 * @param {string} key
 * @param {*} raw 原始值（null = unavailable）
 * @param {Object} [maxByKey] league 列满分元数据 {key: max}
 * @returns {{key,label,rawValue,normalized,displayValue,available}}
 */
export function resolveRadarMetric(key, raw, maxByKey = {}) {
  const def = RADAR_METRIC_DEFS[key]
  const label = def.labelKey
  if (raw == null || raw === '' || !Number.isFinite(Number(raw))) {
    return { key, label, rawValue: null, normalized: null, displayValue: '--', available: false }
  }
  const v = Number(raw)
  if (def.source === 'league') {
    const max = Number(maxByKey[key])
    if (!Number.isFinite(max) || max <= 0) {
      return { key, label, rawValue: v, normalized: null, displayValue: '--', available: false }
    }
    const pct = Math.round(1000 * v / max) / 10
    return {
      key,
      label,
      rawValue: v,
      normalized: clamp01(v / max),
      displayValue: Math.round(v) + ' / ' + max + ' \u00B7 ' + pct + '%',
      available: true,
    }
  }
  return {
    key,
    label,
    rawValue: v,
    normalized: def.normalize(v),
    displayValue: def.format(v),
    available: true,
  }
}
