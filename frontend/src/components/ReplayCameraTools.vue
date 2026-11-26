<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import SegmentedControl from './SegmentedControl.vue'

defineOptions({ name: 'ReplayCameraTools' })

const props = defineProps({
  cam: { type: String, required: true },
  cameras: { type: Array, required: true },
  glbOn: Boolean,
  glbAllowed: Boolean,
  hint: { type: String, default: '' },
})

const emit = defineEmits(['update:cam', 'update:glb'])
const { t } = useI18n()

const mode = computed(() => (props.cam === 'follow' ? 'free' : props.cam))
function reselect(value) {
  if (props.cam === 'follow' && value === 'free') emit('update:cam', 'free')
}
</script>

<template>
  <div class="tool-row" data-testid="replay3d-toolrow" data-tour="replay3d-camera">
    <span class="dim">{{ t('agentReplay.camera') }}</span>
    <SegmentedControl
      class="camera-control"
      data-testid="replay3d-camera"
      :model-value="mode"
      :options="cameras"
      :aria-label="t('agentReplay.camera')"
      @update:model-value="emit('update:cam', $event)"
      @reselect="reselect"
    />
    <button type="button" class="top-view" data-testid="replay3d-top-view" @click="emit('update:cam', 'top-view')">
      {{ t('agentReplay.cam_top') }}
    </button>
    <span v-if="hint" class="dim" data-testid="replay3d-camera-hint">{{ hint }}</span>
    <label class="toggle" :title="glbAllowed ? '' : t(glbOn ? 'agentReplay.glb_forced_hint' : 'agentReplay.glb_gate_hint')">
      <input type="checkbox" data-testid="disp-glb" :checked="glbOn" :disabled="!glbAllowed" @change="emit('update:glb', $event.target.checked)"> {{ t('agentReplay.glb') }}
    </label>
    <slot />
  </div>
</template>

<style scoped>
.dim { color: var(--color-text-secondary); font: var(--type-caption); }
.top-view {
  min-height: var(--control-h-sm);
  padding: 0 var(--space-2);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-sm);
  background: var(--color-surface-2);
  color: var(--color-text-secondary);
  font: var(--type-caption);
  font-weight: 600;
  cursor: pointer;
}
.top-view:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }
@media (hover: hover) {
  .top-view:hover { color: var(--color-text-primary); }
}
@media (pointer: coarse) {
  .top-view { min-height: var(--hit-min); min-width: var(--hit-min); }
}
@media (pointer: coarse) and (orientation: landscape) and (height <= 520px) {
  .top-view { min-height: var(--hit-min-comfortable); min-width: var(--hit-min-comfortable); }
}
.toggle { display: flex; gap: var(--space-1); align-items: center; min-height: var(--hit-min); color: var(--color-text-secondary); cursor: pointer; }
</style>
