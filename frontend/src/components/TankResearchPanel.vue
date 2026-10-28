<script setup>
/**
 * 单车研发界面（客户端 ModulesTree 的数据面复刻）。
 *
 * 结构（客户端 ModulesTree.yaml）：左列 PreviousTanks（前驱车）→ 当前车面板 →
 * 右侧模块研发图。网格 = 客户端常量 64×64 节点 + 104/97 pitch；**节点坐标由客户端
 * 模型计算、数据没有**，这里用 utils/techTreeLayout 的分层 DAG（列=最长入边路径、
 * 行就着父节点放），UI 明示「布局为复刻推导」。下一级坦克是图里的节点，由解锁它的
 * 模块连出去（与客户端同构）。
 *
 * 交互 = 客户端「点击节点 → 安装」：炮塔/炮经 `?config=` 对号，发动机/履带写各自
 * 下标；下一级坦克节点点击切车。不做研发/购买/解锁流程（无账号状态）。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowLeft, Check } from 'lucide-vue-next'
import { loadTankIconCrops, tankImageUrl } from '../scene/agentData.js'
import { tankIconCropTransform } from '../utils/tankIconCrop.js'
import { moduleIconUrl } from '../utils/researchCatalog.js'
import { moduleTreeLayout } from '../utils/techTreeLayout.js'
import { formatXpCompact } from '../utils/xpFormat.js'

const props = defineProps({
  /** tank/{id}.json */
  detail: { type: Object, required: true },
  /** research/modules/{nation}.json 单车条目 */
  modules: { type: Object, required: true },
  /** tankSetup.resolveSetup 结果（?config= 对号的当前搭载） */
  selection: { type: Object, default: null },
  /** 前驱车：[{ node, cost, name }]（科技树边 to=当前车；可能多父） */
  prevVehicles: { type: Array, default: () => [] },
  /** 后继车：[{ stem, cost, name, tankId, sourceModule, sourceKind }]（模块 `<unlocks><vehicle>` 目标） */
  nextVehicles: { type: Array, default: () => [] },
})

const emit = defineEmits(['install', 'open-vehicle'])

const { t, locale } = useI18n()

const lang = computed(() => (locale.value === 'zh' ? 'zh-Hans' : 'en'))
function moduleName(item) {
  if (!item) return ''
  return item[`name_${lang.value}`] || item['name_zh-Hans'] || item.name_en || item.stem || ''
}

const layout = computed(() => {
  try {
    return moduleTreeLayout(props.modules, props.selection, { nextVehicles: props.nextVehicles })
  } catch (error) {
    // 拓扑环等数据异常：整块降级为不可用（fail-closed），不渲染半残图。
    console.error('module tree layout failed:', error)
    return null
  }
})

/* 客户端节点 64×64 / pitch 104×97；这里把**宽度**放宽到 96（pitch 136）——
   小字号下 64 宽只能放约 10 字符/行，两行放不下 "110 mm Destiny Gun V1"
   （实测 4/16 截断）；96 宽两行可容纳 ~28 字符。高度保持客户端 64。 */
const NODE_W = 96
const NODE_H = 64
const PITCH_X = 136
const PITCH_Y = 97

const gridStyle = computed(() => ({
  width: `${layout.value.columns * PITCH_X}px`,
  height: `${layout.value.rows * PITCH_Y}px`,
}))

/** 研发图等比缩放到可用区域（客户端整屏缩放 UI 的同构做法）：图比容器大时缩小，
 * 而不是让用户拖动；容器变大时恢复到 1:1（不放大）。下限 0.72——更小的缩放文字读不清，
 * 极宽的树改为横向平移（与客户端滚动容器同语义）。 */
const scrollEl = ref(null)
const fitScale = ref(1)
const gridW = computed(() => (layout.value?.columns || 0) * PITCH_X)
const gridH = computed(() => (layout.value?.rows || 0) * PITCH_Y)
let observer = null
function recalcFit() {
  const el = scrollEl.value
  if (!el || !gridW.value || !gridH.value) { fitScale.value = 1; return }
  const availW = el.clientWidth - 20
  const availH = el.clientHeight - 20
  if (availW <= 0 || availH <= 0) return
  const scale = Math.min(1, availW / gridW.value, availH / gridH.value)
  // 下限 0.72：再小文字就读不清了。极宽的树（如 14 列的活动车）宁可横向平移
  // ——客户端本身也是滚动容器，不做无限缩小。
  fitScale.value = Math.max(0.72, Math.round(scale * 1000) / 1000)
}
watch([gridW, gridH], recalcFit)
onMounted(() => {
  recalcFit()
  if (typeof ResizeObserver !== 'undefined' && scrollEl.value) {
    observer = new ResizeObserver(recalcFit)
    observer.observe(scrollEl.value)
  }
})
onBeforeUnmount(() => { observer?.disconnect(); observer = null })
const fitStyle = computed(() => ({
  width: `${gridW.value * fitScale.value}px`,
  height: `${gridH.value * fitScale.value}px`,
}))
const gridScaledStyle = computed(() => ({
  ...gridStyle.value,
  transform: `scale(${fitScale.value})`,
  transformOrigin: 'top left',
}))

