<script setup lang="ts">
// 侧边栏顶部（logo 下方）的资产数据版本切换。
// 与侧边栏导航同一套视觉：展开态是带标题/当前值的块，图标栏是图标 + 下方两行小字。
// 原生 select 透明覆盖整个控件——点击/键盘都能打开系统选择器，但外观由本组件决定。
import { computed } from 'vue'
import { ChevronDown, Database } from 'lucide-vue-next'
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

function onChange(event: Event): void {
  const target = event.target as HTMLSelectElement | null
  select(target?.value ?? '')
}
</script>

<template>
  <label
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
      <ChevronDown v-if="!rail" :size="16" aria-hidden="true" />
    </span>
    <select
      class="sidebar-version-select"
      :value="selected"
      :disabled="state.status !== 'ready'"
      :aria-label="$t('dataVersion.title')"
      :title="$t('dataVersion.hint')"
      @change="onChange"
    >
      <option value="">{{ $t('dataVersion.default') }}</option>
      <option
        v-for="option in options"
        :key="option.value"
        :value="option.value"
        :disabled="option.status !== 'active'"
        :title="option.title"
      >
        {{ option.label }}<template v-if="option.tankCount"> · {{ $t('dataVersion.tanks', { count: option.tankCount }) }}</template>
      </option>
    </select>
  </label>
</template>

<style scoped>
.sidebar-version {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-surface-2);
  color: var(--color-text-primary);
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

.sidebar-version-select {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
}

.sidebar-version-select:disabled { cursor: default; }

.sidebar-version:focus-within {
  outline: var(--focus-outline);
  outline-offset: var(--focus-outline-offset);
}

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
  .sidebar-version:not(.is-rail):hover { background: var(--color-surface-3); }
  .sidebar-version.is-rail:hover .sidebar-version-value { color: var(--color-text-primary); }
}
</style>