<script setup lang="ts">

import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowReactive, shallowRef, watch } from 'vue'
import { createReusableTemplate } from '@vueuse/core'
import { useRoute, useRouter } from 'vue-router'
import { locationForView } from '../app/navigation'
import { useI18n } from 'vue-i18n'
import { fetchTankEncyclopedia } from '../scene/agentData.js'
import { loadResearchCatalog } from '../utils/researchCatalog'
import { normalizeTankCache } from '../utils/tankopediaQuery.js'
import {
  loadMobilityDataset, readComparisonDocument, readComparisonSeed, saveComparison, useMobilityDataset,
  emptyComparison, emptyCrew, crewForEntry, type ComparisonDocument, type CrewSettings,
  type ComparisonEntry, type VehicleCurve,
} from '../composables/tankMobility'
import { copyChartView, type MobilityChartView } from '../composables/mobilityChartView'
import { mobilityRows, mobilityCellId } from '../composables/mobilityRows'
import MobilityBatchDialog from './MobilityBatchDialog.vue'
import type { BatchGroup, BatchSetup } from '../composables/mobilityBatch'
import '../styles/mobility-controls.css'
import { ArrowLeft, GitCompareArrows, Plus, Trash2, UserRound, Undo2 } from 'lucide-vue-next'
import EmptyState from './EmptyState.vue'
import AppButton from './AppButton.vue'
import AppDialog from './AppDialog.vue'
import TankCatalogMenu from './TankCatalogMenu.vue'
import CrewSkillsPanel from './CrewSkillsPanel.vue'
import MobilityChart from './MobilityChart.vue'
import MobilityVehicleColumn from './MobilityVehicleColumn.vue'

