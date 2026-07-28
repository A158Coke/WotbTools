<script setup>
defineProps({
  result: {
    type: Object,
    required: true
  },
  teamAnalysis: {
    type: Boolean,
    required: true
  },
  multiAnalysis: {
    type: Boolean,
    required: true
  },
  teams: {
    type: Array,
    required: true
  }
})
</script>

<template>
  <div class="analysis-meta">
    <div class="analysis-meta-item">
      <span>{{ $t('recon.analysis_mode') }}</span>
      <strong>{{ $t(`recon.modes.${result.mode}`) }}</strong>
    </div>
    <div v-if="result.analysisUnitCount > 0" class="analysis-meta-item">
      <span>{{ $t('recon.analysis_unit_count') }}</span>
      <strong>{{ result.analysisUnitCount }}</strong>
    </div>
    <div class="analysis-meta-item">
      <span>{{ $t('recon.analyzed_unit_count') }}</span>
      <strong>{{ result.analyzedUnitCount }}</strong>
    </div>
    <div v-if="result.omittedAnalysisUnitCount > 0" class="analysis-meta-item">
      <span>{{ $t('recon.omitted_analysis_unit_count') }}</span>
      <strong>{{ result.omittedAnalysisUnitCount }}</strong>
    </div>
    <div v-if="result.unavailableAnalysisUnitCount > 0" class="analysis-meta-item">
      <span>{{ $t('recon.unavailable_analysis_unit_count') }}</span>
      <strong>{{ result.unavailableAnalysisUnitCount }}</strong>
    </div>
    <div v-if="teamAnalysis" class="analysis-meta-item">
      <span>{{ $t('recon.perspective_team') }}</span>
      <strong>{{ teams.length ? teams.join(', ') : $t('recon.unknown') }}</strong>
    </div>
    <div v-if="result.sameTeamDuplicatePerspectiveCount" class="analysis-meta-item">
      <span>{{ $t('recon.duplicate_perspectives') }}</span>
      <strong>{{ result.sameTeamDuplicatePerspectiveCount }}</strong>
    </div>
  </div>
  <p v-if="multiAnalysis" class="sub-hint">
    {{ teamAnalysis
      ? $t('recon.multi_team_summary', { n: result.analyzedUnitCount })
      : $t('recon.multi_summary', { n: result.battleCount }) }}
  </p>
  <p v-if="teamAnalysis" class="team-scope-note">
    {{ $t('recon.team_scope_note') }}
  </p>
</template>
