<script setup>
import { computed, ref, watch } from 'vue'
import { CW_DIM_KEYS } from '../utils/playerSummaryMerge.js'
import { stableSortRows } from '../utils/tableSort.js'
import { useStickyColumns } from '../utils/stickyColumns.js'

/**
 * CW 统一玩家汇总表（plan §6；review PR#134 BLOCKER 2/2.9）：Replay Aggregate 全量玩家 +
 * League Rating 按 accountId join，缺失 League 字段显示 "--"。汇总页唯一玩家主表；战队仍走
 * LeagueSummaryTable。列 = 用户偏好（useColumns cw scope）驱动：只有 nickname + league_rating
 * 固定（sticky 核心对，left=0 / 实测昵称列宽），其余列（七维/MVP/表现指标/facts）用户可隐藏、
 * 可拖拽顺序。点击玩家行 emit select-player（Side Drawer，plan §8/§13）。
 */
const props = defineProps({
  title: String,
  rows: { type: Array, default: () => [] },
  /** 统一列定义（useColumns cw scope 可见 + 顺序后的列） */
  columns: { type: Array, default: () => [] },
  /** Rating 列元数据（resp.league.columns：key/max 满分） */
  leagueColumns: { type: Array, default: () => [] },
  /** 是否 League 模式（决定 league_rating/七维是否渲染评分格式） */
  leagueMode: { type: Boolean, default: false },
  /** 本表是否当前可见（父组件持有 activeTab；v-show hidden 时禁止 sticky 测量，BLOCKER 2.9） */
  active: { type: Boolean, default: true },
})
const emit = defineEmits(['select-player'])

const leagueMaxByKey = computed(() =>
  Object.fromEntries((props.leagueColumns || []).map(c => [c.key, c.max])))

// 跨场/单场 Performance Metrics 百分比展示；HP UNKNOWN → null → '--'（不冒充 0）
const PERCENT_KEYS = new Set(['contribution', 'kast', 'impact'])

// ---- 全列 ASC/DESC（plan §11：任何可见列都可排序；missing-last；raw sort）----
const sortKey = ref('')
const sortReverse = ref(false)

const sortedRows = computed(() => {
  if (!sortKey.value) return props.rows
  const col = props.columns.find(c => c.key === sortKey.value)
  return stableSortRows(props.rows, {
    key: sortKey.value,
    direction: sortReverse.value ? -1 : 1,
    num: !!col?.num,
    tiebreakGetter: row => row.cells?.account_id,
  })
})

function sortBy(col) {
  if (sortKey.value === col.key) sortReverse.value = !sortReverse.value
  else { sortKey.value = col.key; sortReverse.value = false }
}

function arrow(key) {
  return sortKey.value === key ? (sortReverse.value ? ' ▼' : ' ▲') : ''
}

/** Rating 文本：缺失（无评分数据）→ '--'，不冒充 0（BLOCKER 3/6.12）。
 * 总 Rating 只显示整数（850），不显示 /1000 冗余完成度（review PR#134 BLOCKER 1）；
 * 七维仍显示「342 / 400 · 85.5%」。 */
function ratingCellText(value, key) {
  if (value == null || value === '' || !Number.isFinite(Number(value))) return '--'
  const v = Number(value)
  const max = Number(leagueMaxByKey.value[key]) || 0
  if (max <= 0) return String(Math.round(v * 10) / 10)
  const pct = Math.round(1000 * v / max) / 10
  if (key === 'league_rating') return String(Math.round(v))
  return Math.round(v) + ' / ' + max + ' · ' + pct + '%'
}

function isRatingKey(key) {
  return props.leagueMode && (key === 'league_rating' || CW_DIM_KEYS.includes(key))
}

function percentCell(value) {
  if (value == null || value === '') return '--'
  return (Math.round(Number(value) * 10) / 10) + '%'
}

