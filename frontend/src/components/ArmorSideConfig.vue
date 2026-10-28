<script setup>
/**
 * 装甲查看器一侧（射击方 / 受击方）的**模块选择**：与坦克百科详情页**同一个
 * `TankConfigPanel`**（只留模块矩阵；装备/消耗品/补给/乘员/涂装在装甲页隐藏）。
 * 选择态来自这一侧的 URL 键（射击方 scfg/sengine/strack/sdev，受击方
 * config/engine/track/dev），改动经 `apply` 交给宿主写 URL 并驱动场景。
 */
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
    if (modules.value) emit('ready')
  } catch {
    if (seq !== request) return
    state.value = 'unavailable'
  }
}

watch(() => props.tankId, id => load(id), { immediate: true })

const urlIndex = value => {
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
      cons: [],
      prov: [],
    },
    catalog: catalog.value,
  })
})

/** 输出这一侧的 URL 载荷（模块/装备四项；设备串按 tankSetup 的编码）。 */
function apply(patch) {
  const sel = selection.value
  if (!sel?.canConfigure || !patch) return
  const next = { ...sel, ...patch }
  emit('apply', {
    config: next.config,
    // 与解析后的当前配置比较：url.config 缺省时 resolveSetup 会给出有效默认值，
    // 直接用原始 URL 键比较会把“只换发动机/履带”误判成换炮。
    configChanged: next.config !== sel.config,
    engine: next.engine,
    track: next.track,
    dev: encodeDevices(next.devices || []),
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
  })
}
</script>

<template>
  <div class="side-config" data-testid="armor-side-config">
    <p v-if="state === 'loading'" class="side-note" role="status">{{ t('agentTanks.loading') }}</p>
    <p v-else-if="state !== 'ready' || !selection" class="side-note">{{ t('armor.loadout_unavailable') }}</p>
    <TankConfigPanel
      v-else-if="selection.canConfigure"
      :detail="detail"
      :modules="modules"
      :selection="selection"
      :catalog="catalog"
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
