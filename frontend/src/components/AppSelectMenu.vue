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
        <SelectViewport>
          <SelectItem v-for="option in options" :key="option.value" :value="option.value" class="app-select-menu-option">
            <SelectItemText>{{ option.label }}</SelectItemText>
            <SelectItemIndicator><Check :size="16" aria-hidden="true" /></SelectItemIndicator>
          </SelectItem>
        </SelectViewport>
      </SelectContent>
    </SelectPortal>
  </SelectRoot>
</template>

<style scoped>
.app-select-menu {
  z-index: var(--z-menu);
  min-inline-size: var(--reka-select-trigger-width);
  max-inline-size: var(--reka-select-content-available-width);
  max-block-size: var(--reka-select-content-available-height);
  padding: var(--space-1);
  border: var(--border-width) solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-surface-1);
  box-shadow: var(--elevation-3);
}

.app-select-menu-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  min-block-size: var(--hit-min-comfortable);
  padding-inline: var(--space-3);
  border-radius: var(--radius-sm);
  color: var(--color-text-primary);
  font: var(--type-body);
  cursor: pointer;
}

.app-select-menu-option[data-highlighted] { outline: none; background: var(--color-surface-2); }
.app-select-menu-option[data-state='checked'] { color: var(--color-accent-text); font-weight: 600; }
</style>
