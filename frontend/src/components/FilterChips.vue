<script setup>
// 手机上的筛选入口（design-language §9 筛选：compact 下一个「筛选」按钮 → sheet，已生效条件以 chip 显示在列表上方）。
import { useI18n } from 'vue-i18n'
import { SlidersHorizontal, X } from 'lucide-vue-next'

defineProps({
  /** 已生效的筛选：[{ key, label }] */
  chips: { type: Array, default: () => [] },
  open: { type: Boolean, default: false },
})
const emit = defineEmits(['toggle', 'remove'])
const { t } = useI18n()
</script>

<template>
  <div class="filter-chips" data-testid="filter-chips">
    <button
      type="button"
      class="filter-toggle"
      data-testid="filter-toggle"
      :aria-expanded="open"
      @click="emit('toggle')"
    >
      <SlidersHorizontal :size="16" aria-hidden="true" />
      <span>{{ t('filters.title') }}</span>
      <span v-if="chips.length" class="filter-count">{{ chips.length }}</span>
    </button>
    <ul v-if="chips.length" class="chip-list">
      <li v-for="chip in chips" :key="chip.key">
        <button
          type="button"
          class="chip"
          data-testid="filter-chip"
          :data-key="chip.key"
          :aria-label="t('filters.remove', { label: chip.label })"
          @click="emit('remove', chip.key)"
        >
          <span>{{ chip.label }}</span>
          <X :size="14" aria-hidden="true" />
        </button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.filter-chips { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); margin: var(--space-2) 0; }

.filter-toggle,
.chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  min-height: var(--control-h-sm);
  border-radius: var(--radius-full);
  font: var(--type-body);
  cursor: pointer;
}

.filter-toggle {
  padding: 0 var(--space-3);
  border: 1px solid var(--color-border-strong);
  background: var(--color-surface-1);
  color: var(--color-text-primary);
  font-weight: 600;
}

.filter-count {
  display: inline-grid;
  place-items: center;
  min-width: 20px;
  height: 20px;
  padding: 0 var(--space-1);
  border-radius: var(--radius-full);
  background: var(--color-accent);
  color: var(--color-on-accent);
  font: var(--type-caption);
  font-weight: 600;
}

.chip-list { display: contents; margin: 0; padding: 0; list-style: none; }

.chip {
  padding: 0 var(--space-2) 0 var(--space-3);
  border: 1px solid var(--color-border-subtle);
  background: var(--color-surface-2);
  color: var(--color-text-primary);
}

.filter-toggle:focus-visible,
.chip:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }
</style>
