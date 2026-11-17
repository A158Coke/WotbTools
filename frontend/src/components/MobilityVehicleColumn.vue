<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { fetchTankData, tankImageUrl } from '../scene/agentData.js'
import { availableItems, loadResearchCatalog, loadTankModules } from '../utils/researchCatalog.js'
import { tankRef, buildComputeInput, resolveSetup, findTankModules } from '../replay-local/compute/tankSetup'
import { effectivePower, terrains } from '../replay-local/compute/mobility'
import { vehicleColor, describeSetup, matchesSnapshot, mobilityVehicle, moduleIdentity, selectionQuery } from '../composables/tankMobility'
import AppDialog from './AppDialog.vue'
import { ArrowLeft, ArrowRight, SlidersHorizontal, X } from 'lucide-vue-next'
import AppButton from './AppButton.vue'
import TankConfigPanel from './TankConfigPanel.vue'
import MobilityActivations from './MobilityActivations.vue'

import type { ComparisonEntry } from '../composables/tankMobility'
import type { SetupSelection } from '../replay-local/compute/tankSetup'
import type { BatchSetup } from '../composables/mobilityBatch'
const props = defineProps<{ entry: ComparisonEntry; dataset?: string | null }>()
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
const setup = computed(() => loaded.value && resolveSetup({ ...loaded.value, url: props.entry.config || {} }))
const compatible = computed(() => loaded.value && props.dataset && props.entry.dataset === props.dataset && setup.value?.canConfigure &&
  (!props.entry.config || matchesSnapshot(props.entry, loaded.value.modules, setup.value, loaded.value.catalog)))
const batchContext = computed<BatchSetup | undefined>(() => {
  if (!compatible.value || !loaded.value || !setup.value) return
  const { modules, catalog, detail } = loaded.value
  const vehicle = tankRef(detail, modules)
  return { entry: props.entry, name: String(detail.name || props.entry.tank), selection: setup.value, modules, devices: catalog.devices,
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
  id: props.entry.id, name: label.value, input: input.value, catalog: loaded.value?.catalog,
  color: vehicleColor(props.entry.id, props.entry.seriesIndex), activations: props.entry.activations,
  summary: compatible.value && loaded.value && setup.value ? describeSetup(loaded.value.modules, setup.value, loaded.value.catalog, locale.value, t) : '',
}))
watch(curve, v => emit('curve', v), { immediate: true })
const values = computed(() => {
  const m = curve.value.mobility
  if (!m) return Array(7).fill(null)
  return [m.mass != null && m.mass > 0 && m.power > 0 ? m.power / m.mass : null, ...terrains.map(g => effectivePower(m,g)), ...terrains.map(g => m.permeability[g])]
})
function patch(value: Partial<ComparisonEntry>) { emit('update', { ...props.entry, ...value }) }
function updateSelection(changes: Partial<SetupSelection>, reset = false) {
  if (!setup.value || !loaded.value) return
  const selection = { ...setup.value, ...changes }
  const url = reset ? {} : { ...selectionQuery(selection), shell:
    changes.config !== undefined && changes.config !== setup.value.config ? null : selection.shell }
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
function skill(id: string, max: boolean) {
  if (!setup.value) return
  const skills = { ...setup.value.skills }, level = Number(skills[id]) || 0
  if (!max && level === 7) delete skills[id]
  else skills[id] = max ? 7 : level + 1
  updateSelection({ skills })
}
</script>
<template>
  <div class="mob-col">
    <header>
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
    <span v-for="(value, i) in values" :key="i">{{ Number.isFinite(value) ? n(value, {maximumFractionDigits: 2}) : '—' }}</span>
    <AppDialog v-if="editing" :open="editing" :title="label" size="xl" @close="editing = false">
      <template v-if="loaded && compatible && setup">
        <label class="mob-alias">{{ t('mobility.alias') }} <input class="mob-field" :value="entry.alias" @change="patch({ alias: ($event.target as HTMLInputElement).value.trim() })" /></label>
        <TankConfigPanel v-bind="loaded" :selection="setup" @update="updateSelection" @reset="updateSelection({}, true)" @preset="preset" @cycle-skill="skill"
          @clear-skills="updateSelection({skills: {}, conditionalSkills:false})"
          @max-skills="updateSelection({skills: Object.fromEntries(Object.keys(loaded.catalog.skills).map(k => [k,7]))})">
          <template v-for="group in (['devices', 'provisions', 'consumables'] as const)" :key="group" #[group]>
            <AppButton size="sm" @click="emit('batch', group)">{{ t('mobBulk.applyAll') }}</AppButton>
          </template>
        </TankConfigPanel>
        <MobilityActivations :model-value="entry.activations" :options="curve.options" :catalog="loaded.catalog" @update:model-value="patch({activations:$event})" />
      </template>
    </AppDialog>
  </div>
</template>
<style scoped>
.mob-alias { display: grid; gap: var(--space-1); margin-bottom: var(--space-3); }
.mob-col { display: grid; grid-template-rows: subgrid; grid-row: 1 / span 8; min-width: 13rem; text-align: center; border-inline-start: 1px solid var(--color-border-subtle); }
.mob-col header { display: grid; align-content: end; justify-items: center; padding: var(--space-3); gap: var(--space-1); }
.mob-col strong { max-inline-size: 100%; overflow-wrap: anywhere; border-bottom: var(--space-1) solid; }
.mob-col-actions { display: flex; align-items: center; justify-content: center; gap: var(--space-1); }
.mob-col-actions :deep(.is-ghost) { padding-inline: var(--space-2); }
.mob-col > span { font-variant-numeric: tabular-nums; border-top: 1px solid var(--color-border-subtle); padding: var(--space-2); }
.mob-col img { object-fit: contain; max-width: 9rem; height: 4rem; }
</style>
