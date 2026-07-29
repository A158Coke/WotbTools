<script setup>
import ReplayAnalysisAction from './ReplayAnalysisAction.vue'
import ReplayFilePicker from './ReplayFilePicker.vue'

defineProps({
  files: {
    type: Array,
    required: true
  },
  analyzing: {
    type: Boolean,
    required: true
  },
  canUseAiReview: {
    type: Boolean,
    required: true
  }
})

defineEmits([
  'add-file',
  'remove-file',
  'clear',
  'analyze'
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

    <ReplayAnalysisAction
      v-if="canUseAiReview && files.length"
      :analyzing="analyzing"
      @analyze="$emit('analyze')"
    />
  </div>
</template>
