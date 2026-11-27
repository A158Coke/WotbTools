<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown, X } from 'lucide-vue-next'

type Option = { value: string; label: string }
const props = defineProps<{
  modelValue: string
  options: Option[]
  inputId: string
  label: string
  emptyLabel?: string
  disabled?: boolean
  inline?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const { t, locale } = useI18n()
const input = ref<HTMLInputElement | null>(null)
const list = ref<HTMLUListElement | null>(null)
const open = ref(false)
const query = ref('')
const highlighted = ref<string>()
const items = computed(() => {
  const needle = query.value.trim().toLocaleLowerCase(locale.value)
  if (needle) return props.options.filter(({ value, label }) =>
    [value, label].some(text => text.toLocaleLowerCase(locale.value).includes(needle)))
  return props.emptyLabel ? [{ value: '', label: props.emptyLabel }, ...props.options] : props.options
})
const selectedLabel = computed(() => props.modelValue
  ? props.options.find(option => option.value === props.modelValue)?.label ?? props.modelValue
  : props.emptyLabel ?? '')
const activeIndex = computed(() => {
  if (!items.value.length) return -1
  return Math.max(0, items.value.findIndex(item => item.value === highlighted.value))
})
const listId = computed(() => props.inputId + '-list')
function optionId(index: number) { return listId.value + '-' + index }
function scrollToActive() {
  nextTick(() => list.value?.children[activeIndex.value]?.scrollIntoView?.({ block: 'nearest' }))
}
function openList() {
  if (props.disabled || open.value) return
  query.value = ''
  highlighted.value = props.modelValue
  open.value = true
  scrollToActive()
}
function closeList() { open.value = false }
function choose(value: string) {
  if (value !== props.modelValue) emit('update:modelValue', value)
  closeList()
  input.value?.focus({ preventScroll: true })
}
function search(event: Event) {
  query.value = (event.target as HTMLInputElement).value
  highlighted.value = undefined
  open.value = true
  if (list.value) list.value.scrollTop = 0
}
function onKeydown(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229) return
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    if (!open.value) return openList()
    const count = items.value.length
    if (!count) return
    const step = event.key === 'ArrowDown' ? 1 : -1
    highlighted.value = items.value[(activeIndex.value + step + count) % count].value
    scrollToActive()
  } else if (event.key === 'Enter' && open.value) {
    event.preventDefault()
    const active = items.value[activeIndex.value]
    if (active) choose(active.value)
  } else if (event.key === 'Escape' && open.value) {
    event.preventDefault()
    event.stopPropagation()
    closeList()
  } else if (event.key === 'Tab') closeList()
}
function onFocusOut(event: FocusEvent) {
  if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) closeList()
}
function toggle() {
  if (open.value) closeList()
  else openList()
  input.value?.focus({ preventScroll: true })
}
watch(() => props.disabled, disabled => { if (disabled) closeList() })
</script>

<template>
  <div class="searchable-select" :class="{ 'is-inline': inline }" @focusout="onFocusOut">
    <div class="select-field">
      <input
        :id="inputId" ref="input" type="text" role="combobox" autocomplete="off" spellcheck="false"
        aria-autocomplete="list" :aria-label="label" :aria-expanded="open" :aria-controls="open ? listId : undefined"
        :aria-activedescendant="open && activeIndex >= 0 ? optionId(activeIndex) : undefined"
        :data-testid="inputId" :data-value="modelValue" :disabled="disabled" :value="open ? query : selectedLabel"
        :placeholder="open ? t('searchableSelect.search') : label" @focus="input?.select()" @click="openList"
        @input="search" @keydown="onKeydown"
      />
      <button v-if="emptyLabel && modelValue" type="button" tabindex="-1" :disabled="disabled"
        :aria-label="t('searchableSelect.clear', { label })" @mousedown.prevent @click="choose('')">
        <X :size="16" aria-hidden="true" />
      </button>
      <button type="button" tabindex="-1" :disabled="disabled" :aria-expanded="open"
        :aria-label="t('searchableSelect.toggle', { label })" @mousedown.prevent @click="toggle">
        <ChevronDown :size="16" aria-hidden="true" />
      </button>
    </div>
    <div v-if="open" class="select-panel">
      <ul :id="listId" ref="list" role="listbox" :aria-label="label">
        <li v-for="(option, index) in items" :id="optionId(index)" :key="option.value" role="option"
          :aria-selected="modelValue === option.value" :data-value="option.value"
          :class="{ 'is-active': index === activeIndex }" @mousedown.prevent @click="choose(option.value)">
          {{ option.label }}
        </li>
      </ul>
      <p v-if="!items.length" role="status">{{ t('searchableSelect.noResults') }}</p>
    </div>
  </div>
</template>

<style scoped>
.searchable-select { position: relative; min-inline-size: 0; max-inline-size: 100%; }
.select-field { display: flex; border: var(--border-width) solid var(--color-border-strong); border-radius: var(--radius-md); background: var(--color-surface-1); }
.select-field:focus-within { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }
.select-field input { flex: 1; min-inline-size: 0; min-block-size: var(--control-h-md); padding-inline: var(--space-3) 0; border: 0; background: transparent; color: var(--color-text-primary); font: var(--type-body); outline: none; text-overflow: ellipsis; }
.select-field button { display: grid; place-items: center; min-inline-size: var(--hit-min); min-block-size: var(--control-h-md); padding: 0; border: 0; background: transparent; color: var(--color-text-secondary); cursor: pointer; }
.select-field :disabled { color: var(--color-text-tertiary); cursor: not-allowed; }
.select-panel { position: absolute; inset-block-start: 100%; inset-inline: 0; z-index: var(--z-menu); margin-block-start: var(--space-1); padding: var(--space-1); border: var(--border-width) solid var(--color-border-strong); border-radius: var(--radius-md); background: var(--color-surface-3); box-shadow: var(--elevation-2); color: var(--color-text-primary); font: var(--type-body); }
.is-inline .select-panel { position: static; }
.select-panel ul { max-block-size: min(40dvh, calc(var(--hit-min) * 6)); margin: 0; padding: 0; overflow-y: auto; overscroll-behavior: contain; list-style: none; }
.select-panel li { display: flex; align-items: center; min-block-size: var(--hit-min); padding-inline: var(--space-3); border-inline-start: var(--space-1) solid transparent; overflow-wrap: anywhere; cursor: pointer; }
.select-panel li.is-active { outline: var(--focus-outline); outline-offset: calc(-1 * var(--focus-outline-offset)); }
.select-panel li[aria-selected="true"] { border-color: var(--color-accent); color: var(--color-accent-text); }
.select-panel p { margin: var(--space-2); }
@media (hover: hover) { .select-panel li:hover, .select-field button:hover:enabled { background: var(--color-surface-2); } }
@media (pointer: coarse) { .select-field input, .select-field button { min-block-size: var(--hit-min); } }
</style>
