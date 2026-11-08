<script setup lang="ts">
import { ref, watch, computed, nextTick } from 'vue'
import type { TournamentEvent } from '../api/tournament-points.js'
import { useI18n } from 'vue-i18n'
import { TOURNAMENT_REGIONS, TOURNAMENT_SEASONS } from '../api/tournament-points.js'
import SegmentedControl from './SegmentedControl.vue'
// compact：管理页页头的单个「赛事」选择器（年份 + 区服 + 季赛合成一项）；公开榜单仍用逐级筛选。
const props = defineProps<{ events: TournamentEvent[]; modelValue: number | null; disabled?: boolean; includeGlobal?: boolean; globalSelected?: boolean; compact?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: number | null]; 'select-global': [] }>()
const { t } = useI18n()
const year = ref('')
const region = ref('')
const season = ref('')
const years = computed(() => [...new Set(props.events.map(event => event.year))].sort((a, b) => b - a))
// 地区域固定 4 项（DC-SEL-01）：选项不随年份增减，当年没有赛事的地区置灰。
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
function selectCompact(event: Event) {
  const value = (event.target as HTMLSelectElement).value
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
  // A local year/region change clears the selected event before the remaining
  // filters are chosen. Only that immediate parent echo preserves these filters.
  preservePartialSelection = value === null && (props.modelValue !== null || !!props.globalSelected)
  emit('update:modelValue', value)
  void nextTick(() => { preservePartialSelection = false })
}
</script>
<template>
  <label v-if="compact" class="tournament-field tournament-event-compact"><span>{{ $t('tournament.event') }}</span>
    <select :value="compactValue" :disabled="disabled" data-testid="event-compact" @change="selectCompact">
      <option value="">{{ $t('tournament.choose') }}</option><option v-if="includeGlobal" value="GLOBAL">{{ $t('tournament.globalConfiguration') }}</option>
      <option v-for="item in compactEvents" :key="item.id" :value="String(item.id)">{{ item.year }} · {{ t('tournament.regions.' + item.region) }} · {{ t('tournament.seasons.' + item.season) }}</option>
    </select>
  </label>
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
