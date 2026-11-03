<script setup lang="ts">
// View 异步 chunk 加载失败的统一错误面（#845）：defineAsyncComponent errorComponent。
// 重试经 viewRegistry.asyncView 捕获的 onError retry 重新执行 loader；错误呈现复用
// 现有 UI primitives（AppButton），不做每页专属 skeleton。
import AppButton from './AppButton.vue'

defineEmits<{ retry: [] }>()
</script>

<template>
  <div class="view-transition-error" role="alert" data-testid="view-transition-error">
    <p class="view-transition-error-text">{{ $t('viewHost.loadFailed') }}</p>
    <AppButton data-testid="view-transition-retry" @click="$emit('retry')">{{ $t('viewHost.retry') }}</AppButton>
  </div>
</template>

<style scoped>
.view-transition-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  min-height: 50dvh;
  color: var(--color-text-secondary);
}

.view-transition-error-text {
  margin: 0;
  font-size: var(--font-size-body);
}
</style>
