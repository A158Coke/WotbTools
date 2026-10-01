<script setup>
// 全局错误提示（useError 的唯一渲染出口）：统一走 AppDialog（审计 PG-09）
import AppDialog from '../components/AppDialog.vue'
import AppButton from '../components/AppButton.vue'

defineProps({
  error: { type: String, default: '' },
  visible: { type: Boolean, default: false },
})
defineEmits(['close'])
</script>

<template>
  <AppDialog
    :open="visible && !!error"
    :title="$t('app.global_error_title')"
    size="sm"
    tone="danger"
    class="global-error-modal"
    @close="$emit('close')"
  >
    <p class="error-msg">{{ error }}</p>
    <template #actions>
      <AppButton data-testid="global-error-close" data-autofocus @click="$emit('close')">{{ $t('app.close') }}</AppButton>
    </template>
  </AppDialog>
</template>
