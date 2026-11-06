<script setup lang="ts">
// 侧边栏顶部（logo 下方）的资产数据版本切换。
// 与侧边栏导航同一套视觉：展开态是带标题/当前值的块，图标栏是图标 + 下方两行小字。
// 下拉列表由 DataVersionMenu（Reka Select）提供，外观由本组件决定。
import { computed } from 'vue'
import { ChevronDown, Database } from 'lucide-vue-next'
import DataVersionMenu from '../components/DataVersionMenu.vue'
import { useDataVersion } from '../composables/useDataVersion.js'

withDefaults(defineProps<{ rail?: boolean }>(), { rail: false })

const { state, selected, options, select } = useDataVersion()

const currentLabel = computed(() => {
  if (!selected.value) return null
  return options.value.find((option) => option.value === selected.value)?.label ?? selected.value
})

/** 图标栏很窄：只显示 variant（如 t11-preview）或 dataset id，完整 label 留给展开态/title。 */
const railLabel = computed(() => {
  if (!selected.value) return null
  return state.value.datasets.find((entry) => entry.id === selected.value)?.variant || selected.value
})

function onSelect(id: string): void {
  if (id !== selected.value) select(id)
}
</script>

<template>
  <DataVersionMenu
    :model-value="selected"
    :options="options"
    :default-id="state.defaultId"
    :label="rail && railLabel ? `${$t('dataVersion.title')}: ${railLabel}` : $t('dataVersion.title')"
    :disabled="state.status !== 'ready'"
    @select="onSelect"
  >
    <template #trigger>
      <button
        type="button"
        class="sidebar-version"
        :class="{ 'is-rail': rail }"
        :title="$t('dataVersion.hint')"
      >
        <span class="sidebar-version-head">
          <Database :size="rail ? 24 : 18" aria-hidden="true" />
          <span class="sidebar-version-title">{{ $t('dataVersion.title') }}</span>
        </span>
        <span class="sidebar-version-value">
          <span
            class="sidebar-version-value-text"
            :title="currentLabel || $t('dataVersion.default')"
          >
            <template v-if="state.status === 'loading'">{{ $t('dataVersion.loading') }}</template>
            <template v-else-if="state.status === 'error'">{{ $t('dataVersion.loadFailed') }}</template>
            <template v-else-if="state.status === 'unavailable'">{{ $t('dataVersion.unavailable') }}</template>
            <template v-else-if="rail">{{ railLabel || $t('dataVersion.defaultShort') }}</template>
            <template v-else>{{ currentLabel || $t('dataVersion.default') }}</template>
          </span>
          <ChevronDown v-if="!rail" class="sidebar-version-chevron" :size="16" aria-hidden="true" />
        </span>
      </button>
    </template>
  </DataVersionMenu>
</template>

<style scoped>
.sidebar-version {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  width: 100%;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-surface-2);
  color: var(--color-text-primary);
  font: inherit;
  text-align: start;
  cursor: pointer;
  transition: background-color var(--duration-fast) var(--ease-standard);
}

.sidebar-version-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--color-text-secondary);
  font: var(--type-caption);
  font-weight: 600;
}

.sidebar-version-value {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  min-width: 0;
  font: var(--type-body);
  font-weight: 600;
}

.sidebar-version-value-text {
  display: -webkit-box;
  min-width: 0;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  white-space: normal;
  overflow-wrap: anywhere;
}

.sidebar-version-value > svg { flex: none; color: var(--color-text-secondary); }

.sidebar-version-chevron { transition: transform var(--duration-fast) var(--ease-standard); }
.sidebar-version[data-state='open'] .sidebar-version-chevron { transform: rotate(180deg); }

.sidebar-version:focus-visible {
  outline: var(--focus-outline);
  outline-offset: var(--focus-outline-offset);
}

.sidebar-version:disabled { cursor: default; }

.sidebar-version[data-state='open'] { background: var(--color-surface-3); }

/* 图标栏：图标 + 下方小字，与 .sidebar-link 的 rail 形态一致；不再显示标题/箭头/边框。 */
.sidebar-version.is-rail {
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-2) 0;
  border: 0;
  background: transparent;
  text-align: center;
}

.sidebar-version.is-rail .sidebar-version-head { justify-content: center; }
.sidebar-version.is-rail .sidebar-version-title { display: none; }

.sidebar-version.is-rail .sidebar-version-value {
  display: -webkit-box;
  max-width: 100%;
  overflow: hidden;
  color: var(--color-text-secondary);
  font: var(--type-caption);
  font-weight: 600;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  white-space: normal;
  overflow-wrap: anywhere;
}

/* 覆盖展开态的 nowrap/ellipsis：否则内层 span 只显示一行，外层两行 clamp 失效。 */
.sidebar-version.is-rail .sidebar-version-value-text {
  display: inline;
  overflow: visible;
  white-space: normal;
  text-overflow: clip;
  overflow-wrap: anywhere;
}

.sidebar-version.is-rail .sidebar-version-value > svg { display: none; }

@media (hover: hover) {
  .sidebar-version:not(.is-rail):not(:disabled):hover { background: var(--color-surface-3); }
  .sidebar-version.is-rail:not(:disabled):hover .sidebar-version-value { color: var(--color-text-primary); }
}
</style>