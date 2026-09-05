<script setup>
import { computed, ref, useId } from 'vue'
import VehicleMarker from './VehicleMarker.vue'
import { activeTerrainRelief, projectTerrainPoint } from '../utils/terrainReliefProjection.js'
import { screenOffsetToSvgDelta } from '../utils/mapView.js'

defineOptions({ name: 'BattleMap' })

const props = defineProps({
  image: { type: Object, required: true },
  mapView: { type: Object, required: true },
  pbOverview: { type: Object, required: true },
  friendlyTeam: { type: [Number, String], default: null },
  bases: { type: Array, default: () => [] },
  visibleTracers: { type: Array, default: () => [] },
  visibleTrails: { type: Array, default: () => [] },
  tracerColor: { type: Function, required: true },
  viewScale: { type: Number, default: 1 },
  renderedFrame: { type: Object, default: null },
  viewportStyle: { type: [String, Array], default: '' },
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
  floatTeamClass: { type: Function, required: true },
})

const emit = defineEmits([
  'wheel', 'pointer-down', 'pointer-move', 'pointer-up', 'viewport-click', 'marker-select',
  'update-text', 'commit-text', 'cancel-text',
])
const mapEl = ref(null)
const textInputRef = ref(null)
defineExpose({ mapEl, textInputRef })

const reliefModel = computed(() => {
  const model = activeTerrainRelief.value
  return model && model.mapCode === String(props.pbOverview?.mapCode || '') ? model : null
})
const reliefActive = computed(() => !!reliefModel.value)

function projectSemantic(x, y) {
  const model = reliefModel.value
  if (!model) return { x: props.mapView.toX(x), y: props.mapView.toY(y) }
  const point = projectTerrainPoint(model, Number(x), Number(y))
  if (!point) return { x: props.mapView.toX(x), y: props.mapView.toY(y) }
  return {
    x: point.xNorm * props.mapView.W,
    y: point.yNorm * props.mapView.H,
  }
}

function projectedX(x, y) {
  return projectSemantic(x, y).x
}

function projectedY(x, y) {
  return projectSemantic(x, y).y
}

function projectSvgPoint(x, y) {
  if (!reliefActive.value) return { x: Number(x), y: Number(y) }
  const semanticX = props.mapView.fromX(Number(x))
  const semanticY = props.mapView.fromY(Number(y))
  if (!Number.isFinite(semanticX) || !Number.isFinite(semanticY)) return { x: Number(x), y: Number(y) }
  return projectSemantic(semanticX, semanticY)
}

function projectSvgPointString(points) {
  if (!reliefActive.value || typeof points !== 'string') return points
  return points.trim().split(/\s+/).map((pair) => {
    const [x, y] = pair.split(',').map(Number)
    if (!Number.isFinite(x) || !Number.isFinite(y)) return pair
    const point = projectSvgPoint(x, y)
    return `${point.x},${point.y}`
  }).join(' ')
}

function projectedAnnotationPoint(annotation, xKey, yKey) {
  return projectSvgPoint(annotation[xKey], annotation[yKey])
}

function projectedRectPoints(annotation) {
  const corners = [
    [annotation.x, annotation.y],
    [annotation.x + annotation.w, annotation.y],
    [annotation.x + annotation.w, annotation.y + annotation.h],
    [annotation.x, annotation.y + annotation.h],
  ]
  return corners.map(([x, y]) => {
    const point = projectSvgPoint(x, y)
    return `${point.x},${point.y}`
  }).join(' ')
}

function projectedCirclePoints(annotation) {
  const points = []
  const segments = 32
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2
    const point = projectSvgPoint(
      annotation.cx + Math.cos(angle) * annotation.r,
      annotation.cy + Math.sin(angle) * annotation.r,
    )
    points.push(`${point.x},${point.y}`)
  }
  return points.join(' ')
}

const presentedVehicleStates = computed(() => {
  if (!reliefModel.value) return props.vehicleStates
  return props.vehicleStates.map((state) => {
    const point = projectSemantic(state.pos.x, state.pos.y)
    const offset = state.presentationOffset || { x: 0, y: 0 }
    return {
      ...state,
      markerStyle: {
        ...state.markerStyle,
        // Collision offsets are already screen pixels. The camera enlarges the layout box,
        // so they must not be divided by viewScale before entering CSS positioning.
        left: `calc(${(point.x / props.mapView.W) * 100}% + ${offset.x}px)`,
        top: `calc(${(point.y / props.mapView.H) * 100}% + ${offset.y}px)`,
      },
    }
  })
})

