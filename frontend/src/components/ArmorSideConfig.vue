<script setup>
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { fetchTankData } from '../scene/agentData.js'
import { encodeDevices, findTankModules, resolveSetup } from '../replay-local/compute/tankSetup'
import { loadResearchCatalog, loadTankModules } from '../utils/researchCatalog.js'
import TankConfigPanel from './TankConfigPanel.vue'

const props = defineProps({
  tankId: { type: Number, default: null },
  config: { type: [Number, String], default: null },
  engine: { type: [Number, String], default: null },
  track: { type: [Number, String], default: null },
  dev: { type: String, default: null },
  upgrade: { type: String, default: null },
  abilities: { type: [String, Array], default: null },
  expanded: { type: Boolean, default: true },
})
const emit = defineEmits(['apply', 'ready'])

const { t } = useI18n()
const state = ref('loading')
const detail = ref(null)
const modules = ref(null)
const catalog = ref(null)
let request = 0

async function load(tankId) {
  const seq = ++request
  detail.value = null
  modules.value = null
  catalog.value = null
  if (!(tankId > 0)) { state.value = 'unavailable'; return }
  state.value = 'loading'
  try {
    const [nextCatalog, data] = await Promise.all([loadResearchCatalog(), fetchTankData(tankId)])
    if (seq !== request) return
    catalog.value = nextCatalog
    detail.value = data
    try {
      const nationData = await loadTankModules(data.nation)
      if (seq !== request) return
      modules.value = findTankModules(nationData, tankId)
    } catch {
      if (seq !== request) return
      modules.value = null
    }
    state.value = modules.value ? 'ready' : 'unavailable'
  } catch {
    if (seq !== request) return
    state.value = 'unavailable'
  }
}

watch(() => props.tankId, id => load(id), { immediate: true })

const urlIndex = value => {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isInteger(n) && n >= 0 ? n : null
}

const selection = computed(() => {
  if (!detail.value || !modules.value || !catalog.value) return null
  return resolveSetup({
    detail: detail.value,
    modules: modules.value,
    url: {
      config: props.config,
      engine: urlIndex(props.engine),
      track: urlIndex(props.track),
      dev: props.dev,
      upgrade: props.upgrade,
      abilities: props.abilities,
      cons: [],
      prov: [],
    },
    catalog: catalog.value,
  })
})
const canConfigure = computed(() => selection.value?.canConfigure === true)
const showConfiguration = computed(() => props.expanded || Number(detail.value?.tier) === 11)
watch(canConfigure, value => { emit('ready', value) }, { immediate: true })

function apply(patch) {
  const sel = selection.value
  if (!sel?.canConfigure || !patch) return
  const next = { ...sel, ...patch }
  emit('apply', {
    config: next.config,
    configChanged: next.config !== sel.config,
    engine: next.engine,
    track: next.track,
    dev: encodeDevices(next.devices || []),
    ...(sel.upgrade != null ? { upgrade: next.upgrade, abilities: next.abilities } : {}),
  })
}

function applyPreset(kind) {
  const sel = selection.value
  if (!sel?.canConfigure) return
  const last = list => Math.max(0, (list || []).length - 1)
  apply({
    config: kind === 'stock' ? 0 : last(detail.value?.configs),
    engine: kind === 'stock' ? 0 : last(modules.value?.engines),
    track: kind === 'stock' ? 0 : last(modules.value?.chassis),
    ...(sel.upgrade != null ? { upgrade: kind === 'stock' ? 'stock' : 'top' } : {}),
  })
}

function resetAll() {
  const sel = selection.value
  if (!sel?.canConfigure) return
  const last = list => Math.max(0, (list || []).length - 1)
  apply({
    config: last(detail.value?.configs),
    engine: last(modules.value?.engines),
    track: last(modules.value?.chassis),
    devices: [],
    ...(sel.upgrade != null ? { upgrade: 'top', abilities: [] } : {}),
  })
}
</script>

<template>
  <div v-show="showConfiguration" class="side-config" data-testid="armor-side-config">
    <p v-if="state === 'loading'" class="side-note" role="status">{{ t('agentTanks.loading') }}</p>
    <p v-else-if="state !== 'ready' || !selection" class="side-note">{{ t('armor.loadout_unavailable') }}</p>
    <TankConfigPanel
      v-else-if="selection.canConfigure"
      embedded
      :detail="detail"
      :modules="modules"
      :selection="selection"
      :catalog="catalog"
      :show-upgrade-details="false"
      :show-crew="false"
      :show-equipment="false"
      :show-consumables="false"
      :show-provisions="false"
      @update="apply"
      @preset="applyPreset"
      @reset="resetAll"
    />
    <p v-else class="side-note">{{ t('armor.loadout_unavailable') }}</p>
  </div>
</template>

<style scoped>
.side-config { display: grid; gap: var(--space-2); min-inline-size: 0; }
.side-note { margin: 0; color: var(--color-text-secondary); font: var(--type-caption); }
</style>