function cellPos(node) {
  return { left: `${node.col * PITCH_X}px`, top: `${node.row * PITCH_Y}px` }
}

/** 连线端点 = 节点中心（宽高各自按节点尺寸取半）。 */
const centerX = col => col * PITCH_X + NODE_W / 2
const centerY = row => row * PITCH_Y + NODE_H / 2

/** 连线（含「模块 → 下一级坦克」）：两端都取节点中心，SVG 拓扑等价。 */
const edges = computed(() => {
  const l = layout.value
  if (!l) return []
  const byKey = new Map(l.nodes.map(n => [n.key, n]))
  return l.edges
    .map(edge => ({ ...edge, from: byKey.get(edge.from), to: byKey.get(edge.to) }))
    .filter(edge => edge.from && edge.to)
})

const KIND_I18N = { chassis: 'track', turret: 'turret', gun: 'gun', engine: 'engine' }
/** 模块类型图标（客户端 ModulesTechTree 图集）。 */
const KIND_ICON = { chassis: 'chassis', turret: 'turret', gun: 'gun', engine: 'engine' }

function nodeIcon(kind) {
  return moduleIconUrl(KIND_ICON[kind] || '')
}

function nodeLabelText(node) {
  return node.kind === 'vehicle' ? (node.name || node.stem) : moduleName(node.module)
}

/** 节点成本：XP 与活动代币（`prx_*`）分开显示，都按 k 缩写（tooltip 给全值）。 */
function nodeCostText(node) {
  if (node.cost != null) return formatXpCompact(node.cost)
  if (node.costTokens?.amount != null) return formatXpCompact(node.costTokens.amount)
  return ''
}
function nodeCostTitle(node) {
  if (node.cost != null) return t('research.xp_cost', { xp: node.cost.toLocaleString() })
  if (node.costTokens?.amount != null) {
    return t('research.token_cost', {
      amount: node.costTokens.amount.toLocaleString(),
      currency: node.costTokens.currency || '—',
    })
  }
  return ''
}

function nodeTitle(node) {
  if (node.kind === 'vehicle') {
    const cost = node.cost != null ? t('research.xp_cost', { xp: node.cost.toLocaleString() }) : ''
    return [node.name || node.stem, t('research.next_tanks'), cost].filter(Boolean).join(' · ')
  }
  const name = moduleName(node.module)
  const kindLabel = t(`research.module_${KIND_I18N[node.kind] || node.kind}`)
  const cost = nodeCostTitle(node)
  const level = node.level != null ? t('agentTanks.tier_n', { tier: node.level }) : ''
  const action = node.installed ? t('research.installed') : t('research.click_to_install')
  return [name, kindLabel, level, cost, action].filter(Boolean).join(' · ')
}

/** 当前搭载的四件（与网格 installed 标记同源：resolveSetup 的下标对号）。 */
const mountedModules = computed(() => {
  const s = props.selection
  const m = props.modules
  if (!s?.canConfigure) return []
  const turret = m?.turrets?.[s.turret]
  return [
    { key: 'turret', item: turret },
    { key: 'gun', item: turret?.guns?.[s.gun] },
    { key: 'engine', item: m?.engines?.[s.engine] },
    { key: 'track', item: m?.chassis?.[s.track] },
  ].filter(row => row.item?.stem)
})

// 当前车面板图标：与科技树同一 crop 口径（卡片 176×64 内的 97×60 图标盒）
const ICON_ASPECT = 97 / 60
const iconCrops = ref(null)
onMounted(() => {
  loadTankIconCrops().then((crops) => { iconCrops.value = crops })
})
const tankId = computed(() => props.detail?.tank_id ?? props.detail?.tankId ?? null)
const iconStyle = computed(() => {
  const transform = tankIconCropTransform(iconCrops.value?.[String(tankId.value)], ICON_ASPECT)
  return transform ? { transform } : null
})