const markerLeaderStates = computed(() => {
  // BattlePlayback supplies this from its existing ResizeObserver-backed mapSize
  // and camera scale. Standalone mounts retain the DOM measurement fallback.
  const hintedFrame = props.renderedFrame
  const svgRect = mapEl.value?.querySelector('.pb-svg')?.getBoundingClientRect?.()
  const hasFrame = (frame) => frame
    && Number.isFinite(frame.width) && Number.isFinite(frame.height)
    && frame.width > 0 && frame.height > 0
  const renderedFrame = hasFrame(hintedFrame)
    ? hintedFrame
    : (hasFrame(svgRect) ? svgRect : { width: props.mapView.W, height: props.mapView.H })
  return presentedVehicleStates.value.flatMap((state) => {
    const offset = state.presentationOffset
    if (!offset || !Number.isFinite(offset.x) || !Number.isFinite(offset.y)
      || (Math.abs(offset.x) <= 1e-9 && Math.abs(offset.y) <= 1e-9)) return []
    const x = Number(state.pos?.x)
    const y = Number(state.pos?.y)
    if (!Number.isFinite(x) || !Number.isFinite(y)) return []
    const canonical = projectSemantic(x, y)
    if (!Number.isFinite(canonical.x) || !Number.isFinite(canonical.y)) return []
    const svgOffset = screenOffsetToSvgDelta(offset, props.mapView, renderedFrame)
    if (!svgOffset) return []
    return [{
      key: state.vehicle.accountId,
      x1: canonical.x,
      y1: canonical.y,
      x2: canonical.x + svgOffset.x,
      y2: canonical.y + svgOffset.y,
      strokeWidth: 1.25 * props.mapView.W / renderedFrame.width,
    }]
  })
})

// clipPath id 是文档级的，多个实例同时挂载时不能撞名。
const clipPrefix = `pb-base-clip-${useId()}`

// Tactical base symbol stays screen-readable in relief mode; only its anchor is
// height-projected. It is deliberately not distorted into a physical ground ellipse.
function baseRadius(base) {
  return props.mapView.toX(base.x + base.radius) - props.mapView.toX(base.x)
}

function fillHeight(base) {
  const clamped = Math.min(Math.max(base.progress ?? 0, 0), 100)
  return baseRadius(base) * 2 * clamped / 100
}

function fillTop(base) {
  return projectedY(base.x, base.y) + baseRadius(base) - fillHeight(base)
}
</script>

