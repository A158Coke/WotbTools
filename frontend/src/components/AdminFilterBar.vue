<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useBreakpoint } from '../composables/useBreakpoint.js'
import AppButton from './AppButton.vue'
import AppSheet from './AppSheet.vue'
import FilterChips from './FilterChips.vue'

withDefaults(defineProps<{
  chips?: { key: string; label: string }[]
  removeDisabled?: boolean
  doneButton?: boolean
}>(), { chips: () => [], doneButton: true })
const emit = defineEmits<{ remove: [key: string] }>()
const { t } = useI18n()
const { isCompact } = useBreakpoint()
const sheetOpen = ref(false)
function close() { sheetOpen.value = false }
</script>

<template>
  <div class="control-bar admin-filter-bar" data-testid="admin-filter-bar">
    <div v-if="$slots.search" class="admin-filter-search"><slot name="search" /></div>
    <template v-if="$slots.default">
      <FilterChips v-if="isCompact" :chips="chips" :open="sheetOpen" :remove-disabled="removeDisabled" @toggle="sheetOpen = !sheetOpen" @remove="(key: string) => emit('remove', key)" />
      <div v-else class="admin-filter-fields"><slot :close="close" :compact="false" /></div>
    </template>
    <div v-if="$slots.actions" class="control-bar-end admin-filter-actions"><slot name="actions" /></div>
    <AppSheet v-if="isCompact && $slots.default" :open="sheetOpen" :title="t('filters.title')" visible-title data-testid="admin-filter-sheet" @close="close">
      <div class="admin-filter-sheet">
        <slot :close="close" :compact="true" />
        <AppButton v-if="doneButton" variant="primary" block data-testid="admin-filter-done" @click="close">{{ t('filters.done') }}</AppButton>
      </div>
    </AppSheet>
  </div>
</template>

<style scoped>
.admin-filter-bar {
  align-items: end;
  padding: var(--space-3);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  background: var(--color-surface-1-glass);
  -webkit-backdrop-filter: blur(16px) saturate(1.2);
  backdrop-filter: blur(16px) saturate(1.2);
}
@supports not (backdrop-filter: blur(1px)) {
  .admin-filter-bar { background: var(--color-surface-1); }
}
.admin-filter-search { display: flex; flex: 1 1 var(--form-field-min); gap: var(--space-2); min-width: 0; }
.admin-filter-search > :deep(*) { min-width: 0; }
.admin-filter-fields { display: flex; flex-wrap: wrap; align-items: end; gap: var(--space-2) var(--space-3); min-width: 0; }
.admin-filter-actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
.admin-filter-sheet { display: grid; gap: var(--space-4); padding-block-end: var(--space-2); }
.admin-filter-bar :deep(.filter-chips) { margin: 0; }
@media (width < 768px) {
  .admin-filter-bar { align-items: center; }
  .admin-filter-search { flex-basis: 100%; }
}
</style>
