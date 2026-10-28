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
 * 点击节点进入单车研发界面（?tank=，复刻 ModulesTree：上一辆车/当前车 + 模块研发图，
 * 见 TankResearchPanel）；不做研发/购买/解锁流程（2026-10-27 裁定维持）。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ArrowLeft, RotateCcw, TriangleAlert } from 'lucide-vue-next'
import { fetchTankData, fetchTankEncyclopedia, tankImageUrl } from '../scene/agentData.js'
import { tankNationLabel } from '../scene/tankMeta.js'
import { findTankModules, resolveSetup } from '../replay-local/compute/tankSetup'
import { loadTechTree, loadTankModules } from '../utils/researchCatalog.js'
import { moduleTreeLayout, techTreeGrid, techTreeNations } from '../utils/techTreeLayout.js'
import { locationForView } from '../app/navigation'
import PageHeader from './PageHeader.vue'
import EmptyState from './EmptyState.vue'
import AppButton from './AppButton.vue'
import TankResearchPanel from './TankResearchPanel.vue'

const VIEW = 'agent-techtree'
const NATIONS = techTreeNations()

const { t, te } = useI18n()
const route = useRoute()
const router = useRouter()

// ---------- URL 状态 ----------
const urlNation = computed(() => (NATIONS.includes(String(route.query.nation)) ? String(route.query.nation) : NATIONS[0]))
const researchId = computed(() => {
  const id = Number(route.query.tank)
  return Number.isInteger(id) && id > 0 ? id : null
})

function writeState(patch) {
  const next = { ...route.query, view: VIEW, ...patch }
  if (patch.nation != null && !NATIONS.includes(String(patch.nation))) next.nation = NATIONS[0]
  router.replace({ query: next })
}

const nationLabel = nation => tankNationLabel(t, te, nation)

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
const CELL_W = 216
const CELL_H = 96
const gridStyle = computed(() => ({
  gridTemplateColumns: `repeat(${grid.value.columns.length}, ${CELL_W}px)`,
  gridTemplateRows: `repeat(${grid.value.rows.length}, ${CELL_H}px)`,
}))
const svgSize = computed(() => ({
  width: (grid.value?.columns.length || 0) * CELL_W,
  height: (grid.value?.rows.length || 0) * CELL_H,
}))
const rulerStyle = computed(() => ({
  gridTemplateColumns: `repeat(${grid.value.columns.length}, ${CELL_W}px)`,
}))

/**
 * 客户端连线几何（TankCell/Lines{mask} 提取）：出线 = 源格右侧 20px（RightHLine
 * 19.5px + 0.5 边距）；跨行干线骑在列边界（VL/VR 在 ±0.5px）；入线到目标格内 13px
 * （LeftHLine 13.5px），箭头即 LeftCenterArrow @13px。同行相邻 = 直线。
 */
function edgePath(edge) {
  const xOut = (edge.x1 + 1) * CELL_W - 20
  const yFrom = edge.y1 * CELL_H + CELL_H / 2
  const xBoundary = edge.x2 * CELL_W
  const yTo = edge.y2 * CELL_H + CELL_H / 2
  const xIn = edge.x2 * CELL_W + 13
  if (edge.y1 === edge.y2) return `M ${xOut} ${yFrom} L ${xIn} ${yTo}`
  return `M ${xOut} ${yFrom} L ${xBoundary} ${yFrom} L ${xBoundary} ${yTo} L ${xIn} ${yTo}`
}

/** 客户端等级条用罗马数字（LevelCell 绑定 roman(level)；1..11 覆盖 XI）。 */
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI']
function romanLevel(level) {
  return ROMAN[level - 1] || String(level)
}

