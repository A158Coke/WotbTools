<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Search, X } from 'lucide-vue-next'
import { createReusableTemplate } from '@vueuse/core'
import AppButton from './AppButton.vue'
import AppSheet from './AppSheet.vue'
import FilterChips from './FilterChips.vue'
import SegmentedControl from './SegmentedControl.vue'
import TankCatalogChoice from './TankCatalogChoice.vue'

export type FilterKey = 'q' | 'tier' | 'nation' | 'type' | 'category' | 'sort'
export type ChoiceMode = 'sheet' | 'inline' | 'menu'

export interface CatalogFilters {
  q: string
  tier: string
  nation: string
  type: string
  category: string
  sort: string
}

export interface CatalogOption {
  value: string
  label: string
}

export interface FilterChip {
  key: Exclude<FilterKey, 'q' | 'sort'>
  label: string
}

const props = defineProps<{
  title: string
  countText: string
  multiple: boolean
  draftCount: number
  selectedHere: number
  filteredCount: number
  isCompact: boolean
  hasFilters: boolean
  chips: FilterChip[]
  filters: CatalogFilters
  choiceMode: ChoiceMode
  layout: 'page' | 'dialog'
  autofocus: boolean
  nationOptions: CatalogOption[]
  tierOptions: CatalogOption[]
  typeOptions: CatalogOption[]
  categoryOptions: CatalogOption[]
  sortOptions: CatalogOption[]
}>()

const emit = defineEmits<{
  'query-input': [value: string]
  'set-filter': [key: FilterKey, value: string]
  'clear-filters': []
  'select-filtered': [selected: boolean]
  'confirm-selection': []
  close: []
}>()

const { t } = useI18n()
const queryModel = computed({
  get: () => props.filters.q,
  set: (value: string) => emit('query-input', value),
})
const sheetOpen = ref(false)
const searchInput = ref<HTMLInputElement | null>(null)
let sheetOpener: HTMLElement | null = null
const [DefineFilters, ReuseFilters] = createReusableTemplate()

watch(() => props.isCompact, async compact => {
  if (compact || !sheetOpen.value) return
  sheetOpen.value = false
  sheetOpener = null
  await nextTick()
  searchInput.value?.focus()
})

function toggleSheet() {
  if (sheetOpen.value) {
    closeSheet()
    return
  }
  sheetOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null
  sheetOpen.value = true
}

function closeSheet() {
  sheetOpen.value = false
  const opener = sheetOpener
  sheetOpener = null
  nextTick(() => opener?.focus())
}

function onTierChange(event: Event) {
  if (event.currentTarget instanceof HTMLSelectElement) emit('set-filter', 'tier', event.currentTarget.value)
}

function updateFilter(key: FilterKey, value: string) {
  emit('set-filter', key, value)
}

function removeChip(key: string) {
  if (['tier', 'nation', 'type', 'category'].includes(key)) updateFilter(key as Exclude<FilterKey, 'q' | 'sort'>, '')
}

if (props.autofocus) nextTick(() => searchInput.value?.focus())
</script>

<template>
  <div v-if="title" class="tc-dialog-head">
    <span id="tp-title">{{ title }}</span>
    <span id="tp-count" class="tp-count" data-testid="tank-count" aria-live="polite">{{ countText }}</span>
    <button id="tp-close" type="button" :title="t('armor.close')" :aria-label="t('armor.close')" @click="emit('close')">
      <X :size="20" aria-hidden="true" />
    </button>
  </div>

  <div v-if="multiple" class="tc-bulk-bar">
    <span aria-live="polite">{{ t('mobBulk.selected', { count: draftCount, hidden: draftCount - selectedHere }) }}</span>
    <AppButton size="sm" :disabled="!filteredCount || selectedHere === filteredCount" @click="emit('select-filtered', true)">{{ t('mobBulk.selectFilter') }}</AppButton>
    <AppButton size="sm" :disabled="!selectedHere" @click="emit('select-filtered', false)">{{ t('mobBulk.clearFilter') }}</AppButton>
    <AppButton variant="primary" size="sm" :disabled="!draftCount" @click="emit('confirm-selection')">{{ t('mobBulk.addN', { count: draftCount }) }}</AppButton>
  </div>

  <div class="tp-toolbar surface-glass-1" :class="{ 'is-dialog': layout === 'dialog' }">
    <div class="tp-search-row">
      <label class="tp-search">
        <Search :size="16" class="tp-search-icon" aria-hidden="true" />
        <input
          ref="searchInput"
          v-model="queryModel"
          id="tp-search"
          type="search"
          data-testid="tank-search" data-tour="tankopedia-search"
          :aria-label="t('agentTanks.search_label')"
          :placeholder="t('agentTanks.search_ph')"
          autocomplete="off"
          enterkeyhint="search"
        >
      </label>
      <FilterChips data-tour="tankopedia-filters" v-if="isCompact" :chips="chips" :open="sheetOpen" @toggle="toggleSheet" @remove="removeChip" />
      <span v-if="!title" id="tp-count" class="tp-count" data-testid="tank-count" aria-live="polite">{{ countText }}</span>
      <AppButton v-if="hasFilters" size="sm" data-testid="catalog-clear" @click="emit('clear-filters')">{{ t('agentTanks.clear_filters') }}</AppButton>
    </div>

    <DefineFilters>
      <div
        class="tp-filters"
        :class="{ 'is-sheet': isCompact, 'is-flat': choiceMode === 'inline' }"
        data-testid="tank-filters" data-tour="tankopedia-filters"
      >
        <div v-if="isCompact" class="tp-sheet-head">
          <strong>{{ t('filters.title') }}</strong>
          <AppButton size="sm" variant="primary" data-testid="filter-sheet-done" @click="closeSheet">{{ t('filters.done') }}</AppButton>
        </div>
        <div class="tp-field tp-nations">
          <span class="tp-field-label">{{ t('agentTanks.nation') }}</span>
          <TankCatalogChoice id="tp-nation" data-testid="filter-nation" :model-value="filters.nation" :options="nationOptions" :label="t('agentTanks.nation')" kind="nation" :mode="choiceMode" @update:model-value="value => updateFilter('nation', value)" />
        </div>
        <div class="tp-field tp-tiers">
          <span class="tp-field-label">{{ t('agentTanks.tier') }}</span>
          <select v-if="choiceMode !== 'inline'" id="tp-tier" data-testid="filter-tier" :value="filters.tier" @change="onTierChange" :aria-label="t('agentTanks.tier')">
            <option v-for="option in tierOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
          </select>
          <SegmentedControl v-else id="tp-tier" data-testid="filter-tier" :model-value="filters.tier" :options="tierOptions" :ariaLabel="t('agentTanks.tier')" presentation="chips" @update:model-value="value => updateFilter('tier', value)" />
        </div>
        <div class="tp-field">
          <span class="tp-field-label">{{ t('agentTanks.type') }}</span>
          <TankCatalogChoice id="tp-type" data-testid="filter-type" :model-value="filters.type" :options="typeOptions" :label="t('agentTanks.type')" kind="type" :mode="choiceMode" @update:model-value="value => updateFilter('type', value)" />
        </div>
        <div class="tp-field">
          <span class="tp-field-label">{{ t('agentTanks.category') }}</span>
          <TankCatalogChoice id="tp-category" data-testid="filter-category" :model-value="filters.category" :options="categoryOptions" :label="t('agentTanks.category')" kind="category" :mode="choiceMode" @update:model-value="value => updateFilter('category', value)" />
        </div>
        <div class="tp-field">
          <span class="tp-field-label">{{ t('agentTanks.sort') }}</span>
          <SegmentedControl
            id="tp-sort"
            data-testid="filter-sort"
            :model-value="filters.sort || 'name'"
            :options="sortOptions"
            presentation="chips"
            :ariaLabel="t('agentTanks.sort')"
            @update:model-value="value => updateFilter('sort', value)"
          />
        </div>
      </div>
    </DefineFilters>
    <AppSheet v-if="isCompact" :open="sheetOpen" :title="t('filters.title')" @close="closeSheet"><ReuseFilters /></AppSheet>
    <ReuseFilters v-else />
  </div>
