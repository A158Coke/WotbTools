<script setup>
// 一行关键数字（design-language §7 Stat：caption 标签 + 等宽数值）。
// 保留旧的 mcards / mc / k / v class：PNG 导出的离屏样式（ReplayPage .replay-export-root）按这些 class 着色。
defineProps({
  /** [{ key, label, value }] */
  stats: { type: Array, required: true },
})
</script>

<template>
  <dl class="stat-strip mcards">
    <div v-for="stat in stats" :key="stat.key" class="stat mc" :data-stat="stat.key">
      <dt class="stat-label k">{{ stat.label }}</dt>
      <dd class="stat-value v">{{ stat.value }}</dd>
    </div>
  </dl>
</template>

<style scoped>
.stat-strip {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: var(--space-0);
  margin: 0 0 var(--space-4);
  overflow: hidden;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  background: var(--color-surface-1);
}

.stat {
  display: grid;
  gap: var(--space-1);
  min-width: 0;
  padding: var(--space-3) var(--space-4);
  border-inline-start: 1px solid var(--color-border-subtle);
}

.stat:first-child { border-inline-start: 0; }
.stat-label { color: var(--color-text-secondary); font: var(--type-caption); }
.stat-value { margin: 0; overflow: hidden; color: var(--color-text-primary); font: var(--type-h3); font-variant-numeric: tabular-nums; text-overflow: ellipsis; white-space: nowrap; }

@media (width < 768px) {
  .stat-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .stat { padding: var(--space-2) var(--space-3); border-block-start: 1px solid var(--color-border-subtle); }
  .stat:nth-child(odd) { border-inline-start: 0; }
  .stat:nth-child(-n + 2) { border-block-start: 0; }
}
</style>