<template>
  <div class="pb-map" data-test="pb-map" ref="mapEl" :style="{ aspectRatio: `${props.mapView.W} / ${props.mapView.H}` }" @wheel.prevent="emit('wheel', $event)">
    <div
      class="pb-viewport"
      data-test="pb-viewport"
      :data-view-scale="props.viewScale"
      :style="[props.viewportStyle, { aspectRatio: `${props.mapView.W} / ${props.mapView.H}` }]"
      @pointerdown="emit('pointer-down', $event)"
      @pointermove="emit('pointer-move', $event)"
      @pointerup="emit('pointer-up', $event)"
      @pointercancel="emit('pointer-up', $event)"
      @click.capture="emit('viewport-click', $event)"
    >
      <img class="pb-basemap" data-test="pb-basemap" :src="props.image.src" alt="" aria-hidden="true" />
      <svg class="pb-svg" :viewBox="`0 0 ${props.mapView.W} ${props.mapView.H}`" role="img">
        <defs>
          <clipPath v-for="base in props.bases" :key="base.baseId" :id="`${clipPrefix}-${base.baseId}`">
            <rect
              class="pb-base-fill-clip"
              :x="projectedX(base.x, base.y) - baseRadius(base)"
              :y="fillTop(base)"
              :width="baseRadius(base) * 2"
              :height="fillHeight(base)"
            />
          </clipPath>
        </defs>
        <g class="pb-marker-leaders" aria-hidden="true">
          <line
            v-for="leader in markerLeaderStates"
            :key="`marker-leader-${leader.key}`"
            class="pb-marker-leader"
            :x1="leader.x1"
            :y1="leader.y1"
            :x2="leader.x2"
            :y2="leader.y2"
            :stroke-width="leader.strokeWidth"
          />
        </g>
        <g class="pb-bases" data-test="pb-bases">
          <g v-for="base in props.bases" :key="base.baseId" :class="`pb-base-${base.status}`" :data-test="`pb-base-${base.baseId}`">
            <circle :cx="projectedX(base.x, base.y)" :cy="projectedY(base.x, base.y)" :r="baseRadius(base)" class="pb-base-circle" />
            <circle
              v-if="base.progress != null"
              class="pb-base-fill"
              :class="`pb-capture-${base.capturedBy}`"
              data-test="pb-base-fill"
              :cx="projectedX(base.x, base.y)"
              :cy="projectedY(base.x, base.y)"
              :r="baseRadius(base)"
              :clip-path="`url(#${clipPrefix}-${base.baseId})`"
            />
            <text :x="projectedX(base.x, base.y)" :y="projectedY(base.x, base.y)" class="pb-base-label" text-anchor="middle" dominant-baseline="central">{{ base.baseId }}</text>
          </g>
        </g>
        <g class="pb-spawns">
          <circle v-for="(spawn, index) in props.pbOverview.spawnPoints" :key="`${spawn.name}-${index}`" :cx="projectedX(spawn.x, spawn.y)" :cy="projectedY(spawn.x, spawn.y)" r="4" :class="props.friendlyTeam === null || props.friendlyTeam === undefined ? 'pb-spawn-neutral' : (spawn.team === props.friendlyTeam ? 'pb-spawn-friendly' : 'pb-spawn-enemy')" />
        </g>
        <g class="pb-trails" data-test="pb-trails" aria-hidden="true">
          <template v-for="(trail, index) in props.visibleTrails" :key="`trail-${trail.accountId}-${index}`">
            <line
              v-if="trail.from && trail.to"
              class="pb-trail"
              :x1="projectedX(trail.from.x, trail.from.y)"
              :y1="projectedY(trail.from.x, trail.from.y)"
              :x2="projectedX(trail.to.x, trail.to.y)"
              :y2="projectedY(trail.to.x, trail.to.y)"
              :stroke="trail.friendly === true ? 'var(--map-spawn-friendly)' : (trail.friendly === false ? 'var(--map-spawn-enemy)' : 'var(--text-muted)')"
              :stroke-width="1.5 / props.viewScale"
              stroke-dasharray="2 4"
              :opacity="trail.opacity"
            />
            <circle
              v-else-if="trail.point"
              class="pb-trail-point"
              :cx="projectedX(trail.point.x, trail.point.y)"
              :cy="projectedY(trail.point.x, trail.point.y)"
              :r="1.8 / props.viewScale"
              :fill="trail.friendly === true ? 'var(--map-spawn-friendly)' : (trail.friendly === false ? 'var(--map-spawn-enemy)' : 'var(--text-muted)')"
              :opacity="trail.opacity"
            />
          </template>
        </g>
        <g class="pb-tracers" aria-hidden="true">
          <template v-for="(line, index) in props.visibleTracers" :key="`tracer-${line.timeSec}-${index}`">
            <line v-if="line.hasLine" class="pb-tracer" :x1="projectedX(line.x1, line.y1)" :y1="projectedY(line.x1, line.y1)" :x2="projectedX(line.x2, line.y2)" :y2="projectedY(line.x2, line.y2)" :stroke="props.tracerColor(line.attackerAccountId)" :stroke-width="6 / props.viewScale" :opacity="line.opacity * 0.35" />
            <line v-if="line.hasLine" class="pb-tracer-core" :x1="projectedX(line.x1, line.y1)" :y1="projectedY(line.x1, line.y1)" :x2="projectedX(line.x2, line.y2)" :y2="projectedY(line.x2, line.y2)" stroke="#fff" :stroke-width="1.75 / props.viewScale" :opacity="line.opacity" />
            <circle v-if="line.flashProgress < 1" class="pb-tracer-flash" :cx="projectedX(line.x2, line.y2)" :cy="projectedY(line.x2, line.y2)" :r="(3 + 9 * line.flashProgress) / props.viewScale" :fill="props.tracerColor(line.attackerAccountId)" :opacity="line.flashOpacity" />
          </template>
        </g>
        <g v-if="props.annotVisible" class="pb-annotations" data-test="pb-annotations">
          <template v-for="(annotation, index) in props.renderedAnnotations" :key="index">
            <polyline v-if="annotation.type === 'pen'" :points="projectSvgPointString(annotation.svgPoints)" fill="none" :stroke="annotation.color" :stroke-width="annotation.widthSvg" stroke-linecap="round" stroke-linejoin="round" />
            <line v-else-if="annotation.type === 'line'" :x1="projectedAnnotationPoint(annotation, 'x1', 'y1').x" :y1="projectedAnnotationPoint(annotation, 'x1', 'y1').y" :x2="projectedAnnotationPoint(annotation, 'x2', 'y2').x" :y2="projectedAnnotationPoint(annotation, 'x2', 'y2').y" :stroke="annotation.color" :stroke-width="annotation.widthSvg" stroke-linecap="round" />
            <g v-else-if="annotation.type === 'arrow'"><line :x1="projectedAnnotationPoint(annotation, 'x1', 'y1').x" :y1="projectedAnnotationPoint(annotation, 'x1', 'y1').y" :x2="projectedAnnotationPoint(annotation, 'x2', 'y2').x" :y2="projectedAnnotationPoint(annotation, 'x2', 'y2').y" :stroke="annotation.color" :stroke-width="annotation.widthSvg" stroke-linecap="round" /><polygon :points="projectSvgPointString(annotation.head)" :fill="annotation.color" /></g>
            <template v-else-if="annotation.type === 'rect'">
              <polygon v-if="reliefActive" :points="projectedRectPoints(annotation)" :stroke="annotation.color" :stroke-width="annotation.widthSvg" fill="none" />
              <rect v-else :x="annotation.x" :y="annotation.y" :width="annotation.w" :height="annotation.h" :stroke="annotation.color" :stroke-width="annotation.widthSvg" fill="none" />
            </template>
            <template v-else-if="annotation.type === 'circle'">
              <polygon v-if="reliefActive" :points="projectedCirclePoints(annotation)" :stroke="annotation.color" :stroke-width="annotation.widthSvg" fill="none" />
              <circle v-else :cx="annotation.cx" :cy="annotation.cy" :r="annotation.r" :stroke="annotation.color" :stroke-width="annotation.widthSvg" fill="none" />
            </template>
            <text v-else-if="annotation.type === 'text'" :x="projectedAnnotationPoint(annotation, 'x', 'y').x" :y="projectedAnnotationPoint(annotation, 'x', 'y').y" :fill="annotation.color" :font-size="props.annotFontSize" text-anchor="middle" dominant-baseline="middle" class="pb-annot-text">{{ annotation.text }}</text>
          </template>
        </g>
      </svg>
      <div class="pb-markers" :class="{ 'pb-drawing': !!props.activeTool }" data-test="pb-markers" aria-hidden="false">
        <VehicleMarker
          v-for="state in presentedVehicleStates"
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
      <span v-for="float in props.visibleFloats" :key="'dmg-' + float.id" class="pb-float-dmg" data-test="pb-float-dmg" :class="props.floatTeamClass(float.friendly)" :style="{ left: float.x + 'px', top: float.y + 'px' }">-{{ float.hpLoss }}</span>
      <span v-for="burst in props.visibleBursts" :key="'burst-' + burst.id" class="pb-burst" data-test="pb-burst" :class="props.floatTeamClass(burst.friendly)" :style="{ left: burst.x + 'px', top: burst.y + 'px' }"></span>
    </div>
  </div>
