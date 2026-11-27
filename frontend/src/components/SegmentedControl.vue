<script setup>
import { useId } from 'vue'
import { RadioGroupItem, RadioGroupRoot } from 'reka-ui'
import { Motion } from 'motion-v'
import { motionTransition } from '../shared/motion/motionPolicy'
import { haptic } from '../composables/useHaptics.js'

const props = defineProps({
  modelValue: { type: String, required: true },
  options: { type: Array, required: true },
  ariaLabel: { type: String, required: true },
  scrollable: { type: Boolean, default: false },
  wrap: { type: Boolean, default: false },
  presentation: { type: String, default: 'segmented', validator: v => ['segmented', 'chips', 'tiles'].includes(v) },
})
const emit = defineEmits(['update:modelValue', 'reselect'])

const indicatorId = `segmented-indicator-${useId()}`

function select(value) {
  if (value === props.modelValue) return
  emit('update:modelValue', value)
  void haptic('selection')
}
function onOptionClick(value) {
  if (value === props.modelValue) emit('reselect', value)
}

const NAVIGATION_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']
let navigating = false
function markNavigation(event) {
  if (!NAVIGATION_KEYS.includes(event.key)) return
  navigating = true
  setTimeout(() => { navigating = false }, 0)
}
function selectOnNavigationFocus(value) {
  if (navigating) select(value)
}

function onKeydown(event) {
  const enabled = props.options.filter((option) => !option.disabled)
  const target = { Home: enabled[0], End: enabled[enabled.length - 1] }[event.key]
  if (!target) return
  event.preventDefault()
  select(target.value)
  event.currentTarget.querySelector(`[data-value="${CSS.escape(target.value)}"]`)?.focus()
}
</script>

<template>
  <RadioGroupRoot
    class="segmented"
    :class="[`is-${presentation}`, {
      'is-scrollable': scrollable && !wrap && presentation === 'segmented',
      'is-wrapping': wrap || presentation === 'chips',
    }]"
    :model-value="modelValue"
    :aria-label="ariaLabel"
    :required="false"
    @update:model-value="select"
    @keydown.capture="markNavigation"
    @keydown="onKeydown"
  >
    <RadioGroupItem
      v-for="(option, index) in options"
      :key="option.value"
      as="button"
      :value="option.value"
      class="segmented-option"
      :class="{ 'is-active': option.value === modelValue }"
      :data-value="option.value"
      :data-testid="option.testid"
      :disabled="option.disabled"
      :title="option.title"
      v-bind="option.data"
      @focus="selectOnNavigationFocus(option.value)"
      @click="onOptionClick(option.value)"
    >
      <Motion
        v-if="option.value === modelValue"
        tag="span"
        class="segmented-indicator"
        :layout-id="indicatorId"
        :transition="motionTransition('base')"
        aria-hidden="true"
      />
      <span class="segmented-label"><slot name="option" :option="option" :index="index" :selected="option.value === modelValue">{{ option.label }}</slot></span>
    </RadioGroupItem>
  </RadioGroupRoot>
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

.segmented.is-scrollable {
  display: flex;
  max-width: 100%;
  overflow-x: auto;
  scrollbar-width: none;
}

.segmented.is-scrollable::-webkit-scrollbar { display: none; }

.segmented.is-wrapping {
  display: flex;
  flex-wrap: wrap;
  max-width: 100%;
}

.segmented.is-chips {
  gap: var(--space-2);
  padding: 0;
  border: 0;
  background: transparent;
}

.segmented.is-tiles {
  display: grid;
  grid-auto-columns: minmax(0, 1fr);
  grid-auto-flow: column;
  width: 100%;
}

.segmented-option {
  position: relative;
  flex: none;
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
  color: var(--color-text-primary);
  font-weight: 600;
}

.segmented-indicator {
  position: absolute;
  inset: 0;
  border-radius: var(--radius-sm);
  background: var(--color-surface-1);
  box-shadow: var(--elevation-1);
}

.segmented.is-chips .segmented-option {
  min-height: var(--control-h-md);
  border: var(--border-width) solid var(--color-border-subtle);
  border-radius: var(--radius-full);
  corner-shape: round;
}

.segmented.is-chips .segmented-option.is-active { border-color: var(--color-accent); }

.segmented.is-chips .segmented-indicator {
  border-radius: var(--radius-full);
  corner-shape: round;
  background: var(--color-surface-3);
  box-shadow: none;
}

.segmented.is-tiles .segmented-option {
  min-height: var(--control-h-lg);
  padding: var(--space-2);
  white-space: normal;
  overflow-wrap: anywhere;
}

.segmented-label { position: relative; }

.segmented-option:disabled { opacity: .5; cursor: not-allowed; }
.segmented-option:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }

.segmented.is-wrapping .segmented-option {
  flex-shrink: 1;
  max-width: 100%;
  white-space: normal;
  overflow-wrap: anywhere;
}

@media (width < 768px) {
  .segmented.is-wrapping .segmented-option {
    flex-grow: 1;
    padding: var(--space-2) var(--space-3);
  }
}

@media (hover: hover) {
  .segmented-option:not(.is-active):hover { color: var(--color-text-primary); }
}

@media (pointer: coarse) {
  .segmented-option { min-height: var(--hit-min); min-width: var(--hit-min); }
}
</style>
