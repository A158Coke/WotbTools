<script setup lang="ts">
import { ref, watch, computed, nextTick, useId } from 'vue'
import type { TournamentEvent } from '../api/tournament-points.js'
import { useI18n } from 'vue-i18n'
import { TOURNAMENT_REGIONS, TOURNAMENT_SEASONS } from '../api/tournament-points.js'
import SegmentedControl from './SegmentedControl.vue'
import SearchableSelect from './SearchableSelect.vue'
const eventInputId = useId()
const props = defineProps<{ events: TournamentEvent[]; modelValue: number | null; disabled?: boolean; includeGlobal?: boolean; globalSelected?: boolean; compact?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: number | null]; 'select-global': [] }>()
const { t } = useI18n()
const year = ref('')
const region = ref('')
const season = ref('')
const years = computed(() => [...new Set(props.events.map(event => event.year))].sort((a, b) => b - a))
const regionOptions = computed(() => TOURNAMENT_REGIONS.map(value => ({
  value,
  label: t(`tournament.regions.${value}`),
  disabled: props.disabled || !props.events.some(event => event.year === Number(year.value) && event.region === value),
})))
const seasons = computed(() => TOURNAMENT_SEASONS.filter(value => props.events.some(event => event.year === Number(year.value) && event.region === region.value && event.season === value)))
const compactEvents = computed(() => [...props.events].sort((a, b) => b.year - a.year
  || TOURNAMENT_REGIONS.indexOf(a.region) - TOURNAMENT_REGIONS.indexOf(b.region)
  || TOURNAMENT_SEASONS.indexOf(a.season) - TOURNAMENT_SEASONS.indexOf(b.season)))
const compactValue = computed(() => props.globalSelected ? 'GLOBAL' : props.modelValue === null ? '' : String(props.modelValue))
const compactOptions = computed(() => [
  ...(props.includeGlobal ? [{ value: 'GLOBAL', label: t('tournament.globalConfiguration') }] : []),
  ...compactEvents.value.map(item => ({ value: String(item.id),
    label: `${item.year} · ${t('tournament.regions.' + item.region)} · ${t('tournament.seasons.' + item.season)}` })),
])
function selectCompact(value: string) {
  if (value === 'GLOBAL') emit('select-global')
  else emit('update:modelValue', value ? Number(value) : null)
}
let preservePartialSelection = false
function syncModel(value: number | null) {
  const selected = props.events.find(event => event.id === value)
  if (selected) { year.value = String(selected.year); region.value = selected.region; season.value = selected.season }
  else { year.value = ''; region.value = ''; season.value = '' }
}
watch(() => props.modelValue, value => {
  if (props.globalSelected || (value === null && preservePartialSelection)) return
  syncModel(value)
}, { immediate: true })
watch(() => props.events, () => { if (props.modelValue !== null && !props.globalSelected) syncModel(props.modelValue) })
watch(() => props.globalSelected, value => {
  if (value) season.value = 'GLOBAL'
  else if (!preservePartialSelection) syncModel(props.modelValue)
}, { immediate: true })
function selectRegion(value: string) {
  region.value = value
  select('region')
}
function select(level: 'year' | 'region' | 'season') {
  if (level === 'season' && season.value === 'GLOBAL') { emit('select-global'); return }
  if (level === 'year') { region.value = ''; season.value = '' }
  if (level === 'region') season.value = ''
  const value = props.events.find(event => event.year === Number(year.value) && event.region === region.value && event.season === season.value)?.id ?? null
  preservePartialSelection = value === null && (props.modelValue !== null || !!props.globalSelected)
  emit('update:modelValue', value)
  void nextTick(() => { preservePartialSelection = false })
}
</script>
<template>
  <div v-if="compact" class="tournament-field tournament-event-compact" data-testid="event-compact">
    <label :for="eventInputId">{{ $t('tournament.event') }}</label>
    <SearchableSelect :input-id="eventInputId" :model-value="compactValue" :options="compactOptions" :disabled="disabled"
      :label="$t('tournament.event')" :empty-label="$t('tournament.choose')" inline @update:model-value="selectCompact" />
  </div>
  <div v-else class="tournament-toolbar">
    <label class="tournament-field"><span>{{ $t('tournament.year') }}</span>
      <select v-model="year" :disabled="disabled" data-testid="event-year" @change="select('year')">
        <option value="">{{ $t('tournament.choose') }}</option><option v-for="value in years" :key="value" :value="value">{{ value }}</option>
      </select>
    </label>
    <div class="tournament-field"><span>{{ $t('tournament.region') }}</span>
      <SegmentedControl :model-value="region" :options="regionOptions" presentation="chips" :ariaLabel="$t('tournament.region')" data-testid="event-region" @update:model-value="selectRegion" />
    </div>
    <label class="tournament-field"><span>{{ $t('tournament.season') }}</span>
      <select v-model="season" :disabled="disabled || (!region && !includeGlobal)" data-testid="event-season" @change="select('season')">
        <option value="">{{ $t('tournament.choose') }}</option><option v-if="includeGlobal" value="GLOBAL">{{ $t('tournament.globalConfiguration') }}</option><option v-for="value in seasons" :key="value" :value="value">{{ $t('tournament.seasons.' + value) }}</option>
      </select>
    </label>
  </div>
</template>
