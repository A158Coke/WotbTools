/**
 * Radar 参考多边形（Battle Average / Global Average）纯函数计算。
 * 契约：
 * - 先确定"谁属于 valid rated reference population"（membership），再校验
 *   cohort 完整性——禁止用"所选维度是否完整"来定义 membership（否则会静默缩小 cohort）。
 * - Battle Average = 当前 battle scope 里被评分的 valid rated 玩家（selected 包含在内），
 *   每维取 cells[key]（league_*_score）；不硬编码 14 人。
 * - Global Average = 当前 summary scope 里"有 League PlayerSummary"的 rated unique 玩家，
 *   按 accountId 去重，每人用其 dimensionMeans profile，等权（weight=1）；不按出场次数加权。
 * - cohort 完整性（§25）：cohort 一旦确定，所有 selected Radar dimensions 必须由同一
 *   完整 cohort 支持——任一成员缺任一所选维 → 整个 reference unavailable（禁止静默过滤该玩家、
 *   禁止跨维换 cohort、禁止 missing 当 0、禁止制造假闭合多边形）。
 * - 非成员（rating-ineligible / aggregate-only / league==null 行）不属于 rated cohort，
 *   直接排除，不因其缺 dimensionMeans 就让 reference unavailable。
 * - 确定性（§59）：聚合前按 accountId 排序，与输入顺序/表格排序/选中玩家无关。
 * - V5 隔离（§65）：只消费 dimensionMeans / 单场 score，与 ratingV5/ratingRawMedian/battles 无关。
 */

import { CW_DIM_KEYS } from './playerSummaryMerge.js'
import { clamp01 } from './radarMetrics.js'

function isRawValid(v) {
  return v != null && v !== '' && Number.isFinite(Number(v))
}

function unavailable(dims) {
  return {
    available: false,
    axes: dims.map(d => ({ key: d.key, rawValue: null, normalized: null, available: false })),
  }
}

/**
 * 通用聚合：入参必须是已确定的 membership（valid rated cohort）。
 * @param {Array} members 已确定的 valid rated 玩家/行（非成员应在 wrapper 中先排除）
 * @param {{dimKeys:string[], maxByKey:Object, idOf:(p)=>string|number, getRaw:(p,key)=>number|null}} opts
 * @returns {{available:boolean, axes:Array<{key,rawValue,normalized,available}>}}
 */
function aggregate(members, { dimKeys, maxByKey, idOf, getRaw }) {
  const dims = dimKeys.map(key => ({ key, max: Number(maxByKey[key]) }))
  // 确定性：按 accountId 排序（均值本身与顺序无关，排序保证稳定迭代/同输入同输出，§59）
  const ordered = (members || [])
    .slice()
    .sort((a, b) => {
      const ia = String(idOf(a))
      const ib = String(idOf(b))
      return ia < ib ? -1 : ia > ib ? 1 : 0
    })

  // Step 2a：任一 selected dimension 的 metadata（max）缺失/非法 → 整个 reference unavailable
  if (!dims.every(d => Number.isFinite(d.max) && d.max > 0)) {
    return unavailable(dims)
  }
  // Step 2b：cohort 为空 → unavailable
  if (!ordered.length) {
    return unavailable(dims)
  }
  // Step 2c：cohort 任一成员缺任一 selected dimension → 整个 reference unavailable
  //（禁止为凑平均而静默过滤该成员，也禁止 per-dimension 换 cohort）
  const incomplete = ordered.some(p => dims.some(d => !isRawValid(getRaw(p, d.key))))
  if (incomplete) {
    return unavailable(dims)
  }

  // Step 3：cohort 完整 → 用同一恒定 cohort 计算平均
  const axes = dims.map(d => {
    const raws = ordered.map(p => Number(getRaw(p, d.key)))
    const rawValue = raws.reduce((a, b) => a + b, 0) / raws.length
    // §57：平均 normalized 值（线性 raw/max 下等价 mean(raw)/max）
    const normalized = raws.reduce((a, b) => a + clamp01(b / d.max), 0) / raws.length
    return { key: d.key, rawValue, normalized: clamp01(normalized), available: true }
  })
  return { available: true, axes }
}

/**
 * Battle Average：当前 battle 的 valid rated 玩家（selected 包含）。
 * membership = 本场被评分的玩家（cells.league_rating 有值 = V4.1 finalRating）。
 * @param {Array<{cells:Object}>} players
 * @param {{dimKeys:string[], maxByKey:Object}} opts
 */
export function battleAverage(players, { dimKeys, maxByKey }) {
  const members = (players || []).filter(p => isRawValid(p?.cells?.league_rating))
  return aggregate(members, {
    dimKeys,
    maxByKey,
    idOf: p => p?.cells?.account_id,
    getRaw: (p, key) => p?.cells?.[key],
  })
}

/**
 * Global Average：summary scope 里"有 League PlayerSummary"的 rated unique 玩家，
 * 按 accountId 去重，每人用其 league.dimensionMeans profile，等权（weight=1）。
 * membership = row.league != null（有 League PlayerSummary = 被评分；aggregate-only/league==null 行排除）。
 * @param {Array<{cells:Object, league:Object|null}>} rows
 * @param {{dimKeys:string[], maxByKey:Object}} opts
 */
export function globalAverage(rows, { dimKeys, maxByKey }) {
  const rated = (rows || []).filter(r => r?.league != null)
  const unique = dedupeByAccountId(rated)
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
