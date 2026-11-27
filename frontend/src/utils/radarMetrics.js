
import { CW_DIM_KEYS } from './playerSummaryMerge.js'

export const RADAR_MIN_AXES = 3
export const RADAR_MAX_AXES = 7

const RADAR_PREF_KEY = 'wotb-radar-metric-order'

const DIM_LABEL_KEY = {
  league_damage_score: 'radar_labels.league_damage_score',
  league_assist_score: 'radar_labels.league_assist_score',
  league_kill_score: 'radar_labels.league_kill_score',
  league_exchange_score: 'radar_labels.league_exchange_score',
  league_blocked_score: 'radar_labels.league_blocked_score',
  league_survival_score: 'radar_labels.league_survival_score',
  league_shooting_score: 'radar_labels.league_shooting_score',
}

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

export const RADAR_DEFAULT_ORDER = [
  'league_damage_score',
  'league_shooting_score',
  'league_kill_score',
  'league_survival_score',
  'league_blocked_score',
  'league_exchange_score',
  'league_assist_score',
]

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
 * League 维度满分来自后端 metadata（maxByKey = resp.league.columns 的 key → max）。本函数只解析
 * raw/display；V6 bounded scaler 会再次验证 max，缺失/非法时令该轴 fail-closed。
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
    displayValue: Math.round(v) + ' / ' + max,
    available: true,
  }
}
