/**
 * Radar Metric Registry：
 * 选手画像雷达图只允许 League Rating 七维，禁止 contribution/kast/impact 进入 Radar。
 * 每个 League 维度保留 score/max 解释值；最终 Radar 几何由 radarScale 相对当前 reference 生成。
 * PlayerDetailDrawer 只消费本 registry + resolveRadarMetric，组件不硬编码业务公式。
 *
 * 架构边界：
 * - Radar selection 是 presentation-only 的 visualization preference；
 *   永远不能改变 final Rating（七维 League Rating 算法固定）。
 * - Table ColumnPicker 与 Radar Metric Picker 是两套完全独立的偏好。
 * - 禁止用 current batch max 做 normalization；最终几何相对当前 Battle/Global Average，
 *   因而允许同一 raw score 随 reference cohort 改变形状，UI 必须明确比较范围。
 * - 禁止复制后端 domain max 常量：League 维度满分由后端 resp.league.columns 提供，
 *   只负责 score/max 明细解释；max 缺失时降级显示 raw score，不得阻断 relative geometry。
 * - V5 Evidence Adjustment 只作用于 Batch Player Rating，不改 Radar 的 raw dimensionMeans；
 *   最终 relative geometry 由 radarScale 独立生成。
 */

import { CW_DIM_KEYS } from './playerSummaryMerge.js'

/** Radar 轴数量约束：min 3 / max 7。 */
export const RADAR_MIN_AXES = 3
export const RADAR_MAX_AXES = 7

/** Radar 偏好 localStorage key（独立于 table column preference）。 */
const RADAR_PREF_KEY = 'wotb-radar-metric-order'

/** 七维在 Radar 上的 presentation-only 短标签（RC 短标签 + tip）。 */
const DIM_LABEL_KEY = {
  league_damage_score: 'radar_labels.league_damage_score',
  league_assist_score: 'radar_labels.league_assist_score',
  league_kill_score: 'radar_labels.league_kill_score',
  league_exchange_score: 'radar_labels.league_exchange_score',
  league_blocked_score: 'radar_labels.league_blocked_score',
  league_survival_score: 'radar_labels.league_survival_score',
  league_shooting_score: 'radar_labels.league_shooting_score',
}

/**
 * 指标定义（仅 League 七维）：
 * - key: 数据 key（League 维度）
 * - labelKey: Radar 短标签 i18n key（radar_labels.*）
 * - source: 'league'（scope-aware：summary → player.dimensionMeans[i]，
 *   battle → player.dimensionScores[i]；禁止 battle 复用跨场字段）
 * - tipKey（仅 RC）：解释 RC 全称 Surivival/Trade，native title/tooltip，不占用 SVG 空间。
 */
export const RADAR_METRIC_DEFS = Object.freeze(
  Object.fromEntries(CW_DIM_KEYS.map(key => [key, {
    key,
    labelKey: DIM_LABEL_KEY[key],
    source: 'league',
    ...(key === 'league_survival_score'
      ? { tipKey: 'player_labels.league_survival_score_tip' }
      : {}),
  }]))
)

/** 默认 Radar 顺序：Damage / Shooting / Kill / RC / Blocked / Exchange / Assist。
 *  仅 presentation order，不修改后端 canonical dimension 顺序。 */
export const RADAR_DEFAULT_ORDER = [
  'league_damage_score',
  'league_shooting_score',
  'league_kill_score',
  'league_survival_score',
  'league_blocked_score',
  'league_exchange_score',
  'league_assist_score',
]

/** 全部可选的 Radar 指标 key（picker 显示；仅七维，贡献度/KAST 属于 Performance Metrics，不入 Radar）。 */
export const RADAR_AVAILABLE_KEYS = [...CW_DIM_KEYS]

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
 * 加载并净化 Radar 偏好：过滤无效/已移除 key（contribution/kast/impact 等旧值被静默淘汰，
 *）；过滤后不足 min → fallback 默认七维。
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
 * League 维度满分来自后端 metadata（maxByKey = resp.league.columns 的 key → max），
 * 只用于 score/max 明细。max 缺失/非法时保留 raw 与 geometry availability，明细降级为 raw。
 * @param {string} key
 * @param {*} raw 原始值（null = unavailable）
 * @param {Object} [maxByKey] league 列满分元数据 {key: max}
 * @returns {{key,label,rawValue,normalized,displayValue,available,tip?}}
 */
export function resolveRadarMetric(key, raw, maxByKey = {}) {
  const def = RADAR_METRIC_DEFS[key]
  const label = def.labelKey
  if (raw == null || raw === '' || !Number.isFinite(Number(raw))) {
    return { key, label, rawValue: null, normalized: null, displayValue: '--', available: false }
  }
  const v = Number(raw)
  const max = Number(maxByKey[key])
  if (!Number.isFinite(max) || max <= 0) {
    return {
      key,
      label,
      rawValue: v,
      normalized: null,
      displayValue: String(Math.round(v)),
      available: true,
    }
  }
  return {
    key,
    label,
    rawValue: v,
    normalized: null,
    // §20：detail 只显示 score / max，不追加百分比。
    displayValue: Math.round(v) + ' / ' + max,
    available: true,
  }
}
