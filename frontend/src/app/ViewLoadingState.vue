<script setup lang="ts">
</script>

<template>
  <div class="view-loading" role="status" aria-live="polite" aria-busy="true" data-testid="view-loading">
    <span class="view-loading-spinner" aria-hidden="true"></span>
    <span class="view-loading-label">{{ $t('app.view_loading') }}</span>
  </div>
</template>

<style scoped>
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
  corner-shape: round;
  border: 3px solid var(--color-border-subtle);
  border-block-start-color: var(--color-accent);
  animation: view-loading-spin 0.9s linear infinite;
}

@media (prefers-reduced-motion: reduce) {
  .view-loading-spinner { animation: none; }
}

@keyframes view-loading-spin {
  to { transform: rotate(360deg); }
}
</style>
