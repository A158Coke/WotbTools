<script setup>
/**
 * 装甲查看器「实际搭载」面板（?tank=&config=&engine=&track=&dev=&cons=&prov= 的配置器交接态）。
 *
 * 数据面与坦克百科配置器同源：tank/{id}.json + research/modules/{nation}.json +
 * research 目录（researchCatalog 缓存加载）。选择态 = tankSetup.resolveSetup 对同一组
 * URL 参数求值（单一实现，无第二套对号）；数据缺失（旧包 / 资产源未配）整块降级为
 * 提示文案，不渲染半残装配（fail-closed）。
 *
 * 交互与坦克百科详情页一致：**直接内嵌同一个 `TankConfigPanel`（compact 形态）**——
 * 模块矩阵 / 装备格 / 消耗品 / 补给都是点图标即改（乘员/涂装块在装甲页隐藏）。
 * 改动经 `apply` 交给宿主：场景立即切 config（炮塔/炮装甲板），URL 写回同一组键
 * （刷新/分享保持）。数据不可用时退回场景自带的原生配置下拉。
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { fetchTankData } from '../scene/agentData.js'
import { encodeDevices, findTankModules, resolveSetup } from '../replay-local/compute/tankSetup'
import { loadResearchCatalog, loadTankModules } from '../utils/researchCatalog.js'
import TankConfigPanel from './TankConfigPanel.vue'

const props = defineProps({
  tankId: { type: Number, default: null },
  /** ?config=（装甲查看器与百科同一契约：缺省 = 顶级） */
  config: { type: [Number, String], default: null },
  dev: { type: String, default: null },
  cons: { type: String, default: null },
  prov: { type: String, default: null },
  engine: { type: [Number, String], default: null },
  track: { type: [Number, String], default: null },
})
const emit = defineEmits(['apply', 'ready'])

const { t } = useI18n()

const state = ref('loading') // loading | ready | unavailable
const detail = ref(null)
const modules = ref(null)
const catalog = ref(null)
let request = 0

const STEM_RE = /^[A-Za-z0-9_]+$/
const stemList = raw => (typeof raw === 'string' && raw.trim()
  ? [...new Set(raw.split(',').map(s => s.trim()).filter(s => STEM_RE.test(s)))]
  : [])

async function load(tankId) {
  const seq = ++request
  detail.value = null
  modules.value = null
  catalog.value = null
  if (!(tankId > 0)) { state.value = 'unavailable'; return }
  state.value = 'loading'
  try {
    const [nextCatalog, data] = await Promise.all([
      loadResearchCatalog(),
      fetchTankData(tankId),
    ])
    if (seq !== request) return
    catalog.value = nextCatalog
    detail.value = data
    try {
      const nationData = await loadTankModules(data.nation)
      if (seq !== request) return
      modules.value = findTankModules(nationData, tankId)
    } catch {
      if (seq !== request) modules.value = null
    }
    state.value = modules.value ? 'ready' : 'unavailable'
    if (modules.value) emit('ready')
  } catch {
    if (seq !== request) return
    state.value = 'unavailable'
  }
}

watch(() => props.tankId, id => load(id), { immediate: true })

/** URL 值是字符串；resolveSetup 的 engine/track 只认 number（字符串会被夹成默认顶级）。 */
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
      cons: stemList(props.cons),
      prov: stemList(props.prov),
    },
    catalog: catalog.value,
  })
})

/**
 * 提交一次改动：`patch` 可以是模块矩阵的完整选择，也可以是单项（发动机/履带只发下标）。
 * 统一并回当前 `selection` 后按 URL 契约输出（config/engine/track + dev/cons/prov）。
 */
function apply(patch) {
  const sel = selection.value
  if (!sel?.canConfigure || !patch) return
  const next = { ...sel, ...patch }
  emit('apply', {
    config: next.config,
    engine: next.engine,
    track: next.track,
    dev: encodeDevices(next.devices || []),
    cons: [...(next.consumables || [])],
    prov: [...(next.provisions || [])],
  })
}

/** 初始/顶级快捷（与详情页同语义：顶级 = 末位配置/末位发动机/末位履带）。 */
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

/** 重置：顶级配置 + 清空装备/补给/消耗品（详情页重置的同语义子集）。 */
function resetAll() {
  const sel = selection.value
  if (!sel?.canConfigure) return
  const last = list => Math.max(0, (list || []).length - 1)
  apply({
    config: last(detail.value?.configs),
    engine: last(modules.value?.engines),
    track: last(modules.value?.chassis),
    devices: [], consumables: [], provisions: [],
  })
}
</script>

<template>
  <div class="loadout" data-testid="armor-loadout">
    <p v-if="state === 'loading'" class="loadout-note" role="status">{{ t('agentTanks.loading') }}</p>
    <p v-else-if="state !== 'ready' || !selection" class="loadout-note">{{ t('armor.loadout_unavailable') }}</p>
    <TankConfigPanel
      v-else-if="selection.canConfigure"
      compact
      :show-crew="false"
      :detail="detail"
      :modules="modules"
      :selection="selection"
      :catalog="catalog"
      @update="apply"
      @preset="applyPreset"
      @reset="resetAll"
    />
    <p v-else class="loadout-note">{{ t('armor.loadout_unavailable') }}</p>
  </div>
</template>

<style scoped>
.loadout { display: grid; gap: var(--space-2); min-inline-size: 0; }
.loadout-note { margin: 0; color: var(--color-text-secondary); font: var(--type-caption); }
</style>
