<script setup lang="ts">
// 数据版本（game-version dataset）显式选择器。
// 设置页（更多）用 setting 变体；回放工作台页头用 compact 变体，保证在回放现场也能
// 直接看到并手动切换，而不是只能改 URL。切换会整页重载（见 useDataVersion）。
// 下拉面板与侧边栏共用 DataVersionMenu，保证同一概念只有一种选择控件（DC-SEL-08）。
import { computed } from 'vue'
import { ChevronDown, Database } from 'lucide-vue-next'
import DataVersionMenu from './DataVersionMenu.vue'
import { useDataVersion } from '../composables/useDataVersion.js'

const props = withDefaults(defineProps<{
  id: string
  variant?: 'setting' | 'compact'
  showHint?: boolean
}>(), {
  variant: 'setting',
  showHint: true,
})

const { state, selected, options, select } = useDataVersion()

/** 生产 origin 尚未部署 versions.json 时，紧凑选择器隐藏而不是在每个回放页显示错误。 */
const visible = computed(() => {
  if (state.value.status === 'unavailable') return false
  if (state.value.status === 'error') return props.variant !== 'compact'
  if (state.value.status === 'ready') return options.value.length > 0
  return true
})

const currentLabel = computed(() => {
  if (!selected.value) return null
  return options.value.find((option) => option.value === selected.value)?.label ?? selected.value
})

const label = computed(() => {
  if (state.value.status === 'loading') return null
  return currentLabel.value
})

function onSelect(id: string): void {
  if (id !== selected.value) select(id)
}
</script>

<template>
  <span
    v-if="visible"
    class="data-version"
    :class="`is-${variant}`"
    :title="$t('dataVersion.hint')"
  >
    <DataVersionMenu
      :model-value="selected"
      :options="options"
      :default-id="state.defaultId"
      :label="`${$t('dataVersion.title')}: ${label || $t('dataVersion.default')}`"
      :disabled="state.status !== 'ready'"
      @select="onSelect"
    >
      <template #trigger>
        <button
          :id="id"
          type="button"
          class="data-version-trigger"
          :aria-describedby="showHint ? `${id}-hint` : undefined"
        >
          <Database v-if="variant === 'compact'" class="data-version-icon" :size="15" aria-hidden="true" />
          <span class="data-version-value">
            <template v-if="state.status === 'loading'">{{ $t('dataVersion.loading') }}</template>
            <template v-else-if="state.status === 'error'">{{ $t('dataVersion.loadFailed') }}</template>
            <template v-else-if="state.status === 'unavailable'">{{ $t('dataVersion.unavailable') }}</template>
            <template v-else>{{ label || $t('dataVersion.default') }}</template>
          </span>
          <ChevronDown class="data-version-chevron" :size="16" aria-hidden="true" />
        </button>
      </template>
    </DataVersionMenu>
    <p v-if="showHint" :id="`${id}-hint`" class="data-version-hint" role="status">
      <template v-if="state.status === 'loading'">{{ $t('dataVersion.loading') }}</template>
      <template v-else-if="state.status === 'error'">{{ $t('dataVersion.loadFailed') }}</template>
      <template v-else>{{ $t('dataVersion.hint') }}</template>
    </p>
  </span>
</template>

<style scoped>
.data-version {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
}

.data-version-trigger {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  min-height: var(--control-h-md);
  padding: 0 var(--space-2) 0 var(--space-3);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-sm);
  background: var(--color-surface-2);
  color: var(--color-text-primary);
  font: var(--type-body);
  text-align: start;
  cursor: pointer;
  transition: background-color var(--duration-fast) var(--ease-standard);
}

.data-version-value {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.data-version-chevron {
  flex: none;
  color: var(--color-text-secondary);
  transition: transform var(--duration-fast) var(--ease-standard);
}

.data-version-trigger[data-state='open'] .data-version-chevron { transform: rotate(180deg); }

.data-version-trigger:focus-visible {
  outline: var(--focus-outline);
  outline-offset: var(--focus-outline-offset);
}

.data-version-trigger:disabled { cursor: default; opacity: .55; }

.data-version-hint {
  margin: 0;
  color: var(--color-text-secondary);
  font: var(--type-caption);
}

/* 页头紧凑形态：图标 + 下拉，宽度受限，不抢 capability tabs 的位置。 */
.data-version.is-compact {
  flex-direction: row;
  align-items: center;
  gap: var(--space-1);
  padding: 0 var(--space-2);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-surface-1);
}

.data-version.is-compact .data-version-trigger {
  width: auto;
  max-width: 190px;
  min-height: var(--control-h-sm);
  padding: 0;
  border: 0;
  background: transparent;
  font: var(--type-caption);
}

.data-version-icon { flex: none; color: var(--color-text-secondary); }

@media (hover: hover) {
  .data-version-trigger:not(:disabled):hover { background: var(--color-surface-3); }
  .data-version.is-compact .data-version-trigger:not(:disabled):hover { background: transparent; }
  .data-version.is-compact .data-version-trigger:not(:disabled):hover .data-version-value { color: var(--color-text-primary); }
}
</style>