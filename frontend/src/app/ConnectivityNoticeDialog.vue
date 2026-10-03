<script setup>
// 联网能力在非-online 状态下的统一提示（useConnectivityNotice 的唯一渲染出口）。
//
// 走 AppDialog（design-language §7 / 审计 PG-09），tone 保持 default：连通性问题不是错误状态，
// 也不使用 danger。四种状态（offline / unknown / degraded / service-unavailable）共用这一个组件，
// 差别只在 capability 模型给出的 title/body/hint key。
import AppDialog from '../components/AppDialog.vue'
import AppButton from '../components/AppButton.vue'

defineProps({
  titleKey: { type: String, default: '' },
  messageKey: { type: String, default: '' },
  hintKey: { type: String, default: '' },
  visible: { type: Boolean, default: false },
})
defineEmits(['close'])
</script>

<template>
  <AppDialog
    :open="visible && !!messageKey"
    :title="$t(titleKey)"
    size="sm"
    class="connectivity-notice-modal"
    data-testid="connectivity-notice"
    @close="$emit('close')"
  >
    <p class="connectivity-notice-requirement" data-testid="connectivity-notice-requirement">{{ $t(messageKey) }}</p>
    <p v-if="hintKey" class="connectivity-notice-hint" data-testid="connectivity-notice-hint">{{ $t(hintKey) }}</p>
    <template #actions>
      <AppButton data-testid="connectivity-notice-close" data-autofocus @click="$emit('close')">
        {{ $t('app.close') }}
      </AppButton>
    </template>
  </AppDialog>
</template>

<style scoped>
.connectivity-notice-requirement {
  margin: 0 0 6px;
}

.connectivity-notice-hint {
  margin: 0;
  color: var(--text-sub);
}
</style>
