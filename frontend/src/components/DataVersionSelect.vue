<script setup lang="ts">
// 数据版本（game-version dataset）显式选择器。
// 设置页（更多）用 setting 变体；回放工作台页头用 compact 变体，保证在回放现场也能
// 直接看到并手动切换，而不是只能改 URL。切换会整页重载（见 useDataVersion）。
import { computed } from 'vue'
import { Database } from 'lucide-vue-next'
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

function onChange(event: Event): void {
  const target = event.target as HTMLSelectElement | null
  select(target?.value ?? '')
}
</script>

<template>
  <span
    v-if="visible"
    class="data-version"
    :class="`is-${variant}`"
    :title="$t('dataVersion.hint')"
  >
    <Database v-if="variant === 'compact'" class="data-version-icon" :size="15" aria-hidden="true" />
    <select
      :id="id"
      class="data-version-select"
      :value="selected"
      :disabled="state.status !== 'ready'"
      :aria-label="$t('dataVersion.title')"
      :aria-describedby="showHint ? `${id}-hint` : undefined"
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

.data-version-select {
  width: 100%;
  min-height: var(--control-h-md);
  padding: 0 var(--space-2);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-sm);
  background: var(--color-surface-2);
  color: var(--color-text-primary);
  font: var(--type-body);
}

.data-version-select:focus-visible {
  outline: var(--focus-outline);
  outline-offset: var(--focus-outline-offset);
}

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

.data-version.is-compact .data-version-icon {
  flex: none;
  color: var(--color-text-secondary);
}

.data-version.is-compact .data-version-select {
  width: auto;
  max-width: 190px;
  min-height: var(--control-h-sm);
  padding: 0;
  border: 0;
  background: transparent;
  font: var(--type-caption);
}
</style>