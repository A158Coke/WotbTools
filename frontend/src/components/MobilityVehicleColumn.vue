<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { fetchTankData, tankImageUrl } from '../scene/agentData.js'
import { availableItems, loadResearchCatalog, loadTankModules } from '../utils/researchCatalog.js'
import { tankRef, buildComputeInput, resolveSetup, findTankModules } from '../replay-local/compute/tankSetup'
import { mobilityRows, mobilityCellId, rowValue } from '../composables/mobilityRows'
import { projectMobilitySetup, vehicleColor, describeSetup, matchesSnapshot, mobilityVehicle, moduleIdentity, selectionQuery } from '../composables/tankMobility'
import AppDialog from './AppDialog.vue'
import { ArrowLeft, ArrowRight, SlidersHorizontal, X } from 'lucide-vue-next'
import AppButton from './AppButton.vue'
import TankConfigPanel from './TankConfigPanel.vue'
import MobilityActivations from './MobilityActivations.vue'

import type { CrewSettings, ComparisonEntry } from '../composables/tankMobility'
import type { SetupSelection } from '../replay-local/compute/tankSetup'
import type { BatchSetup } from '../composables/mobilityBatch'
const props = defineProps<{ entry: ComparisonEntry; dataset?: string | null; crew?: CrewSettings; columnIndex?: number }>()
const emit = defineEmits(['update', 'remove', 'move', 'curve', 'context', 'batch'])
const { t, n, locale } = useI18n()
const editing = ref(false)
type VehicleData = {
  detail: Awaited<ReturnType<typeof fetchTankData>>
  modules: ReturnType<typeof findTankModules>
  catalog: Awaited<ReturnType<typeof loadResearchCatalog>>
}
const loaded = shallowRef<VehicleData | null>(null)
const error = ref(false)
const retry = ref(0)
watch([() => props.entry.tank, retry], async ([tank], _, onCleanup) => {
  let stale = false
  onCleanup(() => { stale = true })
  loaded.value = null
  error.value = false
  try {
    const detail = await fetchTankData(tank)
    const [data, catalog] = await Promise.all([loadTankModules(String(detail.nation)), loadResearchCatalog()])
    if (!stale) loaded.value = { detail, modules: findTankModules(data, tank), catalog }
  } catch { if (!stale) error.value = true }
}, { immediate: true })
const rawSetup = computed(() => loaded.value && resolveSetup({ ...loaded.value, url: props.entry.config || {} }))
const compatible = computed(() => loaded.value && props.dataset && props.entry.dataset === props.dataset && rawSetup.value?.canConfigure &&
  (!props.entry.config || matchesSnapshot(props.entry, loaded.value.modules, rawSetup.value, loaded.value.catalog)))
