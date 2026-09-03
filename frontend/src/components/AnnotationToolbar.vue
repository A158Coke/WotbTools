<script setup>
defineOptions({ name: 'AnnotationToolbar' })

const props = defineProps({
  open: Boolean,
  activeTool: { type: String, default: null },
  annotColors: { type: Array, default: () => [] },
  annotColor: { type: String, default: '' },
  annotVisible: Boolean,
  annotWidthSlider: { type: Number, default: 1 },
  annotWidthMin: { type: Number, default: 1 },
  annotWidthMax: { type: Number, default: 10 },
  historyIndex: { type: Number, default: 0 },
  history: { type: Array, default: () => [] },
  canUndo: { type: Function, required: true },
  canRedo: { type: Function, required: true },
})
const emit = defineEmits(['toggle-tool', 'set-annot-color', 'update:annot-width', 'undo', 'redo', 'clear-annotations', 'toggle-annotations', 'close'])
</script>

<template>
  <div v-if="props.open" class="pb-annotation-toolbar" data-test="pb-annot-toolbar" @pointerdown.stop @click.stop>
    <button type="button" class="pb-annot-close" data-test="pb-annot-close" :aria-label="$t('recon.map.playback.close')" @click="emit('close')">×</button>
    <button
      v-for="tool in ['pen', 'eraser', 'arrow', 'line', 'rect', 'circle', 'text']"
      :key="tool"
      type="button"
      class="pb-annot-btn"
      :class="{ active: props.activeTool === tool }"
      :data-test="'pb-annot-' + tool"
      @click="emit('toggle-tool', tool)"
    >{{ $t('recon.map.playback.annot.' + tool) }}</button>
    <span class="pb-annot-sep" aria-hidden="true"></span>
    <button
      v-for="color in props.annotColors"
      :key="color"
      type="button"
      class="pb-annot-color"
      :class="{ active: props.annotColor === color }"
      :style="{ background: color }"
      :aria-label="$t('recon.map.playback.annot.color')"
      @click="emit('set-annot-color', color)"
    ></button>
    <label class="pb-annot-width">
      {{ $t('recon.map.playback.annot.width') }}
      <input type="range" :min="props.annotWidthMin" :max="props.annotWidthMax" step="1" :value="props.annotWidthSlider" @input="emit('update:annot-width', Number($event.target.value))" />
      <span>{{ props.annotWidthSlider }}</span>
    </label>
    <button type="button" class="pb-annot-btn" :disabled="!props.canUndo(props.historyIndex)" data-test="pb-annot-undo" @click="emit('undo')">{{ $t('recon.map.playback.annot.undo') }}</button>
    <button type="button" class="pb-annot-btn" :disabled="!props.canRedo(props.history, props.historyIndex)" data-test="pb-annot-redo" @click="emit('redo')">{{ $t('recon.map.playback.annot.redo') }}</button>
    <button type="button" class="pb-annot-btn" data-test="pb-annot-clear" @click="emit('clear-annotations')">{{ $t('recon.map.playback.annot.clear') }}</button>
    <button type="button" class="pb-annot-btn" data-test="pb-annot-toggle" @click="emit('toggle-annotations')">{{ $t(props.annotVisible ? 'recon.map.playback.annot.hide' : 'recon.map.playback.annot.show') }}</button>
  </div>
</template>

<style scoped>
.pb-annotation-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; padding: 6px; border: 1px solid var(--border); border-radius: 7px; background: var(--bg-card2); box-shadow: var(--surface-shadow); }
.pb-annot-btn, .pb-annot-close { min-height: 30px; border: 1px solid var(--border-ghost); border-radius: 4px; background: var(--bg-card2); color: var(--text-label); cursor: pointer; font: inherit; font-size: .76rem; padding: 2px 7px; }
.pb-annot-btn.active { border-color: var(--accent); background: var(--accent); color: var(--bg); }
.pb-annot-btn:disabled { opacity: .45; cursor: default; }
.pb-annot-close { min-width: 30px; padding: 0; font-size: 1.1rem; }
.pb-annot-color { width: 22px; height: 22px; border: 2px solid transparent; border-radius: 50%; cursor: pointer; padding: 0; }
.pb-annot-color.active { border-color: var(--text); box-shadow: 0 0 0 1px var(--bg); }
.pb-annot-width { display: inline-flex; align-items: center; gap: 4px; color: var(--text-label); font-size: .76rem; }
.pb-annot-width input { width: 76px; }
.pb-annot-sep { width: 1px; height: 18px; background: var(--border); }
@media (width < 768px) {
  .pb-annotation-toolbar { max-height: min(45dvh, 320px); overflow: auto; }
  .pb-annot-btn, .pb-annot-close { min-height: 36px; }
  .pb-annot-color { width: 26px; height: 26px; }
}
</style>
