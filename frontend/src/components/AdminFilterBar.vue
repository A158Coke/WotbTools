<script setup lang="ts">
// 管理列表模板的搜索与筛选条（design-language §9 筛选 / DC-ARC-03）：
// expanded / medium 行内一行（复用 app-shell 的 .control-bar）；compact 把默认插槽的筛选控件收进
// 「筛选（数量）」按钮打开的底部 AppSheet，已生效条件以 FilterChips 显示，点 chip 移除。
// search 插槽始终行内可见；actions 插槽推到行尾。筛选控件只渲染一份（行内或 sheet 内），状态由页面持有。
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useBreakpoint } from '../composables/useBreakpoint.js'
import AppButton from './AppButton.vue'
import AppSheet from './AppSheet.vue'
import FilterChips from './FilterChips.vue'

withDefaults(defineProps<{
  /** 已生效的筛选：[{ key, label }]（只在 compact 显示为 chip） */
  chips?: { key: string; label: string }[]
  /** sheet 底部的「完成」按钮；筛选需要显式「应用」的页面关掉它，在自己的应用按钮里调用插槽的 close() */
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
      <FilterChips v-if="isCompact" :chips="chips" :open="sheetOpen" @toggle="sheetOpen = !sheetOpen" @remove="(key: string) => emit('remove', key)" />
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
.admin-filter-bar { align-items: end; }
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