</template>

<style>
.pb-map { position: relative; margin: 0 auto; width: 66.7%; overflow: hidden; aspect-ratio: var(--pb-map-aspect, 1 / 1); }
.pb-viewport { position: absolute; inset: 0 auto auto 0; width: 100%; transform-origin: 0 0; touch-action: none; aspect-ratio: var(--pb-map-aspect, 1 / 1); }
.pb-basemap,
.pb-svg { position: absolute; inset: 0; display: block; width: 100%; height: 100%; }
.pb-basemap { object-fit: fill; border-radius: 4px; user-select: none; pointer-events: none; }
.pb-svg { border-radius: 4px; background: transparent; pointer-events: none; }
.pb-viewport.pb-25d-active .pb-basemap { visibility: hidden; }
.pb-marker-leaders { pointer-events: none; }
.pb-marker-leader { stroke: var(--text-muted, #999); stroke-dasharray: 2 2; stroke-linecap: round; opacity: .78; }
.pb-markers { position: absolute; inset: 0; pointer-events: none; }
  .pb-vehicle { position: absolute; width: 30px; height: 30px; transform: translate(-50%, -50%); border: none; background: none; padding: 0; pointer-events: none; }
.pb-base-circle { fill: color-mix(in srgb, currentColor 18%, transparent); stroke: currentColor; stroke-width: 1.6; }
.pb-base-label { fill: currentColor; font-size: 13px; font-weight: 700; paint-order: stroke; stroke: rgba(0,0,0,.55); stroke-width: 2.5; }
/* 圆圈颜色 = 当前归属；进度弧颜色 = 正在占领的一方。两个信息都要看得出来。 */
.pb-base-neutral { color: #fff; }
.pb-base-friendly_controlled { color: var(--map-spawn-friendly, #ffd166); }
.pb-base-enemy_controlled { color: var(--map-spawn-enemy, #ff8d8d); }
.pb-base-controlled { color: var(--text, #e8e8e8); }
/* 占领进度：水位从下往上涨，100% 时整圆铺满占领方颜色。 */
.pb-base-fill { stroke: none; animation: pb-base-pulse 1.3s ease-in-out infinite; }
.pb-base-fill-clip { transition: y .35s linear, height .35s linear; }
.pb-capture-friendly { fill: var(--map-spawn-friendly, #ffd166); }
.pb-capture-enemy { fill: var(--map-spawn-enemy, #ff8d8d); }
.pb-capture-unknown { fill: #fff; }
@keyframes pb-base-pulse { 0%, 100% { opacity: .95; } 50% { opacity: .6; } }
@media (prefers-reduced-motion: reduce) {
  .pb-base-fill { animation: none; }
  .pb-base-fill-clip { transition: none; }
}
.pb-tracer, .pb-tracer-core { stroke-linecap: round; }
.pb-trail { stroke-linecap: round; }
.pb-spawn-friendly { fill: var(--map-spawn-friendly, #8ef7b0); }
.pb-spawn-enemy { fill: var(--map-spawn-enemy, #ff8d8d); }
.pb-spawn-neutral { fill: var(--text-muted, #999); }
.pb-feedback-layer { position: absolute; inset: 0; pointer-events: none; z-index: 9; overflow: hidden; }
.pb-float-dmg { position: absolute; transform: translate(-50%, -50%); font-size: 14px; font-weight: 800; font-variant-numeric: tabular-nums; text-shadow: 0 0 3px color-mix(in srgb, var(--bg) 90%, transparent), 0 1px 2px color-mix(in srgb, var(--bg) 80%, transparent); animation: pb-float-rise 1s ease-out forwards; white-space: nowrap; }
.pb-float-friendly { color: var(--pb-team-text, #4ade80); }
.pb-float-enemy { color: var(--pb-enemy-text, #f87171); }
.pb-float-neutral { color: var(--text-muted, #999); }
@keyframes pb-float-rise { 0% { opacity: 1; margin-top: 0; } 70% { opacity: 1; } 100% { opacity: 0; margin-top: -10px; } }
.pb-burst { position: absolute; width: 26px; height: 26px; border-radius: 50%; border: 2px solid currentColor; animation: pb-burst-ring .7s ease-out forwards; pointer-events: none; }
.pb-burst.pb-float-friendly { color: var(--pb-team-text, #4ade80); }
.pb-burst.pb-float-enemy { color: var(--pb-enemy-text, #f87171); }
.pb-burst.pb-float-neutral { color: var(--text-muted, #999); }
@keyframes pb-burst-ring { 0% { opacity: .9; transform: translate(-50%, -50%) scale(.3); } 100% { opacity: 0; transform: translate(-50%, -50%) scale(2.4); } }
.pb-annotations { pointer-events: none; }
.pb-annot-text { paint-order: stroke; stroke: color-mix(in srgb, var(--bg) 65%, transparent); stroke-width: 1; }
.pb-drawing { pointer-events: none; }
.pb-text-input { position: absolute; width: 140px; font-size: 13px; padding: 2px 6px; border: 1px solid var(--accent); border-radius: 3px; background: color-mix(in srgb, var(--bg) 80%, transparent); color: var(--text); z-index: 6; }
@media (width < 768px) { .pb-map { width: 100%; } .pb-vehicle { width: 25px; height: 25px; } }
@media (prefers-reduced-motion: reduce) { .pb-float-dmg, .pb-burst { animation: none; } }
</style>
