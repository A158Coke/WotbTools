<script setup lang="ts">
import { useI18n } from 'vue-i18n'

defineProps<{
  summary: string
  hint?: string
}>()
const { t } = useI18n()
</script>

<template>
  <div class="admin-bulk-slot">
    <div class="admin-bulk-bar" role="region" :aria-label="t('adminList.bulkRegion')" data-testid="admin-bulk-bar">
      <strong class="admin-bulk-summary" aria-live="polite">{{ summary }}</strong>
      <span v-if="hint" class="admin-bulk-hint">{{ hint }}</span>
      <span class="admin-bulk-actions"><slot /></span>
    </div>
  </div>
</template>

<style scoped>
.admin-bulk-slot { margin-bottom: var(--space-3); }
.admin-bulk-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-3);
  min-height: var(--control-h-lg);
  padding: var(--space-1) var(--space-2) var(--space-1) var(--space-4);
  border: 1px solid color-mix(in oklab, var(--color-accent) 40%, var(--color-border-subtle));
  border-radius: var(--radius-md);
  background: color-mix(in oklab, var(--color-accent) 10%, var(--color-surface-1));
}
.admin-bulk-summary { color: var(--color-accent-text); }
.admin-bulk-hint { color: var(--color-text-secondary); }
.admin-bulk-actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); margin-inline-start: auto; }

@media (width < 768px) {
  .admin-bulk-slot { min-height: calc(var(--hit-min) + var(--space-6) + env(safe-area-inset-bottom)); margin: 0; }
  .admin-bulk-bar {
    position: fixed;
    inset-inline: var(--sidebar-w) 0;
    bottom: 0;
    z-index: var(--z-sticky);
    padding: var(--space-3) calc(var(--gutter) + env(safe-area-inset-right)) calc(var(--space-3) + env(safe-area-inset-bottom)) calc(var(--gutter) + env(safe-area-inset-left));
    border: 0;
    border-top: 1px solid var(--color-border-subtle);
    border-radius: 0;
    background: var(--color-surface-1);
    box-shadow: var(--elevation-2);
  }
  .admin-bulk-hint { display: none; }
}
</style>
