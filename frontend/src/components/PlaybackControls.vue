<script setup>
import PlaybackTimeline from './PlaybackTimeline.vue'

defineOptions({ name: 'PlaybackControls' })

const props = defineProps({
  playing: Boolean,
  speed: { type: Number, default: 1 },
  currentTime: { type: Number, default: 0 },
  duration: { type: Number, default: 0 },
  recorderAccountId: { type: [Number, String], default: null },
  showAll: Boolean,
  labelPrefs: { type: Object, required: true },
  hpPrefs: { type: Object, required: true },
  fullscreenSupported: Boolean,
  isFullscreen: Boolean,
  typeFilter: { type: Object, required: true },
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
  eventMarkers: { type: Array, default: () => [] },
  formatClock: { type: Function, required: true },
})

const emit = defineEmits([
  'toggle-play', 'step', 'previous-event', 'next-event', 'toggle-speed', 'reset-view', 'toggle-fullscreen',
  'update:show-all', 'update-label-pref', 'update-hp-pref', 'toggle-type', 'toggle-tool', 'set-annot-color', 'update:annot-width', 'undo', 'redo', 'clear-annotations',
  'toggle-annotations', 'drag-start', 'seek', 'jump',
])
</script>

<template>
  <div class="pb-controls">
    <button type="button" class="pb-btn" data-test="pb-play" @click="emit('toggle-play')">
      {{ $t(props.playing ? 'recon.map.playback.pause' : 'recon.map.playback.play') }}
    </button>
    <button type="button" class="pb-btn" data-test="pb-back5" @click="emit('step', -5)">-5s</button>
    <button type="button" class="pb-btn" data-test="pb-fwd5" @click="emit('step', 5)">+5s</button>
    <button type="button" class="pb-btn" data-test="pb-prev" @click="emit('previous-event')">◀</button>
    <button type="button" class="pb-btn" data-test="pb-next" @click="emit('next-event')">▶</button>
    <button type="button" class="pb-btn" data-test="pb-speed" @click="emit('toggle-speed')">{{ props.speed }}×</button>
    <button type="button" class="pb-btn" data-test="pb-reset" @click="emit('reset-view')">{{ $t('recon.map.playback.reset_view') }}</button>
    <span class="pb-time">{{ props.formatClock(props.currentTime) }} / {{ props.formatClock(props.duration) }}</span>
    <span v-if="props.recorderAccountId != null" class="pb-filter">
      <label class="pb-check">
        <input type="checkbox" :checked="props.showAll" data-test="pb-all-events" @change="emit('update:show-all', $event.target.checked)" />
        {{ $t('recon.map.playback.all_events') }}
      </label>
    </span>
    <span class="pb-filter">
      <label class="pb-check">
        <input type="checkbox" :checked="props.labelPrefs.showPlayerName" data-test="pb-show-player" @change="emit('update-label-pref', 'showPlayerName', $event.target.checked)" />
        {{ $t('recon.map.playback.show_player_name') }}
      </label>
      <label class="pb-check">
        <input type="checkbox" :checked="props.labelPrefs.showTankName" data-test="pb-show-tank" @change="emit('update-label-pref', 'showTankName', $event.target.checked)" />
        {{ $t('recon.map.playback.show_tank_name') }}
      </label>
      <label class="pb-check">
        <input type="checkbox" :checked="props.hpPrefs.showHp" data-test="pb-show-hp" @change="emit('update-hp-pref', 'showHp', $event.target.checked)" />
        {{ $t('recon.map.playback.show_hp') }}
      </label>
    </span>
    <button v-if="props.fullscreenSupported" type="button" class="pb-btn" data-test="pb-fullscreen" @click="emit('toggle-fullscreen')">
      {{ props.isFullscreen ? $t('recon.map.playback.exit_fullscreen') : $t('recon.map.playback.enter_fullscreen') }}
    </button>
  </div>

  <div class="pb-filters">
    <button
      v-for="type in ['DAMAGE', 'DESTROYED', 'KILL', 'POSITION_REPORTED', 'POSITION_STALE']"
      :key="type"
      type="button"
      class="pb-chip"
      :class="{ active: props.typeFilter.has(type) }"
      @click="emit('toggle-type', type)"
    >{{ $t(`recon.map.playback.event_${type}`) }}</button>
  </div>

  <div class="pb-annot-toolbar" data-test="pb-annot-toolbar">
    <button
      v-for="tool in ['pen', 'eraser', 'arrow', 'line', 'rect', 'circle', 'text']"
      :key="tool"
      type="button"
      class="pb-annot-btn"
      :class="{ active: props.activeTool === tool }"
      :data-test="`pb-annot-${tool}`"
      @click="emit('toggle-tool', tool)"
    >{{ $t(`recon.map.playback.annot.${tool}`) }}</button>
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
    <span class="pb-annot-sep" aria-hidden="true"></span>
    <label class="pb-annot-width">
      {{ $t('recon.map.playback.annot.width') }}
      <input type="range" :min="props.annotWidthMin" :max="props.annotWidthMax" step="1" :value="props.annotWidthSlider" @input="emit('update:annot-width', Number($event.target.value))" />
      <span class="pb-annot-width-val">{{ props.annotWidthSlider }}</span>
    </label>
    <span class="pb-annot-sep" aria-hidden="true"></span>
    <button type="button" class="pb-annot-btn" :disabled="!props.canUndo(props.historyIndex)" data-test="pb-annot-undo" @click="emit('undo')">{{ $t('recon.map.playback.annot.undo') }}</button>
    <button type="button" class="pb-annot-btn" :disabled="!props.canRedo(props.history, props.historyIndex)" data-test="pb-annot-redo" @click="emit('redo')">{{ $t('recon.map.playback.annot.redo') }}</button>
    <button type="button" class="pb-annot-btn" data-test="pb-annot-clear" @click="emit('clear-annotations')">{{ $t('recon.map.playback.annot.clear') }}</button>
    <button type="button" class="pb-annot-btn" data-test="pb-annot-toggle" @click="emit('toggle-annotations')">{{ $t(props.annotVisible ? 'recon.map.playback.annot.hide' : 'recon.map.playback.annot.show') }}</button>
  </div>

  <PlaybackTimeline
    :current-time="props.currentTime"
    :duration="props.duration"
    :event-markers="props.eventMarkers"
    :format-clock="props.formatClock"
    @drag-start="emit('drag-start')"
    @seek="emit('seek', $event)"
    @jump="emit('jump', $event)"
  />