function openResearch(node) {
  writeState({ tank: String(node.tankId) })
}
function backToTree() {
  writeState({ tank: null })
}
function openDetail() {
  // 走 locationForView：保留 assets/lang 等与视图无关的键（审计 3D-09 同口径）。
  const dest = locationForView('agent-tankopedia', route)
  router.push({ path: dest.path, query: { ...dest.query, view: 'agent-tankopedia', tank: String(researchId.value) } })
}
function openTankopedia() {
  const dest = locationForView('agent-tankopedia', route)
  router.push({ path: dest.path, query: { ...dest.query, view: 'agent-tankopedia' } })
}

// ---------- 研发态数据（?tank=） ----------
const detail = ref(null)
const detailState = ref('idle')
const detailError = ref('')
const modules = ref(null)
let detailRequest = 0

async function loadResearch(id) {
  const request = ++detailRequest
  detail.value = null
  modules.value = null
  if (id == null) { detailState.value = 'idle'; return }
  detailState.value = 'loading'
  detailError.value = ''
  try {
    const data = await fetchTankData(id)
    if (request !== detailRequest) return
    detail.value = data
    detailState.value = 'ready'
    try {
      const nationData = await loadTankModules(data.nation)
      if (request !== detailRequest) return
      modules.value = findTankModules(nationData, id)
    } catch (e) {
      if (request !== detailRequest) return
      console.warn('research modules unavailable:', e)
      modules.value = null
    }
  } catch (e) {
    if (request !== detailRequest) return
    detailError.value = String(e?.message || e)
    detailState.value = 'error'
  }
}
watch(researchId, id => loadResearch(id), { immediate: true })

const selection = computed(() => {
  if (!detail.value || !modules.value) return null
  return resolveSetup({ detail: detail.value, modules: modules.value, url: { config: route.query.config }, catalog: null })
})

/** 研发态的科技树数据（上一辆车/下一辆车反解）：?tank= 的国别可能与页签不同。 */
const researchTreeData = ref(null)
watch(() => detail.value?.nation, async (nation) => {
  researchTreeData.value = null
  if (!nation) return
  try {
    researchTreeData.value = await loadTechTree(nation)
  } catch {
    researchTreeData.value = null
  }
}, { immediate: true })
const researchGrid = computed(() => (researchTreeData.value ? techTreeGrid(researchTreeData.value) : null))

/** 上一辆车：科技树边 to=当前车（多父全列）。 */
const prevVehicles = computed(() => {
  const stem = detail.value?.stem
  const g = researchGrid.value
  if (!stem || !g) return []
  const byStem = new Map()
  for (const node of g.cells.values()) byStem.set(node.stem, node)
  const out = new Map()
  for (const edge of researchTreeData.value.edges || []) {
    if (edge.to !== stem) continue
    const node = byStem.get(edge.from)
    if (node && !out.has(node.stem)) out.set(node.stem, { node, cost: Number(edge.cost?.xp) || null })
  }
  return [...out.values()]
})

const moduleLayout = computed(() => {
  if (!modules.value) return null
  try {
    return moduleTreeLayout(modules.value, selection.value)
  } catch {
    return null
  }
})
const nextVehicles = computed(() => {
  const g = researchGrid.value
  const layout = moduleLayout.value
  if (!g || !layout) return []
  const byStem = new Map()
  for (const node of g.cells.values()) byStem.set(node.stem, node)
  return layout.nextVehicles
    .map(v => {
      const node = byStem.get(v.stem)
      return node ? { stem: v.stem, cost: Number(v.cost?.xp) || null, node } : { stem: v.stem, cost: Number(v.cost?.xp) || null, node: null }
    })
})

function jumpTo(node) {
  writeState({ tank: String(node.tankId) })
}
function selectConfig(value) {
  writeState({ config: String(value) })
}
</script>

