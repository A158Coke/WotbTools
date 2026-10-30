<script setup>
import { ArrowUpRight, Circle, Eraser, Eye, EyeOff, MousePointer2, Pencil, Redo2, Route, Slash, Square, Trash2, Type, Undo2, X } from 'lucide-vue-next'
import { computed, nextTick, ref, watch } from 'vue'
import { ANNOT_TANK_CLASSES } from '../utils/annotation.js'
import TankClassIcon from './TankClassIcon.vue'

defineOptions({ name: 'AnnotationToolbar' })
const props = defineProps({
  open: Boolean,
  compact: Boolean,
  /** 能力过滤：null = 既有 2D 全量工具；数组 = 只渲染这些 tool key。 */
  allowedTools: { type: Array, default: null },
  /** 3D 的 eraser visual radius（CSS px）；null = 不渲染第二个滑块。 */
  eraserRadiusSlider: { type: Number, default: null },
  eraserRadiusMin: { type: Number, default: 6 },
  eraserRadiusMax: { type: Number, default: 40 },
  activeTool: { type: String, default: null },
  selectedAnnotation: { type: Object, default: null },
  routePointCount: { type: Number, default: 0 },
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
const emit = defineEmits(['toggle-tool', 'set-annot-color', 'update:annot-width', 'update:eraser-radius', 'undo', 'redo', 'clear-annotations', 'toggle-annotations', 'close', 'rename-selected', 'delete-selected', 'finish-route', 'cancel-route'])
const toolbarEl = ref(null)
// A newly opened context must be reachable even if the user scrolled to a distant tool.
watch([() => props.compact, () => props.activeTool === 'route', () => !!props.selectedAnnotation], async ([compact, route, selected]) => {
  if (!compact || (!route && !selected)) return
  await nextTick()
  if (toolbarEl.value) toolbarEl.value.scrollLeft = 0
})
const tools = [
  { key: 'select', icon: MousePointer2 }, { key: 'route', icon: Route },
  { key: 'pen', icon: Pencil }, { key: 'eraser', icon: Eraser },
  { key: 'arrow', icon: ArrowUpRight }, { key: 'line', icon: Slash },
  { key: 'rect', icon: Square }, { key: 'circle', icon: Circle }, { key: 'text', icon: Type },
]
const allowedToolButtons = computed(() => {
  if (!Array.isArray(props.allowedTools)) return []
  const allowed = new Set(props.allowedTools)
  return tools.filter((tool) => allowed.has(tool.key))
})
// 3D 通过 allowedTools 复用同一个 toolbar；每次只展示当前 tool 相关 slider。
const is3D = computed(() => Array.isArray(props.allowedTools))
</script>

<template>
  <div v-if="props.open" ref="toolbarEl" class="pb-annotation-toolbar" :class="{ 'pb-annot-compact': props.compact }" data-test="pb-annot-toolbar" data-tour="playback-annotation-tools" @pointerdown.stop @click.stop>
    <template v-if="props.allowedTools">
      <div class="pb-annot-tools" role="group" :aria-label="$t('recon.map.playback.annot.drawing')">
        <button v-for="tool in allowedToolButtons" :key="tool.key" type="button" class="pb-annot-btn" :class="{ active: props.activeTool === tool.key }" :aria-pressed="props.activeTool === tool.key" :data-test="'pb-annot-' + tool.key" @click="emit('toggle-tool', tool.key)">
          <component :is="tool.icon" :size="18" aria-hidden="true" />{{ $t('recon.map.playback.annot.' + tool.key) }}
        </button>
        <button type="button" class="pb-annot-btn pb-annot-close" data-test="pb-annot-close" :aria-label="$t('recon.map.playback.annot.exit')" @click="emit('close')"><X :size="18" aria-hidden="true" /><span class="pb-annot-close-label">{{ $t('recon.map.playback.annot.exit') }}</span></button>
      </div>
    </template>
    <template v-else>
      <div class="pb-annot-tools" role="group" :aria-label="$t('recon.map.playback.annot.tools')">
        <button v-for="tool in tools.slice(0, 2)" :key="tool.key" type="button" class="pb-annot-btn" :class="{ active: props.activeTool === tool.key }" :aria-pressed="props.activeTool === tool.key" :data-test="'pb-annot-' + tool.key" @click="emit('toggle-tool', tool.key)">
          <component :is="tool.icon" :size="18" aria-hidden="true" />{{ $t('recon.map.playback.annot.' + tool.key) }}
        </button>
        <button v-for="tank in ANNOT_TANK_CLASSES" :key="tank.key" type="button" class="pb-annot-btn pb-annot-unit-btn" :class="{ active: props.activeTool === tank.key }" :aria-pressed="props.activeTool === tank.key" :data-test="'pb-annot-' + tank.key" @click="emit('toggle-tool', tank.key)">
          <TankClassIcon :tank-class="tank.key" />
          <span>{{ $t('recon.map.playback.annot.' + tank.key) }}<small>{{ tank.key }}</small></span>
        </button>
        <button type="button" class="pb-annot-btn pb-annot-close" data-test="pb-annot-close" :aria-label="$t('recon.map.playback.annot.exit')" @click="emit('close')"><X :size="18" aria-hidden="true" /><span class="pb-annot-close-label">{{ $t('recon.map.playback.annot.exit') }}</span></button>
      </div>
      <div class="pb-annot-tools pb-annot-secondary" role="group" :aria-label="$t('recon.map.playback.annot.drawing')">
        <button v-for="tool in tools.slice(2)" :key="tool.key" type="button" class="pb-annot-btn" :class="{ active: props.activeTool === tool.key }" :aria-pressed="props.activeTool === tool.key" :data-test="'pb-annot-' + tool.key" @click="emit('toggle-tool', tool.key)">
          <component :is="tool.icon" :size="18" aria-hidden="true" />{{ $t('recon.map.playback.annot.' + tool.key) }}
        </button>
      </div>
    </template>
    <div v-if="props.activeTool === 'route'" class="pb-annot-context" data-test="pb-annot-route-context">
      <span role="status">{{ $t('recon.map.playback.annot.route_hint', { count: props.routePointCount }) }}</span>
      <button type="button" class="pb-annot-btn" :disabled="props.routePointCount < 2" data-test="pb-annot-route-finish" @click="emit('finish-route')">{{ $t('recon.map.playback.annot.finish_route') }}</button>
      <button type="button" class="pb-annot-btn" :disabled="!props.routePointCount" data-test="pb-annot-route-cancel" @click="emit('cancel-route')">{{ $t('recon.map.playback.annot.cancel_route') }}</button>
    </div>
    <div v-if="props.selectedAnnotation" class="pb-annot-context" data-test="pb-annot-selection">
      <label v-if="['unit', 'route', 'text'].includes(props.selectedAnnotation.type)" class="pb-annot-name">
        {{ $t('recon.map.playback.annot.name') }}
        <input type="text" maxlength="60" data-test="pb-annot-name" :value="props.selectedAnnotation.text ?? props.selectedAnnotation.label ?? ''" @change="emit('rename-selected', $event.target.value)" />
      </label>
      <span>{{ $t('recon.map.playback.annot.move_hint') }}</span>
      <button type="button" class="pb-annot-btn" data-test="pb-annot-delete" @click="emit('delete-selected')"><Trash2 :size="18" aria-hidden="true" />{{ $t('recon.map.playback.annot.delete') }}</button>
    </div>
    <div class="pb-annot-options">
      <div v-if="!is3D || props.activeTool !== 'eraser'" class="pb-annot-colors" data-test="pb-annot-colors" role="group" :aria-label="$t('recon.map.playback.annot.color')">
        <button v-for="(color, index) in props.annotColors" :key="color" type="button" class="pb-annot-color" :class="{ active: (props.selectedAnnotation?.color || props.annotColor) === color }" :aria-pressed="(props.selectedAnnotation?.color || props.annotColor) === color" :style="{ '--annot-color': color }" :aria-label="$t('recon.map.playback.annot.color_index', { index: index + 1 })" @click="emit('set-annot-color', color)"><span></span></button>
      </div>
      <label v-if="!is3D || props.activeTool !== 'eraser'" class="pb-annot-width" data-test="pb-annot-width">
        {{ $t('recon.map.playback.annot.width') }}
        <input type="range" :min="props.annotWidthMin" :max="props.annotWidthMax" step="1" :value="props.annotWidthSlider" @input="emit('update:annot-width', Number($event.target.value))" />
        <span>{{ props.annotWidthSlider }}</span>
      </label>
      <label v-if="props.eraserRadiusSlider != null && (!is3D || props.activeTool === 'eraser')" class="pb-annot-width">
        {{ $t('recon.map.playback.annot.eraser_radius') }}
        <input type="range" data-test="pb-annot-eraser-radius" :min="props.eraserRadiusMin" :max="props.eraserRadiusMax" step="1" :value="props.eraserRadiusSlider" @input="emit('update:eraser-radius', Number($event.target.value))" />
        <span>{{ props.eraserRadiusSlider }}</span>
      </label>
      <div class="pb-annot-tools">
        <button type="button" class="pb-annot-btn" :disabled="!props.canUndo(props.historyIndex)" data-test="pb-annot-undo" @click="emit('undo')"><Undo2 :size="18" aria-hidden="true" />{{ $t('recon.map.playback.annot.undo') }}</button>
        <button type="button" class="pb-annot-btn" :disabled="!props.canRedo(props.history, props.historyIndex)" data-test="pb-annot-redo" @click="emit('redo')"><Redo2 :size="18" aria-hidden="true" />{{ $t('recon.map.playback.annot.redo') }}</button>
        <button type="button" class="pb-annot-btn" :disabled="!props.history[props.historyIndex]?.length" data-test="pb-annot-clear" @click="emit('clear-annotations')"><Trash2 :size="18" aria-hidden="true" />{{ $t('recon.map.playback.annot.clear') }}</button>
        <button type="button" class="pb-annot-btn" data-test="pb-annot-toggle" :aria-pressed="props.annotVisible" @click="emit('toggle-annotations')"><component :is="props.annotVisible ? Eye : EyeOff" :size="18" aria-hidden="true" />{{ $t(props.annotVisible ? 'recon.map.playback.annot.hide' : 'recon.map.playback.annot.show') }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pb-annotation-toolbar { display: grid; gap: var(--space-2); padding: var(--space-3); border: 1px solid var(--color-border-subtle); border-radius: var(--radius-lg); background: var(--color-surface-1); color: var(--color-text-primary); font: var(--type-caption); }
.pb-annot-tools, .pb-annot-options, .pb-annot-colors, .pb-annot-context { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-1); min-width: 0; }
.pb-annot-options, .pb-annot-context { gap: var(--space-2); }
.pb-annot-secondary { border-bottom: 1px solid var(--color-border-subtle); padding-bottom: var(--space-2); }
.pb-annot-btn { display: inline-flex; align-items: center; justify-content: center; gap: var(--space-1); min-height: var(--control-h-md); padding: var(--space-1) var(--space-2); border: 1px solid var(--color-border-subtle); border-radius: var(--radius-md); background: var(--color-surface-1); color: var(--color-text-secondary); font: var(--type-caption); cursor: pointer; }
.pb-annot-btn:hover { background: var(--color-surface-2); color: var(--color-text-primary); }
.pb-annot-btn.active { border-color: var(--color-accent); background: var(--color-accent); color: var(--color-on-accent); }
.pb-annot-btn:disabled { opacity: .45; cursor: default; }
.pb-annot-btn svg { flex-shrink: 0; }
.pb-annot-unit-btn span { display: flex; flex-wrap: wrap; gap: var(--space-1); }
.pb-annot-unit-btn small { font: inherit; opacity: .8; }
.pb-annot-close { margin-inline-start: auto; }
.pb-annot-color { display: grid; place-items: center; padding: var(--space-1); width: var(--control-h-md); height: var(--control-h-md); background: var(--color-surface-1); border: 1px solid transparent; border-radius: var(--radius-md); cursor: pointer; }
.pb-annot-color span { width: var(--space-4); height: var(--space-4); border: 1px solid var(--color-border-strong); border-radius: var(--radius-full); background: var(--annot-color); }
.pb-annot-color.active { border-color: var(--color-accent); background: var(--color-surface-2); }
.pb-annot-width, .pb-annot-name { display: inline-flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); color: var(--color-text-secondary); }
.pb-annot-width input { width: calc(var(--space-10) * 2); min-height: var(--control-h-md); accent-color: var(--color-accent); }
.pb-annot-name input { min-width: 0; width: calc(var(--space-10) * 4); max-width: 100%; min-height: var(--control-h-md); padding: var(--space-1) var(--space-2); border: 1px solid var(--color-border-strong); border-radius: var(--radius-md); background: var(--color-surface-2); color: var(--color-text-primary); font: var(--type-body); }
.pb-annot-context { padding: var(--space-2); border-radius: var(--radius-md); background: var(--color-surface-2); }
.pb-annot-context > span { color: var(--color-text-secondary); }
.pb-annotation-toolbar :focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }
/* Phone landscape shares the existing measured workspace budget. Keep one control row;
   horizontal scrolling reveals tools without reducing the battlefield to a sliver. */
