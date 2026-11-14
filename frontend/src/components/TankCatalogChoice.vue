<script setup lang="ts">
// Catalog-only presentation. State belongs to TankCatalogMenu, keyboard semantics to existing primitives.
import { computed, ref, watch } from 'vue'
import { SelectRoot, SelectTrigger, SelectContent, SelectViewport, SelectItem, SelectItemText, SelectItemIndicator } from 'reka-ui'
import { Check, ChevronDown } from 'lucide-vue-next'
import SegmentedControl from './SegmentedControl.vue'
import TankCatalogIcon from './TankCatalogIcon.vue'

interface ChoiceOption {
  value: string
  label: string
}
const props = withDefaults(defineProps<{
  modelValue: string
  options: ChoiceOption[]
  label: string
  kind: 'nation' | 'type' | 'category'
  mode?: 'inline' | 'menu' | 'sheet'
}>(), { mode: 'inline' })
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
defineOptions({ inheritAttrs: false })
const menuOpen = ref(false)
watch(() => props.mode, () => { menuOpen.value = false })
const ALL = '__all__' // Reka reserves the empty item value.
const selected = computed(() => props.options.find(option => option.value === props.modelValue) ?? props.options[0])
const value = computed({ get: () => props.modelValue || ALL, set: next => emit('update:modelValue', next === ALL ? '' : next) })
</script>

<template>
  <SelectRoot v-if="mode === 'menu'" v-model="value" v-model:open="menuOpen">
    <SelectTrigger v-bind="$attrs" class="catalog-trigger" :aria-label="`${label} ${selected?.label || ''}`">
      <TankCatalogIcon :kind="kind" :value="selected?.value" />
      <span>{{ selected?.label }}</span><ChevronDown :size="16" aria-hidden="true" />
    </SelectTrigger>
    <SelectContent class="catalog-select" position="popper" align="start" :side-offset="4" @keydown.esc.stop.prevent="menuOpen = false">
      <SelectViewport class="catalog-viewport">
        <SelectItem v-for="option in options" :key="option.value" class="catalog-item" :value="option.value || ALL" :text-value="option.label" :data-value="option.value">
          <SelectItemText>{{ option.label }}</SelectItemText>
          <SelectItemIndicator><Check :size="16" aria-hidden="true" /></SelectItemIndicator>
          <TankCatalogIcon :kind="kind" :value="option.value" variant="filter" />
        </SelectItem>
      </SelectViewport>
    </SelectContent>
  </SelectRoot>
  <details v-else-if="mode === 'sheet'" v-bind="$attrs" class="catalog-details">
    <summary class="catalog-trigger" :aria-label="`${label} ${selected?.label || ''}`"><TankCatalogIcon :kind="kind" :value="selected?.value" /><span>{{ selected?.label }}</span><ChevronDown :size="16" aria-hidden="true" /></summary>
    <SegmentedControl :model-value="modelValue" :options="options" :ariaLabel="label" presentation="chips" @update:model-value="emit('update:modelValue', $event)">
      <template #option="{ index }"><TankCatalogIcon :kind="kind" :value="options[index].value" /><span>{{ options[index].label }}</span></template>
    </SegmentedControl>
  </details>
  <SegmentedControl v-else v-bind="$attrs" :model-value="modelValue" :options="options" :ariaLabel="label" presentation="chips" @update:model-value="emit('update:modelValue', $event)">
    <template #option="{ index }"><TankCatalogIcon :kind="kind" :value="options[index].value" /><span>{{ options[index].label }}</span></template>
  </SegmentedControl>
</template>

<style scoped>
.catalog-trigger { display: flex; align-items: center; gap: var(--space-2); inline-size: 100%; min-block-size: var(--control-h-md); padding: var(--space-1) var(--space-2); border: 1px solid var(--color-border-strong); border-radius: var(--radius-md); background: var(--color-surface-1); color: var(--color-text-primary); font: var(--type-body); cursor: pointer; list-style: none; }
.catalog-trigger > span:not(.catalog-icon) { flex: 1; min-inline-size: 0; overflow-wrap: anywhere; text-align: start; }
.catalog-trigger::-webkit-details-marker { display: none; }
.catalog-trigger:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }
:deep(.catalog-select) { z-index: var(--z-tooltip); min-inline-size: var(--reka-select-trigger-width); max-block-size: var(--reka-select-content-available-height); padding: var(--space-1); border: 1px solid var(--color-border-strong); border-radius: var(--radius-md); background: var(--color-surface-3); color: var(--color-text-primary); box-shadow: var(--elevation-2); }
:deep(.catalog-viewport) { max-block-size: var(--reka-select-content-available-height); overflow-y: auto; }
:deep(.catalog-item) { display: flex; align-items: center; gap: var(--space-2); min-block-size: var(--hit-min-comfortable); padding: var(--space-1) var(--space-3); border-radius: var(--radius-sm); font: var(--type-body); cursor: pointer; }
:deep(.catalog-item) > :first-child { flex: 1; min-inline-size: 0; overflow-wrap: anywhere; }
:deep(.catalog-item[data-highlighted]) { outline: var(--focus-outline); outline-offset: calc(0px - var(--border-width)); }
:deep(.catalog-item[data-state="checked"]) { background: var(--color-surface-2); font-weight: 600; }
:deep(.segmented-label) { display: inline-flex; align-items: center; gap: var(--space-1); }
:deep(.segmented-option.is-active) { border-block-end-color: var(--color-accent); border-block-end-width: calc(var(--border-width) * 2); }
.catalog-details { min-inline-size: 0; }
.catalog-details > .segmented { margin-block-start: var(--space-2); }
</style>
