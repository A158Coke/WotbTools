/**
 * Radar 参考多边形（Battle Average / Global Average）纯函数计算。
 * 契约（计划 §13-14, §25, §57-61）：
 * - Battle Average = 当前 battle scope 里"所选维度全部完整"的 valid 评分玩家
 *   （selected 玩家包含在内）逐个归一化后按维度取均值；不硬编码 14 人。
 * - Global Average = 当前 summary scope 按 accountId 去重的 unique 玩家，
 *   每人用其 dimensionMeans profile，等权（weight=1）按维度取均值；不按出场次数加权。
 * - 恒定 cohort 跨维度（§25）：任一玩家缺任一所选维 → 整体 unavailable
 *   （禁止跨 cohort 拼接、禁止按维换样本）。
 * - 确定性（§59）：聚合前按 accountId 排序，与输入顺序/表格排序/选中玩家无关。
 * - V5 隔离（§65）：只消费 dimensionMeans，与 ratingV5/ratingRawMedian/battles 无关。
 */

import { CW_DIM_KEYS } from './playerSummaryMerge.js'
import { clamp01 } from './radarMetrics.js'

function isRawValid(v) {
  return v != null && v !== '' && Number.isFinite(Number(v))
}

/**
 * 通用聚合：对 dimKeys 每个维度，用同一 valid cohort 的"已归一化值"取均值。
 * @param {Array} players 玩家/行数组
 * @param {{dimKeys:string[], maxByKey:Object, idOf:(p)=>string|number, getRaw:(p,key)=>number|null}} opts
 * @returns {{available:boolean, axes:Array<{key,rawValue,normalized,available}>}}
 */
function aggregate(players, { dimKeys, maxByKey, idOf, getRaw }) {
  const dims = dimKeys.map(key => ({ key, max: Number(maxByKey[key]) }))
  // 确定性：按 accountId 排序（均值本身与顺序无关，排序保证稳定迭代/同输入同输出，§59）
  const ordered = (players || [])
    .slice()
    .sort((a, b) => {
      const ia = String(idOf(a))
      const ib = String(idOf(b))
      return ia < ib ? -1 : ia > ib ? 1 : 0
    })
  // valid cohort = 所有所选维度都完整 且 max 有效 的玩家（恒定 cohort，§25）
  const valid = ordered.filter(p =>
    dims.every(d => Number.isFinite(d.max) && d.max > 0 && isRawValid(getRaw(p, d.key))))
  if (!valid.length) {
    return {
      available: false,
      axes: dims.map(d => ({ key: d.key, rawValue: null, normalized: null, available: false })),
    }
  }
  const axes = dims.map(d => {
    const raws = valid.map(p => Number(getRaw(p, d.key)))
    const rawValue = raws.reduce((a, b) => a + b, 0) / raws.length
    // §57：平均 normalized 值（线性 raw/max 下等价 mean(raw)/max）
    const normalized = raws.reduce((a, b) => a + clamp01(b / d.max), 0) / raws.length
    return { key: d.key, rawValue, normalized: clamp01(normalized), available: true }
  })
  return { available: true, axes }
}

/**
 * Battle Average（计划 §13/§57）：当前 battle 的 valid 评分玩家（selected 包含），
 * 每维取字段 cells[key]（league_*_score）。
 * @param {Array<{cells:Object}>} players
 * @param {{dimKeys:string[], maxByKey:Object}} opts
 */
export function battleAverage(players, { dimKeys, maxByKey }) {
  return aggregate(players || [], {
    dimKeys,
    maxByKey,
    idOf: p => p?.cells?.account_id,
    getRaw: (p, key) => p?.cells?.[key],
  })
}

/**
 * Global Average（计划 §14/§58）：summary scope 按 accountId 去重，每人用其
 * league.dimensionMeans profile，等权（weight=1）按维度取均值。
 * @param {Array<{cells:Object, league:Object|null}>} rows
 * @param {{dimKeys:string[], maxByKey:Object}} opts
 */
export function globalAverage(rows, { dimKeys, maxByKey }) {
  const unique = dedupeByAccountId(rows || [])
  return aggregate(unique, {
    dimKeys,
    maxByKey,
    idOf: r => r?.cells?.account_id,
    getRaw: (r, key) => {
      const idx = CW_DIM_KEYS.indexOf(key)
      return r?.league?.dimensionMeans?.[idx]
    },
  })
}

/** 按 accountId 去重（保留首现；union 行在 merge 时已唯一，防御性去重）。 */
function dedupeByAccountId(rows) {
  const map = new Map()
  for (const r of rows) {
    const id = String(r?.cells?.account_id ?? '')
    if (id === '') continue
    if (!map.has(id)) map.set(id, r)
  }
  return [...map.values()]
}
