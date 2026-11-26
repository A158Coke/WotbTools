<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { createReusableTemplate, useElementSize, useEventListener } from '@vueuse/core'
import { useI18n } from 'vue-i18n'
import { ChevronDown, Crosshair, Expand, Eye, EyeOff, Focus, Info, Plus, Scan, Search, Timer, ZoomIn } from 'lucide-vue-next'
import SegmentedControl from './SegmentedControl.vue'
import '../styles/mobility-controls.css'
import AppButton from './AppButton.vue'
import AppDialog from './AppDialog.vue'
import { intersections, simulate, speedAt, stepSeconds, terrains } from '../replay-local/compute/mobility'
import { loadMobilityDataset, modelRevision } from '../composables/tankMobility'

import { defaultChartView, copyChartView, rankCurveReadings, type MobilityChartView } from '../composables/mobilityChartView'
import type { VehicleCurve } from '../composables/tankMobility'
import type { Phase, Run, Terrain } from '../replay-local/compute/mobility'

const props = defineProps<{ vehicles: VehicleCurve[]; dataset?: string | null; single?: boolean; initialView?: MobilityChartView; loading?: boolean }>()
const savedView = copyChartView(props.initialView || defaultChartView(props.single))
const { t, locale } = useI18n()
const numbers = computed(() => new Intl.NumberFormat(locale.value, { maximumFractionDigits: 2 }))
const [DefinePlot, Plot] = createReusableTemplate()
const expanded = ref(false)
const focusPlot = ref(false)
const terrain = ref<Terrain | 'all'>(savedView.terrain)
const terrainOptions = computed(() => [...terrains, 'all'].map(value => ({ value, label: t('mobility.' + value) })))
const rangeOpen = ref(false)
const inspecting = ref(false)
const singleColors = { Firm: 'var(--color-success)', Medium: 'var(--color-info)', Soft: 'var(--color-warning)' }
const hidden = ref<string[]>(savedView.hidden)
const isolated = ref(savedView.isolated)
const search = ref(savedView.search)
const cursor = ref(savedView.cursor)
const windowEnd = ref(savedView.windowEnd)
const zoom = ref<[number, number] | null>(savedView.zoom)
const from = ref(0)
const to = ref(30)
const area = ref<HTMLElement | null>(null)
const { width, height } = useElementSize(area)
const W = computed(() => Math.max(220, width.value))
const H = computed(() => Math.max(160, height.value))
const left = 48, top = 18, bottom = 34, right = 30
const pairA = ref(savedView.pairA)
const pairB = ref(savedView.pairB)
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
watch(() => [lines.value.map(line => line.key), props.loading] as const, ([keys, loading]) => {
  if (!loading && isolated.value && !keys.includes(isolated.value)) isolated.value = ''
})
const visible = computed(() => lines.value.filter(l => !hidden.value.includes(l.key) && (!isolated.value || l.key === isolated.value)))
const readings = computed(() => rankCurveReadings(visible.value, cursor.value))
const readingsOpen = ref(false)
const plotCursor = computed<number>(previous => readingsOpen.value ? previous ?? cursor.value : cursor.value)
const expandedReadings = ref(false)
let consumeAltUp = false
function leaveInspection() {
  inspecting.value = false
  expandedReadings.value = false
}
function resetInspection() {
  leaveInspection()
  consumeAltUp = false
}
useEventListener(window, 'keydown', event => {
  if (event.key !== 'Alt' || event.ctrlKey || event.metaKey || event.shiftKey || event.defaultPrevented ||
      !inspecting.value || readingsOpen.value || !visible.value.length ||
      (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'))) return
  event.preventDefault()
  flushCursor()
  expandedReadings.value = true
  consumeAltUp = true
})
useEventListener(window, 'keyup', event => {
  if (event.key !== 'Alt') return
  if (consumeAltUp) event.preventDefault()
  expandedReadings.value = false
  consumeAltUp = false
})
useEventListener(window, 'blur', resetInspection)
useEventListener(document, 'visibilitychange', resetInspection)
watch([expanded, readingsOpen, terrain], resetInspection)
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
let cursorFrame = 0
let pendingCursor: number | null = null
function cancelCursor() {
  cancelAnimationFrame(cursorFrame)
  cursorFrame = 0
  pendingCursor = null
}
function flushCursor() {
  const value = pendingCursor
  cancelCursor()
  if (value !== null) cursor.value = Math.max(extent.value[0], Math.min(extent.value[1], value))
}
function queueCursor(value: number) {
  if (!Number.isFinite(value)) return
  pendingCursor = value
  if (!cursorFrame) cursorFrame = requestAnimationFrame(flushCursor)
}
function inputCursor(event: Event) { queueCursor((event.target as HTMLInputElement).valueAsNumber) }
function finishCursor(event: Event) { inputCursor(event); flushCursor() }
function showReadings(open: boolean) {
  flushCursor()
  readingsOpen.value = open
}
onBeforeUnmount(() => { cancelCursor(); resetInspection() })
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
watch(() => [extent.value, props.loading] as const, ([[a, b], loading]) => {
  from.value = a
  to.value = b
  if (!loading && visible.value.some(line => line.run.speeds.length)) cursor.value = Math.max(a, Math.min(b, cursor.value))
}, { immediate: true })
watch(terrain, () => { isolated.value = ''; pairA.value = ''; pairB.value = '' }, { flush: 'sync' })
const drag = ref<number | null>(null)
function pointerTime(event: PointerEvent) {
  const rect = (event.currentTarget as SVGSVGElement).getBoundingClientRect()
  const fraction = Math.max(0, Math.min(1, (event.clientX - rect.left - left) / (rect.width - left - right)))
  return extent.value[0] + fraction * (extent.value[1] - extent.value[0])
}
function press(event: PointerEvent) {
  if (!event.isPrimary || event.button !== 0 || expandedReadings.value) return
  const svg = event.currentTarget as SVGSVGElement
  svg.setPointerCapture?.(event.pointerId)
  cancelCursor()
  cursor.value = pointerTime(event)
  drag.value = cursor.value
}
function release(event: PointerEvent) {
  flushCursor()
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
function snapshotView(): MobilityChartView {
  flushCursor()
  return copyChartView({ terrain: terrain.value, hidden: hidden.value, isolated: isolated.value,
    cursor: cursor.value, windowEnd: windowEnd.value, zoom: zoom.value, search: search.value, pairA: pairA.value, pairB: pairB.value })
}
function restoreView(value: MobilityChartView) {
  cancelCursor()
  resetInspection()
  const v = copyChartView(value)
  terrain.value = v.terrain
  hidden.value = v.hidden
  isolated.value = v.isolated
  windowEnd.value = v.windowEnd
  zoom.value = v.zoom
  search.value = v.search
  pairA.value = v.pairA
  pairB.value = v.pairB
  cursor.value = v.cursor
  expanded.value = false
}
defineExpose({ snapshotView, restoreView })
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
      <div ref="area" class="mob-area" @pointerleave="leaveInspection" @pointercancel="resetInspection">
        <svg :viewBox="'0 0 ' + W + ' ' + H" role="img" :aria-label="t('mobility.chart')"
          @pointerenter="inspecting = true" @pointerdown="inspecting = true; press($event)" @pointermove="!expandedReadings && queueCursor(pointerTime($event))" @pointerup="release" @pointercancel="drag = null">
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
          <line v-if="inspecting || plotCursor > 0" class="mob-cursor" :x1="x(plotCursor)" :x2="x(plotCursor)" :y1="top" :y2="H-bottom" />
          <g v-if="inspecting || plotCursor > 0">
            <template v-for="l in visible" :key="l.key"><circle v-if="speedAt(l.run.speeds, plotCursor) != null" :cx="x(plotCursor)" :cy="y(speedAt(l.run.speeds, plotCursor)!)" r="4" :fill="l.color" class="mob-point" /></template>
          </g>
        </svg>
        <div v-if="inspecting && visible.length" class="mob-tip" :style="tipPosition" :class="{ 'is-before': x(cursor) > W / 2, 'is-expanded': expandedReadings }" @wheel.stop>
          <b>{{ fmt(cursor) }} s</b><div v-for="{ line: l, speed } in (expandedReadings ? readings : readings.slice(0, 4))" :key="l.key"><i :style="{ background: l.color }" /><span>{{ l.label }}</span><strong>{{ fmt(speed) }} km/h</strong></div>
          <small v-if="expandedReadings">{{ t('mob1016.releaseAlt') }}</small>
          <small v-else-if="readings.length > 4">{{ t('mob1016.moreCurves', { count: readings.length - 4 }) }} · {{ t('mob1016.holdAlt') }}</small>
        </div>
      </div>
      <label class="mob-scrubber">
        <span><Crosshair :size="16" />{{ t('mobility.cursor') }}</span>
        <output>{{ fmt(plotCursor) }} <small>s</small></output>
        <input :value="plotCursor" type="range" :min="extent[0]" :max="extent[1]" :step="stepSeconds" @input="inputCursor" @change="finishCursor" @pointerup="finishCursor" @pointercancel="finishCursor" />
      </label>
      <label v-if="!(expanded && focusPlot) && lines.length > 3" class="mob-search"><Search :size="16" /><input class="mob-field" v-model="search" type="search" :placeholder="t('mobility.search')" :aria-label="t('mobility.search')" /></label>
      <AppButton size="sm" variant="ghost" class="mob-readings-button" @click="showReadings(true)">{{ t('mob1016.allReadings') }} · {{ fmt(plotCursor) }} s</AppButton>
      <ul v-if="!(expanded && focusPlot)" class="mob-legend">
        <li v-for="l in legend.slice(0, legendLimit)" :key="l.key" :style="{ '--series': l.color }">
          <div class="mob-series">
            <button type="button" class="mob-visibility" :aria-label="l.label" :aria-pressed="!hidden.includes(l.key)" @click="toggle(l.key)">
              <Eye v-if="!hidden.includes(l.key)" :size="16" /><EyeOff v-else :size="16" />
            </button>
            <div class="mob-identity"><strong>{{ l.car.name }}</strong><span><i :class="'sample-' + l.ground" />{{ t('mobility.' + l.ground) }}</span></div>
            <output class="mob-speed">{{ fmt(speedAt(l.run.speeds, plotCursor)) }} <small>km/h</small></output>
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
    <AppDialog :open="readingsOpen" :title="t('mob1016.allReadings')" size="lg" @close="showReadings(false)">
      <label class="mob-scrubber mob-reading-scrubber">
        <span>{{ t('mobility.cursor') }} <output>{{ fmt(cursor) }} <small>s</small></output></span>
        <input :value="cursor" type="range" :min="extent[0]" :max="extent[1]" :step="stepSeconds" @input="inputCursor" @change="finishCursor" @pointerup="finishCursor" @pointercancel="finishCursor" />
      </label>
      <table class="mob-reading-table">
        <caption>{{ t('mob1016.descending') }}</caption>
        <thead><tr><th>{{ t('mob1016.vehicle') }}</th><th>{{ t('mobility.ground') }}</th><th>km/h</th></tr></thead>
        <tbody><tr v-for="{ line, speed } in readings" :key="line.key">
          <th scope="row"><i :style="{ borderColor: line.color }" />{{ line.car.name }}</th>
          <td>{{ t('mobility.' + line.ground) }}</td><td>{{ fmt(speed) }}</td>
        </tr></tbody>
      </table>
    </AppDialog>
  </section>
</template>
<style scoped>
.mob-readings-button { justify-self: start; }
.mob-reading-table { inline-size: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
.mob-reading-table th, .mob-reading-table td { padding: var(--space-2); border-bottom: 1px solid var(--color-border-subtle); text-align: start; overflow-wrap: anywhere; }
.mob-reading-table td:last-child { text-align: end; white-space: nowrap; }
.mob-reading-table i { display: inline-block; inline-size: var(--space-3); margin-inline-end: var(--space-2); border-top: 3px solid; }
.mob-reading-table caption { text-align: start; color: var(--color-text-secondary); padding-block: var(--space-2); }
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
.mob-tip.is-expanded { max-block-size: 60%; overflow-y: auto; overscroll-behavior: contain; pointer-events: auto; }
.mob-tip small { display: block; margin-block-start: var(--space-1); }
.mob-tip div { margin-block-start: var(--space-1); }
.mob-tip div span { min-inline-size: 0; overflow-wrap: anywhere; }
.mob-tip i { width: var(--space-2); height: var(--space-2); border-radius: var(--radius-full); corner-shape: round; flex: none; }
.mob-tip strong { flex: none; margin-inline-start: auto; white-space: nowrap; }
.mob-scrubber { padding-inline: var(--space-1); font: var(--type-caption); color: var(--color-text-secondary); }
.mob-scrubber span, .mob-identity span { display: inline-flex; align-items: center; gap: var(--space-2); }
.mob-scrubber output { min-inline-size: 6ch; font: var(--type-h3); color: var(--color-text-primary); }
.mob-scrubber input { flex: 1; min-width: 4ch; min-height: var(--control-h-sm); accent-color: var(--color-accent); }
.mob-reading-scrubber { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--space-2); }
.mob-reading-scrubber > span { justify-content: space-between; }
.mob-reading-scrubber input { inline-size: 100%; margin-inline: 0; }
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
