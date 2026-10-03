<script setup>
// 联网功能在已知离线时的统一提示（useOfflineNotice 的唯一渲染出口）。
// 走 AppDialog（design-language §7 / 审计 PG-09），tone 保持 default：离线是受支持的运行模式，
// 不是错误状态，因此不使用 danger。
import AppDialog from '../components/AppDialog.vue'
import AppButton from '../components/AppButton.vue'

defineProps({
  messageKey: { type: String, default: '' },
  visible: { type: Boolean, default: false },
})
defineEmits(['close'])
</script>

<template>
  <AppDialog
    :open="visible && !!messageKey"
    :title="$t('featureOffline.title')"
    size="sm"
    class="offline-notice-modal"
    data-testid="offline-notice"
    @close="$emit('close')"
  >
    <p class="offline-notice-requirement" data-testid="offline-notice-requirement">{{ $t(messageKey) }}</p>
    <p class="offline-notice-hint">{{ $t('featureOffline.retry') }}</p>
    <template #actions>
      <AppButton data-testid="offline-notice-close" data-autofocus @click="$emit('close')">
        {{ $t('app.close') }}
      </AppButton>
    </template>
  </AppDialog>
</template>

<style scoped>
.offline-notice-requirement {
  margin: 0 0 6px;
}

.offline-notice-hint {
  margin: 0;
  color: var(--text-sub);
}
</style>
