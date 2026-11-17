<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { createReusableTemplate, useElementSize } from '@vueuse/core'
import { useI18n } from 'vue-i18n'
import { ChevronDown, Crosshair, Expand, Eye, EyeOff, Focus, Info, Plus, Scan, Search, Timer, ZoomIn } from 'lucide-vue-next'
import SegmentedControl from './SegmentedControl.vue'
import '../styles/mobility-controls.css'
import AppButton from './AppButton.vue'
import AppDialog from './AppDialog.vue'
import { intersections, simulate, speedAt, stepSeconds, terrains } from '../replay-local/compute/mobility'
import { loadMobilityDataset, modelRevision } from '../composables/tankMobility'

import type { VehicleCurve } from '../composables/tankMobility'
import type { Phase, Run, Terrain } from '../replay-local/compute/mobility'

const props = defineProps<{ vehicles: VehicleCurve[]; dataset?: string | null; single?: boolean }>()
const { t, locale } = useI18n()
const numbers = computed(() => new Intl.NumberFormat(locale.value, { maximumFractionDigits: 2 }))
const [DefinePlot, Plot] = createReusableTemplate()
const expanded = ref(false)
const focusPlot = ref(false)
const terrain = ref<Terrain | 'all'>(props.single ? 'all' : 'Firm')
const terrainOptions = computed(() => [...terrains, 'all'].map(value => ({ value, label: t('mobility.' + value) })))
const rangeOpen = ref(false)
const inspecting = ref(false)
const singleColors = { Firm: 'var(--color-success)', Medium: 'var(--color-info)', Soft: 'var(--color-warning)' }
const hidden = ref<string[]>([])
const isolated = ref('')
const search = ref('')
const cursor = ref(0)
const windowEnd = ref(90)
const zoom = ref<[number, number] | null>(null)
const from = ref(0)
const to = ref(30)
const area = ref<HTMLElement | null>(null)
const { width, height } = useElementSize(area)
const W = computed(() => Math.max(220, width.value))
const H = computed(() => Math.max(160, height.value))
const left = 48, top = 18, bottom = 34, right = 30
const pairA = ref('')
const pairB = ref('')
const fmt = (value: number | null) => value == null ? '—' : numbers.value.format(value)
const cache = new WeakMap<Phase[], { seconds: number; runs: Partial<Record<Terrain, Run>> }>()
function run(car: VehicleCurve, ground: Terrain, seconds: number): Run {
  let saved = cache.get(car.phases)
  if (!saved || saved.seconds !== seconds) {
    saved = { seconds, runs: {} }
    cache.set(car.phases, saved)
  }
  return saved.runs[ground] ??= simulate(car.phases, ground, seconds)
}
const lines = computed(() => props.vehicles.flatMap(car =>
  (terrain.value === 'all' ? terrains : [terrain.value]).map(ground => ({
    key: car.id + ground, ground, car, run: run(car, ground, windowEnd.value),
    color: props.single ? singleColors[ground] : car.color,
    label: car.name + ' · ' + t('mobility.' + ground),
  }))))