const { t, locale } = useI18n()
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
const document = shallowRef<ComparisonDocument>(emptyComparison())
const entries = computed(() => document.value.entries)
const contexts = shallowReactive(new Map<string, BatchSetup>())
const batch = ref<{ id: string; group: BatchGroup } | null>(null)
const source = computed(() => entries.value.find(e => e.id === batch.value?.id))
type Undo = { kind: 'batch' | 'clear' | 'crew'; document: ComparisonDocument; view?: MobilityChartView; count: number }
const undo = shallowRef<Undo | null>(null)
const chart = ref<InstanceType<typeof MobilityChart> | null>(null)
const chartRestore = shallowRef<MobilityChartView>()
const storageFallback = ref(false)
type RenderRow = { entry: ComparisonEntry; crew: CrewSettings }
const rowCache = new WeakMap<ComparisonEntry, RenderRow>()
const currentRows = computed(() => entries.value.map(entry => {
  const crew = crewForEntry(document.value, entry.id)
  const cached = rowCache.get(entry)
  if (cached?.crew === crew) return cached
  const row = { entry, crew }
  rowCache.set(entry, row)
  return row
}))
const currentById = computed(() => new Map(currentRows.value.map(row => [row.entry.id, row])))
const rendered = shallowRef<RenderRow[]>([])
const remaining = ref(0)
const curves = new Map<string, { row: RenderRow; curve: VehicleCurve }>()
const contextRows = new Map<string, RenderRow>()
const selectedCurves = shallowRef<VehicleCurve[]>([])
let frame = 0, chartFrame = 0
function publishCurves() {
  chartFrame = 0
  selectedCurves.value = currentRows.value.flatMap(row => {
    const saved = curves.get(row.entry.id)
    return saved?.row === row ? [saved.curve] : []
  })
}
function refreshCurves() {
  if (entries.value.length <= 8) {
    cancelAnimationFrame(chartFrame)
    publishCurves()
  } else if (!chartFrame) chartFrame = requestAnimationFrame(publishCurves)
}
watch(currentRows, next => {
  cancelAnimationFrame(frame)
  const previous = new Map(rendered.value.map(row => [row.entry.id, row]))
  const rows = next.map(row => previous.get(row.entry.id))
  const dirty = next.flatMap((row, i) => rows[i] === row ? [] : [i])
  for (const [id, row] of contextRows) if (currentById.value.get(id) !== row) { contexts.delete(id); contextRows.delete(id) }
  for (const [id, saved] of curves) if (currentById.value.get(id) !== saved.row) curves.delete(id)
  if (batch.value && !currentById.value.has(batch.value.id)) batch.value = null
  function advance() {
    const end = Math.min(cursor + 8, dirty.length)
    for (; cursor < end; cursor++) rows[dirty[cursor]] = next[dirty[cursor]]
    remaining.value = dirty.length - cursor
    rendered.value = remaining.value ? rows.filter((row): row is RenderRow => !!row) : next
    if (remaining.value) frame = requestAnimationFrame(advance)
  }
  let cursor = 0
  advance()
  refreshCurves()
}, { flush: 'sync', immediate: true })
onBeforeUnmount(() => { cancelAnimationFrame(frame); cancelAnimationFrame(chartFrame) })
function setCurve(row: RenderRow, curve: VehicleCurve) {
  if (currentById.value.get(row.entry.id) !== row) return
  curves.set(row.entry.id, { row, curve })
  refreshCurves()
}
function setContext(row: RenderRow, context?: BatchSetup) {
  if (currentById.value.get(row.entry.id) !== row) return
  if (context) { contexts.set(row.entry.id, context); contextRows.set(row.entry.id, row) }
  else { contexts.delete(row.entry.id); contextRows.delete(row.entry.id) }
}
const catalog = shallowRef<Awaited<ReturnType<typeof loadResearchCatalog>> | null>(null)
const catalogError = ref(false)
async function loadCatalog() {
  catalogError.value = false
  try { catalog.value = await loadResearchCatalog() } catch { catalogError.value = true }
}
onMounted(loadCatalog)
const problem = ref<'missing' | 'invalid' | 'unsupported' | null>(null)
const picker = ref(false), tanks = ref<ReturnType<typeof normalizeTankCache>>([]), state = ref('loading'), filters = ref({ sort: 'speed' })
const key = ref<string | null>(null)
const crewOpen = ref(false)
const crewDraft = ref<CrewSettings>(emptyCrew())
const [DefineCrewControl, CrewControl] = createReusableTemplate()
watch(() => [route.query.comparison, route.query.mobilitySeed, catalog.value] as const, ([value, encoded, nextCatalog], previous) => {
  if (value && value === key.value && !encoded && nextCatalog === previous?.[2]) return
  const switched = (typeof value === 'string' ? value : null) !== key.value
  if (switched) { undo.value = null; batch.value = null; crewOpen.value = false; picker.value = false; chartRestore.value = undefined }
  key.value = typeof value === 'string' ? value : null
  const skillIds = nextCatalog ? Object.keys(nextCatalog.skills || {}) : undefined
  const stored = readComparisonDocument(value, skillIds)
  const seed = readComparisonSeed(encoded, skillIds)
  const result = stored.status === 'ready' ? stored : seed.status === 'ready' ? seed : stored.status !== 'missing' ? stored : seed
  if (result.status === 'ready') {
    document.value = result.document
    problem.value = null
  } else {
    problem.value = value || encoded ? result.status : null
    document.value = emptyComparison()
    key.value = null
  }
}, { immediate: true })