<template>
  <section class="techtree" data-testid="techtree">
    <PageHeader
      :title="t('research.title')"
      :description="t('research.hint')"
    >
      <template #actions>
        <AppButton variant="ghost" size="sm" data-testid="techtree-tankopedia" @click="openTankopedia">
          {{ t('nav.tankopedia') }}
        </AppButton>
      </template>
    </PageHeader>

    <p v-if="cacheState === 'error'" class="tt-status" role="status">{{ t('research.cache_unavailable') }}</p>

    <!-- ================= 研发态（?tank=） ================= -->
    <template v-if="researchId != null">
      <div class="tt-nav">
        <AppButton variant="ghost" size="sm" data-testid="techtree-back" @click="backToTree">
          <ArrowLeft :size="16" aria-hidden="true" />
          {{ t('research.back_tree') }}
        </AppButton>
      </div>

      <p v-if="detailState === 'loading'" class="tt-status" role="status">{{ t('agentTanks.loading') }}</p>
      <EmptyState
        v-else-if="detailState === 'error'"
        role="alert"
        data-testid="techtree-detail-error"
        :icon="TriangleAlert"
        :title="t('agentTanks.detail_error_title')"
        :description="detailError || t('agentTanks.error_desc')"
      >
        <AppButton variant="primary" @click="loadResearch(researchId)">
          <RotateCcw :size="16" aria-hidden="true" />
          {{ t('agentTanks.retry') }}
        </AppButton>
      </EmptyState>

      <template v-else-if="detail">
        <header class="tt-research-head">
          <span class="tt-media">
            <img :src="tankImageUrl(detail.tank_id ?? detail.tankId)" alt="" width="240" height="150" decoding="async" @error="$event.target.hidden = true">
          </span>
          <div class="tt-research-title">
            <h2>{{ detail.name }}</h2>
            <div class="tt-badges">
              <span class="tt-pill is-tier">{{ t('agentTanks.tier_n', { tier: detail.tier }) }}</span>
              <span class="tt-pill">{{ nationLabel(detail.nation) }}</span>
              <span v-if="summaryOf({ tankId: detail.tank_id ?? detail.tankId })?.is_premium" class="tt-pill is-premium">{{ t('agentTanks.premium') }}</span>
            </div>
            <div class="tt-research-actions">
              <AppButton variant="ghost" size="sm" data-testid="techtree-open-detail" @click="openDetail">
                {{ t('research.open_detail') }}
              </AppButton>
            </div>
          </div>
          <dl v-if="prevVehicles.length || nextVehicles.length" class="tt-links">
            <div v-if="prevVehicles.length">
              <dt>{{ t('research.prev_tanks') }}</dt>
              <dd>
                <button
                  v-for="prev in prevVehicles"
                  :key="prev.node.stem"
                  type="button"
                  class="tt-link-chip"
                  data-testid="techtree-prev-vehicle"
                  @click="jumpTo(prev.node)"
                >
                  {{ nameOf(prev.node) || prev.node.stem }}
                  <span v-if="prev.cost != null" class="tt-link-cost">{{ t('research.xp_short', { xp: prev.cost.toLocaleString() }) }}</span>
                </button>
              </dd>
            </div>
            <div v-if="nextVehicles.length">
              <dt>{{ t('research.next_tanks') }}</dt>
              <dd>
                <template v-for="next in nextVehicles" :key="next.stem">
                  <button
                    v-if="next.node"
                    type="button"
                    class="tt-link-chip"
                    data-testid="techtree-next-vehicle"
                    @click="jumpTo(next.node)"
                  >
                    {{ nameOf(next.node) || next.node.stem }}
                    <span v-if="next.cost != null" class="tt-link-cost">{{ t('research.xp_short', { xp: next.cost.toLocaleString() }) }}</span>
                  </button>
                  <span v-else class="tt-link-chip is-unresolved" data-testid="techtree-next-vehicle-unresolved">{{ next.stem }}</span>
                </template>
              </dd>
            </div>
          </dl>
        </header>

        <TankResearchPanel
          v-if="modules"
          :detail="detail"
          :modules="modules"
          :selection="selection"
          @select-config="selectConfig"
        />
        <p v-else-if="detailState === 'ready'" class="tt-status">{{ t('research.modules_unavailable') }}</p>
      </template>
    </template>

    <!-- ================= 树态 ================= -->
    <template v-else>
      <div class="tt-tabs" role="tablist" :aria-label="t('research.nation_tabs')">
        <button
          v-for="nation in NATIONS"
          :key="nation"
          type="button"
          role="tab"
          class="tt-tab"
          :class="{ 'is-on': nation === urlNation }"
          :aria-selected="nation === urlNation ? 'true' : 'false'"
          :data-testid="`techtree-nation-${nation}`"
          @click="writeState({ nation, tank: null })"
        >
          {{ nationLabel(nation) }}
        </button>
      </div>

      <p v-if="treeState === 'loading'" class="tt-status" role="status">{{ t('research.loading') }}</p>
      <EmptyState
        v-else-if="treeState === 'error'"
        role="alert"
        data-testid="techtree-error"
        :icon="TriangleAlert"
        :title="t('research.load_error_title')"
        :description="treeError || t('agentTanks.error_desc')"
      >
        <AppButton variant="primary" @click="loadTree(urlNation)">
          <RotateCcw :size="16" aria-hidden="true" />
          {{ t('agentTanks.retry') }}
        </AppButton>
      </EmptyState>

      <div v-else-if="grid" class="tt-scroll" data-testid="techtree-grid">
        <div class="tt-canvas" :style="{ minWidth: `${grid.columns.length * CELL_W}px` }">
          <div class="tt-body" :style="gridStyle">
            <svg class="tt-edges" :width="svgSize.width" :height="svgSize.height" aria-hidden="true">
              <defs>
                <marker id="tt-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
                  <path d="M0,0 L7,3.5 L0,7 z" class="tt-arrow-head" />
                </marker>
              </defs>
              <!-- 客户端连线几何（TankCell/Lines{mask} 提取）：出线从源格右侧 20px 处出发，
                   跨行干线骑在列边界上（客户端 VL/VR 在 ±0.5px），入线 13px 后是箭头
                   （LeftCenterArrow @13px）。 -->
              <path
                v-for="edge in grid.drawnEdges"
                :key="`${edge.from}-${edge.to}-${edge.sourceModule}`"
                class="tt-edge"
                :d="edgePath(edge)"
                marker-end="url(#tt-arrow)"
              >
                <title>{{ `${nameOf(edge.fromNode) || edge.from} → ${nameOf(edge.toNode) || edge.to}` }}{{ edge.cost?.xp != null ? ` · ${t('research.xp_cost', { xp: edge.cost.xp.toLocaleString() })}` : '' }}</title>
              </path>
            </svg>
            <button
              v-for="[key, node] in grid.cells"
              :key="key"
              type="button"
              class="tt-cell"
              :class="{ 'is-preview': node.preview }"
              :style="{ gridColumn: String(grid.colIndex.get(node.x) + 1), gridRow: String(grid.rowIndex.get(node.y) + 1) }"
              :data-testid="`techtree-cell-${node.stem}`"
              :aria-label="`${nameOf(node) || node.stem} · ${t('agentTanks.tier_n', { tier: node.tier })}`"
              @click="openResearch(node)"
            >
              <img class="tt-cell-icon" :src="tankImageUrl(node.tankId)" alt="" loading="lazy" decoding="async" @error="$event.target.hidden = true">
              <span class="tt-cell-info">
                <span class="tt-cell-name">{{ nameOf(node) || node.stem }}</span>
                <span class="tt-cell-meta">
                  <span class="tt-pill">T{{ node.tier }}</span>
                  <span v-if="summaryOf(node)?.is_premium" class="tt-pill is-premium">{{ t('agentTanks.premium') }}</span>
                  <span v-if="node.preview" class="tt-pill is-preview">{{ t('research.preview') }}</span>
                </span>
                <span v-if="costByStem.get(node.stem) != null" class="tt-cell-cost">{{ t('research.xp_short', { xp: costByStem.get(node.stem).toLocaleString() }) }}</span>
              </span>
            </button>
            <span
              v-for="node in grid.pending"
              :key="`pending-${node.stem}`"
              class="tt-cell is-pending"
              :style="{ gridColumn: String(grid.colIndex.get(node.x) + 1), gridRow: String(grid.rowIndex.get(node.y) + 1) }"
              :title="t('research.pending_title', { stem: node.stem })"
              :data-testid="`techtree-pending-${node.stem}`"
            >
              <span class="tt-pending-label">{{ t('research.pending') }}</span>
            </span>
          </div>
          <!-- PREMIUM 带（客户端 PremiumSection：premiumRows×96，底部 96px 渐变底 + 标签）；
               单元归属由客户端模型重排、数据不可证——这里只渲染带本身，不重排任何格子。 -->
          <div
            v-if="grid.premiumRows > 0"
            class="tt-premium"
            :style="{ height: `${grid.premiumRows * CELL_H}px` }"
            data-testid="techtree-premium-band"
          >
            <span class="tt-premium-label">{{ t('research.premium_band') }}</span>
          </div>
          <!-- 等级条（客户端 LevelCell：216×24，roman(level)，可见窗口 = minLevel..maxLevel；
               吸底、随内容横向滚动）。列 i 的标注 = minTier + i（other 树列 1..7 = tier
               4..10 时与客户端一致）。 -->
          <div class="tt-ruler" :style="rulerStyle" data-testid="techtree-levels">
            <span v-for="(x, i) in grid.columns" :key="`ruler-${x}`" class="tt-ruler-cell">
              {{ grid.minTier != null && grid.minTier + i <= grid.maxTier ? romanLevel(grid.minTier + i) : '' }}
            </span>
          </div>
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.techtree {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-6) var(--gutter) var(--space-12);
  color: var(--color-text-primary);
  min-inline-size: 0;
}

