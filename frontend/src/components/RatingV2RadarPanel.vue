<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import PlayerRatingRadar from './PlayerRatingRadar.vue'
import {
  ratingV2RadarComplete,
  ratingV2RadarSeries,
} from '../utils/ratingV2Radar.js'

const props = defineProps({
  row: { type: Object, required: true },
  rows: { type: Array, default: () => [] },
})

defineEmits(['close'])

const { t, locale } = useI18n()

const series = computed(() => ratingV2RadarSeries(props.row, props.rows, t, locale.value))
const metrics = computed(() => series.value.metrics)
const reference = computed(() => series.value.reference)
const playerComplete = computed(() => ratingV2RadarComplete(metrics.value))
</script>

<template>
  <section class="rating-v2-radar-panel" aria-labelledby="rating-v2-radar-title">
    <header class="rating-v2-radar-head">
      <div>
        <p class="rating-v2-radar-kicker">{{ t('ratingV2.radar.title') }}</p>
        <h3 id="rating-v2-radar-title">{{ row.cells?.nickname || '--' }}</h3>
        <p class="rating-v2-radar-rating">{{ t('ratingV2.labels.rating') }} · {{ row.cells?.rating ?? '--' }}</p>
      </div>
      <button class="rating-v2-radar-close" type="button" :aria-label="t('ratingV2.radar.close')" @click="$emit('close')">✕</button>
    </header>

    <p v-if="!playerComplete" class="rating-v2-radar-empty" data-testid="rating-v2-radar-unavailable">
      {{ t('ratingV2.radar.unavailable') }}
    </p>
    <PlayerRatingRadar
      v-else
      :metrics="metrics"
      :reference="reference"
      :reference-label="t('ratingV2.radar.batchAverage')"
      :player-label="row.cells?.nickname || ''"
      :reference-unavailable-label="t('ratingV2.radar.referenceUnavailable')" />
  </section>
</template>

<style scoped>
.rating-v2-radar-panel { margin-top: 16px; padding: 16px; border: 1px solid var(--border); border-radius: 10px; background: var(--bg-card); }
.rating-v2-radar-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 8px; }
.rating-v2-radar-kicker { margin: 0 0 3px; color: var(--accent); font-size: .7rem; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; }
.rating-v2-radar-head h3 { margin: 0; color: var(--text-heading); font-size: 1rem; }
.rating-v2-radar-rating { margin: 3px 0 0; color: var(--text-muted); font-size: .78rem; font-variant-numeric: tabular-nums; }
.rating-v2-radar-close { min-width: 34px; min-height: 34px; border: 1px solid var(--border); border-radius: 7px; background: transparent; color: var(--text-sub); cursor: pointer; font: inherit; font-size: 1rem; }
.rating-v2-radar-close:hover, .rating-v2-radar-close:focus-visible { border-color: var(--accent); color: var(--text-heading); outline: none; }
.rating-v2-radar-empty { margin: 12px 0 0; padding: 14px; border: 1px dashed var(--border); border-radius: 8px; color: var(--text-muted); text-align: center; }
@media (max-width: 767px) {
  .rating-v2-radar-panel { padding: 12px; }
}
</style>
