<script setup>
// 场次选择器（design-language §7 SearchSelect，单选）：WAI-ARIA combobox + listbox。
// 桌面 / 平板为 Popover 下拉面板；手机为底部 AppSheet。超过 6 场显示搜索框，按地图 / 文件名 / 胜方过滤。
// 键盘导航、aria-activedescendant、Esc、outside click、portal 与碰撞定位由 Reka Listbox / Popover 提供；
// 这里只拥有场次选项/过滤语义与桌面 vs 手机的产品策略。
import { computed, inject, onDeactivated, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { createReusableTemplate } from '@vueuse/core'
import { ListboxContent, ListboxFilter, ListboxItem, ListboxRoot, PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'
import { ChevronDown, Search } from 'lucide-vue-next'
import { useBreakpoint } from '../composables/useBreakpoint.js'
import AppSheet from './AppSheet.vue'
import { DIALOG_INLINE_KEY } from '../shared/dialog.js'

defineOptions({ inheritAttrs: false })

const props = defineProps({
  /** [{ value, label, meta, search }]：label 主文本，meta 次要信息，search 额外检索文本。 */
  options: { type: Array, required: true },
  modelValue: { type: String, default: null },
  ariaLabel: { type: String, required: true },
  /** 父级 capability 可见性；false 时关闭已打开的 overlay（v-show 隐藏不会移除 portal 到 body 的 sheet）。 */
  visible: { type: Boolean, default: true },
})
const emit = defineEmits(['update:modelValue'])
const { t } = useI18n()
const { isCompact } = useBreakpoint()
// 与 AppDialog 同口径：组件测试 / fullscreen 宿主内原地渲染
const inline = inject(DIALOG_INLINE_KEY, false)

const SEARCH_THRESHOLD = 6
const open = ref(false)
const query = ref('')
// 桌面面板与手机 sheet 共用同一份列表模板
const [DefineBody, ReuseBody] = createReusableTemplate()

const selected = computed(() => props.options.find(option => option.value === props.modelValue) || null)
const searchable = computed(() => props.options.length > SEARCH_THRESHOLD)
const filtered = computed(() => {
  const needle = query.value.trim().toLowerCase()
  if (!needle) return props.options
  return props.options.filter(option =>
    [option.label, option.meta, option.search].filter(Boolean).join(' ').toLowerCase().includes(needle))
})

function setOpen(value) {
  open.value = value
  query.value = ''
}

function choose(value) {
  setOpen(false)
  // Listbox 单选里再次点击当前项会取消选择（value 为空）；场次不允许为空
  if (value != null && value !== props.modelValue) emit('update:modelValue', value)
}

watch(() => props.visible, (visible) => {
  if (!visible) setOpen(false)
})
// KeepAlive 停用（离开 Replay 页面）时组件不会 unmount：portal 到 body 的面板不随父 DOM 隐藏，必须主动关闭。
onDeactivated(() => setOpen(false))
</script>

<template>
  <DefineBody>
    <ListboxRoot
      class="picker-listbox"
      :model-value="modelValue"
      highlight-on-hover
      @update:model-value="choose"
    >
      <label v-if="searchable" class="picker-search">
        <Search :size="16" aria-hidden="true" />
        <ListboxFilter
          v-model="query"
          auto-focus
          type="search"
          :aria-label="t('workspace.battle_search')"
          :placeholder="t('workspace.battle_search')"
          data-testid="battle-picker-search"
        />
      </label>
      <ListboxContent class="picker-list" :aria-label="ariaLabel">
        <ListboxItem
          v-for="option in filtered"
          :key="option.value"
          :value="option.value"
          class="picker-option"
          :data-value="option.value"
          data-testid="battle-picker-option"
        >
          <span class="picker-label">{{ option.label }}</span>
          <span v-if="option.meta" class="picker-meta">{{ option.meta }}</span>
        </ListboxItem>
        <div v-if="!filtered.length" class="picker-empty">{{ t('workspace.battle_search_empty') }}</div>
      </ListboxContent>
    </ListboxRoot>
  </DefineBody>

  <div class="battle-picker">
    <PopoverRoot :open="open" @update:open="setOpen">
      <PopoverTrigger as-child>
        <button
          type="button"
          class="picker-trigger"
          aria-haspopup="listbox"
          :aria-expanded="open"
          :aria-label="`${ariaLabel}: ${selected ? selected.label : ''}`"
          v-bind="$attrs"
        >
          <span class="picker-value">
            <span class="picker-label">{{ selected ? selected.label : ariaLabel }}</span>
            <span v-if="selected?.meta" class="picker-meta">{{ selected.meta }}</span>
          </span>
          <ChevronDown :size="16" aria-hidden="true" />
        </button>
      </PopoverTrigger>

      <PopoverPortal v-if="!isCompact" :disabled="inline">
        <PopoverContent class="picker-panel" align="start" :side-offset="4" data-testid="battle-picker-panel">
          <ReuseBody />
        </PopoverContent>
      </PopoverPortal>
    </PopoverRoot>

    <AppSheet v-if="isCompact" :open="open" :title="ariaLabel" class="picker-sheet" data-testid="battle-picker-panel" @close="setOpen(false)">
      <ReuseBody />
    </AppSheet>
  </div>
</template>

<style scoped>
.battle-picker { position: relative; display: inline-flex; min-width: 0; }

.picker-trigger {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  max-width: 100%;
  min-height: var(--control-h-md);
  padding: 0 var(--space-3);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  background: var(--color-surface-1);
  color: var(--color-text-primary);
  font: var(--type-body);
  cursor: pointer;
}

.picker-trigger:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }

.picker-value { display: inline-flex; align-items: baseline; gap: var(--space-2); min-width: 0; }
.picker-label { overflow: hidden; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.picker-meta { overflow: hidden; color: var(--color-text-secondary); font: var(--type-caption); text-overflow: ellipsis; white-space: nowrap; }

.picker-panel {
  z-index: var(--z-menu);
  width: 360px;
  max-width: calc(100% - var(--space-4));
  padding: var(--space-2);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-surface-3);
  box-shadow: var(--elevation-2);
}
.picker-panel[data-state="open"] { animation: picker-in var(--duration-fast) var(--ease-standard); }
.picker-panel[data-state="closed"] { animation: picker-out var(--duration-fast) var(--ease-standard); }
@keyframes picker-in { from { opacity: 0; transform: translateY(calc(var(--space-1) * -1)); } }
@keyframes picker-out { to { opacity: 0; transform: translateY(calc(var(--space-1) * -1)); } }

.picker-listbox { display: grid; grid-template-rows: auto minmax(0, 1fr); gap: var(--space-1); max-height: 420px; }

.picker-search {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: var(--control-h-md);
  padding: 0 var(--space-2);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-sm);
  background: var(--color-surface-1);
  color: var(--color-text-secondary);
}