.techtree :deep(.page-header) { margin-bottom: 0; }
.tt-status { margin: 0; color: var(--color-text-secondary); font: var(--type-body); }

.tt-tabs { display: flex; flex-wrap: wrap; gap: var(--space-1); }
.tt-tab {
  padding: var(--space-1) var(--space-3);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-full);
  background: var(--color-surface-1);
  color: var(--color-text-secondary);
  font: var(--type-body);
  cursor: pointer;
}
.tt-tab:hover { border-color: var(--color-border-strong); color: var(--color-text-primary); }
.tt-tab.is-on { border-color: var(--color-accent); color: var(--color-accent-text); background: color-mix(in oklab, var(--color-accent) 14%, var(--color-surface-1)); }
.tt-tab:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }

/* ---------- 树网格：客户端 216×96 单元格语义，横向滚动 ---------- */
.tt-scroll { overflow: auto; max-block-size: calc(100dvh - 220px); }
.tt-canvas { display: grid; gap: 0; min-inline-size: 0; align-content: start; }
.tt-body { position: relative; display: grid; }
.tt-edges { position: absolute; inset: 0; pointer-events: none; overflow: visible; }
.tt-edge { fill: none; stroke: var(--color-border-strong); stroke-width: 1.5; }
.tt-arrow-head { fill: var(--color-border-strong); }

