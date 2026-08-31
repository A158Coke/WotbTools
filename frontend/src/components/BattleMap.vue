<script setup>
import { ref } from 'vue'
import VehicleMarker from './VehicleMarker.vue'

defineOptions({ name: 'BattleMap' })

const props = defineProps({
  image: { type: Object, required: true },
  mapView: { type: Object, required: true },
  pbOverview: { type: Object, required: true },
  friendlyTeam: { type: [Number, String], default: null },
  gridRegions: { type: Array, default: () => [] },
  visibleTracers: { type: Array, default: () => [] },
  tracerColor: { type: Function, required: true },
  viewScale: { type: Number, default: 1 },
  viewportStyle: { type: String, default: '' },
  annotVisible: Boolean,
  renderedAnnotations: { type: Array, default: () => [] },
  annotFontSize: { type: Number, default: 14 },
  activeTool: { type: String, default: null },
  vehicleStates: { type: Array, default: () => [] },
  selectedAccountId: { type: [Number, String], default: null },
  markerLabel: { type: Function, required: true },
  hpFor: { type: Function, required: true },
  hpPrefs: { type: Object, required: true },
  translate: { type: Function, required: true },
  ghostFor: { type: Function, required: true },
  flashFor: { type: Function, required: true },
  hpNoTransition: Boolean,
  textSession: { type: Object, default: null },
  textInputStyle: { type: Object, default: () => ({}) },
  visibleFloats: { type: Array, default: () => [] },
  visibleBursts: { type: Array, default: () => [] },
  visibleFeed: { type: Array, default: () => [] },
  floatTeamClass: { type: Function, required: true },
})

const emit = defineEmits([
  'wheel', 'pointer-down', 'pointer-move', 'pointer-up', 'viewport-click', 'marker-select',
  'update-text', 'commit-text', 'cancel-text',
])
const mapEl = ref(null)
const textInputRef = ref(null)
defineExpose({ mapEl, textInputRef })
</script>

