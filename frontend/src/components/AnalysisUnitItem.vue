<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { localizeLimitation } from '../utils/reconstruction-analysis.js'

const props = defineProps({
  unit: {
    type: Object,
    required: true
  },
  teamAnalysis: {
    type: Boolean,
    required: true
  }
})

const { t } = useI18n()
const perspectiveLabel = computed(() => props.teamAnalysis
  ? t('recon.team_perspective', { team: props.unit.perspectiveTeam })
  : t('recon.player_perspective'))
const duplicateFiles = computed(() => props.unit.duplicateFileNames ?? [])
const coverageLabel = computed(() => {
  if (!props.teamAnalysis || !props.unit.report?.coverage) {
    return ''
  }
  return props.unit.report.coverage.fullFeaturesAvailable
    ? t('recon.full_team_features')
    : t('recon.authoritative_fallback')
})
const limitations = computed(() => props.unit.report?.limitations ?? [])
</script>

<template>
  <article class="analysis-unit">
    <div class="analysis-unit-head">
      <strong>{{ unit.analysisUnitId }}</strong>
      <span>{{ perspectiveLabel }}</span>
    </div>
    <p>
      {{ $t('recon.representative_file') }}:
      <span class="mono-inline">{{ unit.representativeFileName }}</span>
    </p>
    <p v-if="duplicateFiles.length">
      {{ $t('recon.duplicate_files') }}:
      <span class="mono-inline">{{ duplicateFiles.join(', ') }}</span>
    </p>
    <p v-if="coverageLabel">
      {{ coverageLabel }}
    </p>
    <ul v-if="limitations.length" class="limitation-list">
      <li v-for="code in limitations" :key="code">
        {{ localizeLimitation(code, $t) }}
      </li>
    </ul>
  </article>
</template>
