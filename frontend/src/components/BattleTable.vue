<script setup>
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { RATING_KEYS, ratingTier, medal, fmtDuration, mapLabel } from '../utils/helpers.js'
import { replayValueLabel } from '../utils/display.js'
import poopUrl from '../assets/poop.png'

const { locale, t, te } = useI18n()
const LOCALIZED_VALUE_KEYS = new Set(['tank_type', 'tank_nation', 'potential_damage_detail'])
const props = defineProps({ battle: Object, shownCols: Array })
const sortKey = ref('')
const sortReverse = ref(false)

const sorted = computed(() => {
  if (!sortKey.value) return props.battle.players
  const arr = [...props.battle.players]
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

function survivalClass(value) {
  if (value === 'SURVIVED') return 'alive'
  if (value === 'DESTROYED') return 'dead'
  return ''
}

function survivalLabel(value) {
  if (value === 'SURVIVED') return t('survived.alive')
  if (value === 'DESTROYED') return t('survived.dead')
  return value ?? '--'
}
</script>

<template>
  <div>
    <div class="mcards">
      <div class="mc"><div class="k">{{ $t('metric.map') }}</div><div class="v">{{ mapLabel(battle.mapName, locale) }}</div></div>
      <div class="mc"><div class="k">{{ $t('metric.duration') }}</div><div class="v">{{ fmtDuration(battle.durationS, t) }}</div></div>
      <div class="mc"><div class="k">{{ $t('metric.winner') }}</div><div class="v">{{ battle.winnerTeam ? $t('team.' + battle.winnerTeam) : $t('team.unknown') }}</div></div>
      <div class="mc"><div class="k">{{ $t('metric.player_count') }}</div><div class="v">{{ battle.players.length }}</div></div>
    </div>
    <div class="tablewrap">
      <table>
        <thead><tr>
          <th v-for="c in shownCols" :key="c.key" @click="sortBy(c)" :title="c.key === 'survival_time' ? $t('player_labels.survival_time_tip') : undefined">{{ $t('player_labels.' + c.key) }}{{ arrow(c.key) }}</th>
        </tr></thead>
        <tbody>
          <tr v-for="(row, ri) in sorted" :key="ri" :class="row.team === 1 ? 't1' : 't2'">
            <td v-for="c in shownCols" :key="c.key">
              <span v-if="RATING_KEYS.has(c.key)" class="rbadge" :class="ratingTier(row.cells[c.key])">{{ row.cells[c.key] }}<span class="medal"><template v-if="medal(battle.players, c.key, row.cells[c.key]) === 'first'"> 🥇</template><img v-else-if="medal(battle.players, c.key, row.cells[c.key]) === 'last'" class="poop" :src="poopUrl" :alt="$t('result.lowest_rating_alt')"></span></span>
              <span v-else-if="c.key === 'survived_label'" :class="survivalClass(row.cells[c.key])">{{ survivalLabel(row.cells[c.key]) }}</span>
              <span v-else-if="c.key === 'survival_time'">{{ fmtDuration(row.cells[c.key], t) }}</span>
              <span v-else-if="LOCALIZED_VALUE_KEYS.has(c.key)">{{ replayValueLabel(t, te, row.cells[c.key]) }}</span>
              <span v-else>{{ row.cells[c.key] }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="scroll-hint">{{ $t('result.scroll_hint') }}</p>
  </div>
</template>
