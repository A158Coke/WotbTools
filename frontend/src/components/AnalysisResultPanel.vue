<script setup>
import { computed } from 'vue'
import {
  analysisLimitations,
  isMultiMode,
  isTeamMode,
  perspectiveTeams
} from '../utils/reconstruction-analysis.js'
import AnalysisKeyEvents from './AnalysisKeyEvents.vue'
import AnalysisLimitations from './AnalysisLimitations.vue'
import AnalysisSummary from './AnalysisSummary.vue'
import AnalysisUnitList from './AnalysisUnitList.vue'
import MarkdownContent from './MarkdownContent.vue'

const props = defineProps({
  result: {
    type: Object,
    required: true
  }
})

const isTeamAnalysis = computed(() => isTeamMode(props.result.mode))
const isMultiAnalysis = computed(() => isMultiMode(props.result.mode))
const analysisTeams = computed(() => perspectiveTeams(props.result))
const reportLimitations = computed(() => analysisLimitations(props.result))
</script>

<template>
  <div class="panel analysis-panel">
    <div class="panel-head">
      <h2>{{ isTeamAnalysis ? $t('recon.analysis_title_team') : $t('recon.analysis_title_player') }}</h2>
    </div>
    <AnalysisSummary
      :result="result"
      :team-analysis="isTeamAnalysis"
      :multi-analysis="isMultiAnalysis"
      :teams="analysisTeams"
    />
    <MarkdownContent class="analysis-text" :content="result.analysis" />

    <AnalysisUnitList
      v-if="result.analyses?.length"
      :units="result.analyses"
      :team-analysis="isTeamAnalysis"
    />

    <AnalysisLimitations
      v-if="reportLimitations.length"
      :codes="reportLimitations"
    />

    <AnalysisKeyEvents
      v-if="result.keyEvents?.length"
      :events="result.keyEvents"
    />
  </div>
</template>

<style scoped>
.analysis-panel {
  margin-top: 16px;
}
.panel-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.panel-head h2 { margin: 0 0 12px; }
.analysis-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0 0 12px;
}
.analysis-meta-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 130px;
  padding: 8px 12px;
  border: 1px solid var(--border-light);
  border-radius: 6px;
  background: var(--bg-card2);
}
.analysis-meta-item span { color: var(--text-sub); font-size: .72rem; }
.analysis-meta-item strong { color: var(--text-heading); font-size: .9rem; }
.sub-hint { color: var(--text-sub); font-size: .88rem; margin: 6px 0 16px; }
.team-scope-note {
  padding: 9px 12px;
  border-left: 3px solid var(--accent);
  background: var(--bg-card2);
  color: var(--text-label);
  font-size: .84rem;
}
.analysis-limitations {
  margin-top: 16px;
}
.analysis-limitations h3 {
  margin: 0 0 8px;
  color: var(--text-heading);
  font-size: .9rem;
}
.analysis-panel :deep(.analysis-unit) {
  margin-top: 8px;
  padding: 10px 12px;
  border: 1px solid var(--border-light);
  border-radius: 6px;
  background: var(--bg-card2);
}
.analysis-panel :deep(.analysis-unit p) {
  margin: 6px 0 0;
  color: var(--text-label);
  font-size: .8rem;
}
.analysis-panel :deep(.analysis-unit-head) {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 8px;
  color: var(--text-heading);
  font-size: .82rem;
}
.analysis-panel :deep(.analysis-unit-head span) { color: var(--accent); }
.analysis-panel :deep(.mono-inline) {
  font-family: 'SF Mono', 'Cascadia Code', 'Consolas', monospace;
}
.analysis-panel :deep(.limitation-list) {
  margin: 7px 0 0;
  padding-left: 20px;
  color: var(--text-sub);
  font-size: .8rem;
}
.analysis-panel :deep(.limitation-list li) { margin: 3px 0; }
.analysis-text {
  white-space: pre-wrap;
  line-height: 1.6;
  font-size: .9rem;
  color: var(--text);
  margin: 0 0 8px;
}
.analysis-panel :deep(.recon-details) { margin-top: 8px; }
.analysis-panel :deep(.recon-details summary) { cursor: pointer; font-size: .82rem; color: var(--accent); }
.analysis-panel :deep(.key-events) { list-style: none; margin: 8px 0 0; padding: 0; }
.analysis-panel :deep(.key-events li) {
  display: flex;
  gap: 10px;
  align-items: baseline;
  padding: 3px 0;
  border-bottom: 1px solid var(--border-light);
  font-size: .82rem;
}
.analysis-panel :deep(.ke-time) { color: var(--text-sub); font-variant-numeric: tabular-nums; min-width: 52px; text-align: right; }
.analysis-panel :deep(.ke-type) { color: var(--accent); font-weight: 600; min-width: 130px; }
.analysis-panel :deep(.ke-label) { color: var(--text); }
</style>