</template>

<style scoped>
.pb-controls, .pb-filters { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.pb-btn, .pb-chip {
  border: 1px solid var(--border-ghost);
  background: var(--bg-card2);
  color: var(--text-label);
  border-radius: 4px;
  padding: 2px 8px;
  font-size: .78rem;
  cursor: pointer;
}
.pb-chip.active { background: var(--accent); border-color: var(--accent); color: var(--bg); }
.pb-time { font-size: .8rem; color: var(--text-label); font-variant-numeric: tabular-nums; }
.pb-filter { display: inline-flex; align-items: center; gap: 4px; font-size: .78rem; }
.pb-check { display: inline-flex; align-items: center; gap: 4px; }
.pb-annot-toolbar { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.pb-annot-btn { border: 1px solid var(--border-ghost); background: var(--bg-card2); color: var(--text-label); border-radius: 4px; padding: 2px 8px; font-size: .78rem; cursor: pointer; }
.pb-annot-btn.active { background: var(--accent); border-color: var(--accent); color: var(--bg); }
.pb-annot-btn:disabled { opacity: .45; cursor: default; }
.pb-annot-color { width: 16px; height: 16px; border-radius: 50%; border: 2px solid transparent; cursor: pointer; padding: 0; }
.pb-annot-color.active { border-color: var(--text); box-shadow: 0 0 0 1px var(--bg); }
.pb-annot-width { display: inline-flex; align-items: center; gap: 4px; font-size: .78rem; color: var(--text-label); }
.pb-annot-width input { width: 80px; }
.pb-annot-width-val { font-variant-numeric: tabular-nums; min-width: 2ch; }
.pb-annot-sep { width: 1px; height: 16px; background: var(--border); }
</style>
