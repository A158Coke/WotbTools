<script setup>
/**
 * 科技树（?view=agent-techtree）：客户端 TanksTechTree 的数据面复刻。
 *
 * 数据 = 资产包 research/tech_tree/{nation}.json（上游 --with-research-graph；含 11.22
 * XI 预览节点）+ tank_cache.json（名称/is_premium 联表）+ tank_images 封面。
 * 布局按客户端 yaml 原始 x/y 网格渲染（x=列 y=行；列≠tier，等级锚点按列数据判定）；
 * 研发连线 = 整车 `<unlocks><vehicle>` 边的 SVG 拓扑等价（from 车不在树上不画线）。
 * `pending`（已登记未实装的 XI 展示位）渲染为无名称占位——不造数据。
 *
 * 点击节点进入**坦克百科详情**（?view=agent-tankopedia&tank=）；单车研发界面在详情页的
 * 「研发」弹窗里（见 TankResearchPanel），不做研发/购买/解锁流程（2026-10-27 裁定维持）。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { BookOpen } from 'lucide-vue-next'
import { fetchTankEncyclopedia, loadTankIconCrops, tankImageUrl } from '../scene/agentData.js'
import { tankIconCropTransform } from '../utils/tankIconCrop.js'
import { tankNationLabel, tankTypeLabel } from '../scene/tankMeta.js'
import { loadTechTree } from '../utils/researchCatalog.js'
import { techTreeGrid, techTreeNations } from '../utils/techTreeLayout.js'
import { locationForView } from '../app/navigation'
import ShowcaseHero from './ShowcaseHero.vue'
import AppButton from './AppButton.vue'
import SegmentedControl from './SegmentedControl.vue'
import TankCatalogIcon from './TankCatalogIcon.vue'
import AgentTechTreeCanvas from './AgentTechTreeCanvas.vue'

const VIEW = 'agent-techtree'
const NATIONS = techTreeNations()

const { t, te } = useI18n()
const route = useRoute()
const router = useRouter()

// ---------- URL 状态 ----------
const urlNation = computed(() => (NATIONS.includes(String(route.query.nation)) ? String(route.query.nation) : NATIONS[0]))
function writeState(patch) {
  const next = { ...route.query, view: VIEW, ...patch }
  if (patch.nation != null && !NATIONS.includes(String(patch.nation))) next.nation = NATIONS[0]
  router.replace({ query: next })
}

const nationLabel = nation => tankNationLabel(t, te, nation)

const nationTabs = ref(null)
const focusedNation = ref(urlNation.value)
watch([urlNation, nationTabs], ([nation, tabs]) => {
  focusedNation.value = nation
  tabs?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
}, { flush: 'post' })

function onNationKeydown(event) {
  const tabs = [...event.currentTarget.querySelectorAll('[role="tab"]')]
  const index = tabs.indexOf(event.target)
  const offsets = { ArrowRight: 1, ArrowLeft: -1 }
  let target
  if (event.key in offsets) target = tabs[(index + offsets[event.key] + tabs.length) % tabs.length]
  if (event.key === 'Home') target = tabs[0]
  if (event.key === 'End') target = tabs.at(-1)
  if (!target) return
  event.preventDefault()
  focusedNation.value = target.dataset.nation
  target.focus()
  target.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
}

// ---------- 科技树数据 ----------
const tree = ref(null)
const treeState = ref('loading') // loading | ready | error
const treeError = ref('')
let treeRequest = 0

async function loadTree(nation) {
  const request = ++treeRequest
  treeState.value = 'loading'
  treeError.value = ''
  tree.value = null
  try {
    const data = await loadTechTree(nation)
    if (request !== treeRequest) return
    tree.value = data
    treeState.value = 'ready'
  } catch (e) {
    if (request !== treeRequest) return
    console.error('tech tree load failed:', e)
    treeError.value = String(e?.message || e)
    treeState.value = 'error'
  }
}
watch(urlNation, nation => loadTree(nation), { immediate: true })

// ---------- tank_cache 联表（名称 / 金币车标记） ----------
const cache = ref({})
const cacheState = ref('loading')
async function loadCache() {
  cacheState.value = 'loading'
  try {
    cache.value = await fetchTankEncyclopedia()
    cacheState.value = 'ready'
  } catch (e) {
    console.error('tank cache load failed:', e)
    cacheState.value = 'error'
  }
}
onMounted(loadCache)

const summaryOf = node => cache.value?.[String(node.tankId)] || null
const nameOf = node => summaryOf(node)?.name || null

/**
 * 封面图标裁剪：客户端 TankNode 的图标盒是 **97×60**（`TankIcon` size，@40,8 in a
 * 176×64 card），贴图是原始画布（坦克锚左上、右/下留白近半）。用数据面逐车内容框
 * （tank_images/crops.json）换算出容器内 transform（utils/tankIconCrop.js，与坦克百科
 * 同一实现）；缺 crop（旧包）时回退原始 contain。
 */