</template>

<style scoped>
.tc-bulk-bar { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); padding-block: var(--space-2); }
.tc-bulk-bar span { margin-inline-end: auto; }

.tc-dialog-head { display: flex; align-items: center; gap: var(--space-3); flex: none; }
#tp-title { flex: 1; min-inline-size: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: var(--type-h3); }
#tp-close {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  inline-size: var(--scene-hit);
  block-size: var(--scene-hit);
  padding: 0;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-primary);
  cursor: pointer;
}

.tp-count { color: var(--color-text-secondary); font: var(--type-caption); font-variant-numeric: tabular-nums; }

.tp-toolbar { display: grid; gap: var(--space-3); padding: var(--space-3); border: 1px solid var(--color-border-subtle); border-radius: var(--radius-lg); }
.tp-toolbar.is-dialog { padding: 0; border: 0; border-radius: 0; background: transparent; }
.tp-search-row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); flex: none; }
.tp-search { position: relative; flex: 1 1 var(--form-field-min); min-inline-size: 0; }
.tp-search-icon { position: absolute; inset-block-start: 50%; inset-inline-start: var(--space-3); color: var(--color-text-tertiary); transform: translateY(-50%); pointer-events: none; }
.tp-search input,
.tp-field select {
  inline-size: 100%;
  min-block-size: var(--control-h-md);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  background: var(--color-surface-1);
  color: var(--color-text-primary);
  font: var(--type-body);
}
.tp-search input { padding: 0 var(--space-3) 0 var(--space-8); }
.tp-field select { padding: 0 var(--space-2); }
.tp-search input:focus-visible,
.tp-field select:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }
.tp-search input::placeholder { color: var(--color-text-tertiary); }
.tp-filters { display: flex; flex-wrap: wrap; align-items: start; gap: var(--space-3); flex: none; padding-block-start: var(--space-3); border-block-start: 1px solid var(--color-border-subtle); }
.tp-field { display: grid; gap: var(--space-1); min-inline-size: min(100%, var(--form-field-min)); flex: 1; }
.tp-filters.is-flat .tp-nations, .tp-filters.is-flat .tp-tiers { flex-basis: 100%; }
.tp-field-inline { max-inline-size: 360px; }
.tp-field-label { color: var(--color-text-secondary); font: var(--type-caption); }
.tp-filters.is-sheet { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-3); }
.tp-sheet-head { display: flex; grid-column: 1 / -1; align-items: center; justify-content: space-between; color: var(--color-text-primary); font: var(--type-h3); }
.is-sheet .tp-field { min-inline-size: 0; }
.is-sheet .tp-nations { grid-column: 1 / -1; }

/* The sheet portals outside the dialog tree; keep 44px targets. The segmented selector needs
   its extra class in the selector to outrank its own 32px control-height rule. */
.tp-filters.is-sheet :deep(button),
.tp-filters.is-sheet :deep(select),
.tp-filters.is-sheet :deep(input),
.tp-filters.is-sheet :deep(summary) { min-block-size: var(--scene-hit); }
.tp-filters.is-sheet :deep(.segmented .segmented-option) { min-block-size: var(--scene-hit); }

@media (width < 768px) {
  .tp-search { flex-basis: 100%; }
}
</style>
