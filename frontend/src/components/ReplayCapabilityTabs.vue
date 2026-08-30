<script setup>
defineOptions({ name: 'ReplayCapabilityTabs' })

defineProps({
  options: { type: Array, default: () => [] },
  activeCapability: { type: String, default: 'data' },
})

const emit = defineEmits(['select'])
</script>

<template>
  <nav class="workspace-tabs" role="tablist" aria-label="Replay capabilities">
    <button
      v-for="option in options"
      :key="option.key"
      role="tab"
      type="button"
      :class="{ active: activeCapability === option.key }"
      :aria-selected="activeCapability === option.key"
      data-testid="ws-tab"
      :data-cap="option.key"
      @click="emit('select', option.key)"
    >
      {{ $t(option.labelKey) }}
    </button>
  </nav>
</template>

<style scoped>
.workspace-tabs {
  display: flex;
  gap: 4px;
  margin: 10px 0 14px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 9px;
  padding: 3px;
  overflow-x: auto;
  scrollbar-width: none;
}
.workspace-tabs::-webkit-scrollbar { display: none; }
.workspace-tabs button {
  flex: 0 0 auto;
  padding: 8px 16px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--text-label);
  cursor: pointer;
  font-size: .88rem;
  font-family: inherit;
  font-weight: 600;
  white-space: nowrap;
}
.workspace-tabs button.active { background: color-mix(in srgb, var(--accent) 16%, var(--bg-card)); color: var(--accent-dark); font-weight: 700; }
.workspace-tabs button:hover:not(.active) { color: var(--text-label); }
</style>
