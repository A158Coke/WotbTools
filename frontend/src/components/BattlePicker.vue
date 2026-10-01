<script setup>
// 场次选择器（design-language §7 SearchSelect，单选）：WAI-ARIA combobox + listbox。
// 桌面 / 平板为下拉面板；手机为底部 sheet（遮罩点击关闭）。超过 6 场显示搜索框，按地图 / 文件名 / 胜方过滤。
// 焦点留在搜索框（或列表），方向键移动高亮项，Enter 选中，Esc 关闭并把焦点还给触发按钮。
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown, Search } from 'lucide-vue-next'

defineOptions({ inheritAttrs: false })

const props = defineProps({
  /** [{ value, label, meta, search }]：label 主文本，meta 次要信息，search 额外检索文本。 */
  options: { type: Array, required: true },
  modelValue: { type: String, default: null },
  ariaLabel: { type: String, required: true },
})
const emit = defineEmits(['update:modelValue'])
const { t } = useI18n()

const SEARCH_THRESHOLD = 6
const open = ref(false)
const query = ref('')
const activeIndex = ref(-1)
const root = ref(null)
const trigger = ref(null)
const searchInput = ref(null)
const list = ref(null)
const uid = Math.random().toString(36).slice(2, 9)
const listId = `battle-picker-list-${uid}`

const selected = computed(() => props.options.find(option => option.value === props.modelValue) || null)
const searchable = computed(() => props.options.length > SEARCH_THRESHOLD)
const filtered = computed(() => {
  const needle = query.value.trim().toLowerCase()
  if (!needle) return props.options
  return props.options.filter(option =>
    [option.label, option.meta, option.search].filter(Boolean).join(' ').toLowerCase().includes(needle))
})
const activeId = computed(() => (activeIndex.value >= 0 ? `${listId}-${activeIndex.value}` : undefined))

async function openPicker() {
  open.value = true
  query.value = ''
  // 等 query 的 watch 先跑完（它会把高亮复位到第一项），再定位到当前场次
  await nextTick()
  activeIndex.value = Math.max(0, props.options.findIndex(option => option.value === props.modelValue))
  ;(searchable.value ? searchInput.value : list.value)?.focus()
  scrollActiveIntoView()
}

function closePicker({ restoreFocus = false } = {}) {
  if (!open.value) return
  open.value = false
  query.value = ''
  if (restoreFocus) trigger.value?.focus()
}

function choose(option) {
  closePicker({ restoreFocus: true })
  if (option.value !== props.modelValue) emit('update:modelValue', option.value)
}

function scrollActiveIntoView() {
  nextTick(() => list.value?.querySelector('.is-highlighted')?.scrollIntoView?.({ block: 'nearest' }))
}

function onKeydown(event) {
  const count = filtered.value.length
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    if (!count) return
    const step = event.key === 'ArrowDown' ? 1 : -1
    activeIndex.value = (activeIndex.value + step + count) % count
    scrollActiveIntoView()
  } else if (event.key === 'Home' && event.currentTarget === list.value) {
    event.preventDefault()
    activeIndex.value = 0
  } else if (event.key === 'End' && event.currentTarget === list.value) {
    event.preventDefault()
    activeIndex.value = count - 1
  } else if (event.key === 'Enter') {
    event.preventDefault()
    const option = filtered.value[activeIndex.value]
    if (option) choose(option)
  } else if (event.key === 'Escape') {
    event.preventDefault()
    closePicker({ restoreFocus: true })
  } else if (event.key === 'Tab') {
    closePicker()
  }
}

watch(query, () => { activeIndex.value = filtered.value.length ? 0 : -1 })

function onDocumentPointerDown(event) {
  if (!root.value?.contains(event.target)) closePicker()
}
watch(open, (value) => {
  if (value) document.addEventListener('pointerdown', onDocumentPointerDown)
  else document.removeEventListener('pointerdown', onDocumentPointerDown)
})
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocumentPointerDown))
</script>

