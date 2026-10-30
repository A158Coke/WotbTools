<script setup>
// 镜头模式 + 俯视 + GLB 车模：宽形态直接陈列在 3D 控制条，紧凑控制条放不下时进 Display 面。
// 两处渲染同一份组件，状态仍归 Replay3DPane 的 store，这里只转发。
// 默认插槽放同一行的 3D 工具入口：它们用父组件的样式。
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import SegmentedControl from './SegmentedControl.vue'

defineOptions({ name: 'ReplayCameraTools' })

const props = defineProps({
  cam: { type: String, required: true },
  cameras: { type: Array, required: true },
  glbOn: Boolean,
  glbAllowed: Boolean,
  /** 触屏看不到 title：Display 面里把录像者不可用的原因写出来。 */
  hint: { type: String, default: '' },
})

const emit = defineEmits(['update:cam', 'update:glb'])
const { t } = useI18n()

// 跟随是自由视角的子状态，不是模式：radio 仍选中「自由」，再点一次退出跟随。
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
    <!-- 俯视是一次性动作，不是相机模式，所以不进 radio 组。 -->
    <button type="button" class="top-view" data-testid="replay3d-top-view" @click="emit('update:cam', 'top')">
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
.toggle { display: flex; gap: var(--space-1); align-items: center; min-height: var(--hit-min); color: var(--color-text-secondary); cursor: pointer; }
</style>
