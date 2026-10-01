<script setup>
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { fmtDuration } from '../utils/helpers.js'
import { stableSortRows } from '../utils/tableSort.js'
import PlayerCardList from './PlayerCardList.vue'
import StatStrip from './StatStrip.vue'

const { t, locale } = useI18n()
const props = defineProps({
  aggregate: Array,
  shownCols: Array,
  aggStats: Object,
  /** 呈现方式：table（默认）/ cards（手机卡片列表；表格保留在 DOM 里供 PNG 导出）。 */
  layout: { type: String, default: 'table' },
})
const sortKey = ref('')
const sortReverse = ref(false)
// 跨场表现派生列：百分比展示；HP 全部 UNKNOWN 时为 null（显示 "--"，不冒充 0）
const PERCENT_KEYS = new Set(['multi_damage_rate'])
// 跨场原始比例列：分母为 0（无射击/无命中）→ null（unavailable，显示 "--"，禁止 0/0 伪装 0%）
const RATE_KEYS = new Set(['hit_rate', 'pen_rate'])

function percentCell(value) {
  if (value == null || value === '') return '--'
  return (Math.round(value * 10) / 10) + '%'
}

/** 原始比例（0-100 标尺）：denominator==0 → null（unavailable，显示 "--"）；否则展示数值。 */
function rateCell(value) {
  if (value == null || value === '') return '--'
  return String(Math.round(Number(value) * 10) / 10)
}

const sorted = computed(() => {
  if (!sortKey.value) return props.aggregate
  const col = props.shownCols.find(c => c.key === sortKey.value)
  return stableSortRows(props.aggregate, {
    key: sortKey.value,
    direction: sortReverse.value ? -1 : 1,
    num: !!col?.num,
    locale: locale.value,
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

const aggregateStats = computed(() => props.aggStats ? [
  { key: 'battles', label: t('metric.battles'), value: props.aggStats.battles },
  { key: 'players', label: t('metric.players'), value: props.aggStats.players },
  { key: 'max_damage', label: t('metric.max_damage'), value: props.aggStats.maxDmg },
] : [])

// ---- 卡片列表（手机）：与表格共用排序与单元格格式 ----
const CARD_IDENTITY_KEYS = new Set(['nickname', 'clan'])

function cellText(row, c) {
  const value = row.cells[c.key]
  if (c.key === 'survival_time_avg') return fmtDuration(value, t)
  if (PERCENT_KEYS.has(c.key)) return percentCell(value)
  if (RATE_KEYS.has(c.key)) return rateCell(value)
  return value == null || value === '' ? '--' : String(value)
}

const cardItems = computed(() => sorted.value.map((row, i) => ({
  key: String(row.accountId ?? i),
  title: row.cells.nickname ?? '--',
  subtitle: row.cells.clan || '',
  team: row.team,
  metrics: props.shownCols
    .filter(c => !CARD_IDENTITY_KEYS.has(c.key))
    .map(c => ({ key: c.key, label: t('agg_labels.' + c.key), value: cellText(row, c) })),
})))
const cardSortOptions = computed(() => props.shownCols
  .filter(c => c.key !== 'nickname')
  .map(c => ({ key: c.key, label: t('agg_labels.' + c.key) })))

function onCardSort({ key, desc }) {
  sortKey.value = key
  sortReverse.value = desc
}
</script>

<template>
  <div>
    <StatStrip v-if="aggStats" :stats="aggregateStats" />
    <PlayerCardList
      v-if="layout === 'cards'"
      :items="cardItems"
      :sort-options="cardSortOptions"
      :sort-key="sortKey"
      :sort-desc="sortReverse"
      @sort="onCardSort"
    />
    <div v-show="layout !== 'cards'" class="tablewrap">
      <table>
        <thead><tr>
          <th v-for="c in shownCols" :key="c.key" @click="sortBy(c)" :title="c.key === 'survival_time_avg' ? $t('agg_labels.survival_time_avg_tip') : undefined">{{ $t('agg_labels.' + c.key) }}{{ arrow(c.key) }}</th>
        </tr></thead>
        <tbody>
          <tr v-for="(row, i) in sorted" :key="i" :class="row.team === 1 ? 't1' : 't2'">
            <td v-for="c in shownCols" :key="c.key">
              <span v-if="c.key === 'survival_time_avg'">{{ fmtDuration(row.cells[c.key], t) }}</span>
              <span v-else-if="PERCENT_KEYS.has(c.key)">{{ percentCell(row.cells[c.key]) }}</span>
              <span v-else-if="RATE_KEYS.has(c.key)">{{ rateCell(row.cells[c.key]) }}</span>
              <span v-else>{{ row.cells[c.key] }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-show="layout !== 'cards'" class="scroll-hint">{{ $t('result.scroll_hint') }}</p>
  </div>
</template>