<script setup>
import { computed, ref } from 'vue'
import { CW_DIM_KEYS } from '../utils/playerSummaryMerge.js'
import { stableSortRows } from '../utils/tableSort.js'

/**
 * CW 统一玩家汇总表（plan §6）：Replay Aggregate 全量玩家 + League Rating 按 accountId join，
 * 缺失 League 字段显示 "--"。汇总页唯一玩家主表；战队仍走 LeagueSummaryTable。
 * 点击玩家行 emit select-player（Side Drawer，plan §8/§13）。
 */
const props = defineProps({
  title: String,
  rows: { type: Array, default: () => [] },
  /** 统一列定义（mergeCwPlayerColumns 产出：league 前置 + aggregate 追加） */
  columns: { type: Array, default: () => [] },
  /** Rating 列元数据（resp.league.columns：key/max 满分，league_rating 固定） */
  leagueColumns: { type: Array, default: () => [] },
  /** 是否 League 模式（决定 league_rating/七维是否渲染评分格式） */
  leagueMode: { type: Boolean, default: false },
})
const emit = defineEmits(['select-player'])

const leagueMaxByKey = computed(() =>
  Object.fromEntries((props.leagueColumns || []).map(c => [c.key, c.max])))

// ---- 全列 ASC/DESC（plan §11：任何可见列都可排序；missing-last；raw sort） ----
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

function ratingCellText(value, key) {
  const v = Number(value) || 0
  const max = Number(leagueMaxByKey.value[key]) || 0
  if (max <= 0) return String(v)
  const pct = Math.round(1000 * v / max) / 10
  if (key === 'league_rating') return Math.round(v) + ' · ' + pct + '%'
  return Math.round(v) + ' / ' + max + ' · ' + pct + '%'
}

function isRatingKey(key) {
  return props.leagueMode && (key === 'league_rating' || CW_DIM_KEYS.includes(key))
}

function cellDisplay(row, col) {
  const key = col.key
  const raw = row.cells[key]
  if (raw == null || raw === '') return '--'
  if (isRatingKey(key)) return ratingCellText(raw, key)
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
</script>

<template>
  <div class="cw-player-summary">
    <div class="league-summary-head">
      <span class="league-summary-title">{{ title }}</span>
      <span class="league-summary-note">{{ $t('league.summary.battles_note') }}</span>
    </div>
    <div class="tablewrap">
      <table>
        <thead><tr>
          <th v-for="c in columns" :key="c.key" @click="sortBy(c)">{{ $t('agg_labels.' + c.key) }}{{ arrow(c.key) }}</th>
        </tr></thead>
        <tbody>
          <tr v-for="(row, i) in sortedRows" :key="row.cells.account_id ?? i"
              :class="[row.team === 1 ? 't1' : 't2', 'player-row']"
              @click="onRowClick(row)">
            <td v-for="c in columns" :key="c.key">{{ cellDisplay(row, c) }}</td>
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
</style>