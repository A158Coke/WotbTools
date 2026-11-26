<script setup>
import { computed, ref, watch } from 'vue'
import { CW_DIM_KEYS } from '../utils/playerSummaryMerge.js'
import { stableSortRows } from '../utils/tableSort.js'
import { useStickyColumns } from '../utils/stickyColumns.js'
import { leagueMaxByKey, ratingCellText } from '../utils/helpers.js'
import { useI18n } from 'vue-i18n'
import PlayerCardList from './PlayerCardList.vue'

const props = defineProps({
  title: String,
  rows: { type: Array, default: () => [] },
  columns: { type: Array, default: () => [] },
  leagueColumns: { type: Array, default: () => [] },
  leagueMode: { type: Boolean, default: false },
  active: { type: Boolean, default: true },
  selectedAccountId: { type: [Number, String], default: null },
  layout: { type: String, default: 'table' },
})
const emit = defineEmits(['select-player'])
const { t } = useI18n()

const maxByKey = computed(() => leagueMaxByKey(props.leagueColumns))

const sortKey = ref('')
const sortReverse = ref(false)

const sortedRows = computed(() => {
  if (!sortKey.value) return props.rows
  const col = props.columns.find(c => c.key === sortKey.value)
  return stableSortRows(props.rows, {
    key: sortKey.value,
    direction: sortReverse.value ? -1 : 1,
    num: !!col?.num,
    tiebreakGetter: row => row.accountId,
  })
})

function sortBy(col) {
  if (sortKey.value === col.key) sortReverse.value = !sortReverse.value
  else { sortKey.value = col.key; sortReverse.value = false }
}

function arrow(key) {
  return sortKey.value === key ? (sortReverse.value ? ' ▼' : ' ▲') : ''
}


function isRatingKey(key) {
  return props.leagueMode && (key === 'league_rating' || key === 'league_observed_mean' || CW_DIM_KEYS.includes(key))
}

function cellDisplay(row, col) {
  const key = col.key
  const raw = row.cells[key]
  if (raw == null || raw === '') return '--'
  if (isRatingKey(key)) return ratingCellText(raw, key, maxByKey.value)
  if (col.num) {
    const n = Number(raw)
    if (Number.isFinite(n)) return String(Math.round(n * 10) / 10)
  }
  return String(raw)
}

function onRowClick(row) {
  emit('select-player', {
    scope: 'summary',
    accountId: Number(row.accountId),
    order: sortedRows.value.map(r => Number(r.accountId)),
  })
}

function isSelectedRow(row) {
  const sel = props.selectedAccountId
  if (sel == null || sel === '') return false
  return Number(row.accountId) === Number(sel)
}

const { headerRefs, isStickyCol, colStyle, schedule } = useStickyColumns({
  enabled: computed(() => props.leagueMode),
  active: computed(() => props.active && props.layout !== 'cards'),
  watchCols: computed(() => props.columns),
})

watch([sortKey, sortReverse], schedule)

const CARD_IDENTITY_KEYS = new Set(['nickname', 'clan', 'league_rating'])

const cardItems = computed(() => {
  const ratingCol = props.columns.find(c => c.key === 'league_rating')
  return sortedRows.value.map((row, i) => ({
    key: String(row.accountId ?? i),
    title: row.cells.nickname ?? '--',
    subtitle: row.cells.clan || '',
    team: row.team,
    primary: ratingCol ? { label: t('agg_labels.league_rating'), value: cellDisplay(row, ratingCol) } : null,
    metrics: props.columns
      .filter(c => !CARD_IDENTITY_KEYS.has(c.key))
      .map(c => ({ key: c.key, label: t('agg_labels.' + c.key), value: cellDisplay(row, c) })),
    selected: isSelectedRow(row),
  }))
})
const cardSortOptions = computed(() => props.columns
  .filter(c => c.key !== 'nickname')
  .map(c => ({ key: c.key, label: t('agg_labels.' + c.key) })))

function onCardSort({ key, desc }) {
  sortKey.value = key
  sortReverse.value = desc
}

function onCardSelect(accountId) {
  const row = props.rows.find(r => String(r.accountId) === accountId)
  if (row) onRowClick(row)
}
</script>

<template>
  <div class="cw-player-summary">
    <div class="league-summary-head">
      <span class="league-summary-title">{{ title }}</span>
      <span class="league-summary-note">{{ $t('league.summary.battles_note') }}</span>
    </div>
    <PlayerCardList
      v-if="layout === 'cards'"
      :items="cardItems"
      clickable
      :sort-options="cardSortOptions"
      :sort-key="sortKey"
      :sort-desc="sortReverse"
      :empty-text="$t('league.summary.no_rateable')"
      @sort="onCardSort"
      @select="onCardSelect"
    />
    <div v-show="layout !== 'cards'" class="tablewrap">
      <table :class="'cw-table'">
        <thead><tr>
          <th v-for="c in columns" :key="c.key"
              :ref="(el) => { if (c.key === 'nickname' || c.key === 'league_rating') headerRefs[c.key] = el }"
              :class="{ 'sticky-col': isStickyCol(c.key) }" :style="colStyle(c.key)"
              @click="sortBy(c)">{{ $t('agg_labels.' + c.key) }}{{ arrow(c.key) }}</th>
        </tr></thead>
        <tbody>
          <tr v-for="(row, i) in sortedRows" :key="row.accountId ?? i"
              :class="[row.team === 1 ? 't1' : 't2', 'player-row', { selected: isSelectedRow(row) }]"
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
.cw-player-summary tr.player-row.selected td { background: color-mix(in srgb, var(--accent) 16%, var(--bg-card)); }
.cw-player-summary tr.player-row.selected td.sticky-t1 { background: color-mix(in srgb, var(--accent) 16%, var(--bg-t1)); }
.cw-player-summary tr.player-row.selected td.sticky-t2 { background: color-mix(in srgb, var(--accent) 16%, var(--bg-t2)); }
.cw-player-summary tr.player-row.selected:hover td { background: color-mix(in srgb, var(--accent) 24%, var(--bg-card)); }
.cw-player-summary tr.player-row.selected:hover td.sticky-t1 { background: color-mix(in srgb, var(--accent) 24%, var(--bg-t1)); }
.cw-player-summary tr.player-row.selected:hover td.sticky-t2 { background: color-mix(in srgb, var(--accent) 24%, var(--bg-t2)); }
.league-summary-empty { text-align: center; color: var(--text-sub); }

.cw-table th.sticky-col, .cw-table td.sticky-col { position: sticky; }
.cw-table td.sticky-col { z-index: 3; background: var(--bg-card); }
.cw-table th.sticky-col { z-index: 7; background: var(--bg-card2); }
.cw-table td.sticky-col.sticky-t1 { background: color-mix(in srgb, var(--bg-t1) 64%, var(--bg-card)); }
.cw-table td.sticky-col.sticky-t2 { background: color-mix(in srgb, var(--bg-t2) 64%, var(--bg-card)); }
.cw-table tr.player-row:hover td.sticky-col { background: var(--bg-list-hover); }
</style>