const ICON_ASPECT = 97 / 60
const iconCrops = ref(null)
onMounted(() => {
  loadTankIconCrops().then((crops) => { iconCrops.value = crops })
})
function iconCropStyle(tankId) {
  const transform = tankIconCropTransform(iconCrops.value?.[String(tankId)], ICON_ASPECT)
  return transform ? { transform } : null
}

/** 每辆树节点的最低研发成本（指向它的全部整车边取最小 XP；数据缺省不显示）。 */
const costByStem = computed(() => {
  const out = new Map()
  for (const edge of tree.value?.edges || []) {
    const xp = Number(edge?.cost?.xp)
    if (!Number.isFinite(xp)) continue
    const prev = out.get(edge.to)
    if (prev == null || xp < prev) out.set(edge.to, xp)
  }
  return out
})

const grid = computed(() => (tree.value ? techTreeGrid(tree.value) : null))

/*
 * 竖屏手机（design-language §9「科技树」）：网格横向太宽、等级标尺会压住节点，改为按等级从高到低、
 * 每级一行横向卡片；国家页签 + 车种分段吸顶。连线与标尺只在网格形态出现。
 */
const PORTRAIT_QUERY = '(width < 768px) and (orientation: portrait)'
const portrait = ref(false)
let portraitQuery = null
const syncPortrait = () => { portrait.value = !!portraitQuery?.matches }
onMounted(() => {
  if (typeof window.matchMedia !== 'function') return
  portraitQuery = window.matchMedia(PORTRAIT_QUERY)
  portraitQuery.addEventListener?.('change', syncPortrait)
  syncPortrait()
})
onBeforeUnmount(() => portraitQuery?.removeEventListener?.('change', syncPortrait))

const TYPE_FILTERS = ['all', 'heavyTank', 'mediumTank', 'lightTank', 'AT-SPG']
const typeFilter = ref('all')
const typeOptions = computed(() => TYPE_FILTERS.map(value => ({
  value,
  label: value === 'all' ? t('research.all_types') : tankTypeLabel(t, te, value),
  testid: `techtree-type-${value}`,
})))
const tierRows = computed(() => {
  if (!portrait.value || !tree.value) return null
  const rows = new Map()
  for (const node of tree.value.nodes || []) {
    if (typeFilter.value !== 'all' && summaryOf(node)?.type !== typeFilter.value) continue
    if (!rows.has(node.tier)) rows.set(node.tier, [])
    rows.get(node.tier).push(node)
  }
  return [...rows.entries()].sort((a, b) => b[0] - a[0]).map(([tier, nodes]) => ({ tier, nodes: nodes.sort((a, b) => a.y - b.y || a.x - b.x) }))
})
/** 节点点击 = 进坦克百科详情（研发弹窗在详情页里；这里不再有中间研发页）。 */
function openResearch(node) {
  if (!node?.tankId) return
  // 走 locationForView：保留 assets/lang 等与视图无关的键（审计 3D-09 同口径）。
  const dest = locationForView('agent-tankopedia', route)
  const query = { ...dest.query, view: 'agent-tankopedia', tank: String(node.tankId) }
  // 科技树的国别页签与详情无关；上一辆车的配置下标更不能带过去
  for (const key of ['nation', 'config', 'engine', 'track', 'shell']) delete query[key]
  router.push({ path: dest.path, query })
}
function openTankopedia() {
  const dest = locationForView('agent-tankopedia', route)
  router.push({ path: dest.path, query: { ...dest.query, view: 'agent-tankopedia' } })
}

// 旧深链 ?view=agent-techtree&tank=<id>：研发界面已并入坦克百科详情页，直接转过去。
onMounted(() => {
  const id = Number(route.query.tank)
  if (!Number.isInteger(id) || id <= 0) return
  const dest = locationForView('agent-tankopedia', route)
  const query = { ...dest.query, view: 'agent-tankopedia', tank: String(id) }
  delete query.nation
  router.replace({ path: dest.path, query })
})
</script>

