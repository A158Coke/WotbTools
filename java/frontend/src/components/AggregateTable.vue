<script setup>
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { RATING_KEYS, ratingTier, medal, fmtDuration } from '../utils/helpers.js'
import poopUrl from '../assets/poop.png'

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
      <div class="mc"><div class="k">{{ $t('metric.max_rating') }}</div><div class="v">{{ aggStats.maxRating }}</div></div>
      <div class="mc"><div class="k">{{ $t('metric.max_damage') }}</div><div class="v">{{ aggStats.maxDmg }}</div></div>
    </div>
    <div class="tablewrap">
      <table>
        <thead><tr>
          <th v-for="c in shownCols" :key="c.key" @click="sortBy(c)">{{ $t('agg_labels.' + c.key) }}{{ arrow(c.key) }}</th>
        </tr></thead>
        <tbody>
          <tr v-for="(row, i) in sorted" :key="i" :class="row.team === 1 ? 't1' : 't2'">
            <td v-for="c in shownCols" :key="c.key">
              <span v-if="RATING_KEYS.has(c.key)" class="rbadge" :class="ratingTier(row.cells[c.key])">{{ row.cells[c.key] }}<span class="medal"><template v-if="medal(aggregate, c.key, row.cells[c.key]) === 'first'"> 🥇</template><img v-else-if="medal(aggregate, c.key, row.cells[c.key]) === 'last'" class="poop" :src="poopUrl" alt="倒数"></span></span>
              <span v-else-if="c.key === 'survival_avg'">{{ fmtDuration(row.cells[c.key], t) }}</span>
              <span v-else>{{ row.cells[c.key] }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="scroll-hint">{{ $t('result.scroll_hint') }}</p>
  </div>
</template>
