<script setup>
// 车辆选择器（design-language §7 SearchSelect，单选；审计 BZ-17）：可编辑 combobox + listbox（WAI-ARIA APG combobox 模式）。
// 焦点始终留在输入框：输入即按车名模糊过滤（复用坦克百科的 tankFuzzyScore），方向键移动高亮项，
// Enter 选中，Esc 关闭并恢复显示当前选择，Tab / 点外部关闭。
// 当前值不在选项里（例如深链 ?tank= 指向的车辆当前筛选下不存在）时仍显示为已选：优先 fallbackLabel，否则 `#id`。
import { computed, nextTick, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown, X } from 'lucide-vue-next'
import { tankFuzzyScore } from '../scene/tankMeta.js'

const props = defineProps({
  /** 当前车辆 id；null 表示未选 / 全部车辆。 */
  modelValue: { type: Number, default: null },
  /** [{ id, label, hint?, search? }]：label 车名，hint 次要信息（等级 / 国家 / 车种），search 额外检索文本。 */
  options: { type: Array, required: true },
  /** 提供时列表首项为「全部 / 默认」选项（值为 null），并显示清除按钮。 */
  nullLabel: { type: String, default: '' },
  /** 未选择时的占位文字；默认使用 nullLabel 或通用提示。 */
  placeholder: { type: String, default: '' },
  /** 当前值不在 options 里时显示的名称。 */
  fallbackLabel: { type: String, default: '' },
  /** 输入框 id，供外部 <label for> 关联。 */
  inputId: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue', 'change'])
const { t } = useI18n()

const uid = useId()
const resolvedInputId = computed(() => props.inputId || `vehicle-picker-${uid}`)
const listId = computed(() => `${resolvedInputId.value}-list`)

const root = ref(null)
const input = ref(null)
const list = ref(null)
const open = ref(false)
const query = ref('')
const activeIndex = ref(-1)

const selectedOption = computed(() => (props.modelValue == null
  ? null
  : props.options.find(option => option.id === props.modelValue) || null))

/** 输入框在非编辑状态下显示的文字。 */
const displayLabel = computed(() => {
  if (props.modelValue == null) return ''
  return selectedOption.value?.label || props.fallbackLabel || `#${props.modelValue}`
})
const placeholderText = computed(() => props.placeholder || props.nullLabel || t('vehiclePicker.placeholder'))

const items = computed(() => {
  const needle = query.value.trim()
  if (!needle) {
    const all = props.nullLabel ? [{ id: null, label: props.nullLabel }] : []
    return [...all, ...props.options]
  }
  return props.options
    .map((option, order) => ({ option, order, score: tankFuzzyScore(`${option.label} ${option.search || ''}`, needle) }))
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map(entry => entry.option)
})

const optionId = index => `${listId.value}-${index}`
const activeDescendant = computed(() => (open.value && activeIndex.value >= 0 ? optionId(activeIndex.value) : undefined))

function scrollActiveIntoView() {
  nextTick(() => list.value?.querySelector('.is-active')?.scrollIntoView?.({ block: 'nearest' }))
}

function openList() {
  if (props.disabled || open.value) return
  open.value = true
  query.value = ''
  activeIndex.value = Math.max(0, items.value.findIndex(item => item.id === props.modelValue))
  scrollActiveIntoView()
}

function closeList() {
  open.value = false
  query.value = ''
  activeIndex.value = -1
}

function choose(item) {
  closeList()
  if (item.id === props.modelValue) return
  emit('update:modelValue', item.id)
  emit('change', item.id)
}

function onInput(event) {
  query.value = event.target.value
  open.value = true
  activeIndex.value = items.value.length ? 0 : -1
}

function moveActive(step) {
  const count = items.value.length
  if (!count) return
  activeIndex.value = activeIndex.value < 0
    ? (step > 0 ? 0 : count - 1)
    : (activeIndex.value + step + count) % count
  scrollActiveIntoView()
}

function onKeydown(event) {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    if (!open.value) return openList()
    moveActive(event.key === 'ArrowDown' ? 1 : -1)
  } else if (event.key === 'Enter') {
    if (!open.value) return
    event.preventDefault()
    const item = items.value[activeIndex.value]
    if (item) choose(item)
  } else if (event.key === 'Escape') {
    if (!open.value) return
    // 只关闭列表，不让 Esc 冒泡到外层弹窗 / sheet 把它们一并关掉
    event.preventDefault()
    event.stopPropagation()
    closeList()
  } else if (event.key === 'Tab') {
    closeList()
  }
}

function toggleList() {
  if (open.value) closeList()
  else openList()
  input.value?.focus()
}

function clearSelection() {
  choose({ id: null })
  input.value?.focus()
}

function onFocusOut(event) {
  if (!root.value?.contains(event.relatedTarget)) closeList()
}

// 选项集合变化（外层筛选收窄）时高亮项可能越界
watch(() => props.options, () => {
  if (activeIndex.value >= items.value.length) activeIndex.value = items.value.length ? 0 : -1
})
</script>

<template>
  <div ref="root" class="vehicle-picker" :class="{ 'is-open': open }" @focusout="onFocusOut">
    <input
      :id="resolvedInputId"
      ref="input"
      class="vp-input"
      type="text"
      role="combobox"
      autocomplete="off"
      spellcheck="false"
      aria-autocomplete="list"
      :aria-expanded="open"
      :aria-controls="listId"
      :aria-activedescendant="activeDescendant"
      :value="open ? query : displayLabel"
      :placeholder="open ? (displayLabel || t('vehiclePicker.placeholder')) : placeholderText"
      :disabled="disabled"
      :data-value="modelValue ?? ''"
      @click="openList"
      @input="onInput"
      @keydown="onKeydown"
    />
    <span class="vp-actions">
      <button
        v-if="nullLabel && modelValue != null && !disabled"
        type="button"
        class="vp-btn"
        tabindex="-1"
        :aria-label="t('vehiclePicker.clear')"
        :title="t('vehiclePicker.clear')"
        @mousedown.prevent
        @click="clearSelection"
      ><X :size="16" aria-hidden="true" /></button>
      <button
        type="button"
        class="vp-btn"
        tabindex="-1"
        :disabled="disabled"
        :aria-label="t('vehiclePicker.toggle')"
        :aria-expanded="open"
        :aria-controls="listId"
        @mousedown.prevent
        @click="toggleList"
      ><ChevronDown :size="16" aria-hidden="true" /></button>
    </span>
    <ul
      v-show="open"
      :id="listId"
      ref="list"
      class="vp-list"
      role="listbox"
      :aria-label="placeholderText"
    >
      <li
        v-for="(item, index) in items"
        :id="optionId(index)"
        :key="item.id ?? 'all'"
        role="option"
        class="vp-option"
        :class="{ 'is-active': index === activeIndex }"
        :aria-selected="item.id === modelValue"
        :data-id="item.id ?? ''"
        @mousedown.prevent
        @click="choose(item)"
        @pointermove="activeIndex = index"
      >
        <span class="vp-label">{{ item.label }}</span>
        <span v-if="item.hint" class="vp-hint">{{ item.hint }}</span>
      </li>
      <li v-if="!items.length" class="vp-empty" role="presentation">{{ t('vehiclePicker.noResults') }}</li>
    </ul>
  </div>
</template>

<style scoped>
.vehicle-picker { position: relative; min-width: 0; }

.vp-input {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  min-height: var(--control-h-md);
  padding: 0 calc(var(--control-h-sm) * 2 + var(--space-2)) 0 var(--space-3);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  background: var(--color-surface-1);
  color: var(--color-text-primary);
  font: var(--type-body);
  text-overflow: ellipsis;
}

.vp-input::placeholder { color: var(--color-text-tertiary); }
.vp-input:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }
.vp-input:disabled { cursor: not-allowed; opacity: .55; }

