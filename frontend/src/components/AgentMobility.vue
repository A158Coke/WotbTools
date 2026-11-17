<script setup lang="ts">
import { computed, ref, shallowReactive, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { fetchTankEncyclopedia } from '../scene/agentData.js'
import { normalizeTankCache } from '../utils/tankopediaQuery.js'
import { terrains } from '../replay-local/compute/mobility'
import { loadMobilityDataset, readComparison, readSeed, saveComparison, useMobilityDataset } from '../composables/tankMobility'
import AppButton from './AppButton.vue'
import AppDialog from './AppDialog.vue'
import TankCatalogMenu from './TankCatalogMenu.vue'
import MobilityChart from './MobilityChart.vue'
import MobilityVehicleColumn from './MobilityVehicleColumn.vue'
import type { ComparisonEntry, VehicleCurve } from '../composables/tankMobility'
const { t } = useI18n()
const route = useRoute(), router = useRouter()
const dataset = useMobilityDataset()
const entries = ref<ComparisonEntry[]>([])
const curves = shallowReactive(new Map<string, VehicleCurve>())
const selectedCurves = computed(() => entries.value.map(e => curves.get(e.id)).filter((curve): curve is VehicleCurve => !!curve))
const expired = ref(false)
const picker = ref(false), tanks = ref<ReturnType<typeof normalizeTankCache>>([]), state = ref('loading'), filters = ref({})
const key = ref<string | null>(null)
watch(() => [route.query.comparison, route.query.mobilitySeed], ([value, encoded]) => {
  key.value = typeof value === 'string' ? value : null
  const restored = readComparison(value)
  const seed = readSeed(encoded)
  entries.value = restored || (seed ? [seed] : [])
  expired.value = !!(value || encoded) && !restored && !seed
  for (const id of curves.keys()) if (!entries.value.some(entry => entry.id === id)) curves.delete(id)
}, { immediate: true })
async function save(next: ComparisonEntry[]) {
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
function add(tank: { id: number; name: string }) {
  if (!dataset.value) return
  const id = crypto.randomUUID()
  const used = new Set(entries.value.filter(e => Number(e.tank) === Number(tank.id)).map(e => e.alias || tank.name))
  let alias = tank.name
  for (let suffix = 2; used.has(alias); suffix++) alias = tank.name + ' (' + suffix + ')'
  const colors = new Set(entries.value.map(entry => entry.seriesIndex))
  let seriesIndex = 0
  while (colors.has(seriesIndex)) seriesIndex++
  save([...entries.value, { id, seriesIndex, tank: tank.id, dataset: dataset.value, alias, activations: {} }])
  picker.value = false
}
function move(i: number, delta: number) {
  const next = entries.value.slice()
  if (i + delta < 0 || i + delta >= next.length) return
  next.splice(i + delta, 0, ...next.splice(i, 1))
  save(next)
}
function remove(id: string) {
  curves.delete(id)
  save(entries.value.filter(e => e.id !== id))
}
</script>
<template>
  <section class="mob-page">
    <h1>{{ t('mobility.compare') }}</h1>
    <p v-if="expired" role="status">{{ t('mobility.expired') }}</p>
    <p v-if="!dataset" role="status">{{ t('mobility.missingVersion') }} <button @click="loadMobilityDataset">{{ t('mobility.retry') }}</button></p>
    <div><AppButton variant="primary" :disabled="!dataset" @click="choose">{{ t('mobility.add') }}</AppButton></div>
    <div v-if="entries.length" class="mob-scroll">
      <div class="mob-table">
        <div class="mob-heading">
          <strong>{{ t('mobility.startConfig') }}</strong>
          <span>{{ t('agentTanks.params.thrustToWeightRatio') }} (hp/t)</span>
          <span v-for="g in terrains" :key="g">{{ t('agentTanks.params.effectivePower' + g) }} (hp/t)</span>
          <span v-for="g in terrains" :key="g">{{ t('agentTanks.params.terrainPermeability' + g) }} (%)</span>
        </div>
        <MobilityVehicleColumn v-for="(e, i) in entries" :key="e.id" :entry="e" :dataset="dataset"
          @update="(v: ComparisonEntry) => save(entries.map(entry => entry.id === e.id ? v : entry))"
          @remove="remove(e.id)" @move="move(i, $event)" @curve="curves.set(e.id, $event)" />
      </div>
    </div>
    <MobilityChart v-if="entries.length" :vehicles="selectedCurves" :dataset="dataset" />
    <AppDialog :open="picker" :title="t('mobility.add')" size="xl" @close="picker = false">
      <TankCatalogMenu layout="dialog" :tanks="tanks" :state="state" :filters="filters" @update:filters="filters = $event" @select="add" @retry="choose" />
    </AppDialog>
  </section>
</template>
<style scoped>
.mob-page { display: grid; gap: var(--space-4); min-width: 0; }
.mob-scroll { overflow-x: auto; border: 1px solid var(--color-border-subtle); border-radius: var(--radius-lg); background: var(--color-surface-1); }
.mob-table { display: grid; grid-auto-flow: column; grid-template-rows: auto repeat(7, auto); grid-auto-columns: max-content; gap: 0; }
.mob-heading { display: grid; grid-row: 1 / span 8; grid-template-rows: subgrid; position: sticky; inset-inline-start: 0; z-index: var(--z-sticky); background: var(--color-surface-1); }
.mob-heading > * { padding: var(--space-2) var(--space-3); }
.mob-heading span { border-top: 1px solid var(--color-border-subtle); }
.mob-heading strong { align-self: end; }
</style>