<template>
  <div class="pb-map" data-test="pb-map" ref="mapEl" @wheel.prevent="emit('wheel', $event)">
    <div
      class="pb-viewport"
      data-test="pb-viewport"
      :style="props.viewportStyle"
      @pointerdown="emit('pointer-down', $event)"
      @pointermove="emit('pointer-move', $event)"
      @pointerup="emit('pointer-up', $event)"
      @pointercancel="emit('pointer-up', $event)"
      @click.capture="emit('viewport-click', $event)"
    >
      <svg class="pb-svg" :viewBox="`0 0 ${props.mapView.W} ${props.mapView.H}`" role="img">
        <image :href="props.image.src" :width="props.mapView.W" :height="props.mapView.H" preserveAspectRatio="none" />
        <g class="pb-grid">
          <rect v-for="cell in props.pbOverview.gridCells" :key="cell.id" :x="props.mapView.toX(cell.bounds.xMin)" :y="props.mapView.toY(cell.bounds.yMax)" :width="props.mapView.toX(cell.bounds.xMax) - props.mapView.toX(cell.bounds.xMin)" :height="props.mapView.toY(cell.bounds.yMin) - props.mapView.toY(cell.bounds.yMax)" class="pb-cell" />
        </g>
        <g class="pb-regions">
          <g v-for="[region, regionBounds] in props.gridRegions" :key="region">
            <rect :x="props.mapView.toX(regionBounds.xMin)" :y="props.mapView.toY(regionBounds.yMax)" :width="props.mapView.toX(regionBounds.xMax) - props.mapView.toX(regionBounds.xMin)" :height="props.mapView.toY(regionBounds.yMin) - props.mapView.toY(regionBounds.yMax)" class="pb-region-line" />
          </g>
        </g>
        <g class="pb-spawns">
          <circle v-for="(spawn, index) in props.pbOverview.spawnPoints" :key="`${spawn.name}-${index}`" :cx="props.mapView.toX(spawn.x)" :cy="props.mapView.toY(spawn.y)" r="4" :class="spawn.team === props.friendlyTeam ? 'pb-spawn-friendly' : 'pb-spawn-enemy'" />
        </g>
        <g class="pb-tracers" aria-hidden="true">
          <template v-for="(line, index) in props.visibleTracers" :key="`tracer-${line.timeSec}-${index}`">
            <line class="pb-tracer" :x1="props.mapView.toX(line.x1)" :y1="props.mapView.toY(line.y1)" :x2="props.mapView.toX(line.x2)" :y2="props.mapView.toY(line.y2)" :stroke="props.tracerColor(line.attackerAccountId)" :stroke-width="6 / props.viewScale" :opacity="line.opacity * 0.35" />
            <line class="pb-tracer-core" :x1="props.mapView.toX(line.x1)" :y1="props.mapView.toY(line.y1)" :x2="props.mapView.toX(line.x2)" :y2="props.mapView.toY(line.y2)" stroke="#fff" :stroke-width="1.75 / props.viewScale" :opacity="line.opacity" />
            <circle v-if="line.flashProgress < 1" class="pb-tracer-flash" :cx="props.mapView.toX(line.x2)" :cy="props.mapView.toY(line.y2)" :r="(3 + 9 * line.flashProgress) / props.viewScale" :fill="props.tracerColor(line.attackerAccountId)" :opacity="line.flashOpacity" />
          </template>
        </g>
        <g v-if="props.annotVisible" class="pb-annotations" data-test="pb-annotations">
          <template v-for="(annotation, index) in props.renderedAnnotations" :key="index">
            <polyline v-if="annotation.type === 'pen'" :points="annotation.svgPoints" fill="none" :stroke="annotation.color" :stroke-width="annotation.widthSvg" stroke-linecap="round" stroke-linejoin="round" />
            <line v-else-if="annotation.type === 'line'" :x1="annotation.x1" :y1="annotation.y1" :x2="annotation.x2" :y2="annotation.y2" :stroke="annotation.color" :stroke-width="annotation.widthSvg" stroke-linecap="round" />
            <g v-else-if="annotation.type === 'arrow'"><line :x1="annotation.x1" :y1="annotation.y1" :x2="annotation.x2" :y2="annotation.y2" :stroke="annotation.color" :stroke-width="annotation.widthSvg" stroke-linecap="round" /><polygon :points="annotation.head" :fill="annotation.color" /></g>
            <rect v-else-if="annotation.type === 'rect'" :x="annotation.x" :y="annotation.y" :width="annotation.w" :height="annotation.h" :stroke="annotation.color" :stroke-width="annotation.widthSvg" fill="none" />
            <circle v-else-if="annotation.type === 'circle'" :cx="annotation.cx" :cy="annotation.cy" :r="annotation.r" :stroke="annotation.color" :stroke-width="annotation.widthSvg" fill="none" />
            <text v-else-if="annotation.type === 'text'" :x="annotation.x" :y="annotation.y" :fill="annotation.color" :font-size="props.annotFontSize" text-anchor="middle" dominant-baseline="middle" class="pb-annot-text">{{ annotation.text }}</text>
          </template>
        </g>
      </svg>
      <div class="pb-markers" :class="{ 'pb-drawing': !!props.activeTool }" data-test="pb-markers" aria-hidden="false">
        <VehicleMarker
          v-for="state in props.vehicleStates"
          :key="state.vehicle.accountId"
          :marker="state"
          :selected="props.selectedAccountId === state.vehicle.accountId"
          :label="props.markerLabel(state.vehicle.accountId)"
          :hp="props.hpFor(state.vehicle)"
          :hp-visible="props.hpPrefs.showHp"
          :t="props.translate"
          :hp-ghost="props.ghostFor(state.vehicle.accountId)"
          :hp-flash="props.flashFor(state.vehicle.accountId)"
          :hp-no-transition="props.hpNoTransition"
          @select="emit('marker-select', state.vehicle, $event)"
        />
      </div>
    </div>

    <input v-if="props.textSession" ref="textInputRef" :value="props.textSession.text" class="pb-text-input" :style="props.textInputStyle" :placeholder="$t('recon.map.playback.annot.text_placeholder')" data-test="pb-text-input" @input="emit('update-text', $event.target.value)" @keydown.enter.prevent="emit('commit-text', props.textSession)" @keydown.esc.prevent="emit('cancel-text', props.textSession)" @blur="emit('commit-text', props.textSession)" />
    <div class="pb-feedback-layer" data-test="pb-feedback-layer" aria-hidden="true">
      <span v-for="float in props.visibleFloats" :key="'dmg-' + float.id" class="pb-float-dmg" data-test="pb-float-dmg" :class="props.floatTeamClass(float.team)" :style="{ left: float.x + 'px', top: float.y + 'px' }">-{{ float.hpLoss }}</span>
      <span v-for="burst in props.visibleBursts" :key="'burst-' + burst.id" class="pb-burst" data-test="pb-burst" :class="props.floatTeamClass(burst.team)" :style="{ left: burst.x + 'px', top: burst.y + 'px' }"></span>
    </div>
    <div v-if="props.visibleFeed.length" class="pb-kill-feed" data-test="pb-kill-feed" aria-hidden="true">
      <div v-for="feed in props.visibleFeed" :key="'feed-' + feed.id" class="pb-feed-item" :class="feed.victimTeam === props.friendlyTeam ? 'pb-feed-friendly' : 'pb-feed-enemy'"><span class="pb-feed-skull" aria-hidden="true">☠</span><span class="pb-feed-victim">{{ feed.victimName }}</span><span class="pb-feed-destroyed">{{ $t('recon.map.playback.feed_destroyed') }}</span></div>
    </div>
  </div>
