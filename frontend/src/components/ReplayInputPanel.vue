<script setup>
import ReplayAnalysisAction from './ReplayAnalysisAction.vue'
import ReplayFilePicker from './ReplayFilePicker.vue'
import ReplayReconstructionActions from './ReplayReconstructionActions.vue'

defineProps({
  files: {
    type: Array,
    required: true
  },
  file: {
    type: Object,
    default: null
  },
  loading: {
    type: Boolean,
    required: true
  },
  queryTime: {
    type: String,
    required: true
  },
  analyzing: {
    type: Boolean,
    required: true
  },
  analysisResult: {
    type: Object,
    default: null
  },
  isAdmin: {
    type: Boolean,
    required: true
  },
  showAnalysis: {
    type: Boolean,
    required: true
  }
})

defineEmits([
  'add-file',
  'remove-file',
  'clear',
  'reconstruct',
  'state-at',
  'analyze',
  'toggle-analysis',
  'update:queryTime'
])
</script>

<template>
  <div class="uploadwrap">
    <div class="up-icon">
      <svg class="ic" viewBox="0 0 24 24"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/><polyline points="16 16 12 12 8 16"/></svg>
    </div>
    <h2>{{ $t('recon.title') }}</h2>
    <p class="sub-hint">{{ $t('recon.description') }}</p>

    <ReplayFilePicker
      :files="files"
      @add-file="$emit('add-file', $event)"
      @remove-file="$emit('remove-file', $event)"
      @clear="$emit('clear')"
    />

    <ReplayReconstructionActions
      :file="file"
      :loading="loading"
      :query-time="queryTime"
      @reconstruct="$emit('reconstruct')"
      @state-at="$emit('state-at')"
      @update:query-time="$emit('update:queryTime', $event)"
    />

    <ReplayAnalysisAction
      v-if="isAdmin && files.length"
      :files="files"
      :analyzing="analyzing"
      :analysis-result="analysisResult"
      :show-analysis="showAnalysis"
      @analyze="$emit('analyze')"
      @toggle-analysis="$emit('toggle-analysis')"
    />
  </div>
</template>