async function commit(next: ComparisonDocument, kind?: Undo['kind'], count = 0) {
  undo.value = kind ? {
    kind, document: JSON.parse(JSON.stringify(document.value)), count,
    view: chart.value?.snapshotView(),
  } : null
  const id = key.value || crypto.randomUUID()
  storageFallback.value = saveComparison(id, next) === 'memory'
  problem.value = null
  key.value = id
  document.value = next
  if (route.query.comparison !== id || route.query.mobilitySeed) {
    const query: import('vue-router').LocationQueryRaw = { ...route.query, comparison: id }
    delete query.mobilitySeed
    await router.replace({ query })
  }
}
function save(next: ComparisonEntry[], kind?: Undo['kind'], count = 0) {
  const ids = new Set(next.map(e => e.id))
  const overrides = Object.fromEntries(Object.entries(document.value.legacyCrewOverrides || {}).filter(([id]) => ids.has(id)))
  return commit({ v: 2, entries: next, crew: document.value.crew,
    ...(Object.keys(overrides).length ? { legacyCrewOverrides: overrides } : {}) }, kind, count)
}
async function undoChange() {
  const snapshot = undo.value
  if (!snapshot) return
  chartRestore.value = snapshot.view && copyChartView(snapshot.view)
  await commit(snapshot.document)
  await nextTick()
  if (snapshot.view) chart.value?.restoreView(snapshot.view)
}
function clearVehicles() {
  if (!entries.value.length) return
  batch.value = null
  picker.value = false
  chartRestore.value = undefined
  save([], 'clear', entries.value.length)
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
  save(entries.value.map(entry => changes.get(entry.id) || entry), 'batch', changes.size)
}
function move(id: string, delta: number) {
  const index = entries.value.findIndex(e => e.id === id)
  const next = entries.value.slice()
  if (index < 0 || index + delta < 0 || index + delta >= next.length) return
  next.splice(index + delta, 0, ...next.splice(index, 1))
  save(next)
}
function remove(id: string) { save(entries.value.filter(e => e.id !== id)) }
function openCrew() {
  crewDraft.value = { skills: { ...document.value.crew.skills }, conditionalSkills: document.value.crew.conditionalSkills }
  crewOpen.value = true
}
function cycleSkill(id: string, max: boolean) {
  const skills = { ...crewDraft.value.skills }, old = skills[id] || 0
  if (!max && old === 7) delete skills[id]
  else skills[id] = max ? 7 : old + 1
  crewDraft.value = { ...crewDraft.value, skills }
}
function applyCrew() {
  const next: ComparisonDocument = { v: 2, entries: entries.value, crew: {
    skills: { ...crewDraft.value.skills }, conditionalSkills: crewDraft.value.conditionalSkills,
  } }
  crewOpen.value = false
  commit(next, 'crew', entries.value.length)
}
const legacy = computed(() => entries.value.filter(entry => document.value.legacyCrewOverrides?.[entry.id]))
function crewDescription(crew: CrewSettings) {
  return Object.entries(crew.skills).map(([id, level]) => {
    const item = catalog.value?.skills?.[id]
    return (item?.[locale.value === 'zh' ? 'name_zh-Hans' : 'name_en'] || id) + ' ' + level
  }).join(', ') + ' · ' + t(crew.conditionalSkills ? 'mob1016.triggerOn' : 'mob1016.triggerOff')
}
function rowCells(key: string) {
  return rendered.value.map(row => mobilityCellId(row.entry.id, key)).join(' ')
}
</script>

