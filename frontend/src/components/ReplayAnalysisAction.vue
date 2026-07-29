<script setup>
defineProps({
  analyzing: {
    type: Boolean,
    required: true
  }
})

defineEmits(['analyze'])
</script>

<template>
  <div class="ai-action">
    <button class="lg" :disabled="analyzing" @click="$emit('analyze')">
      {{ analyzing ? $t('action.processing') : $t('recon.analyze_btn') }}
    </button>
  </div>
</template>
