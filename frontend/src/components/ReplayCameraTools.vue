<script setup>
// 镜头挡位 + GLB 车模：宽形态直接陈列在 3D 控制条，紧凑控制条放不下时进 Display 面。
// 两处渲染同一份组件，状态仍归 Replay3DPane 的 store，这里只转发。
import { useI18n } from 'vue-i18n'
import SegmentedControl from './SegmentedControl.vue'

defineOptions({ name: 'ReplayCameraTools' })

defineProps({
  cam: { type: String, required: true },
  cameras: { type: Array, required: true },
  glbOn: Boolean,
  glbAllowed: Boolean,
})

const emit = defineEmits(['update:cam', 'update:glb'])
const { t } = useI18n()
</script>

<template>
  <div class="tool-row" data-testid="replay3d-toolrow" data-tour="replay3d-camera">
    <span class="dim">{{ t('agentReplay.camera') }}</span>
    <SegmentedControl
      class="camera-control"
      data-testid="replay3d-camera"
      :model-value="cam"
      :options="cameras"
      :aria-label="t('agentReplay.camera')"
      @update:model-value="emit('update:cam', $event)"
    />
    <label class="toggle" :title="glbAllowed ? '' : t(glbOn ? 'agentReplay.glb_forced_hint' : 'agentReplay.glb_gate_hint')">
      <input type="checkbox" data-testid="disp-glb" :checked="glbOn" :disabled="!glbAllowed" @change="emit('update:glb', $event.target.checked)"> {{ t('agentReplay.glb') }}
    </label>
  </div>
</template>

<style scoped>
.dim { color: var(--color-text-secondary); font: var(--type-caption); }
.toggle { display: flex; gap: var(--space-1); align-items: center; min-height: var(--hit-min); color: var(--color-text-secondary); cursor: pointer; }
</style>