watch(() => lines.value.map(line => line.key), keys => {
  if (isolated.value && !keys.includes(isolated.value)) isolated.value = ''
})
const visible = computed(() => lines.value.filter(l => !hidden.value.includes(l.key) && (!isolated.value || l.key === isolated.value)))
const legend = computed(() => lines.value.filter(l => l.label.toLocaleLowerCase().includes(search.value.toLocaleLowerCase())))
const legendLimit = ref(48)
watch(search, () => { legendLimit.value = 48 })
const extent = computed<[number, number]>(() => {
  if (zoom.value) return zoom.value
  let end = 1
  for (const { run } of visible.value) {
    const last = (run.speeds.length - 1) * stepSeconds
    end = Math.max(end, run.reached ?? (run.status === 'unreachable' ? run.near : null) ?? last)
  }
  return [0, Math.min(windowEnd.value, Math.ceil(end * 1.08))]
})
function tickSize(span: number, count: number) {
  const raw = Math.max(0.001, span / Math.max(2, count))
  const base = 10 ** Math.floor(Math.log10(raw))
  return base * ([1, 2, 2.5, 5, 10].find(x => x >= raw / base) ?? 10)
}
function ticks(lo: number, hi: number, step: number) {
  const values = []
  for (let i = Math.ceil(lo / step); i <= Math.floor(hi / step); i++) values.push(i * step)
  return values
}
const xs = computed(() => ticks(...extent.value, tickSize(extent.value[1] - extent.value[0], Math.min(12, W.value / 80))))
const peaks = new WeakMap<Run, { first: number; last: number; peak: number }>()
const maxSpeed = computed(() => {
  let max = 1
  const first = Math.max(0, Math.floor(extent.value[0] / stepSeconds))
  const end = Math.ceil(extent.value[1] / stepSeconds)
  for (const { run } of visible.value) {
    const last = Math.min(run.speeds.length - 1, end)
    let saved = peaks.get(run)
    if (!saved || saved.first !== first || saved.last !== last) {
      let peak = 0
      for (let i = first; i <= last; i++) peak = Math.max(peak, run.speeds[i])
      saved = { first, last, peak }
      peaks.set(run, saved)
    }
    max = Math.max(max, saved.peak)
  }
  return max
})
const yStep = computed(() => tickSize(maxSpeed.value, Math.min(10, H.value / 52)))
const yMax = computed(() => Math.ceil(maxSpeed.value / yStep.value) * yStep.value)
const ys = computed(() => ticks(0, yMax.value, yStep.value))
const x = (time: number) => left + (time - extent.value[0]) / (extent.value[1] - extent.value[0]) * (W.value - left - right)
const y = (speed: number) => H.value - bottom - speed / yMax.value * (H.value - bottom - top)
const tipPosition = computed(() => {
  const at = x(cursor.value)
  const before = at > W.value / 2
  return { [before ? 'right' : 'left']: (before ? W.value - at : at) + 'px',
    '--tip-space': (before ? at : W.value - at) + 'px' }
})
// Cache the drawing for each run while other vehicles finish loading. Physics samples
// remain full precision for the cursor, speed bounds and intersections.
const drawing = new WeakMap<Run, { view: string; points: string }>()
const paths = computed(() => {
  const [lo, hi] = extent.value
  const w = W.value, h = H.value
  const sx = (w - left - right) / (hi - lo), sy = (h - bottom - top) / yMax.value
  const view = [lo, hi, w, h, yMax.value].join(',')
  return visible.value.map(line => {
    let cached = drawing.get(line.run)
    if (cached?.view !== view) {
      const first = Math.max(0, Math.ceil(lo / stepSeconds))
      const last = Math.min(line.run.speeds.length - 1, Math.floor(hi / stepSeconds))
      const stride = Math.max(1, Math.floor((last - first) / w))
      const points: string[] = []
      const point = (i: number) => (left + (i * stepSeconds - lo) * sx).toFixed(2) + ',' +
        (h - bottom - line.run.speeds[i] * sy).toFixed(2)
      for (let i = first; i < last; i += stride) points.push(point(i))
      if (last >= first) points.push(point(last))
      cached = { view, points: points.join(' ') }
      drawing.set(line.run, cached)
    }
    return { ...line, points: cached.points }
  })
})
function setRange(a: number, b: number) {
  const lo = Math.max(0, Math.min(a, b))
  const hi = Math.min(windowEnd.value, Math.max(a, b))
  if (Number.isFinite(lo) && Number.isFinite(hi) && hi > lo) zoom.value = [lo, hi]
}
watch(extent, ([a, b]) => { from.value = a; to.value = b; cursor.value = Math.max(a, Math.min(b, cursor.value)) }, { immediate: true })
watch(terrain, () => { isolated.value = ''; pairA.value = ''; pairB.value = '' })
const drag = ref<number | null>(null)
function pointerTime(event: PointerEvent) {
  const rect = (event.currentTarget as SVGSVGElement).getBoundingClientRect()
  const fraction = Math.max(0, Math.min(1, (event.clientX - rect.left - left) / (rect.width - left - right)))
  return extent.value[0] + fraction * (extent.value[1] - extent.value[0])
}
function press(event: PointerEvent) {
  if (!event.isPrimary || event.button !== 0) return
  const svg = event.currentTarget as SVGSVGElement
  svg.setPointerCapture?.(event.pointerId)
  cursor.value = pointerTime(event)
  drag.value = cursor.value
}
function release(event: PointerEvent) {
  const time = pointerTime(event)
  if (drag.value != null && Math.abs(x(time) - x(drag.value)) > 10) setRange(drag.value, time)
  drag.value = null
}
function toggle(key: string) {
  hidden.value = hidden.value.includes(key) ? hidden.value.filter(k => k !== key) : [...hidden.value, key]
}
function solo(key: string) {
  if (hidden.value.includes(key)) toggle(key)
  isolated.value = isolated.value === key ? '' : key
}
const secondChoices = computed(() => {
  const first = lines.value.find(l => l.key === pairA.value)
  return first ? lines.value.filter(l => l.key !== first.key && l.ground === first.ground) : []
})
const crossings = computed(() => {
  const a = lines.value.find(l => l.key === pairA.value), b = secondChoices.value.find(l => l.key === pairB.value)
  return a && b && a.run.speeds.length && b.run.speeds.length ? intersections(a.run.speeds, b.run.speeds) : null
})
const marks = computed(() => {
  const line = visible.value.find(l => l.key === pairA.value)
  if (!line || !visible.value.some(l => l.key === pairB.value)) return []
  return (crossings.value || []).flatMap(([a, b]) => {
    const start = Math.max(a, extent.value[0]), end = Math.min(b, extent.value[1])
    if (end < start) return []
    const v = speedAt(line.run.speeds, start)
    return v == null ? [] : [{ start, end, speed: v, endSpeed: speedAt(line.run.speeds, end) }]
  })
})
</script>

