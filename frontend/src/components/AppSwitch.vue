<script setup lang="ts">
// 开关（design-language §7.1 DC-SEL-06：只用于立即生效的布尔设置）：role=switch，44px 命中区，
// 标签在左、轨道在右；切换给一次「选择」触感。
import { haptic } from '../composables/useHaptics.js'

defineProps<{ modelValue: boolean, label: string, description?: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

function toggle(current: boolean) {
  emit('update:modelValue', !current)
  void haptic('selection')
}
</script>

<template>
  <button type="button" role="switch" class="app-switch" :aria-checked="modelValue ? 'true' : 'false'" @click="toggle(modelValue)">
    <span class="app-switch-text">
      <span class="app-switch-label">{{ label }}</span>
      <span v-if="description" class="app-switch-description">{{ description }}</span>
    </span>
    <span class="app-switch-track" aria-hidden="true"><span class="app-switch-thumb" /></span>
  </button>
</template>

<style scoped>
.app-switch {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  inline-size: 100%;
  min-block-size: var(--hit-min-comfortable);
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--color-text-primary);
  font: var(--type-body);
  text-align: start;
  cursor: pointer;
}
.app-switch-text { display: grid; gap: var(--space-1); min-inline-size: 0; }
.app-switch-label { font-weight: 600; }
.app-switch-description { color: var(--color-text-secondary); font: var(--type-caption); }
.app-switch-track {
  position: relative;
  flex: none;
  inline-size: calc(var(--space-10) + var(--space-1));
  block-size: var(--space-6);
  border: var(--border-width) solid var(--color-border-strong);
  border-radius: var(--radius-full);
  background: var(--color-surface-3);
  transition: background-color var(--duration-fast) var(--ease-standard);
}
.app-switch-thumb {
  position: absolute;
  inset-block-start: 50%;
  inset-inline-start: var(--space-1);
  inline-size: var(--space-4);
  block-size: var(--space-4);
  border-radius: var(--radius-full);
  background: var(--color-text-secondary);
  transform: translateY(-50%);
  transition: inset-inline-start var(--duration-fast) var(--ease-standard);
}
.app-switch[aria-checked="true"] .app-switch-track { border-color: var(--color-accent); background: var(--color-accent); }
.app-switch[aria-checked="true"] .app-switch-thumb { inset-inline-start: calc(100% - var(--space-4) - var(--space-1)); background: var(--color-on-accent); }
.app-switch:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }
</style>
