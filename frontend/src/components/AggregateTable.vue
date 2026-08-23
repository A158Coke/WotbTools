<script setup>
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { fmtDuration } from '../utils/helpers.js'

const { t } = useI18n()
const props = defineProps({ aggregate: Array, shownCols: Array, aggStats: Object })
const sortKey = ref('')
const sortReverse = ref(false)

const sorted = computed(() => {
  if (!sortKey.value) return props.aggregate
  const arr = [...props.aggregate]
  const col = props.shownCols.find(c => c.key === sortKey.value)
  arr.sort((ra, rb) => {
    let a = ra.cells[sortKey.value], b = rb.cells[sortKey.value]
    if (col?.num) { a = Number(a) || 0; b = Number(b) || 0; return a - b }
    return String(a).localeCompare(String(b))
  })
  if (sortReverse.value) arr.reverse()
  return arr
})

function sortBy(col) {
  if (sortKey.value === col.key) sortReverse.value = !sortReverse.value
  else { sortKey.value = col.key; sortReverse.value = false }
}

function arrow(key) {
  return sortKey.value === key ? (sortReverse.value ? ' ▼' : ' ▲') : ''
}
</script>

<template>
  <div>
    <div v-if="aggStats" class="mcards">
      <div class="mc"><div class="k">{{ $t('metric.battles') }}</div><div class="v">{{ aggStats.battles }}</div></div>
      <div class="mc"><div class="k">{{ $t('metric.players') }}</div><div class="v">{{ aggStats.players }}</div></div>
      <div class="mc"><div class="k">{{ $t('metric.max_damage') }}</div><div class="v">{{ aggStats.maxDmg }}</div></div>
    </div>
    <div class="tablewrap">
      <table>
        <thead><tr>
          <th v-for="c in shownCols" :key="c.key" @click="sortBy(c)" :title="c.key === 'survival_avg' ? $t('agg_labels.survival_avg_tip') : undefined">{{ $t('agg_labels.' + c.key) }}{{ arrow(c.key) }}</th>
        </tr></thead>
        <tbody>
          <tr v-for="(row, i) in sorted" :key="i" :class="row.team === 1 ? 't1' : 't2'">
            <td v-for="c in shownCols" :key="c.key">
              <span v-if="c.key === 'survival_avg'">{{ fmtDuration(row.cells[c.key], t) }}</span>
              <span v-else>{{ row.cells[c.key] }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="scroll-hint">{{ $t('result.scroll_hint') }}</p>
  </div>
</template>
