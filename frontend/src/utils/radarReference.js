
import { CW_DIM_KEYS } from './playerSummaryMerge.js'

function isRawValid(v) {
  return v != null && v !== '' && Number.isFinite(Number(v))
}

function unavailable(dims) {
  return {
    available: false,
    axes: dims.map(d => ({ key: d.key, rawValue: null, available: false })),
  }
}

/**
 * 通用聚合：入参必须是已确定的 membership（valid rated cohort）。
 * @param {Array} members 已确定的 valid rated 玩家/行（非成员应在 wrapper 中先排除）
 * @param {{dimKeys:string[], idOf:(p)=>string|number, getRaw:(p,key)=>number|null}} opts
 * @returns {{available:boolean, axes:Array<{key,rawValue,available}>}}
 */
function aggregate(members, { dimKeys, idOf, getRaw }) {
  const dims = dimKeys.map(key => ({ key }))
  const ordered = (members || [])
    .slice()
    .sort((a, b) => {
      const ia = String(idOf(a))
      const ib = String(idOf(b))
      return ia < ib ? -1 : ia > ib ? 1 : 0
    })

  if (!ordered.length) {
    return unavailable(dims)
  }
  const incomplete = ordered.some(p => dims.some(d => !isRawValid(getRaw(p, d.key))))
  if (incomplete) {
    return unavailable(dims)
  }

  const axes = dims.map(d => {
    const raws = ordered.map(p => Number(getRaw(p, d.key)))
    const rawValue = raws.reduce((a, b) => a + b, 0) / raws.length
    return { key: d.key, rawValue, available: true }
  })
  return { available: true, axes }
}

/**
 * Battle Average：当前 battle 的 valid rated 玩家（selected 包含）。
 * membership = 本场被评分的玩家（cells.league_rating 有值 = V4.1 finalRating）。
 * @param {Array<{cells:Object}>} players
 * @param {{dimKeys:string[]}} opts
 */
export function battleAverage(players, { dimKeys }) {
  const members = (players || []).filter(p => isRawValid(p?.cells?.league_rating))
  return aggregate(members, {
    dimKeys,
    idOf: p => p?.accountId,
    getRaw: (p, key) => p?.cells?.[key],
  })
}

/**
 * Global Average：summary scope 里"有 League PlayerSummary"的 rated unique 玩家，
 * 按 accountId 去重，每人用其 league.dimensionMeans profile，等权（weight=1）。
 * membership = row.league != null（有 League PlayerSummary = 被评分；aggregate-only/league==null 行排除）。
 * @param {Array<{cells:Object, league:Object|null}>} rows
 * @param {{dimKeys:string[]}} opts
 */
export function globalAverage(rows, { dimKeys }) {
  const rated = (rows || []).filter(r => r?.league != null)
  const unique = dedupeByAccountId(rated)
  return aggregate(unique, {
    dimKeys,
    idOf: r => r?.accountId,
    getRaw: (r, key) => {
      const idx = CW_DIM_KEYS.indexOf(key)
      return r?.league?.dimensionMeans?.[idx]
    },
  })
}

function dedupeByAccountId(rows) {
  const map = new Map()
  for (const r of rows) {
    const id = String(r?.accountId ?? '')
    if (id === '') continue
    if (!map.has(id)) map.set(id, r)
  }
  return [...map.values()]
}