<template>
  <div ref="root" class="battle-picker">
    <button
      ref="trigger"
      type="button"
      class="picker-trigger"
      aria-haspopup="listbox"
      :aria-expanded="open"
      :aria-label="`${ariaLabel}: ${selected ? selected.label : ''}`"
      v-bind="$attrs"
      @click="open ? closePicker() : openPicker()"
    >
      <span class="picker-value">
        <span class="picker-label">{{ selected ? selected.label : ariaLabel }}</span>
        <span v-if="selected?.meta" class="picker-meta">{{ selected.meta }}</span>
      </span>
      <ChevronDown :size="16" aria-hidden="true" />
    </button>

    <template v-if="open">
      <div class="picker-scrim" aria-hidden="true" @click="closePicker()"></div>
      <div class="picker-panel" data-testid="battle-picker-panel">
        <label v-if="searchable" class="picker-search">
          <Search :size="16" aria-hidden="true" />
          <input
            ref="searchInput"
            v-model="query"
            type="search"
            role="combobox"
            aria-autocomplete="list"
            :aria-expanded="true"
            :aria-controls="listId"
            :aria-activedescendant="activeId"
            :aria-label="t('workspace.battle_search')"
            :placeholder="t('workspace.battle_search')"
            data-testid="battle-picker-search"
            @keydown="onKeydown"
          />
        </label>
        <ul
          :id="listId"
          ref="list"
          class="picker-list"
          role="listbox"
          :aria-label="ariaLabel"
          :tabindex="searchable ? -1 : 0"
          :aria-activedescendant="searchable ? undefined : activeId"
          @keydown="onKeydown"
        >
          <li
            v-for="(option, index) in filtered"
            :id="`${listId}-${index}`"
            :key="option.value"
            role="option"
            class="picker-option"
            :class="{ 'is-highlighted': index === activeIndex }"
            :aria-selected="option.value === modelValue"
            :data-value="option.value"
            data-testid="battle-picker-option"
            @click="choose(option)"
            @pointermove="activeIndex = index"
          >
            <span class="picker-label">{{ option.label }}</span>
            <span v-if="option.meta" class="picker-meta">{{ option.meta }}</span>
          </li>
          <li v-if="!filtered.length" class="picker-empty" role="presentation">{{ t('workspace.battle_search_empty') }}</li>
        </ul>
      </div>
    </template>
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

.picker-scrim { display: none; }

.picker-panel {
  position: absolute;
  top: calc(100% + var(--space-1));
  left: 0;
  z-index: var(--z-menu);
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: var(--space-1);
  width: 360px;
  max-height: 420px;
  padding: var(--space-2);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-surface-3);
  box-shadow: var(--elevation-2);
}

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

.picker-list { margin: 0; padding: 0; overflow-y: auto; list-style: none; outline: 0; }
/* activedescendant 模式：焦点留在列表 / 搜索框，焦点环画在高亮项上而不是整个列表 */
.picker-list:focus .picker-option.is-highlighted { outline: var(--focus-outline); outline-offset: calc(var(--focus-outline-offset) * -1); }

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

.picker-option.is-highlighted { background: var(--color-surface-2); }
.picker-option[aria-selected="true"] { border-inline-start-color: var(--color-accent); }
.picker-option[aria-selected="true"] .picker-label { color: var(--color-accent-text); }
.picker-empty { padding: var(--space-4) var(--space-3); color: var(--color-text-secondary); font: var(--type-body); }

@media (width < 768px) {
  .battle-picker,
  .picker-trigger { width: 100%; }
  .picker-trigger { justify-content: space-between; }

  .picker-scrim { position: fixed; inset: 0; z-index: var(--z-sheet); display: block; background: var(--color-scrim); }

  .picker-panel {
    position: fixed;
    top: auto;
    right: 0;
    bottom: 0;
    left: 0;
    z-index: var(--z-sheet);
    width: auto;
    max-height: 70dvh;
    padding: var(--space-3) var(--space-3) calc(var(--space-3) + env(safe-area-inset-bottom));
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  }
}
</style>