<template>
  <section class="mob-page">
    <DefineCrewControl>
      <div class="mob-crew-control">
        <AppButton class="mob-crew-button" :disabled="!catalog" data-testid="mobility-crew" @click="openCrew"><UserRound :size="17" />{{ t('agentTanks.configurator.crew_skills') }}</AppButton>
        <div class="mob-crew-status"><small>{{ Object.keys(document.crew.skills).length ? t('mob1016.skillSummary', { count: Object.keys(document.crew.skills).length }) : t('mob1016.noSkills') }}</small>
          <span :class="{ 'is-active': document.crew.conditionalSkills }">{{ t(document.crew.conditionalSkills ? 'mob1016.triggerOn' : 'mob1016.triggerOff') }}</span>
        </div>
        <small v-if="legacy.length" class="mob-legacy">{{ t('mob1016.legacyCount', { count: legacy.length }) }}</small>
        <AppButton v-if="catalogError" size="sm" @click="loadCatalog">{{ t('mobility.retry') }}</AppButton>
      </div>
    </DefineCrewControl>
    <header class="mob-page-heading">
      <div class="mob-page-title">
        <AppButton variant="ghost" data-testid="mobility-back" @click="router.push(returnLocation)"><ArrowLeft :size="18" />{{ t('mobBulk.back') }}</AppButton>
        <h1>{{ t('mobility.compare') }}</h1>
      </div>
      <div class="mob-page-actions">
        <span class="mob-selected">{{ t('mob1016.selected', { count: entries.length }) }}</span>
        <AppButton class="mob-action" data-testid="mobility-clear" :disabled="!entries.length" @click="clearVehicles"><Trash2 :size="16" />{{ t('mob1016.clear') }}</AppButton>
        <AppButton class="mob-action" variant="primary" data-testid="mobility-add" :disabled="!dataset" @click="choose"><Plus :size="18" />{{ t('mobility.add') }}</AppButton>
      </div>
    </header>
    <div v-if="undo" class="mob-undo" role="status">
      <span>{{ t(undo.kind === 'clear' ? 'mob1016.cleared' : undo.kind === 'crew' ? 'mob1016.crewApplied' : 'mobBulk.applied', { count: undo.count }) }}</span>
      <AppButton size="sm" data-testid="mobility-undo" @click="undoChange"><Undo2 :size="16" />{{ t('mobBulk.undo') }}</AppButton>
    </div>
    <p v-if="problem" role="status">{{ t(problem === 'unsupported' ? 'mob1016.unsupported' : problem === 'invalid' ? 'mob1016.invalid' : 'mobility.expired') }}</p>
    <p v-if="storageFallback" role="status">{{ t('mob1016.memoryOnly') }}</p>
    <p v-if="!dataset" role="status">{{ t('mobility.missingVersion') }} <AppButton size="sm" @click="loadMobilityDataset">{{ t('mobility.retry') }}</AppButton></p>
    <EmptyState v-if="!entries.length" class="mob-empty" :title="t('mobBulk.emptyTitle')" :description="t('mobBulk.empty')" :icon="GitCompareArrows"><CrewControl /></EmptyState>
    <p v-if="remaining" class="mob-progress" role="status">{{ t('mobBulk.updating', { count: remaining }) }}</p>
    <div v-if="entries.length" class="mob-scroll">
      <div class="mob-table" role="table" :aria-label="t('mobility.compare')" :aria-rowcount="10" :aria-colcount="entries.length + 1">
        <div class="mob-heading" role="rowgroup">
          <div class="mob-cross-header" role="row" :aria-owns="rowCells('header')" :aria-rowindex="1">
            <div role="columnheader"><CrewControl /></div>
          </div>
          <div v-for="(row, i) in mobilityRows" :key="row.key" role="row" :aria-rowindex="i + 2" :aria-owns="rowCells(row.key)" :class="{ 'mob-label-group': row.kind === 'group', 'mob-ground-row': !!row.terrain }">
            <span :id="'mob-label-' + row.key" role="rowheader">{{ t(row.label) }}<small v-if="row.unit">{{ row.unit }}</small></span>
          </div>
        </div>
        <MobilityVehicleColumn v-for="(row, i) in rendered" :key="row.entry.id" :inert="currentById.get(row.entry.id) !== row" v-memo="[row, dataset, i, currentById.get(row.entry.id) !== row]"
          :entry="row.entry" :crew="row.crew" :dataset="dataset" :column-index="i + 2"
          @context="setContext(row, $event)" @batch="batch = { id: row.entry.id, group: $event }"
          @update="value => save(entries.map(entry => entry.id === row.entry.id ? value : entry))"
          @remove="remove(row.entry.id)" @move="move(row.entry.id, $event)" @curve="setCurve(row, $event)" />
      </div>
    </div>
    <MobilityChart v-if="entries.length" :key="key || 'comparison'" ref="chart" :initial-view="chartRestore" :loading="remaining > 0 || selectedCurves.length < entries.length || selectedCurves.some(curve => curve.loading)" :vehicles="selectedCurves" :dataset="dataset" />
    <MobilityBatchDialog v-if="batch && source" :group="batch.group" :source="source" :dataset="dataset" :entries="entries" :contexts="contexts" @close="batch = null" @apply="applyBatch" />
    <AppDialog :open="picker" :title="t('mobility.add')" size="xl" @close="picker = false">
      <TankCatalogMenu v-if="picker" multiple inline-filters layout="dialog" :tanks="tanks" :state="state" :filters="filters" @update:filters="filters = $event" @confirm="add" @retry="choose" />
    </AppDialog>
    <AppDialog :open="crewOpen" :title="t('agentTanks.configurator.crew_skills')" size="xl" @close="crewOpen = false">
      <template v-if="catalog">
        <p>{{ t('mob1016.globalCrewHint') }}</p>
        <div v-if="legacy.length" class="mob-crew-legacy">
          <p>{{ t('mob1016.legacyHint') }}</p>
          <ul><li v-for="entry in legacy" :key="entry.id"><strong>{{ entry.alias || entry.tank }}</strong> · {{ crewDescription(crewForEntry(document, entry.id)) }}</li></ul>
          <p>{{ t('mob1016.replaceLegacy') }}</p>
        </div>
        <CrewSkillsPanel :catalog="catalog" :selection="crewDraft" :show-title="false" @update="crewDraft = { ...crewDraft, ...$event }" @cycle-skill="cycleSkill"
          @max-skills="crewDraft = { ...crewDraft, skills: Object.fromEntries(Object.keys(catalog.skills).map(id => [id, 7])) }"
          @clear-skills="crewDraft = emptyCrew()" />
      </template>
      <template #actions><AppButton @click="crewOpen = false">{{ t('mobBulk.cancel') }}</AppButton><AppButton variant="primary" data-testid="mobility-crew-apply" @click="applyCrew">{{ t('mob1016.applyCrew') }}</AppButton></template>
    </AppDialog>
  </section>