.pb-annotation-toolbar.pb-annot-compact { display: flex; align-items: center; flex-wrap: nowrap; gap: var(--space-1); padding: var(--space-1); max-inline-size: 100%; overflow-x: auto; overscroll-behavior-inline: contain; scroll-padding-inline-start: calc(var(--control-h-md) + var(--space-2)); }
.pb-annot-compact > .pb-annot-tools:first-child, .pb-annot-compact > .pb-annot-options { display: contents; }
.pb-annot-compact .pb-annot-tools, .pb-annot-compact .pb-annot-colors, .pb-annot-compact .pb-annot-context, .pb-annot-compact .pb-annot-width, .pb-annot-compact .pb-annot-name, .pb-annot-compact .pb-annot-unit-btn span { flex-wrap: nowrap; flex-shrink: 0; }
.pb-annot-compact .pb-annot-btn { flex-shrink: 0; white-space: nowrap; }
.pb-annot-compact .pb-annot-secondary { border: 0; padding: 0; }
.pb-annot-compact .pb-annot-context { order: -1; padding: 0; }
.pb-annot-compact .pb-annot-context > span, .pb-annot-compact .pb-annot-close-label { display: none; }
.pb-annot-compact .pb-annot-close { position: sticky; inset-inline-start: 0; order: -2; z-index: var(--pb-z-hud); min-inline-size: var(--control-h-md); margin-inline-start: 0; }
@media (width < 768px) {
  .pb-annotation-toolbar:not(.pb-annot-compact) { padding: var(--space-2); }
  .pb-annot-btn, .pb-annot-color { min-height: var(--control-h-md); }
  .pb-annot-color { width: var(--control-h-md); }
}
</style>
