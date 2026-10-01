<script setup>
// useConfirm() 的唯一渲染宿主（挂在 AppShell）。按钮写明具体动作（design-language §10）；默认焦点在「取消」，防误触。
import { useConfirmHost } from '../composables/useConfirm.js'
import AppDialog from './AppDialog.vue'
import AppButton from './AppButton.vue'

const { request, settle } = useConfirmHost()
</script>

<template>
  <AppDialog
    :open="!!request"
    :title="request?.title || $t('dialog.confirm')"
    size="sm"
    :tone="request?.danger ? 'danger' : 'default'"
    data-testid="confirm-dialog"
    @close="settle(false)"
  >
    <p v-if="request?.message">{{ request.message }}</p>
    <template #actions>
      <AppButton data-autofocus data-testid="confirm-cancel" @click="settle(false)">{{ request?.cancelLabel || $t('dialog.cancel') }}</AppButton>
      <AppButton :variant="request?.danger ? 'danger' : 'primary'" data-testid="confirm-ok" @click="settle(true)">{{ request?.confirmLabel || $t('dialog.confirm') }}</AppButton>
    </template>
  </AppDialog>
</template>