function activate(node) {
  if (node.kind === 'vehicle') {
    if (node.tankId) emit('open-vehicle', node.tankId)
    return
  }
  if (!node.installed) emit('install', node)
}
</script>

<template>
  <section class="tr-panel" data-testid="research-panel">
    <!-- ============ 左：前驱车 → 当前车面板 ============ -->
    <aside class="tr-side">
      <div v-if="prevVehicles.length" class="tr-prev" data-testid="research-prev-tanks">
        <h3 class="tr-side-title">{{ t('research.prev_tanks') }}</h3>
        <button
          v-for="prev in prevVehicles"
          :key="prev.node.stem"
          type="button"
          class="tr-prev-node"
          data-testid="research-prev-vehicle"
          :title="`${prev.name || prev.node.stem}${prev.cost != null ? ` · ${t('research.xp_cost', { xp: prev.cost.toLocaleString() })}` : ''}`"
          @click="emit('open-vehicle', prev.node.tankId)"
        >
          <ArrowLeft :size="14" aria-hidden="true" />
          <span class="tr-prev-name">{{ prev.name || prev.node.stem }}</span>
          <span v-if="prev.cost != null" class="tr-prev-cost">{{ t('research.xp_short', { xp: formatXpCompact(prev.cost) }) }}</span>
        </button>
      </div>

      <div class="tr-tank" data-testid="research-current-tank">
        <span class="tr-tank-icon">
          <img v-if="tankId" :src="tankImageUrl(tankId)" alt="" :style="iconStyle" @error="$event.target.hidden = true">
        </span>
        <h3 class="tr-tank-name">{{ detail.name }}</h3>
        <div class="tr-tank-meta">
          <span class="tr-pill">{{ t('agentTanks.tier_n', { tier: detail.tier }) }}</span>
        </div>
        <dl class="tr-mounted">
          <div v-for="row in mountedModules" :key="row.key">
            <dt>{{ t(`agentTanks.configurator.${row.key}`) }}</dt>
            <dd>{{ moduleName(row.item) }}</dd>
          </div>
        </dl>
        <p class="tr-hint">{{ t('research.click_to_install_hint') }}</p>
      </div>
    </aside>

    <!-- ============ 右：研发图（模块 + 下一级坦克，点击安装/切车） ============ -->
    <div class="tr-main">
      <header class="tr-head">
        <h3 class="tr-title">{{ t('research.modules_title') }}</h3>
        <span class="tr-note">{{ t('research.layout_derived_note') }}</span>
      </header>

      <p v-if="!layout" class="tr-empty" role="alert">{{ t('research.layout_unavailable') }}</p>
      <template v-else>
        <p v-if="!layout.hasChain" class="tr-empty" data-testid="research-no-chain">
          {{ t('research.no_chain_note') }}
        </p>
        <div ref="scrollEl" class="tr-scroll">
          <div class="tr-fit" :style="fitStyle">
          <div class="tr-grid" :style="gridScaledStyle" data-testid="research-grid">
            <svg class="tr-edges" :width="layout.columns * PITCH_X" :height="layout.rows * PITCH_Y" aria-hidden="true">
              <defs>
                <marker id="tr-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                  <path d="M0,0 L6,3 L0,6 z" class="tr-arrow-head" />
                </marker>
              </defs>
              <line
                v-for="edge in edges"
                :key="`${edge.from.key}->${edge.to.key}`"
                class="tr-edge"
                :class="{ 'is-installed': edge.from.installed && edge.to.installed }"
                :x1="centerX(edge.from.col)"
                :y1="centerY(edge.from.row)"
                :x2="centerX(edge.to.col)"
                :y2="centerY(edge.to.row)"
                marker-end="url(#tr-arrow)"
              >
                <title>{{ `${nodeLabelText(edge.from)} → ${nodeLabelText(edge.to)}` }}{{ edge.cost?.xp != null ? ` · ${t('research.xp_cost', { xp: edge.cost.xp.toLocaleString() })}` : '' }}</title>
              </line>
            </svg>
            <button
              v-for="node in layout.nodes"
              :key="node.key"
              type="button"
              class="tr-node"
              :class="{
                'is-installed': node.installed,
                'is-next-tank': node.kind === 'vehicle',
              }"
              :style="cellPos(node)"
              :title="nodeTitle(node)"
              :aria-label="nodeTitle(node)"
              :aria-pressed="node.kind === 'vehicle' ? undefined : (node.installed ? 'true' : 'false')"
              :disabled="node.kind === 'vehicle' && !node.tankId"
              :data-testid="`research-node-${node.kind}-${node.stem}`"
              @click="activate(node)"
            >
              <span class="tr-node-pic">
                <img v-if="node.kind === 'vehicle' && node.tankId" :src="tankImageUrl(node.tankId)" alt="" loading="lazy">
                <img v-else-if="nodeIcon(node.kind)" :src="nodeIcon(node.kind)" alt="" width="40" height="40" loading="lazy">
                <span v-else class="tr-node-fallback">{{ nodeLabelText(node).slice(0, 1) }}</span>
              </span>
              <span v-if="node.kind !== 'vehicle' && node.level != null && node.kind !== 'gun'" class="tr-node-level">{{ node.level }}</span>
              <span
                v-if="nodeCostText(node) && !node.installed"
                class="tr-node-cost"
                :class="{ 'is-token': node.cost == null }"
                :title="nodeCostTitle(node)"
              >{{ nodeCostText(node) }}</span>
              <span v-if="node.installed" class="tr-node-check" aria-hidden="true"><Check :size="12" /></span>
              <span class="tr-node-name">{{ nodeLabelText(node) }}</span>
            </button>
          </div>
          </div>
        </div>
      </template>
    </div>
  </section>
