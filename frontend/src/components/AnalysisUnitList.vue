<script setup>
import AnalysisUnitItem from './AnalysisUnitItem.vue'

defineProps({
  units: {
    type: Array,
    required: true
  },
  teamAnalysis: {
    type: Boolean,
    required: true
  }
})

</script>

<template>
  <section class="analysis-units">
    <h3>{{ $t('recon.analysis_units') }}</h3>
    <AnalysisUnitItem
      v-for="unit in units"
      :key="unit.analysisUnitId"
      :unit="unit"
      :team-analysis="teamAnalysis"
    />
  </section>
</template>