</template>

<style>
.pb-map { position: relative; margin: 0 auto; width: 66.7%; overflow: hidden; }
.pb-viewport { position: relative; width: 100%; transform-origin: 0 0; touch-action: none; }
.pb-svg { display: block; width: 100%; height: auto; border-radius: 4px; background: var(--bg-elevated); }
.pb-markers { position: absolute; inset: 0; pointer-events: none; }
.pb-vehicle { position: absolute; width: 36px; height: 36px; transform: translate(-50%, -50%); border: none; background: none; padding: 0; pointer-events: none; }
.pb-cell { stroke: var(--map-grid-stroke, rgba(255,255,255,.55)); stroke-width: 1; fill: none; }
.pb-tracer, .pb-tracer-core { stroke-linecap: round; }
.pb-region-line { fill: none; stroke: var(--map-region-stroke, rgba(255,255,255,.28)); stroke-width: 1; }
.pb-spawn-friendly { fill: var(--map-spawn-friendly, #8ef7b0); }
.pb-spawn-enemy { fill: var(--map-spawn-enemy, #ff8d8d); }
.pb-feedback-layer { position: absolute; inset: 0; pointer-events: none; z-index: 9; overflow: hidden; }
.pb-float-dmg { position: absolute; transform: translate(-50%, -50%); font-size: 14px; font-weight: 800; font-variant-numeric: tabular-nums; text-shadow: 0 0 3px color-mix(in srgb, var(--bg) 90%, transparent), 0 1px 2px color-mix(in srgb, var(--bg) 80%, transparent); animation: pb-float-rise 1s ease-out forwards; white-space: nowrap; }
.pb-float-friendly { color: var(--pb-team-text, #4ade80); }
.pb-float-enemy { color: var(--pb-enemy-text, #f87171); }
@keyframes pb-float-rise { 0% { opacity: 1; margin-top: 0; } 70% { opacity: 1; } 100% { opacity: 0; margin-top: -10px; } }
.pb-burst { position: absolute; width: 26px; height: 26px; border-radius: 50%; border: 2px solid currentColor; animation: pb-burst-ring .7s ease-out forwards; pointer-events: none; }
.pb-burst.pb-float-friendly { color: var(--pb-team-text, #4ade80); }
.pb-burst.pb-float-enemy { color: var(--pb-enemy-text, #f87171); }
@keyframes pb-burst-ring { 0% { opacity: .9; transform: translate(-50%, -50%) scale(.3); } 100% { opacity: 0; transform: translate(-50%, -50%) scale(2.4); } }
.pb-kill-feed { position: absolute; top: 6px; right: 6px; display: flex; flex-direction: column; gap: 3px; z-index: 10; pointer-events: none; max-width: 62%; }
.pb-feed-item { display: flex; align-items: center; gap: 4px; font-size: .75rem; background: color-mix(in srgb, var(--bg) 60%, transparent); border: 1px solid color-mix(in srgb, var(--text) 14%, transparent); border-radius: 3px; padding: 2px 6px; animation: pb-feed-in .25s ease-out; }
.pb-feed-skull { color: var(--text); }
.pb-feed-friendly .pb-feed-victim { color: var(--pb-team-text, #4ade80); }
.pb-feed-enemy .pb-feed-victim { color: var(--pb-enemy-text, #f87171); }
.pb-feed-destroyed { color: var(--text-muted, #999); }
@keyframes pb-feed-in { from { opacity: 0; transform: translateX(8px); } to { opacity: 1; transform: none; } }
.pb-annotations { pointer-events: none; }
.pb-annot-text { paint-order: stroke; stroke: color-mix(in srgb, var(--bg) 65%, transparent); stroke-width: 1; }
.pb-drawing { pointer-events: none; }
.pb-text-input { position: absolute; width: 140px; font-size: 13px; padding: 2px 6px; border: 1px solid var(--accent); border-radius: 3px; background: color-mix(in srgb, var(--bg) 80%, transparent); color: var(--text); z-index: 6; }
@media (max-width: 768px) { .pb-map { width: 100%; } .pb-vehicle { width: 28px; height: 28px; } }
@media (prefers-reduced-motion: reduce) { .pb-float-dmg, .pb-burst, .pb-feed-item { animation: none; } }
</style>