</template>

<style scoped>
/* 客户端 ModulesTree 的横向结构：前驱车 → 当前车面板 → 研发图。
   左两栏固定窄宽，研发图吃掉全部剩余空间（不再被挤成需要左右拖的小窗）。 */
.tr-panel {
  display: grid;
  grid-template-columns: 190px minmax(0, 1fr);
  gap: var(--space-4);
  padding: var(--space-4);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  background: var(--color-surface-1);
  box-shadow: var(--elevation-1);
  min-inline-size: 0;
  min-block-size: calc(100dvh - var(--header-h) - var(--tabbar-h) - 190px);
  align-items: stretch;
}

.tr-side { display: grid; gap: var(--space-3); align-content: start; min-inline-size: 0; }
.tr-side-title { margin: 0; color: var(--color-text-secondary); font: var(--type-caption); font-weight: 600; }
.tr-prev { display: grid; gap: var(--space-1); }
.tr-prev-node {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-surface-2);
  color: var(--color-text-primary);
  font: var(--type-caption);
  cursor: pointer;
  text-align: start;
}
.tr-prev-node:hover { border-color: var(--color-border-strong); }
.tr-prev-node:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }
.tr-prev-name { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tr-prev-cost { color: var(--color-warning); font-variant-numeric: tabular-nums; }

/* 当前车面板（客户端 TankPanel 的紧凑形态） */
.tr-tank {
  display: grid;
  gap: var(--space-2);
  justify-items: center;
  padding: var(--space-3);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-surface-2);
}
.tr-tank-icon {
  position: relative;
  inline-size: 97px;
  block-size: 60px;
  overflow: hidden;
}
.tr-tank-icon img {
  position: absolute;
  inset: 0;
  inline-size: 100%;
  block-size: 100%;
  object-fit: contain;
}
.tr-tank-name { margin: 0; font: var(--type-h3); text-align: center; overflow-wrap: anywhere; }
.tr-tank-meta { display: flex; flex-wrap: wrap; gap: var(--space-1); justify-content: center; }
.tr-pill {
  padding: 0 var(--space-2);
  border-radius: var(--radius-full);
  background: var(--color-surface-3);
  color: var(--color-text-secondary);
  font: var(--type-caption);
  font-weight: 600;
}
.tr-mounted { display: grid; gap: 2px; margin: 0; inline-size: 100%; }
.tr-mounted > div { display: flex; justify-content: space-between; gap: var(--space-2); }
.tr-mounted dt { color: var(--color-text-secondary); font: var(--type-caption); }
.tr-mounted dd { margin: 0; font: var(--type-caption); font-weight: 600; text-align: end; overflow-wrap: anywhere; }
.tr-hint { margin: 0; color: var(--color-text-secondary); font: var(--type-caption); text-align: center; }

.tr-main { display: flex; flex-direction: column; gap: var(--space-2); min-inline-size: 0; min-block-size: 0; }
.tr-head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-2); flex-wrap: wrap; }
.tr-title { margin: 0; font: var(--type-h3); }
.tr-note { color: var(--color-text-secondary); font: var(--type-caption); }
.tr-empty { margin: 0; color: var(--color-text-secondary); font: var(--type-body); }

