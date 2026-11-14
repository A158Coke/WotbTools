<script setup lang="ts">
// 数据版本下拉面板（design-language §7 Menu / §7.1 Select）。
// Reka Select 提供 listbox 语义、方向键/Home/End/typeahead、Esc 关闭并还焦点、portal 与
// 碰撞定位；这里只拥有选项信息层级与视觉 token。触发器由调用方以 #trigger 插槽提供，
// 保证侧边栏块、设置项、页头紧凑形态共用同一份列表。
import { computed } from 'vue'
import {
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectPortal,
  SelectRoot,
  SelectSeparator,
  SelectTrigger,
  SelectViewport,
} from 'reka-ui'
import { Check } from 'lucide-vue-next'
import type { DatasetOption, DatasetStatus } from '../composables/useDataVersion.js'

// Reka/Radix Select 禁止空字符串作为 item value；用不可能与 dataset id 冲突的哨兵值映射
// 到「默认（跟随服务器）」。
const DEFAULT_VALUE = '__default__'

const props = withDefaults(defineProps<{
  modelValue: string
  options: DatasetOption[]
  defaultId: string | null
  label: string
  disabled?: boolean
}>(), { disabled: false })

const emit = defineEmits<{ select: [value: string] }>()

const value = computed({
  get: () => props.modelValue || DEFAULT_VALUE,
  set: (next: string) => {
    const id = next === DEFAULT_VALUE ? '' : next
    if (id !== props.modelValue) emit('select', id)
  },
})

const STATUS_LABEL: Record<DatasetStatus, string> = {
  active: '',
  deprecated: 'dataVersion.statusDeprecated',
  revoked: 'dataVersion.statusRevoked',
}

interface MetaPart {
  text?: string
  key?: string
  params?: { count: number }
}

/** 第二行分段：版本来源 / 车辆数 / 非 active 状态；分隔符只在两段之间出现。 */
function metaParts(option: DatasetOption): MetaPart[] {
  const parts: MetaPart[] = []
  if (option.title) parts.push({ text: option.title })
  if (option.tankCount != null) parts.push({ key: 'dataVersion.tanks', params: { count: option.tankCount } })
  if (option.status !== 'active') parts.push({ key: STATUS_LABEL[option.status] })
  return parts
}
</script>

<template>
  <SelectRoot v-model="value" :disabled="disabled">
    <SelectTrigger as-child :aria-label="label">
      <slot name="trigger" />
    </SelectTrigger>
    <SelectPortal>
      <SelectContent
        class="dv-menu"
        position="popper"
        align="start"
        :side-offset="6"
        :collision-padding="8"
      >
        <SelectViewport class="dv-viewport">

          <SelectItem
            v-for="option in options"
            :key="option.value"
            :value="option.value"
            :disabled="option.status !== 'active'"
            :text-value="option.label"
            class="dv-item"
          >
            <span class="dv-item-body">
              <span class="dv-item-line">
                <SelectItemText class="dv-item-label">{{ option.label }}</SelectItemText>
                <span v-if="option.preview" class="dv-badge">{{ $t('dataVersion.preview') }}</span>
              </span>
              <span class="dv-item-meta">
                <template v-for="(part, index) in metaParts(option)" :key="index">
                  <template v-if="index > 0"> · </template>
                  <template v-if="part.key">{{ $t(part.key, part.params ?? {}) }}</template>
                  <template v-else>{{ part.text }}</template>
                </template>
              </span>
            </span>
            <SelectItemIndicator class="dv-check">
              <Check :size="16" aria-hidden="true" />
            </SelectItemIndicator>
          </SelectItem>
          <SelectSeparator v-if="options.length" class="dv-separator" />
          <SelectItem
            :value="DEFAULT_VALUE"
            class="dv-item"
          >
            <span class="dv-item-body">
              <SelectItemText class="dv-item-label">{{ $t('dataVersion.default') }}</SelectItemText>
              <span v-if="defaultId" class="dv-item-meta">
                {{ $t('dataVersion.serverDefault', { id: defaultId }) }}
              </span>
            </span>
            <SelectItemIndicator class="dv-check">
              <Check :size="16" aria-hidden="true" />
            </SelectItemIndicator>
          </SelectItem>

        </SelectViewport>
      </SelectContent>
    </SelectPortal>
  </SelectRoot>
</template>

<style scoped>
/* Popper 内容有外层 wrapper：scoped 属性落在 wrapper 上，面板元素用 :deep 命中 */
:deep(.dv-menu) {
  z-index: var(--z-menu);
  min-width: max(248px, var(--reka-select-trigger-width));
  max-height: var(--reka-select-content-available-height);
  overflow: hidden;
  padding: var(--space-1);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-surface-3);
  box-shadow: var(--elevation-2);
}

:deep(.dv-menu[data-state='open']) { animation: wotb-dv-in var(--duration-fast) var(--ease-standard); }

:deep(.dv-viewport) {
  max-height: var(--reka-select-content-available-height);
  overflow-y: auto;
  overscroll-behavior: contain;
}

:deep(.dv-item) {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: var(--control-h-md);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm);
  color: var(--color-text-primary);
  cursor: pointer;
  outline: 0;
}

:deep(.dv-item[data-highlighted]:not([data-disabled])) { background: var(--color-surface-2); }
:deep(.dv-item[data-state='checked']) { background: var(--color-surface-2); }
:deep(.dv-item[data-disabled]) { color: var(--color-text-tertiary); cursor: not-allowed; }
:deep(.dv-item:focus-visible) { outline: var(--focus-outline); outline-offset: calc(var(--focus-outline-offset) * -1); }

:deep(.dv-item-body) {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: var(--space-0);
  min-width: 0;
}

:deep(.dv-item-line) {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

:deep(.dv-item-label) {
  overflow: hidden;
  font: var(--type-body);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

:deep(.dv-item-meta) {
  overflow: hidden;
  color: var(--color-text-tertiary);
  font: var(--type-caption);
  text-overflow: ellipsis;
  white-space: nowrap;
}

:deep(.dv-item[data-disabled] .dv-item-meta) { color: var(--color-text-tertiary); }

:deep(.dv-badge) {
  flex: none;
  padding: 0 var(--space-1);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  color: var(--color-text-secondary);
  font: var(--type-caption);
  font-weight: 600;
}

:deep(.dv-check) {
  display: inline-grid;
  flex: none;
  place-items: center;
  color: var(--color-accent-text);
}

:deep(.dv-separator) {
  height: 1px;
  margin: var(--space-1) var(--space-2);
  background: var(--color-border-subtle);
}

@media (hover: hover) {
  :deep(.dv-item:not([data-disabled]):hover) { background: var(--color-surface-2); }
}
</style>

<!-- Popper 内容的进场 keyframes：scoped 会改写名字而 :deep 规则里的引用不会 -->
<style>
@keyframes wotb-dv-in {
  from {
    opacity: 0;
    transform: translateY(calc(var(--space-1) * -1));
  }
}
</style>