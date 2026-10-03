<script setup>
// 回放工作台的能力切换：把「数据 / 2D 回放 / 3D 回放 / 射击分析 / AI 复盘」呈现为
// 同一内容区域的模式分档（design-language §7：SegmentedControl 的形态）。
// 视觉 primitive 与 SegmentedControl 同一套语义 token，不再维护 Replay 专属 tab CSS；
// 窄屏允许水平滚动，键盘走完整的 WAI-ARIA tab 模式：方向键移动并激活、Home / End 跳首尾。
defineOptions({ name: 'ReplayCapabilityTabs' })

const props = defineProps({
  options: { type: Array, default: () => [] }, // [{ key, labelKey }]
  activeCapability: { type: String, default: 'data' },
})

const emit = defineEmits(['select'])

function onKeydown(event) {
  const keys = props.options.map(option => option.key)
  const index = keys.indexOf(props.activeCapability)
  const next = {
    ArrowRight: keys[(index + 1) % keys.length],
    ArrowLeft: keys[(index - 1 + keys.length) % keys.length],
    Home: keys[0],
    End: keys[keys.length - 1],
  }[event.key]
  if (!next) return
  event.preventDefault()
  emit('select', next)
  event.currentTarget.querySelector(`[data-cap="${next}"]`)?.focus()
}
</script>

<template>
  <div class="capability-selector" role="tablist" :aria-label="$t('workspace.title')" @keydown="onKeydown">
    <button
      v-for="option in options"
      :key="option.key"
      role="tab"
      type="button"
      class="capability-option"
      :class="{ 'is-active': activeCapability === option.key }"
      :aria-selected="activeCapability === option.key"
      :tabindex="activeCapability === option.key ? 0 : -1"
      data-testid="ws-tab"
      :data-cap="option.key"
      @click="emit('select', option.key)"
    >
      {{ $t(option.labelKey) }}
    </button>
  </div>
</template>

<style scoped>
.capability-selector {
  display: flex;
  gap: var(--space-1);
  max-width: 100%;
  margin-bottom: var(--space-4);
  padding: var(--space-1);
  overflow-x: auto;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-surface-2);
  scrollbar-width: none;
}

.capability-selector::-webkit-scrollbar { display: none; }

.capability-option {
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

.capability-option.is-active {
  background: var(--color-surface-1);
  box-shadow: var(--elevation-1);
  color: var(--color-text-primary);
  font-weight: 600;
}

.capability-option:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }

@media (hover: hover) {
  .capability-option:not(.is-active):hover { color: var(--color-text-primary); }
}

/* 触屏：点击区域抬到 --hit-min（44px），布局不动（design-language §5/§6） */
@media (pointer: coarse) {
  .capability-option { min-height: var(--hit-min); padding: 0 var(--space-4); }
}
</style>