.picker-search:focus-within { outline: var(--focus-outline); outline-offset: calc(var(--focus-outline-offset) * -1); }
.picker-search input { flex: 1 1 auto; min-width: 0; border: 0; background: transparent; color: var(--color-text-primary); font: var(--type-body); outline: 0; }

.picker-list { margin: 0; padding: 0; overflow-y: auto; outline: 0; }

.picker-option {
  display: grid;
  gap: var(--space-0);
  min-height: var(--row-h);
  padding: var(--space-1) var(--space-3);
  border-inline-start: 3px solid transparent;
  border-radius: var(--radius-sm);
  align-content: center;
  cursor: pointer;
}

.picker-option { outline: 0; }
.picker-option[data-highlighted] { background: var(--color-surface-2); }
.picker-list:focus-within .picker-option[data-highlighted] { outline: var(--focus-outline); outline-offset: calc(var(--focus-outline-offset) * -1); }
.picker-option[aria-selected="true"] { border-inline-start-color: var(--color-accent); }
.picker-option[aria-selected="true"] .picker-label { color: var(--color-accent-text); }
.picker-empty { padding: var(--space-4) var(--space-3); color: var(--color-text-secondary); font: var(--type-body); }

@media (width < 768px) {
  .battle-picker,
  .picker-trigger { width: 100%; }
  .picker-trigger { justify-content: space-between; }
}
</style>
