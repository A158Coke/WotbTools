<script setup>
// 回放工作台的模式切换（design-language §7 Tabs：切换内容区域）。
// WAI-ARIA tablist：方向键在模式间移动并激活，Home / End 跳到首尾。
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
  <div class="workspace-tabs" role="tablist" :aria-label="$t('workspace.title')" @keydown="onKeydown">
    <button
      v-for="option in options"
      :key="option.key"
      role="tab"
      type="button"
      class="workspace-tab"
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
.workspace-tabs {
  display: flex;
  gap: var(--space-1);
  margin-bottom: var(--space-4);
  overflow-x: auto;
  border-bottom: 1px solid var(--color-border-subtle);
  scrollbar-width: none;
}

.workspace-tabs::-webkit-scrollbar { display: none; }

.workspace-tab {
  flex: none;
  min-height: var(--control-h-lg);
  margin-bottom: -1px;
  padding: 0 var(--space-4);
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--color-text-secondary);
  font: var(--type-body);
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
}

.workspace-tab.is-active { border-bottom-color: var(--color-accent); color: var(--color-text-primary); }
.workspace-tab:focus-visible { outline: var(--focus-outline); outline-offset: calc(var(--focus-outline-offset) * -1); }

@media (hover: hover) {
  .workspace-tab:not(.is-active):hover { color: var(--color-text-primary); }
}
</style>
