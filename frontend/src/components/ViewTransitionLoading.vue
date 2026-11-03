<script setup>
// View 切换的统一加载面（#845）：由 viewRegistry.asyncView 挂到每个异步视图的
// defineAsyncComponent loadingComponent 上，只在 chunk 加载超过阈值后出现（flicker-free）。
// 只覆盖 main 内容区（宿主是 ViewHost 的 <main>），App Shell / Sidebar 不受影响。
</script>

<template>
  <div class="view-transition-loading" role="status" data-testid="view-transition-loading">
    <span class="view-transition-loading-spinner" aria-hidden="true"></span>
    <p class="view-transition-loading-text">{{ $t('viewHost.loading') }}</p>
  </div>
</template>

<style scoped>
.view-transition-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-3, 12px);
  min-height: 50dvh;
  color: var(--color-text-secondary);
}

.view-transition-loading-spinner {
  width: 28px;
  height: 28px;
  border-radius: var(--radius-full);
  border: 3px solid var(--color-border-subtle);
  border-top-color: var(--color-accent);
  animation: view-transition-loading-spin var(--duration-slow) linear infinite;
}

.view-transition-loading-text {
  margin: 0;
  font-size: var(--font-size-body);
}

@keyframes view-transition-loading-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
