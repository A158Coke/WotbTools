<script setup lang="ts">
import { ref, watch, computed, nextTick } from 'vue'
import type { TournamentEvent } from '../api/tournament-points.js'
import { TOURNAMENT_REGIONS, TOURNAMENT_SEASONS } from '../api/tournament-points.js'
const props = defineProps<{ events: TournamentEvent[]; modelValue: number | null; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: number | null] }>()
const year = ref('')
const region = ref('')
const season = ref('')
const years = computed(() => [...new Set(props.events.map(event => event.year))].sort((a, b) => b - a))
const regions = computed(() => TOURNAMENT_REGIONS.filter(value => props.events.some(event => event.year === Number(year.value) && event.region === value)))
const seasons = computed(() => TOURNAMENT_SEASONS.filter(value => props.events.some(event => event.year === Number(year.value) && event.region === region.value && event.season === value)))
let preservePartialSelection = false
function syncModel(value: number | null) {
  const selected = props.events.find(event => event.id === value)
  if (selected) { year.value = String(selected.year); region.value = selected.region; season.value = selected.season }
  else { year.value = ''; region.value = ''; season.value = '' }
}
watch(() => props.modelValue, value => {
  if (value === null && preservePartialSelection) return
  syncModel(value)
}, { immediate: true })
watch(() => props.events, () => { if (props.modelValue !== null) syncModel(props.modelValue) })
function select(level: 'year' | 'region' | 'season') {
  if (level === 'year') { region.value = ''; season.value = '' }
  if (level === 'region') season.value = ''
  const value = props.events.find(event => event.year === Number(year.value) && event.region === region.value && event.season === season.value)?.id ?? null
  // A local year/region change clears the selected event before the remaining
  // filters are chosen. Only that immediate parent echo preserves these filters.
  preservePartialSelection = value === null && props.modelValue !== null
  emit('update:modelValue', value)
  void nextTick(() => { preservePartialSelection = false })
}
</script>
<template>
  <div class="tournament-toolbar">
    <label class="tournament-field"><span>{{ $t('tournament.year') }}</span>
      <select v-model="year" :disabled="disabled" data-testid="event-year" @change="select('year')">
        <option value="">{{ $t('tournament.choose') }}</option><option v-for="value in years" :key="value" :value="value">{{ value }}</option>
      </select>
    </label>
    <label class="tournament-field"><span>{{ $t('tournament.region') }}</span>
      <select v-model="region" :disabled="disabled || !year" data-testid="event-region" @change="select('region')">
        <option value="">{{ $t('tournament.choose') }}</option><option v-for="value in regions" :key="value" :value="value">{{ $t('tournament.regions.' + value) }}</option>
      </select>
    </label>
    <label class="tournament-field"><span>{{ $t('tournament.season') }}</span>
      <select v-model="season" :disabled="disabled || !region" data-testid="event-season" @change="select('season')">
        <option value="">{{ $t('tournament.choose') }}</option><option v-for="value in seasons" :key="value" :value="value">{{ $t('tournament.seasons.' + value) }}</option>
      </select>
    </label>
  </div>
</template>
