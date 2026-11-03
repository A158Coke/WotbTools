<script setup lang="ts">
// View transition 的统一 loading surface（#845）：由 viewRegistry 的 defineLazyView
// 在 lazy chunk 超过反馈阈值后渲染在原 view 位置（main 内容区内，不遮 Sidebar / 导航）。
</script>

<template>
  <div class="view-loading" role="status" aria-live="polite" aria-busy="true" data-testid="view-loading">
    <span class="view-loading-spinner" aria-hidden="true"></span>
    <span class="view-loading-label">{{ $t('app.view_loading') }}</span>
  </div>
</template>

<style scoped>
/* 填满 main：ViewHost 在 surface 在场时把 main 变成列 flex（见 ViewHost.vue），这里跟随伸展。
   main 的 flex-grow 已保证块高（Footer 贴底不上跳），无需任何视口/百分比 magic number。 */
.view-loading {
  flex: 1 1 auto;
  display: grid;
  place-content: center;
  gap: var(--space-3);
  color: var(--color-text-tertiary);
  font: var(--type-body);
}

.view-loading-spinner {
  justify-self: center;
  block-size: var(--space-8);
  inline-size: var(--space-8);
  border-radius: var(--radius-full);
  border: 3px solid var(--color-border-subtle);
  border-block-start-color: var(--color-accent);
  animation: view-loading-spin 0.9s linear infinite;
}

/* reduced-motion 只停动画，不改变 loading 语义（阈值在 viewRegistry，与 motion token 无关）。 */
@media (prefers-reduced-motion: reduce) {
  .view-loading-spinner { animation: none; }
}

@keyframes view-loading-spin {
  to { transform: rotate(360deg); }
}
</style>
