<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowReactive, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { locationForView } from '../app/navigation'
import { useI18n } from 'vue-i18n'
import { fetchTankEncyclopedia } from '../scene/agentData.js'
import { normalizeTankCache } from '../utils/tankopediaQuery.js'
import { terrains } from '../replay-local/compute/mobility'
import { loadMobilityDataset, readComparison, readSeed, saveComparison, useMobilityDataset } from '../composables/tankMobility'
import MobilityBatchDialog from './MobilityBatchDialog.vue'
import type { BatchGroup, BatchSetup } from '../composables/mobilityBatch'
import '../styles/mobility-controls.css'
import { ArrowLeft, GitCompareArrows } from 'lucide-vue-next'
import EmptyState from './EmptyState.vue'
import AppButton from './AppButton.vue'
import AppDialog from './AppDialog.vue'
import TankCatalogMenu from './TankCatalogMenu.vue'
import MobilityChart from './MobilityChart.vue'
import MobilityVehicleColumn from './MobilityVehicleColumn.vue'
import type { ComparisonEntry, VehicleCurve } from '../composables/tankMobility'
const { t } = useI18n()
const route = useRoute(), router = useRouter()
const returnLocation = computed(() => {
  const fallback = locationForView('agent-tankopedia', route)
  const origin = route.query.mobilityReturn
  if (typeof origin !== 'string' || !origin.startsWith('/') || origin.startsWith('//')) return fallback
  const resolved = router.resolve(origin)
  if (!['/', '/index.html'].includes(resolved.path) || resolved.query.view !== 'agent-tankopedia') return fallback
  return { path: resolved.path, query: resolved.query, hash: resolved.hash }
})
const dataset = useMobilityDataset()
const entries = shallowRef<ComparisonEntry[]>([])
const contexts = shallowReactive(new Map<string, BatchSetup>())
const batch = ref<{ id: string; group: BatchGroup } | null>(null)
const source = computed(() => entries.value.find(e => e.id === batch.value?.id))
const undo = shallowRef<ComparisonEntry[] | null>(null)
const modified = ref(0)
// Persist an entire transaction once. Spread only its table and curve projection across frames.
const rendered = shallowRef<ComparisonEntry[]>([])
const remaining = ref(0)
const currentById = computed(() => new Map(entries.value.map(row => [row.id, row])))
let frame = 0
watch(entries, next => {
  cancelAnimationFrame(frame)
  const current = new Map(rendered.value.map(row => [row.id, row]))
  const rows = next.map(row => current.get(row.id))
  const dirty = next.flatMap((row, i) => rows[i] === row ? [] : [i])
  let cursor = 0
  function advance() {
    const end = Math.min(cursor + 8, dirty.length)
    for (; cursor < end; cursor++) rows[dirty[cursor]] = next[dirty[cursor]]
    remaining.value = dirty.length - cursor
    rendered.value = remaining.value ? rows.filter((row): row is ComparisonEntry => !!row) : next
    if (remaining.value) frame = requestAnimationFrame(advance)
  }
  advance()
}, { flush: 'sync' })
onBeforeUnmount(() => cancelAnimationFrame(frame))
const curves = new Map<string, VehicleCurve>()
const selectedCurves = shallowRef<VehicleCurve[]>([])
let chartFrame = 0
function publishCurves() {
  chartFrame = 0
  selectedCurves.value = entries.value.map(e => curves.get(e.id)).filter((curve): curve is VehicleCurve => !!curve)
}
function refreshCurves() {
  if (entries.value.length <= 8) {
    cancelAnimationFrame(chartFrame)
    publishCurves()
  } else if (!chartFrame) chartFrame = requestAnimationFrame(publishCurves)
}
function setCurve(curve: VehicleCurve) { curves.set(curve.id, curve); refreshCurves() }
watch(entries, refreshCurves)
onBeforeUnmount(() => cancelAnimationFrame(chartFrame))
const expired = ref(false)
const picker = ref(false), tanks = ref<ReturnType<typeof normalizeTankCache>>([]), state = ref('loading'), filters = ref({ sort: 'speed' })
const key = ref<string | null>(null)
watch(() => [route.query.comparison, route.query.mobilitySeed], ([value, encoded]) => {
  if (value && value === key.value && !encoded) return
  if (value !== key.value) { undo.value = null; modified.value = 0; batch.value = null }
  key.value = typeof value === 'string' ? value : null
  const restored = readComparison(value)
  const seed = readSeed(encoded)
  entries.value = restored || (seed ? [seed] : [])
  expired.value = !!(value || encoded) && !restored && !seed
  const ids = new Set(entries.value.map(e => e.id))
  for (const id of curves.keys()) if (!ids.has(id)) { curves.delete(id); contexts.delete(id) }
}, { immediate: true })
async function save(next: ComparisonEntry[], remember = false) {
  undo.value = remember ? entries.value : null
  if (!remember) modified.value = 0
  const id = key.value || crypto.randomUUID()
  expired.value = false
  key.value = id
  entries.value = next
  saveComparison(id, next)
  if (route.query.comparison !== id || route.query.mobilitySeed) {
    const query: import('vue-router').LocationQueryRaw = { ...route.query, comparison: id }
    delete query.mobilitySeed
    await router.replace({ query })
  }
}
async function choose() {
  picker.value = true
  if (tanks.value.length) return
  state.value = 'loading'
  try { tanks.value = normalizeTankCache(await fetchTankEncyclopedia()); state.value = 'ready' }
  catch { state.value = 'error' }
}
function add(picked: { id: number; name: string }[]) {
  if (!dataset.value || !picked.length || !picker.value) return
  const colors = new Set(entries.value.map(e => e.seriesIndex))
  let seriesIndex = 0
  const aliases = new Map<number, Set<string>>()
  const names = new Map(picked.map(t => [t.id, t.name]))
  for (const entry of entries.value) {
    if (!aliases.has(entry.tank)) aliases.set(entry.tank, new Set())
    aliases.get(entry.tank)!.add(entry.alias || names.get(entry.tank) || '')
  }
  const added = picked.map(tank => {
    while (colors.has(seriesIndex)) seriesIndex++
    const used = aliases.get(tank.id)
    let alias = tank.name
    for (let suffix = 2; used?.has(alias); suffix++) alias = tank.name + ' (' + suffix + ')'
    return { id: crypto.randomUUID(), tank: tank.id, dataset: dataset.value!, seriesIndex: seriesIndex++, alias, activations: {} }
  })
  picker.value = false
  save([...entries.value, ...added])
}
function applyBatch(changes: Map<string, ComparisonEntry>) {
  if (!batch.value || !changes.size) return
  batch.value = null
  modified.value = changes.size
  save(entries.value.map(entry => changes.get(entry.id) || entry), true)
}
function setContext(id: string, context?: BatchSetup) {
  if (context) contexts.set(id, context)
  else contexts.delete(id)
}
function move(i: number, delta: number) {
  const next = entries.value.slice()
  if (i < 0 || i + delta < 0 || i + delta >= next.length) return
  next.splice(i + delta, 0, ...next.splice(i, 1))
  save(next)
}
function remove(id: string) {
  curves.delete(id)
  contexts.delete(id)
  save(entries.value.filter(e => e.id !== id))
}
</script>
<template>
  <section class="mob-page">
    <header class="mob-page-heading">
      <AppButton variant="ghost" data-testid="mobility-back" @click="router.push(returnLocation)"><ArrowLeft :size="18" />{{ t('mobBulk.back') }}</AppButton>
      <h1>{{ t('mobility.compare') }}</h1>
    </header>
    <p v-if="expired" role="status">{{ t('mobility.expired') }}</p>
    <p v-if="!dataset" role="status">{{ t('mobility.missingVersion') }} <button @click="loadMobilityDataset">{{ t('mobility.retry') }}</button></p>
    <EmptyState v-if="!entries.length" class="mob-empty" :title="t('mobBulk.emptyTitle')" :description="t('mobBulk.empty')" :icon="GitCompareArrows">
      <div class="mob-page-actions"><AppButton class="mob-action" variant="primary" :disabled="!dataset" @click="choose">{{ t('mobility.add') }}</AppButton></div>
    </EmptyState>
    <div v-else class="mob-page-actions"><AppButton class="mob-action" variant="primary" :disabled="!dataset" @click="choose">{{ t('mobility.add') }}</AppButton>
      <template v-if="undo"><span role="status">{{ t('mobBulk.applied', { count: modified }) }}</span><AppButton @click="save(undo)">{{ t('mobBulk.undo') }}</AppButton></template>
    </div>
    <p v-if="remaining" class="mob-progress">{{ t('mobBulk.updating', { count: remaining }) }}</p>
    <div v-if="entries.length" class="mob-scroll">
      <div class="mob-table">
        <div class="mob-heading">
          <strong>{{ t('mobility.startConfig') }}</strong>
          <span>{{ t('agentTanks.params.thrustToWeightRatio') }} (hp/t)</span>
          <span v-for="g in terrains" :key="g">{{ t('agentTanks.params.effectivePower' + g) }} (hp/t)</span>
          <span v-for="g in terrains" :key="g">{{ t('agentTanks.params.terrainPermeability' + g) }} (%)</span>
        </div>
        <MobilityVehicleColumn v-for="e in rendered" :key="e.id" :inert="currentById.get(e.id) !== e" v-memo="[e, dataset, currentById.get(e.id) !== e]" :entry="e" :dataset="dataset"
          @update="(v: ComparisonEntry) => save(entries.map(entry => entry.id === e.id ? v : entry))"
          @context="setContext(e.id, $event)" @batch="batch = { id: e.id, group: $event }"
          @remove="remove(e.id)" @move="move(entries.findIndex(row => row.id === e.id), $event)" @curve="setCurve" />
      </div>
    </div>
    <MobilityChart v-if="entries.length" :vehicles="selectedCurves" :dataset="dataset" />
    <MobilityBatchDialog v-if="batch && source" :group="batch.group" :source="source" :dataset="dataset" :entries="entries" :contexts="contexts"
      @close="batch = null" @apply="applyBatch" />
    <AppDialog :open="picker" :title="t('mobility.add')" size="xl" @close="picker = false">
      <TankCatalogMenu v-if="picker" multiple layout="dialog" :tanks="tanks" :state="state" :filters="filters" @update:filters="filters = $event" @confirm="add" @retry="choose" />
    </AppDialog>
  </section>
</template>
<style scoped>
.mob-page-heading { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); }
.mob-page-heading h1 { margin: 0; }
.mob-progress { margin: 0; color: var(--color-text-secondary); font: var(--type-caption); }
.mob-page-actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); }
.mob-empty { border: 1px solid var(--color-border-subtle); border-radius: var(--radius-lg); background: var(--color-surface-1); }
.mob-page { padding: var(--space-4); display: grid; gap: var(--space-4); min-width: 0; }
.mob-scroll { overflow-x: auto; border: 1px solid var(--color-border-subtle); border-radius: var(--radius-lg); background: var(--color-surface-1); }
.mob-table { display: grid; grid-auto-flow: column; grid-template-rows: auto repeat(7, auto); grid-template-columns: minmax(9rem, max-content); grid-auto-columns: minmax(13rem, 1fr); gap: 0; }
.mob-heading { display: grid; grid-row: 1 / span 8; grid-template-rows: subgrid; position: sticky; inset-inline-start: 0; z-index: var(--z-sticky); background: var(--color-surface-1); }
.mob-heading > * { padding: var(--space-2) var(--space-3); }
.mob-heading span { border-top: 1px solid var(--color-border-subtle); }
.mob-heading strong { align-self: end; }
</style>
