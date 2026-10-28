<script setup>
/**
 * 装甲查看器「实际搭载」面板（?tank=&config=&dev=&cons=&prov= 的百科配置器交接态）。
 *
 * 数据面与坦克百科配置器同源：tank/{id}.json + research/modules/{nation}.json +
 * research 目录（researchCatalog 缓存加载）。选择态 = tankSetup.resolveSetup 对同一组
 * URL 参数求值（单一实现，无第二套对号）；数据缺失（旧包 / 资产源未配）整块降级为
 * 提示文案，不渲染半残装配（fail-closed）。
 *
 * 交互与坦克百科详情页一致：模块矩阵 / 装备格 / 消耗品 / 补给都用同一个
 * `TankConfigPanel` 组件（乘员/涂装块在装甲页隐藏），点图标即改、写回同一组 URL 键；
 * 改动经 `apply` 交给宿主：装甲查看器立即把 config 应用到场景（炮塔/炮装甲板），
 * 并把 dev/cons/prov 写进 URL（刷新/分享保持）。数据不可用时退回原生配置下拉（场景自带）。
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { SlidersHorizontal } from 'lucide-vue-next'
import { fetchTankData } from '../scene/agentData.js'
import {
  encodeDevices, findTankModules, presetSlots, resolveSetup,
} from '../replay-local/compute/tankSetup'
import { itemIconUrl, loadResearchCatalog, loadTankModules } from '../utils/researchCatalog.js'
import AppButton from './AppButton.vue'
import AppDialog from './AppDialog.vue'
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

const { t, locale } = useI18n()

const state = ref('loading') // loading | ready | unavailable
const editorOpen = ref(false)
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

watch(() => props.tankId, (id) => { editorOpen.value = false; load(id) }, { immediate: true })

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

const lang = computed(() => (locale.value === 'zh' ? 'zh-Hans' : 'en'))
function moduleName(item) {
  if (!item) return ''
  return item[`name_${lang.value}`] || item['name_zh-Hans'] || item.name_en || item.stem || ''
}

const deviceByStem = computed(() => new Map((catalog.value?.devices || []).map(d => [d.stem, d])))

const moduleRows = computed(() => {
  const s = selection.value
  if (!s?.canConfigure) return []
  const turret = modules.value?.turrets?.[s.turret] || null
  const gun = turret?.guns?.[s.gun] || null
  return [
    { key: 'turret', name: moduleName(turret) },
    { key: 'gun', name: moduleName(gun) },
    { key: 'engine', name: moduleName(modules.value?.engines?.[s.engine] || null) },
    { key: 'track', name: moduleName(modules.value?.chassis?.[s.track] || null) },
  ].filter(row => row.name)
})

/** 已选装备槽（stem → 目录条目）；预设缺失的槽位不猜。 */
const deviceItems = computed(() => {
  const s = selection.value
  if (!s) return []
  const slots = presetSlots(modules.value, catalog.value)
  const out = []
  for (let i = 0; i < slots.length; i += 1) {
    const choice = s.devices?.[i]
    if (choice !== 0 && choice !== 1) continue
    const stem = choice === 0 ? slots[i]?.left : slots[i]?.right
    const device = stem ? deviceByStem.value.get(stem) : null
    if (device) out.push(device)
  }
  return out
})

/** 消耗品/补给：各组自带 kind（图标目录分开），组件内不推断。 */
const itemGroups = computed(() => {
  const s = selection.value
  if (!s) return []
  const pick = (items, stems, kind) => (items || [])
    .filter(item => stems.includes(item.stem))
    .map(item => ({ ...item, kind }))
  return [
    { kind: 'provisions', items: pick(catalog.value?.provisions, s.provisions || [], 'provisions') },
    { kind: 'consumables', items: pick(catalog.value?.consumables, s.consumables || [], 'consumables') },
  ].filter(group => group.items.length)
})
</script>

<template>
  <div class="loadout" data-testid="armor-loadout">
    <p v-if="state === 'loading'" class="loadout-note" role="status">{{ t('agentTanks.loading') }}</p>
    <p v-else-if="state !== 'ready' || !selection" class="loadout-note">{{ t('armor.loadout_unavailable') }}</p>
    <template v-else>
      <dl class="loadout-modules">
        <div v-for="row in moduleRows" :key="row.key">
          <dt>{{ t(`agentTanks.configurator.${row.key}`) }}</dt>
          <dd>{{ row.name }}</dd>
        </div>
      </dl>
      <div v-if="deviceItems.length" class="loadout-items" data-testid="armor-loadout-devices">
        <span
          v-for="device in deviceItems"
          :key="device.stem"
          class="loadout-item"
          :title="moduleName(device)"
          :aria-label="moduleName(device)"
        >
          <img v-if="itemIconUrl('devices', device.icon)" :src="itemIconUrl('devices', device.icon)" alt="" width="32" height="32" loading="lazy">
          <span v-else class="loadout-item-fallback">{{ moduleName(device).slice(0, 2) }}</span>
        </span>
      </div>
      <div
        v-for="group in itemGroups"
        :key="group.kind"
        class="loadout-items"
        :data-testid="`armor-loadout-${group.kind}`"
      >
        <span
          v-for="item in group.items"
          :key="item.stem"
          class="loadout-item"
          :title="moduleName(item)"
          :aria-label="moduleName(item)"
        >
          <img v-if="itemIconUrl(group.kind, item.icon)" :src="itemIconUrl(group.kind, item.icon)" alt="" width="32" height="32" loading="lazy">
          <span v-else class="loadout-item-fallback">{{ moduleName(item).slice(0, 2) }}</span>
        </span>
      </div>
      <AppButton
        v-if="selection?.canConfigure"
        variant="secondary"
        size="sm"
        data-testid="armor-loadout-edit"
        @click="editorOpen = true"
      >
        <SlidersHorizontal :size="16" aria-hidden="true" />
        {{ t('armor.loadout_edit') }}
      </AppButton>
      <AppDialog
        :open="editorOpen"
        :title="t('agentTanks.configurator.title')"
        size="xl"
        data-testid="armor-loadout-dialog"
        @close="editorOpen = false"
      >
        <TankConfigPanel
          v-if="selection?.canConfigure"
          :detail="detail"
          :modules="modules"
          :selection="selection"
          :catalog="catalog"
          :show-crew="false"
          @update="apply"
          @preset="applyPreset"
          @reset="resetAll"
        />
      </AppDialog>
    </template>
  </div>
</template>

<style scoped>
.loadout { display: grid; gap: var(--space-2); min-inline-size: 0; }
.loadout-note { margin: 0; color: var(--color-text-secondary); font: var(--type-caption); }
.loadout-modules { display: grid; gap: var(--space-1); margin: 0; }
.loadout-modules > div { display: flex; justify-content: space-between; gap: var(--space-2); }
.loadout-modules dt { color: var(--color-text-secondary); font: var(--type-caption); white-space: nowrap; }
.loadout-modules dd { margin: 0; font: var(--type-caption); font-weight: 600; overflow-wrap: anywhere; text-align: end; }
.loadout-items { display: flex; flex-wrap: wrap; gap: var(--space-1); }
.loadout-item {
  display: grid;
  place-items: center;
  inline-size: 32px;
  block-size: 32px;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-sm);
  background: var(--color-surface-2);
}
.loadout-item img { inline-size: 100%; block-size: 100%; object-fit: contain; }
.loadout-item-fallback { color: var(--color-text-secondary); font: var(--type-caption); font-weight: 600; }
</style>
