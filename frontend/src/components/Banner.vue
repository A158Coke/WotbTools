<script setup>
import { computed } from 'vue'
import { CircleAlert, Info, TriangleAlert } from 'lucide-vue-next'

// 页面级状态提示（design-language §7 / §10）：失败必须可见，不静默。
const props = defineProps({
  tone: { type: String, default: 'info', validator: v => ['info', 'warning', 'danger'].includes(v) },
})
const ICONS = { info: Info, warning: TriangleAlert, danger: CircleAlert }
const icon = computed(() => ICONS[props.tone])
</script>

<template>
  <div class="banner" :class="`is-${tone}`" :role="tone === 'danger' ? 'alert' : 'status'">
    <component :is="icon" class="banner-icon" :size="20" aria-hidden="true" />
    <div class="banner-body"><slot /></div>
    <div v-if="$slots.actions" class="banner-actions"><slot name="actions" /></div>
  </div>
</template>

<style scoped>
.banner {
  --banner-tone: var(--color-info);
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border: 1px solid color-mix(in oklab, var(--banner-tone) 45%, var(--color-border-subtle));
  border-radius: var(--radius-md);
  background: color-mix(in oklab, var(--banner-tone) 12%, var(--color-surface-1));
  color: var(--color-text-primary);
  font: var(--type-body);
}

.is-warning { --banner-tone: var(--color-warning); }
.is-danger { --banner-tone: var(--color-danger); }

.banner-icon { flex: none; margin-top: 2px; color: var(--banner-tone); }
.banner-body { flex: 1 1 auto; min-width: 0; }
.banner-body :deep(p) { margin: 0; }
.banner-body :deep(p + p),
.banner-body :deep(ul) { margin-top: var(--space-1); }
.banner-actions { display: flex; flex: none; gap: var(--space-2); }
</style>