function cellDisplay(row, col) {
  const key = col.key
  const raw = row.cells[key]
  if (raw == null || raw === '') return '--'
  if (isRatingKey(key)) return ratingCellText(raw, key)
  if (PERCENT_KEYS.has(key)) return percentCell(raw)
  if (col.num) {
    const n = Number(raw)
    if (Number.isFinite(n)) return String(Math.round(n * 10) / 10)
  }
  return String(raw)
}

function onRowClick(row) {
  // §8.7 identity = accountId；scope 标记汇总（drawerPlayer 按 scope + accountId 重新 resolve）
  emit('select-player', { scope: 'summary', accountId: Number(row.cells.account_id) })
}

// ---- sticky 核心对（BLOCKER 2.9）：nickname.left=0；league_rating.left=实测昵称列宽 >0 ----
const { headerRefs, stickyLeft, isStickyCol, colStyle, schedule } = useStickyColumns({
  enabled: computed(() => props.leagueMode),
  active: computed(() => props.active),
  watchCols: computed(() => props.columns),
})

// 排序箭头变化可能改昵称列宽 → 重新调度测量
watch([sortKey, sortReverse], schedule)
</script>

<template>
  <div class="cw-player-summary">
    <div class="league-summary-head">
      <span class="league-summary-title">{{ title }}</span>
      <span class="league-summary-note">{{ $t('league.summary.battles_note') }}</span>
    </div>
    <div class="tablewrap">
      <table :class="'cw-table'">
        <thead><tr>
          <th v-for="c in columns" :key="c.key"
              :ref="(el) => { if (c.key === 'nickname' || c.key === 'league_rating') headerRefs[c.key] = el }"
              :class="{ 'sticky-col': isStickyCol(c.key) }" :style="colStyle(c.key)"
              @click="sortBy(c)">{{ $t('agg_labels.' + c.key) }}{{ arrow(c.key) }}</th>
        </tr></thead>
        <tbody>
          <tr v-for="(row, i) in sortedRows" :key="row.cells.account_id ?? i"
              :class="[row.team === 1 ? 't1' : 't2', 'player-row']"
              @click="onRowClick(row)">
            <td v-for="c in columns" :key="c.key"
                :class="{ 'sticky-col': isStickyCol(c.key), 'sticky-t1': isStickyCol(c.key) && row.team === 1, 'sticky-t2': isStickyCol(c.key) && row.team === 2 }"
                :style="colStyle(c.key)">{{ cellDisplay(row, c) }}</td>
          </tr>
          <tr v-if="!rows.length"><td :colspan="Math.max(columns.length, 1)" class="league-summary-empty">{{ $t('league.summary.no_rateable') }}</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.cw-player-summary { margin-bottom: 16px; }
.league-summary-head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 6px; }
.league-summary-title { font-size: .9rem; font-weight: 800; color: var(--text-heading); }
.league-summary-note { font-size: .72rem; color: var(--text-sub); }
.player-row { cursor: pointer; }
.player-row:hover td { background: var(--bg-list-hover); }
.league-summary-empty { text-align: center; color: var(--text-sub); }

/* CW 统一玩家表 sticky：玩家 + Rating 固定（BLOCKER 2.9）。
   z-index 层级与 BattleTable.league-table 对齐（plan §17）：tbody 3 < thead 7。 */
.cw-table th.sticky-col, .cw-table td.sticky-col { position: sticky; }
.cw-table td.sticky-col { z-index: 3; background: var(--bg-card); }
.cw-table th.sticky-col { z-index: 7; background: var(--bg-card2); }
.cw-table td.sticky-col.sticky-t1 { background: color-mix(in srgb, var(--bg-t1) 64%, var(--bg-card)); }
.cw-table td.sticky-col.sticky-t2 { background: color-mix(in srgb, var(--bg-t2) 64%, var(--bg-card)); }
.cw-table tr.player-row:hover td.sticky-col { background: var(--bg-list-hover); }
</style>