/* PREMIUM 带（客户端 PremiumSection：底部 96px 渐变底 + 标签；这里是布局近似，
   客户端的单元格归属由模型重排、数据不可证，我们不重排）。 */
.tt-premium {
  position: relative;
  display: flex;
  align-items: flex-end;
  padding: var(--space-2);
  background: linear-gradient(to top, color-mix(in oklab, var(--color-warning) 7%, transparent), transparent) var(--color-surface-1) bottom / 100% 96px no-repeat;
}
.tt-premium-label {
  color: var(--color-text-secondary);
  font: var(--type-caption);
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

/* 等级条（客户端 LevelCell 216×24，罗马数字，吸底随内容横向滚动） */
.tt-ruler {
  position: sticky;
  inset-block-end: 0;
  display: grid;
  background: var(--color-surface-2);
}
.tt-ruler-cell {
  display: grid;
  place-items: center;
  block-size: 24px;
  color: var(--color-text-secondary);
  font: var(--type-caption);
  font-weight: 700;
}

.tt-cell {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-surface-1);
  cursor: pointer;
  text-align: start;
  min-inline-size: 0;
}
.tt-cell:hover { border-color: var(--color-border-strong); }
.tt-cell:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }
.tt-cell.is-preview { border-style: dashed; border-color: color-mix(in oklab, var(--color-warning) 55%, var(--color-border-subtle)); }
.tt-cell.is-pending {
  display: grid;
  place-items: center;
  border-style: dashed;
  background: var(--color-surface-2);
  opacity: 0.72;
  cursor: default;
}
.tt-pending-label { color: var(--color-text-secondary); font: var(--type-caption); }

