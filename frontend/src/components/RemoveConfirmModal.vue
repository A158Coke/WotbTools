<script setup>
// 移除单场回放的确认（审计 PG-09：统一 AppDialog——焦点陷阱、Esc、关闭后焦点回到触发元素）
import AppDialog from './AppDialog.vue'
import AppButton from './AppButton.vue'

defineProps({ pending: Object })
defineEmits(['confirm', 'cancel'])
</script>

<template>
  <AppDialog
    :open="!!pending"
    :title="$t('modal.remove_title')"
    size="sm"
    tone="danger"
    data-testid="remove-confirm"
    @close="$emit('cancel')"
  >
    <p>{{ $t('modal.remove_confirm', { label: pending?.label }) }}</p>
    <p class="modal-sub">{{ $t('modal.remove_hint') }}</p>
    <template #actions>
      <AppButton data-autofocus @click="$emit('cancel')">{{ $t('modal.cancel') }}</AppButton>
      <AppButton variant="danger" data-testid="remove-confirm-ok" @click="$emit('confirm')">{{ $t('modal.confirm') }}</AppButton>
    </template>
  </AppDialog>
</template>
