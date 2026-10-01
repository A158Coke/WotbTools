<script setup>
// 同一内容的呈现方式切换（design-language §7）：单选组，方向键在选项间移动并选中。
const props = defineProps({
  modelValue: { type: String, required: true },
  options: { type: Array, required: true }, // [{ value, label, testid? }]
  ariaLabel: { type: String, required: true },
})
const emit = defineEmits(['update:modelValue'])

function select(value) {
  if (value !== props.modelValue) emit('update:modelValue', value)
}

function onKeydown(event) {
  const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key]
  if (!step) return
  event.preventDefault()
  const index = props.options.findIndex(option => option.value === props.modelValue)
  const next = props.options[(index + step + props.options.length) % props.options.length]
  select(next.value)
  event.currentTarget.querySelector(`[data-value="${CSS.escape(next.value)}"]`)?.focus()
}
</script>

<template>
  <div class="segmented" role="radiogroup" :aria-label="ariaLabel" @keydown="onKeydown">
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      role="radio"
      class="segmented-option"
      :class="{ 'is-active': option.value === modelValue }"
      :aria-checked="option.value === modelValue"
      :tabindex="option.value === modelValue ? 0 : -1"
      :data-value="option.value"
      :data-testid="option.testid"
      @click="select(option.value)"
    >{{ option.label }}</button>
  </div>
</template>

<style scoped>
.segmented {
  display: inline-flex;
  gap: var(--space-1);
  padding: var(--space-1);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-surface-2);
}

.segmented-option {
  flex: 1 1 0;
  min-height: var(--control-h-sm);
  padding: 0 var(--space-3);
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-secondary);
  font: var(--type-body);
  white-space: nowrap;
  cursor: pointer;
}

.segmented-option.is-active {
  background: var(--color-surface-1);
  box-shadow: var(--elevation-1);
  color: var(--color-text-primary);
  font-weight: 600;
}

.segmented-option:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }

@media (hover: hover) {
  .segmented-option:not(.is-active):hover { color: var(--color-text-primary); }
}
</style>