<template>
  <section class="techtree" data-testid="techtree">
    <ShowcaseHero compact section="techtree" :kicker="t('nav.groups.reference')" :title="t('research.title')">
      <template #actions>
        <AppButton variant="secondary" data-testid="techtree-tankopedia" @click="openTankopedia">
          <BookOpen :size="18" aria-hidden="true" />
          {{ t('nav.tankopedia') }}
        </AppButton>
      </template>
    </ShowcaseHero>

    <p v-if="cacheState === 'error'" class="tt-status" role="status">{{ t('research.cache_unavailable') }}</p>

    <!-- ================= 树态 ================= -->
    <div class="tt-filters" :class="{ 'is-sticky': tierRows }">
    <div ref="nationTabs" class="tt-tabs" role="tablist" @keydown="onNationKeydown" :aria-label="t('research.nation_tabs')">
        <button
          v-for="nation in NATIONS"
          :key="nation"
          type="button"
          role="tab"
          class="tt-tab"
          :class="{ 'is-on': nation === urlNation }"
          :tabindex="nation === focusedNation ? 0 : -1"
          :data-nation="nation"
          @focus="focusedNation = nation"
          :aria-selected="nation === urlNation ? 'true' : 'false'"
          :data-testid="`techtree-nation-${nation}`"
          @click="writeState({ nation, tank: null })"
        >
          <TankCatalogIcon kind="nation" :value="nation" />{{ nationLabel(nation) }}
        </button>
      </div>
      <SegmentedControl
        v-if="tierRows"
        presentation="tiles"
        :model-value="typeFilter"
        :options="typeOptions"
        :aria-label="t('research.type_filter')"
        data-testid="techtree-type-filter"
        @update:model-value="value => typeFilter = value"
      >
        <template #option="{ option }"><TankCatalogIcon kind="type" :value="option.value" />{{ option.label }}</template>
      </SegmentedControl>
    </div>

    <AgentTechTreeCanvas
      :state="treeState"
      :error="treeError"
      :tier-rows="tierRows"
      :grid="grid"
      :summaries="cache"
      :cost-by-stem="costByStem"
      :image-url="tankImageUrl"
      :icon-style="iconCropStyle"
      @retry="loadTree(urlNation)"
      @select-node="openResearch"
    />  </section>
</template>

<style scoped>
.techtree {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-6) var(--gutter) var(--space-12);
  color: var(--color-text-primary);
  min-inline-size: 0;
  /* 占满外壳留给本页的视口高度：顶栏高度已由 .app-main 的 padding 让出，底部 Tab 栏是
     fixed，必须在这里再减掉；树滚动区用 flex 吃掉页头/页签之后的剩余高度。
     不再写视口减法魔法数——4.0 外壳的顶栏/底栏与页头行数一变就错位。 */
  block-size: calc(100dvh - var(--header-h) - env(safe-area-inset-top) - env(safe-area-inset-bottom));
  min-block-size: 0;
}

.techtree :deep(.showcase-hero-host) { flex: none; }
.tt-status { margin: 0; color: var(--color-text-secondary); font: var(--type-body); }

.tt-tab { display: inline-flex; align-items: center; justify-content: center; gap: var(--space-1); }
.tt-tabs { display: flex; flex: none; flex-wrap: wrap; gap: var(--space-1); }
.tt-tab {
  padding: var(--space-1) var(--space-3);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-full);
  corner-shape: round;
  background: var(--color-surface-1);
  color: var(--color-text-secondary);
  font: var(--type-body);
  cursor: pointer;
}
.tt-tab:hover { border-color: var(--color-border-strong); color: var(--color-text-primary); }
.tt-tab.is-on { border-color: var(--color-accent); color: var(--color-accent-text); background: color-mix(in oklab, var(--color-accent) 14%, var(--color-surface-1)); }
.tt-tab:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }

/* ---------- 竖屏手机：按等级分行（design-language §9「科技树」） ---------- */
.tt-filters { display: grid; flex: none; gap: var(--space-2); }
.tt-filters.is-sticky .tt-tabs { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; }
.tt-filters.is-sticky .tt-tab { flex: none; min-block-size: var(--hit-min-comfortable); }
/* 数据密集区：整站环境背景只出现在页头与外围，树板保持不透明表面（design-language §2.1）。 */
/* ---------- 研发态 ---------- */
/* 手机：分区横幅只保留标题；国别页签改单行横滑——9 个国别在 390px 下会换
   两行，白白吃掉 36px 树高；横滑比换行更符合“页签条”的语义。 */
@media (width < 768px) {
  .techtree {
    gap: var(--space-3);
    padding-block: var(--space-4);
  }
  .tt-tabs {
    flex-wrap: nowrap;
    overflow-x: auto;
    overscroll-behavior-inline: contain;
    scrollbar-width: none;
  }
  .tt-tabs::-webkit-scrollbar { display: none; }
  .tt-tab { flex: 0 0 auto; }
}

/* 矮横屏（手机横屏等）：96px 分区横幅会把树视口压到不足两行，只隐藏横幅本身；
   “坦克百科”操作留在下方工具条里，不丢入口。 */
@media (orientation: landscape) and (height <= 520px) {
  .techtree :deep(.showcase-hero) { display: none; }
  .techtree :deep(.showcase-hero-host) { gap: 0; margin-block-end: 0; }
}

@media (height <= 520px) {
  .techtree {
    gap: var(--space-2);
    padding-block: var(--space-3);
  }
}
</style>
