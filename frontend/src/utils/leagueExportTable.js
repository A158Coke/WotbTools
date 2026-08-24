/**
 * League PNG 导出表格构造（review PR#134 第三轮 BLOCKER 1）：
 * 导出是独立 rendering concern——完整 column universe 来自 backend 列定义，绝不使用
 * 当前 ColumnPicker visible-only DOM：
 * - 单场 Battle：完整列 = resp.playerColumns（全部 Replay facts + Rating 维度 + 占点原始字段）；
 *   resp.league.columns 只提供 Rating max/format 元数据（总 Rating 整数；七维 score/max/%）。
 * - 汇总（aggregate）：完整列 = mergeCwPlayerColumns(league.playerSummaryColumns,
 *   resp.aggregateColumns)（CW Unified Player Summary）+ league.teamSummaryColumns（Team Summary）。
 * 缺失 Rating/维度 → '--'，只有真实 raw 0 才显示 0（禁止 Number(raw) || 0 伪造）。
 * 不改变页面用户 column 偏好。
 */

import { mergeCwPlayerRows, mergeCwPlayerColumns, CW_DIM_KEYS } from './playerSummaryMerge.js'

/** 通用缺失判断：null / '' → '--'；真实 0 与任意文本保留（Rating 的 NaN 检查只在 ratingCellText 内做）。 */
export function isMissingValue(value) {
  return value == null || value === ''
}

/** Rating 列 max 元数据（resp.league.columns：key → max）。 */
export function leagueMaxByKey(leagueColumns) {
  return Object.fromEntries((leagueColumns || []).map(c => [c.key, c.max]))
}

export function escapeHtml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** 总 Rating 只显示整数（927）；七维仍显示「342 / 400 · 85.5%」；
 * 缺失（null / '' / NaN）→ '--'，只有真实 raw 0 才显示 0（review PR#134 BLOCKER 1 第三轮）。 */
export function ratingCellText(value, key, maxByKey) {
  if (value == null || value === '' || !Number.isFinite(Number(value))) return '--'
  const v = Number(value)
  const max = Number(maxByKey[key]) || 0
  if (max <= 0) return String(Math.round(v * 10) / 10)
  const pct = Math.round(1000 * v / max) / 10
  if (key === 'league_rating') return String(Math.round(v))
  return Math.round(v) + ' / ' + max + ' \u00B7 ' + pct + '%'
}

const PERCENT_KEYS = new Set(['contribution', 'kast', 'impact'])

/** 单场/统一玩家表单元格：Rating 列走 max 格式；表现指标百分比；数值列四舍五入；缺失 '--'。 */
function playerCellText(raw, key, maxByKey, isNum) {
  if (isMissingValue(raw)) return '--'
  if (key === 'league_rating' || CW_DIM_KEYS.includes(key)) return ratingCellText(raw, key, maxByKey)
  if (PERCENT_KEYS.has(key)) return (Math.round(Number(raw) * 10) / 10) + '%'
  if (isNum) {
    const n = Number(raw)
    if (Number.isFinite(n)) return String(Math.round(n * 10) / 10)
  }
  return String(raw)
}

function buildTableHtml(columns, rows, { labelFor, valueFor, rowClassFor, format }) {
  const headers = (columns || []).map(c => '<th>' + escapeHtml(labelFor(c.key)) + '</th>').join('')
  const body = (rows || []).map(row => {
    const tds = (columns || []).map(c => '<td>' + escapeHtml(format(c.key, valueFor(row, c.key), c)) + '</td>').join('')
    const cls = rowClassFor(row)
    return '<tr' + (cls ? ' class="' + cls + '"' : '') + '>' + tds + '</tr>'
  }).join('')
  return '<table><thead><tr>' + headers + '</tr></thead><tbody>' + body + '</tbody></table>'
}

/** 单场 Battle PNG：完整列 = resp.playerColumns（backend 全量）；Rating 格式元数据 = resp.league.columns。 */
export function leagueBattleExportTable(battle, playerColumns, leagueColumns, labelFor) {
  const maxByKey = leagueMaxByKey(leagueColumns)
  return buildTableHtml(playerColumns, battle?.players || [], {
    labelFor,
    valueFor: (row, key) => row.cells?.[key],
    rowClassFor: row => row.team === 1 ? 't1' : 't2',
    format: (key, raw, col) => playerCellText(raw, key, maxByKey, col?.num),
  })
}

/** 战队汇总行字段映射（与页面 LeagueSummaryTable 一致；team_name 含批次 override）。 */
function teamCellValue(row, key, teamNames) {
  if (key === 'team_name') {
    const override = teamNames ? teamNames[row.teamKey] : undefined
    if (override) return override
    return row.autoName || ''
  }
  if (key === 'battles') return row.battles
  if (key === 'wins') return row.wins
  if (key === 'league_rating') return row.ratingMedian
  const dimIndex = CW_DIM_KEYS.indexOf(key)
  if (dimIndex >= 0) return (row.dimensionMedians || [])[dimIndex]
  return row[key]
}

/**
 * League aggregate PNG：完整 export DOM 两张表——
 * 1) CW Unified Player Summary：完整 cw column universe（mergeCwPlayerColumns，不受 ColumnPicker 影响）；
 * 2) Team Summary：完整 teamSummaryColumns。
 * 不复用当前 visible-only DOM；不改变页面 column 偏好。
 * @param {Object} resp resp（含 aggregate / aggregateColumns / league.playerSummaries / playerSummaryColumns /
 *                       teamSummaries / teamSummaryColumns / columns）
 * @param {Function} labelFor 玩家/统一表列头（agg_labels.*）
 * @param {Function} teamLabelFor 战队表列头（league.summary.*）
 * @param {Object} teamNames 批次战队名称覆盖 {teamKey: name}
 * @returns {{player: string, team: string}} 两张完整表格 HTML
 */
export function leagueAggregateExportTables(resp, labelFor, teamLabelFor, teamNames) {
  const league = resp?.league || {}
  const maxByKey = leagueMaxByKey(league.columns)
  const playerCols = mergeCwPlayerColumns(league.playerSummaryColumns || [], resp?.aggregateColumns || [])
  const playerRows = mergeCwPlayerRows(resp?.aggregate || [], league.playerSummaries || [])
  const player = buildTableHtml(playerCols, playerRows, {
    labelFor,
    valueFor: (row, key) => row.cells?.[key],
    rowClassFor: row => row.team === 1 ? 't1' : 't2',
    format: (key, raw, col) => playerCellText(raw, key, maxByKey, col?.num),
  })
  const team = buildTableHtml(league.teamSummaryColumns || [], league.teamSummaries || [], {
    labelFor: teamLabelFor,
    valueFor: (row, key) => teamCellValue(row, key, teamNames),
    rowClassFor: () => '',
    format: (key, raw) => {
      // 与页面一致：战队总 Rating 只显示整数；七维/数值保留一位小数；缺失 '--'
      if (key === 'league_rating') return ratingCellText(raw, key, { league_rating: 1000 })
      if (isMissingValue(raw)) return '--'
      const n = Number(raw)
      return Number.isFinite(n) ? String(Math.round(n * 10) / 10) : String(raw)
    },
  })
  return { player, team }
}