<template>
  <section class="mob-chart surface-glass-1">
    <header class="mob-tools">
      <h2>{{ t('mobility.chart') }}</h2>
      <slot />
      <AppButton class="mob-action" @click="expanded = true"><Expand :size="16" />{{ t('mobility.expand') }}</AppButton>
    </header>
    <DefinePlot>
      <div class="mob-plot" :class="{ 'mob-expanded': expanded, 'mob-plot-focus': expanded && focusPlot }">
      <div class="mob-toolbar">
        <SegmentedControl v-model="terrain" :options="terrainOptions" :ariaLabel="t('mobility.ground')" wrap />
        <div class="mob-actions">
          <AppButton v-if="expanded" size="sm" variant="ghost" :aria-pressed="focusPlot" @click="focusPlot = !focusPlot">{{ t(focusPlot ? 'mobBulk.showLegend' : 'mobBulk.focus') }}</AppButton>
          <AppButton class="mob-action" size="sm" :aria-expanded="rangeOpen" @click="rangeOpen = !rangeOpen">
            <Timer :size="16" />{{ fmt(extent[0]) }}–{{ fmt(extent[1]) }} s <ChevronDown :size="14" />
          </AppButton>
          <AppButton size="sm" variant="ghost" @click="zoom = null"><Scan :size="16" />{{ t('mobility.fit') }}</AppButton>
        </div>
      </div>
      <form v-if="rangeOpen" class="mob-range" @submit.prevent="setRange(from, to); rangeOpen = false">
        <label>{{ t('mobility.from') }}<input class="mob-field" v-model.number="from" required type="number" min="0" :max="windowEnd" step="any" /></label>
        <label>{{ t('mobility.to') }}<input class="mob-field" v-model.number="to" required type="number" min="0" :max="windowEnd" step="any" /></label>
        <AppButton size="sm" type="submit" :disabled="!(to > from)"><ZoomIn :size="15" />{{ t('mobility.zoom') }}</AppButton>
        <AppButton size="sm" variant="ghost" @click="windowEnd += 90; setRange(0, windowEnd)"><Plus :size="15" />{{ t('mobility.extend') }}</AppButton>
      </form>
      <div ref="area" class="mob-area">
        <svg :viewBox="'0 0 ' + W + ' ' + H" role="img" :aria-label="t('mobility.chart')"
          @pointerenter="inspecting = true" @pointerleave="inspecting = false" @pointerdown="inspecting = true; press($event)" @pointermove="cursor = pointerTime($event)" @pointerup="release" @pointercancel="drag = null">
          <g v-for="v in ys" :key="'y'+v"><line :x1="left" :x2="W-right" :y1="y(v)" :y2="y(v)" /><text :x="left-6" :y="y(v)" text-anchor="end">{{ fmt(v) }}</text></g>
          <g v-for="v in xs" :key="'x'+v"><line :x1="x(v)" :x2="x(v)" :y1="top" :y2="H-bottom" /><text :x="x(v)" :y="H-8" text-anchor="middle">{{ fmt(v) }}</text></g>
          <text :x="left" :y="12">km/h</text><text :x="W-10" :y="H-8">s</text>
          <g v-for="l in paths" :key="l.key">
            <template v-for="win in l.car.windows" :key="win.stem">
              <rect v-if="win.start < extent[1] && win.end > extent[0]" :x="x(Math.max(extent[0], win.start))" :y="top"
                :width="x(Math.min(extent[1], win.end))-x(Math.max(extent[0], win.start))" :height="H-top-bottom" :fill="l.color" opacity=".06" />
            </template>
            <polyline :points="l.points" fill="none" :stroke="l.color" stroke-width="2.5" :stroke-dasharray="l.ground === 'Soft' ? '2 4' : l.ground === 'Medium' ? '7 4' : undefined" />
          </g>
          <g v-for="mark in marks" :key="mark.start">
            <circle :cx="x(mark.start)" :cy="y(mark.speed)" r="4" fill="currentColor" />
            <circle v-if="mark.end > mark.start" :cx="x(mark.end)" :cy="y(mark.endSpeed ?? mark.speed)" r="4" fill="currentColor" />
          </g>
          <line v-if="inspecting || cursor > 0" class="mob-cursor" :x1="x(cursor)" :x2="x(cursor)" :y1="top" :y2="H-bottom" />
          <g v-if="inspecting || cursor > 0">
            <template v-for="l in visible" :key="l.key"><circle v-if="speedAt(l.run.speeds, cursor) != null" :cx="x(cursor)" :cy="y(speedAt(l.run.speeds, cursor)!)" r="4" :fill="l.color" class="mob-point" /></template>
          </g>
        </svg>
        <div v-if="inspecting && visible.length" class="mob-tip" :style="tipPosition" :class="{ 'is-before': x(cursor) > W / 2 }">
          <b>{{ fmt(cursor) }} s</b><div v-for="l in visible.slice(0, 4)" :key="l.key"><i :style="{ background: l.color }" /><span>{{ l.label }}</span><strong>{{ fmt(speedAt(l.run.speeds, cursor)) }} km/h</strong></div>
          <small v-if="visible.length > 4">+{{ visible.length - 4 }}</small>
        </div>
      </div>
      <label class="mob-scrubber">
        <span><Crosshair :size="16" />{{ t('mobility.cursor') }}</span>
        <output>{{ fmt(cursor) }} <small>s</small></output>
        <input v-model.number="cursor" type="range" :min="extent[0]" :max="extent[1]" :step="stepSeconds" />
      </label>
      <label v-if="!(expanded && focusPlot) && lines.length > 3" class="mob-search"><Search :size="16" /><input class="mob-field" v-model="search" type="search" :placeholder="t('mobility.search')" :aria-label="t('mobility.search')" /></label>
      <ul v-if="!(expanded && focusPlot)" class="mob-legend">
        <li v-for="l in legend.slice(0, legendLimit)" :key="l.key" :style="{ '--series': l.color }">
          <div class="mob-series">
            <button type="button" class="mob-visibility" :aria-label="l.label" :aria-pressed="!hidden.includes(l.key)" @click="toggle(l.key)">
              <Eye v-if="!hidden.includes(l.key)" :size="16" /><EyeOff v-else :size="16" />
            </button>
            <div class="mob-identity"><strong>{{ l.car.name }}</strong><span><i :class="'sample-' + l.ground" />{{ t('mobility.' + l.ground) }}</span></div>
            <output class="mob-speed">{{ fmt(speedAt(l.run.speeds, cursor)) }} <small>km/h</small></output>
            <AppButton size="sm" variant="ghost" class="mob-solo" :aria-pressed="isolated === l.key" @click="solo(l.key)">
              <Focus :size="15" />{{ t(isolated === l.key ? 'mobility.showAll' : 'mobility.solo') }}
            </AppButton>
          </div>
          <details class="mob-config"><summary><ChevronDown :size="14" />{{ t('mobility.' + l.run.status) }}<b v-if="l.run.reached != null">{{ fmt(l.run.reached) }} s</b><span>{{ t('mobility.configure') }}</span></summary>
            <p v-if="l.run.status === 'unreachable'">{{ fmt(l.run.upper) }} km/h · 97%: {{ fmt(l.run.near) }} s</p>
            <p>{{ l.car.summary }}</p>
            <p v-for="item in l.car.carried" :key="item.stem">
              {{ t('mobility.carriedItem', { name: item.item?.[locale === 'zh' ? 'name_zh-Hans' : 'name_en'] || item.stem }) }}
              · {{ item.window ? t('mobility.activeWindow', { from: fmt(item.window.start), to: Number.isFinite(item.window.end) ? fmt(item.window.end) : '—' }) : t('mobility.inactive') }}
            </p>
          </details>
        </li>
      </ul>
      <AppButton v-if="!(expanded && focusPlot) && legend.length > legendLimit" size="sm" @click="legendLimit += 48">{{ t('mobBulk.moreLegend', { count: legend.length - legendLimit }) }}</AppButton>
      <details class="mob-crossings" v-if="!(expanded && focusPlot) && !single && vehicles.length > 1">
        <summary>{{ t('mobility.crossings') }}</summary>
        <select class="mob-field" v-model="pairA" :aria-label="t('mobility.first')" @change="pairB = ''"><option value="">—</option><option v-for="l in lines" :key="l.key" :value="l.key">{{ l.label }}</option></select>
        <select class="mob-field" v-model="pairB" :aria-label="t('mobility.second')"><option value="">—</option><option v-for="l in secondChoices" :key="l.key" :value="l.key">{{ l.label }}</option></select>
        <p v-if="crossings">{{ crossings.length ? crossings.map(([a,b]) => a === b ? '≈ ' + fmt(a) + ' s' : fmt(a) + '–' + fmt(b) + ' s').join(', ') : t('mobility.noCrossing') }}</p>
      </details>
      <footer class="mob-source">
        <details class="mob-model"><summary><Info :size="15" />{{ t('mobility.estimate') }} <ChevronDown :size="14" /></summary>
          <p>{{ t('mobility.modelLimits') }}</p>
          <a href="https://wg.blitzinfo.app/core-fallback.js" target="_blank" rel="noopener noreferrer">{{ t('mobility.modelSource') }}</a>
        </details><small>{{ dataset || t('mobility.missingVersion') }} · {{ modelRevision }}</small><AppButton v-if="!dataset" variant="ghost" size="sm" @click="loadMobilityDataset">{{ t('mobility.retry') }}</AppButton></footer>
      </div>
    </DefinePlot>
    <Plot v-if="!expanded" />
    <AppDialog :open="expanded" :title="t('mobility.chart')" size="viewport" @close="expanded = false"><Plot v-if="expanded" /></AppDialog>
  </section>
