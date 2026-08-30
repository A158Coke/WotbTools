<script setup>
defineProps({
  error: { type: String, default: '' },
  visible: { type: Boolean, default: false },
})
defineEmits(['close'])
</script>

<template>
  <div v-if="visible && error" class="modal-overlay" @click.self="$emit('close')">
    <div class="modal global-error-modal">
      <h3>{{ $t('app.global_error_title') }}</h3>
      <p class="error-msg">{{ error }}</p>
      <div class="modal-actions"><button class="btn-sm" @click="$emit('close')">{{ $t('app.close') }}</button></div>
    </div>
  </div>
</template>