.vp-actions {
  position: absolute;
  top: 0;
  right: var(--space-1);
  bottom: 0;
  display: flex;
  align-items: center;
  gap: var(--space-0);
}

.vp-btn {
  display: inline-grid;
  place-items: center;
  min-width: var(--hit-min);
  min-height: var(--hit-min);
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
}

.vp-btn:disabled { cursor: not-allowed; }
.is-open .vp-btn:last-child svg { transform: rotate(180deg); }

@media (hover: hover) {
  .vp-btn:hover:not(:disabled) { background: var(--color-surface-2); color: var(--color-text-primary); }
  .vp-option:hover { background: var(--color-surface-2); }
}

.vp-list {
  position: absolute;
  top: calc(100% + var(--space-1));
  right: 0;
  left: 0;
  z-index: var(--z-menu);
  box-sizing: border-box;
  max-height: min(320px, 50dvh);
  margin: 0;
  padding: var(--space-1);
  overflow-y: auto;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-surface-3);
  box-shadow: var(--elevation-2);
  list-style: none;
}

.vp-option {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-3);
  min-height: var(--row-h);
  padding: var(--space-1) var(--space-3);
  border-inline-start: 3px solid transparent;
  border-radius: var(--radius-sm);
  color: var(--color-text-primary);
  font: var(--type-body);
  align-content: center;
  cursor: pointer;
}

/* activedescendant 模式：焦点留在输入框，高亮项需要可见的焦点指示 */
.vp-option.is-active { background: var(--color-surface-2); outline: var(--focus-outline); outline-offset: calc(var(--focus-outline-offset) * -1); }
.vp-option[aria-selected="true"] { border-inline-start-color: var(--color-accent); }
.vp-option[aria-selected="true"] .vp-label { color: var(--color-accent-text); font-weight: 600; }

.vp-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vp-hint { flex: 0 0 auto; color: var(--color-text-secondary); font: var(--type-caption); font-variant-numeric: tabular-nums; white-space: nowrap; }
.vp-empty { padding: var(--space-3); color: var(--color-text-secondary); font: var(--type-body); }
</style>