const setup = computed(() => rawSetup.value && projectMobilitySetup(rawSetup.value, props.crew || {
  skills: rawSetup.value.skills, conditionalSkills: rawSetup.value.conditionalSkills === true,
}))
const batchContext = computed<BatchSetup | undefined>(() => {
  if (!compatible.value || !loaded.value || !setup.value) return
  const { modules, catalog, detail } = loaded.value
  const vehicle = tankRef(detail, modules)
  return { rawSelection: rawSetup.value!, entry: props.entry, name: String(detail.name || props.entry.tank), selection: setup.value, modules, devices: catalog.devices,
    slots: catalog.devicePresets?.[modules.optDevicePreset || 'defaultPreset'] || [],
    provisions: availableItems(catalog.provisions, vehicle), consumables: availableItems(catalog.consumables, vehicle),
    provisionSlots: Number(modules.provisionSlots), consumableSlots: Number(modules.consumableSlots) }
})
watch(batchContext, context => emit('context', context), { immediate: true })
const input = computed(() => {
  if (!compatible.value || !setup.value || !loaded.value) return null
  try { return buildComputeInput({ ...loaded.value, selection: setup.value }) } catch { return null }
})
const label = computed(() => props.entry.alias || String(loaded.value?.detail.name || props.entry.tank))
const curve = computed(() => mobilityVehicle({
  loading: !loaded.value && !error.value, id: props.entry.id, name: label.value, input: input.value, catalog: loaded.value?.catalog,
  color: vehicleColor(props.entry.id, props.entry.seriesIndex), activations: props.entry.activations,
  summary: compatible.value && loaded.value && setup.value ? describeSetup(loaded.value.modules, setup.value, loaded.value.catalog, locale.value, t) : '',
}))
watch(curve, v => emit('curve', v), { immediate: true })
function patch(value: Partial<ComparisonEntry>) { emit('update', { ...props.entry, ...value }) }
function updateSelection(changes: Partial<SetupSelection>, reset = false) {
  if (!rawSetup.value || !loaded.value) return
  const selection = { ...rawSetup.value, ...changes, skills: rawSetup.value.skills,
    conditionalSkills: rawSetup.value.conditionalSkills, camouflage: rawSetup.value.camouflage }
  const url = reset ? {} : { ...selectionQuery(selection), shell:
    changes.config !== undefined && changes.config !== rawSetup.value.config ? null : selection.shell }
  const normalized = resolveSetup({ ...loaded.value, url })
  const activations = Object.fromEntries(Object.entries(props.entry.activations || {}).filter(([stem]) => normalized.consumables.includes(stem)))
  patch({ config: selectionQuery(normalized), stems: moduleIdentity(loaded.value.modules, normalized), activations })
}
function preset(kind: 'stock' | 'top') {
  if (!loaded.value) return
  const { detail, modules } = loaded.value
  const index = (list: unknown[]) => kind === 'stock' ? 0 : list.length - 1
  updateSelection({ config: index(Array.isArray(detail.configs) ? detail.configs : []), engine: index(modules.engines), track: index(modules.chassis),
    ...(detail.tier === 11 ? { upgrade: kind, abilities: [] } : {}) })
}
</script>
<template>
  <div class="mob-col" role="presentation">
    <header :id="mobilityCellId(entry.id, 'header')" role="columnheader" :aria-colindex="columnIndex">
      <img :src="tankImageUrl(entry.tank)" alt="" loading="lazy" />
      <strong :style="{ borderColor: curve.color }">{{ label }}</strong>
      <div class="mob-col-actions">
        <AppButton size="sm" :disabled="!compatible" @click="editing = true"><SlidersHorizontal :size="14" />{{ t('mobility.configure') }}</AppButton>
        <AppButton size="sm" variant="ghost" :aria-label="t('mobility.remove') + ' ' + label" :title="t('mobility.remove') + ' ' + label" @click="emit('remove')"><X :size="15" /></AppButton>
        <AppButton size="sm" variant="ghost" :aria-label="t('mobility.left')" :title="t('mobility.left')" @click="emit('move', -1)"><ArrowLeft :size="15" /></AppButton>
        <AppButton size="sm" variant="ghost" :aria-label="t('mobility.right')" :title="t('mobility.right')" @click="emit('move', 1)"><ArrowRight :size="15" /></AppButton>
      </div>
      <small v-if="error"><AppButton size="sm" @click="retry++">{{ t('mobility.retry') }}</AppButton></small>
      <small v-else-if="!loaded">{{ t('mobility.loading') }}</small>
      <small v-else-if="!compatible || !input">{{ t('mobility.invalid') }}</small>
    </header>
    <span v-for="(row, i) in mobilityRows" :key="row.key" :id="mobilityCellId(entry.id, row.key)" class="mob-value" :class="{ 'mob-group': row.kind === 'group' }"
      role="cell" :aria-hidden="row.kind === 'group' || undefined" :aria-colindex="columnIndex" :aria-rowindex="i + 2" :aria-labelledby="'mob-label-' + row.key + ' ' + mobilityCellId(entry.id, 'header')">
      <template v-if="row.kind === 'value'">{{ rowValue(row, curve.mobility) == null ? '—' : n(rowValue(row, curve.mobility)!, { maximumFractionDigits: 2 }) }}</template>
    </span>
    <AppDialog v-if="editing" class="mob-loadout-dialog" :open="editing" :title="label" size="xl" @close="editing = false">
      <template v-if="loaded && compatible && setup">
        <label class="mob-alias">{{ t('mobility.alias') }} <input class="mob-field" :value="entry.alias" @change="patch({ alias: ($event.target as HTMLInputElement).value.trim() })" /></label>
        <TankConfigPanel v-bind="loaded" :selection="setup" :show-crew="false" comparison-layout @update="updateSelection" @reset="updateSelection({}, true)" @preset="preset">
          <template v-for="group in (['devices', 'provisions', 'consumables'] as const)" :key="group" #[group]>
            <AppButton size="sm" @click="emit('batch', group)">{{ t('mobBulk.applyAll') }}</AppButton>
          </template>
        </TankConfigPanel>
        <MobilityActivations :model-value="entry.activations" :options="curve.options" :catalog="loaded.catalog" @update:model-value="patch({activations:$event})" />
      </template>
      <template #actions><AppButton variant="primary" @click="editing = false">{{ t('mob1016.done') }}</AppButton></template>
    </AppDialog>
  </div>
</template>
<style scoped>
.mob-loadout-dialog :deep(.dialog-title) { overflow-wrap: anywhere; }
.mob-alias { display: grid; gap: var(--space-1); margin-bottom: var(--space-3); }
.mob-col { display: grid; grid-template-rows: subgrid; grid-row: 1 / span 10; min-inline-size: 0; text-align: center; border-inline-start: 1px solid var(--color-border-subtle); }
.mob-col header { display: grid; align-content: end; justify-items: center; padding: var(--space-3); gap: var(--space-1); }
.mob-col strong { max-inline-size: 100%; overflow-wrap: anywhere; border-bottom: var(--space-1) solid; }
.mob-col-actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: var(--space-1); }
.mob-col-actions :deep(.app-button) { min-inline-size: var(--hit-min); min-block-size: var(--hit-min); }
@media (pointer: coarse) { .mob-col-actions :deep(.app-button:first-child) { flex: 1 0 100%; } }
.mob-col-actions :deep(.is-ghost) { padding-inline: var(--space-2); }
.mob-col > .mob-group { padding-block: var(--space-2); background: var(--color-surface-2); }
.mob-col > span { font-variant-numeric: tabular-nums; border-top: 1px solid var(--color-border-subtle); padding: var(--space-2); }
.mob-col img { object-fit: contain; max-width: 9rem; height: 4rem; }
</style>
