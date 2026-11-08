<script setup lang="ts">
// 管理列表模板的批量条：勾选后出现。大屏在表格上方行内；小屏固定在底部安全区上方（DC-RSP-05），
// 外层占位保留同等高度，列表末尾不被它盖住（DC-OCC-01）。默认插槽放批量动作按钮。
import { useI18n } from 'vue-i18n'

defineProps<{
  /** 「已选 N 项」 */
  summary: string
  /** 作用范围说明（例如「只作用于本页勾选的行」），小屏隐藏 */
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
  /* 占位高度 = 固定条高度（控件 + 上下内边距 + 底部安全区） */
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
