<script setup>
defineProps({
  files: {
    type: Array,
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
  showAnalysis: {
    type: Boolean,
    required: true
  }
})

defineEmits(['analyze', 'toggle-analysis'])
</script>

<template>
  <div class="ai-action">
    <button
      v-if="!analysisResult"
      class="lg"
      :disabled="analyzing"
      @click="$emit('analyze')"
    >
      {{ analyzing
        ? $t('action.processing')
        : (files.length > 1
          ? $t('recon.analyze_multi_btn', { n: files.length })
          : $t('recon.analyze_btn')) }}
    </button>
    <button v-else class="ghost" @click="$emit('toggle-analysis')">
      {{ showAnalysis ? $t('recon.hide_analysis') : $t('recon.show_analysis') }}
    </button>
  </div>
</template>