/* 研发图区：占满剩余宽高，内容居中（图比容器小时不贴左上角留死白） */
.tr-scroll {
  display: grid;
  place-content: safe center;
  flex: 1 1 auto;
  overflow: auto;
  min-block-size: 0;
  padding: var(--space-2);
}
.tr-fit { position: relative; }
.tr-grid { position: absolute; inset-block-start: 0; inset-inline-start: 0; }
.tr-edges { position: absolute; inset: 0; pointer-events: none; }
.tr-edge { stroke: var(--color-border-strong); stroke-width: 1.5; }
.tr-edge.is-installed { stroke: var(--color-accent-text); }
.tr-arrow-head { fill: var(--color-border-strong); }

/* 节点 64×64（客户端 ModuleNode）；已安装 = 高亮 + 勾，点击安装 */
.tr-node {
  position: absolute;
  display: grid;
  grid-template-rows: 24px minmax(0, 1fr);
  justify-items: center;
  align-items: start;
  gap: 2px;
  inline-size: 96px;
  block-size: 64px;
  padding: 3px var(--space-1) 2px;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-surface-2);
  color: var(--color-text-secondary);
  cursor: pointer;
}
.tr-node:hover { border-color: var(--color-border-strong); color: var(--color-text-primary); }
.tr-node:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }
.tr-node.is-installed {
  border-color: var(--color-accent);
  background: color-mix(in oklab, var(--color-accent) 16%, var(--color-surface-1));
}
/* 下一级坦克节点：客户端 ModulesTree 的 VEHICLE 节点（在网格里、由模块连出去） */
.tr-node.is-next-tank {
  border-color: var(--color-info);
  background: color-mix(in oklab, var(--color-info) 12%, var(--color-surface-1));
  color: var(--color-text-primary);
}
.tr-node.is-next-tank:disabled { cursor: default; opacity: 0.6; }

.tr-node-pic { display: grid; place-items: center; inline-size: 24px; block-size: 24px; overflow: hidden; }
.tr-node-pic img { inline-size: 100%; block-size: 100%; object-fit: contain; }
.tr-node-fallback { font: var(--type-h3); }
.tr-node-level {
  position: absolute;
  inset-block-start: 0;
  inset-inline-end: 0;
  min-inline-size: 16px;
  padding: 0 3px;
  border-radius: var(--radius-full);
  background: var(--color-surface-1);
  color: var(--color-text-secondary);
  font: var(--type-caption);
  font-weight: 700;
}
/* 研发成本：左上角小标（等级标在右上、勾在右下，互不遮挡） */
.tr-node-cost {
  position: absolute;
  inset-block-start: 0;
  inset-inline-start: 0;
  max-inline-size: calc(100% - 18px);
  padding: 0 3px;
  border-radius: var(--radius-sm);
  background: var(--color-surface-1);
  color: var(--color-warning);
  font: var(--type-caption);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tr-node-cost.is-token { color: var(--color-info); }
.tr-node-check {
  position: absolute;
  inset-block-end: 0;
  inset-inline-end: 0;
  display: grid;
  place-items: center;
  inline-size: 14px;
  block-size: 14px;
  border-radius: var(--radius-full);
  background: var(--color-accent);
  color: var(--color-canvas);
}
/* 模块名最多两行（客户端也是压缩显示；单行必然全是省略号）：
   24px 图标 + 2×16px 文本 = 62px，正好落在 64px 节点内。完整名称在 tooltip/aria 里。 */
.tr-node-name {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  inline-size: 100%;
  overflow: hidden;
  overflow-wrap: anywhere;
  text-align: center;
  font-family: var(--font-family-sans);
  font-size: var(--font-size-caption-xs);
  line-height: var(--line-height-caption-xs);
}

/* 平板/手机：横向三段改为纵向堆叠（前驱车 → 当前车 → 研发图） */
@media (width < 1200px) {
  .tr-panel { grid-template-columns: minmax(0, 1fr); min-block-size: 0; }
  .tr-side { grid-template-columns: minmax(150px, 0.9fr) minmax(0, 1.1fr); align-items: start; }
  .tr-scroll { place-content: start; }
}
@media (width < 768px) {
  .tr-side { grid-template-columns: minmax(0, 1fr); }
}
</style>