.tt-cell-icon {
  flex: none;
  inline-size: 45%;
  max-inline-size: 120px;
  object-fit: contain;
}
.tt-cell-info { display: grid; gap: 2px; min-inline-size: 0; }
.tt-cell-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: var(--type-caption); font-weight: 600; }
.tt-cell-meta { display: flex; flex-wrap: wrap; gap: var(--space-1); }
.tt-cell-cost { color: var(--color-warning); font: var(--type-caption); font-variant-numeric: tabular-nums; }

.tt-pill {
  padding: 0 var(--space-1);
  border-radius: var(--radius-full);
  background: var(--color-surface-3);
  color: var(--color-text-secondary);
  font: var(--type-caption);
  font-weight: 600;
  white-space: nowrap;
}
.tt-pill.is-premium { background: color-mix(in oklab, var(--color-warning) 16%, var(--color-surface-1)); color: var(--color-warning); }
.tt-pill.is-preview { background: color-mix(in oklab, var(--color-info) 14%, var(--color-surface-1)); color: var(--color-info); }
.tt-pill.is-tier { background: color-mix(in oklab, var(--color-accent) 14%, var(--color-surface-1)); color: var(--color-accent-text); }

/* ---------- 研发态 ---------- */
.tt-nav { display: flex; }
.tt-research-head {
  display: flex;
  align-items: flex-start;
  gap: var(--space-4);
  padding: var(--space-4);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  background: var(--color-surface-1);
  box-shadow: var(--elevation-1);
  flex-wrap: wrap;
}
.tt-media {
  flex: none;
  display: grid;
  place-items: center;
  inline-size: 240px;
  aspect-ratio: 8 / 5;
  border-radius: var(--radius-sm);
  background: var(--color-surface-2);
  overflow: hidden;
}
.tt-media img { inline-size: 100%; block-size: 100%; object-fit: contain; }
.tt-research-title { display: grid; gap: var(--space-2); min-inline-size: 0; }
.tt-research-title h2 { margin: 0; font: var(--type-h2); overflow-wrap: anywhere; }
.tt-badges { display: flex; flex-wrap: wrap; gap: var(--space-1); }
.tt-research-actions { display: flex; gap: var(--space-1); }
.tt-links { display: grid; gap: var(--space-2); margin: 0; min-inline-size: 0; }
.tt-links dt { color: var(--color-text-secondary); font: var(--type-caption); }
.tt-links dd { margin: 0; display: flex; flex-wrap: wrap; gap: var(--space-1); }
.tt-link-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: 0 var(--space-2);
  min-block-size: var(--control-h-sm, 32px);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-full);
  background: var(--color-surface-2);
  color: var(--color-text-primary);
  font: var(--type-caption);
  cursor: pointer;
}
.tt-link-chip:hover { border-color: var(--color-border-strong); }
.tt-link-chip:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }
.tt-link-chip.is-unresolved { color: var(--color-text-secondary); cursor: default; }
.tt-link-cost { color: var(--color-warning); font-variant-numeric: tabular-nums; }

/* 手机：头部纵向排列，网格横向滚动不变 */
@media (width < 768px) {
  .techtree { gap: var(--space-3); padding-block-start: var(--space-4); }
  .tt-research-head { flex-direction: column; }
  .tt-media { inline-size: 100%; }
}
</style>