</template>
<style scoped>
.mob-chart { display: grid; gap: var(--space-4); min-inline-size: 0; padding: var(--space-4); border: 1px solid var(--color-border-subtle); border-radius: var(--radius-lg); }
.mob-tools, .mob-toolbar, .mob-actions, .mob-range, .mob-source, .mob-scrubber, .mob-search, .mob-series, .mob-config summary, .mob-tip div { display: flex; align-items: center; gap: var(--space-2); }
.mob-tools, .mob-toolbar, .mob-range, .mob-source { flex-wrap: wrap; }
.mob-tools h2 { margin: 0 auto 0 0; font: var(--type-h2); }
.mob-plot { display: grid; gap: var(--space-3); min-inline-size: 0; container-type: inline-size; }
.mob-toolbar { justify-content: space-between; gap: var(--space-3); }
.mob-range { align-items: end; padding: var(--space-3); border-radius: var(--radius-md); background: var(--color-surface-2); }
.mob-range label { display: grid; gap: var(--space-1); color: var(--color-text-secondary); font: var(--type-caption); }
.mob-range input { width: 9ch; font-variant-numeric: tabular-nums; }
.mob-area { position: relative; height: clamp(12rem, calc(100dvh - 21rem), 52rem); min-inline-size: 0; border: 1px solid var(--color-border-subtle); border-radius: var(--radius-md); background: var(--color-surface-1); }
.mob-expanded { gap: var(--space-2); }
.mob-expanded .mob-toolbar, .mob-expanded .mob-actions { gap: var(--space-1); }
@media (hover: hover) and (pointer: fine) {
  .mob-expanded .mob-actions :deep(.app-button) { padding-inline: var(--space-2); }
}
.mob-plot-focus .mob-area { height: max(12rem, calc(100dvh - 15rem)); }
.mob-area svg { display: block; width: 100%; height: 100%; touch-action: pan-y; cursor: crosshair; }
.mob-area line { stroke: var(--color-border-subtle); }
.mob-area .mob-cursor { stroke: var(--color-text-secondary); stroke-dasharray: 3 4; }
.mob-area text { fill: var(--color-text-secondary); font: var(--type-caption); font-variant-numeric: tabular-nums; }
.mob-point { stroke: var(--color-surface-1); stroke-width: 2; }
.mob-tip { position: absolute; top: var(--space-4); inline-size: max-content; max-inline-size: min(32rem, calc(var(--tip-space) - var(--space-4))); transform: translateX(var(--space-2)); pointer-events: none; padding: var(--space-2) var(--space-3); color: var(--color-text-primary); background: var(--color-surface-3); border: 1px solid var(--color-border-subtle); border-radius: var(--radius-md); box-shadow: var(--elevation-2); font: var(--type-caption); font-variant-numeric: tabular-nums; }
.mob-tip.is-before { transform: translateX(calc(-1 * var(--space-2))); }
.mob-tip div { margin-block-start: var(--space-1); }
.mob-tip div span { min-inline-size: 0; overflow-wrap: anywhere; }
.mob-tip i { width: var(--space-2); height: var(--space-2); border-radius: var(--radius-full); corner-shape: round; flex: none; }
.mob-tip strong { flex: none; margin-inline-start: auto; white-space: nowrap; }
.mob-scrubber { padding-inline: var(--space-1); font: var(--type-caption); color: var(--color-text-secondary); }
.mob-scrubber span, .mob-identity span { display: inline-flex; align-items: center; gap: var(--space-2); }
.mob-scrubber output { min-inline-size: 6ch; font: var(--type-h3); color: var(--color-text-primary); }
.mob-scrubber input { flex: 1; min-width: 4ch; min-height: var(--control-h-sm); accent-color: var(--color-accent); }
.mob-search input { width: min(100%, 24rem); }
.mob-legend { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 19rem), 1fr)); gap: var(--space-2); margin: 0; padding: 0; list-style: none; }
.mob-legend li { display: grid; align-content: start; min-width: 0; border: 1px solid var(--color-border-subtle); border-radius: var(--radius-md); background: var(--color-surface-2); }
.mob-series { flex-wrap: wrap; padding: var(--space-2) var(--space-3); }
.mob-visibility { display: inline-grid; place-items: center; min-width: var(--control-h-sm); min-height: var(--control-h-sm); border: 1px solid var(--color-border-subtle); border-radius: var(--radius-sm); color: var(--color-text-secondary); background: var(--color-surface-1); cursor: pointer; }
.mob-visibility[aria-pressed="true"] { color: var(--color-text-primary); }
.mob-visibility:hover, .mob-solo[aria-pressed="true"] { color: var(--color-accent); background: var(--color-surface-3); }
.mob-visibility:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }
.mob-identity { display: grid; flex: 1 1 7rem; min-width: 0; }
.mob-identity strong { font: var(--type-h3); overflow-wrap: anywhere; }
.mob-identity span, .mob-speed small, .mob-scrubber small { font: var(--type-caption); color: var(--color-text-secondary); }
.mob-identity i { width: var(--space-5); border-top: 3px solid var(--series); }
.mob-identity .sample-Medium { border-top-style: dashed; }
.mob-identity .sample-Soft { border-top-style: dotted; }
.mob-speed, .mob-scrubber output { font-variant-numeric: tabular-nums; }
.mob-speed { white-space: nowrap; font-size: var(--font-size-h3); font-weight: 600; }
.mob-config { padding: var(--space-1) var(--space-3); border-top: 1px solid var(--color-border-subtle); color: var(--color-text-secondary); font: var(--type-caption); }
.mob-config summary { min-height: var(--control-h-sm); cursor: pointer; }
.mob-config summary::-webkit-details-marker { display: none; }
.mob-config[open] summary svg { transform: rotate(180deg); }
.mob-config summary span { margin-inline-start: auto; }
.mob-config p { overflow-wrap: anywhere; }
.mob-crossings { color: var(--color-text-secondary); font: var(--type-caption); }
.mob-crossings summary { cursor: pointer; padding-block: var(--space-2); }
.mob-crossings select { max-width: 100%; margin-inline-end: var(--space-2); }
.mob-source { border-top: 1px solid var(--color-border-subtle); padding-block-start: var(--space-2); font: var(--type-caption); color: var(--color-text-secondary); }
.mob-model summary { cursor: pointer; display: flex; align-items: center; gap: var(--space-2); min-height: var(--control-h-sm); }
.mob-model p { max-inline-size: 65ch; }
.mob-model[open] summary svg:last-child { transform: rotate(180deg); }
.mob-source small { margin-inline-start: auto; font: inherit; }
@container (max-width: 38rem) {
  .mob-toolbar { align-items: start; }
  .mob-source small { margin-inline-start: 0; }
  .mob-area { height: clamp(14rem, 56dvh, 30rem); }
}
@media (pointer: coarse) {
  .mob-visibility, .mob-config summary { min-height: var(--control-h-lg); }
  .mob-visibility { min-width: var(--control-h-lg); }
}
</style>