</template>
<style scoped>
.mob-page { --mob-label-width: 14.5rem; --mob-vehicle-width: 13.75rem; display: grid; gap: var(--space-4); min-width: 0; padding: var(--space-5); }
.mob-page-heading, .mob-page-title, .mob-page-actions, .mob-undo { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); }
.mob-page-heading { justify-content: space-between; }
.mob-page-title h1 { margin: 0; }
.mob-selected { color: var(--color-text-secondary); font: var(--type-caption); white-space: nowrap; }
.mob-undo { padding: var(--space-2) var(--space-3); border: 1px solid var(--color-border-subtle); border-radius: var(--radius-md); background: var(--color-surface-1); }
.mob-undo span { margin-inline-end: auto; }
.mob-crew-control { display: grid; justify-items: center; gap: var(--space-3); min-width: 0; text-align: center; }
.mob-crew-button { inline-size: 100%; }
.mob-crew-status { display: grid; justify-items: center; gap: var(--space-1); }
.mob-crew-status > span { padding: var(--space-1) var(--space-2); border-radius: var(--radius-sm); background: var(--color-surface-2); color: var(--color-text-secondary); font: var(--type-caption); }
.mob-crew-status > .is-active { color: var(--color-accent); }
.mob-cross-header .mob-crew-control { inline-size: 100%; }
.mob-crew-control small, .mob-cross-header small { font: var(--type-caption); color: var(--color-text-secondary); }
.mob-crew-control .mob-legacy { color: var(--color-warning); }
.mob-crew-legacy { padding: var(--space-3); background: var(--color-surface-2); border-radius: var(--radius-md); }
.mob-crew-legacy li { overflow-wrap: anywhere; }
.mob-empty { border: 1px solid var(--color-border-subtle); border-radius: var(--radius-lg); background: var(--color-surface-1); }
.mob-progress { margin: 0; color: var(--color-text-secondary); font: var(--type-caption); }
.mob-scroll { min-inline-size: 0; max-inline-size: 100%; overflow-x: auto; }
.mob-table { inline-size: max-content; border: 1px solid var(--color-border-subtle); border-radius: var(--radius-lg); background: var(--color-surface-1); display: grid; grid-auto-flow: column; grid-template-rows: auto repeat(9, auto); grid-template-columns: var(--mob-label-width); grid-auto-columns: var(--mob-vehicle-width); justify-content: start; gap: 0; }
.mob-heading { display: grid; grid-row: 1 / span 10; grid-template-rows: subgrid; position: sticky; inset-inline-start: 0; z-index: var(--z-sticky); background: var(--color-surface-1); }
.mob-heading > div { padding: var(--space-2) var(--space-3); }
.mob-heading > div:not(:first-child) { border-top: 1px solid var(--color-border-subtle); }
.mob-heading .mob-label-group { background: var(--color-surface-2); font-weight: 600; }
.mob-heading .mob-ground-row { padding-inline-start: var(--space-5); }
.mob-heading span small { margin-inline-start: var(--space-2); color: var(--color-text-secondary); font: var(--type-caption); }
.mob-cross-header { align-self: stretch; display: grid; align-content: center; }
.mob-cross-header [role="columnheader"] { display: grid; place-items: center; gap: var(--space-2); }
@media (width < 768px) {
  .mob-page { --mob-label-width: 9rem; --mob-vehicle-width: 12.5rem; padding: var(--space-3); }
  .mob-page-heading { align-items: start; }
}
</style>
