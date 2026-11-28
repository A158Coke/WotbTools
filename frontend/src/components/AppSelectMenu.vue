<script setup lang="ts">
import { SelectContent, SelectItem, SelectItemIndicator, SelectItemText, SelectPortal, SelectRoot, SelectTrigger, SelectViewport } from 'reka-ui'
import { Check } from 'lucide-vue-next'

defineOptions({ inheritAttrs: false })

defineProps<{
  modelValue: string
  options: Array<{ value: string; label: string }>
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
</script>

<template>
  <SelectRoot :model-value="modelValue" @update:model-value="value => typeof value === 'string' && emit('update:modelValue', value)">
    <SelectTrigger v-bind="$attrs"><slot /></SelectTrigger>
    <SelectPortal>
      <SelectContent class="app-select-menu" position="popper" align="end" :side-offset="6" :collision-padding="12">
        <SelectViewport class="app-select-menu-viewport">
          <SelectItem v-for="option in options" :key="option.value" :value="option.value" class="app-select-menu-option">
            <SelectItemText class="app-select-menu-label">{{ option.label }}</SelectItemText>
            <SelectItemIndicator class="app-select-menu-check"><Check :size="16" aria-hidden="true" /></SelectItemIndicator>
          </SelectItem>
        </SelectViewport>
      </SelectContent>
    </SelectPortal>
  </SelectRoot>
</template>

<style>
/* Reka renders the popup inside a wrapper teleported to the body. */
.app-select-menu {
  z-index: var(--z-menu);
  inline-size: min(var(--reka-select-trigger-width), var(--reka-select-content-available-width));
  max-block-size: var(--reka-select-content-available-height);
  overflow: hidden;
  padding: var(--space-1);
  border: var(--border-width) solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-surface-3);
  box-shadow: var(--elevation-2);
}

.app-select-menu-viewport {
  min-block-size: 0;
  overscroll-behavior: contain;
}

.app-select-menu-option {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-block-size: var(--hit-min-comfortable);
  padding-inline: var(--space-3);
  border-radius: var(--radius-sm);
  color: var(--color-text-primary);
  font: var(--type-body);
  font-variant-numeric: tabular-nums;
  cursor: pointer;
}

.app-select-menu-label { flex: 1; min-inline-size: 0; overflow-wrap: anywhere; }
.app-select-menu-check { display: grid; flex: none; color: var(--color-accent-text); }
.app-select-menu-option[data-highlighted] { background: var(--color-surface-2); }
.app-select-menu-option:focus-visible {
  outline: var(--focus-outline);
  outline-offset: calc(-1 * var(--focus-outline-offset));
}
.app-select-menu-option[data-state='checked'] { background: var(--color-surface-2); font-weight: 600; }
</style>
