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
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowLeft, Check } from 'lucide-vue-next'
import { loadTankIconCrops, tankImageUrl } from '../scene/agentData.js'
import { tankIconCropTransform } from '../utils/tankIconCrop.js'
import { moduleIconUrl } from '../utils/researchCatalog.js'
import { moduleTreeLayout } from '../utils/techTreeLayout.js'
import { formatXpCompact } from '../utils/xpFormat.js'
import { romanLevel } from '../utils/tierFormat.js'

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
/** 左侧竖干（客户端：当前坦克 → 各行分叉）的宽度 */
const TRUNK_W = 32
/** 本级坦克节点与下一级坦克同尺寸、同呈现（用户 2026-10-27），占最左一个节点位 */
const CURRENT_X = 0

const gridStyle = computed(() => ({
  width: `${layout.value.columns * PITCH_X}px`,
  height: `${layout.value.rows * PITCH_Y}px`,
}))

/** 研发图按自然尺寸渲染（96×64 节点 / 136×97 pitch）：容器 .tr-scroll 负责滚动。
 * 不做整图 `transform: scale()`——缩放会把节点文字和 44px 触控目标一起缩小，窄屏上
 * 无法阅读/点击（frontend/AGENTS.md 明确禁止整图 scale 作为布局手段）。 */
const gridW = computed(() => (layout.value?.columns || 0) * PITCH_X)
const canvasW = computed(() => NODE_W + TRUNK_W + gridW.value)
const gridH = computed(() => (layout.value?.rows || 0) * PITCH_Y)
const canvasStyle = computed(() => ({
  width: `${canvasW.value}px`,
  height: `${gridH.value}px`,
}))
const gridInCanvasStyle = computed(() => ({ ...gridStyle.value, left: `${NODE_W + TRUNK_W}px` }))
/** 当前坦克节点：纵向对齐各链行的中点（不超出画布）。 */
const currentTop = computed(() => {
  const l = layout.value
  if (!l?.branches?.length) return 0
  const ys = l.branches.map(b => b.row * PITCH_Y + NODE_H / 2)
  const mid = (Math.min(...ys) + Math.max(...ys)) / 2
  return Math.max(0, Math.min(gridH.value - NODE_H, mid - NODE_H / 2))
})

/** 竖干：从当前坦克节点右缘中点横出 → 竖线贯穿各链行 → 逐行横出箭头（直角折线）。 */
const trunk = computed(() => {
  const l = layout.value
  if (!l?.branches?.length) return { lines: [], height: gridH.value }
  const ys = l.branches.map(b => b.row * PITCH_Y + NODE_H / 2).sort((a, b) => a - b)
  const top = ys[0]
  const bottom = ys[ys.length - 1]
  const currentY = currentTop.value + NODE_H / 2
  const trunkX = NODE_W + 12
  const lines = [
    // 当前坦克右缘 → 竖干
    { x1: NODE_W, y1: currentY, x2: trunkX, y2: currentY, arrow: false },
    // 竖干本体（覆盖当前节点中心与全部分行）
    { x1: trunkX, y1: Math.min(top, currentY), x2: trunkX, y2: Math.max(bottom, currentY), arrow: false },
  ]
  for (const y of ys) lines.push({ x1: trunkX, y1: y, x2: NODE_W + TRUNK_W, y2: y, arrow: true })
  return { lines, height: gridH.value }
})

/** 连线：直角折线（客户端同样不画斜线）：源右缘 → 列间中线 → 竖直 → 目标左缘箭头。 */
const edges = computed(() => {
  const l = layout.value
  if (!l) return []
  const byKey = new Map(l.nodes.map(n => [n.key, n]))
  return l.edges
    .map(edge => ({ ...edge, from: byKey.get(edge.from), to: byKey.get(edge.to) }))
    .filter(edge => edge.from && edge.to)
    .map((edge) => {
      const x1 = edge.from.col * PITCH_X + NODE_W
      const y1 = edge.from.row * PITCH_Y + NODE_H / 2
      const x2 = edge.to.col * PITCH_X
      const y2 = edge.to.row * PITCH_Y + NODE_H / 2
      const d = y1 === y2
        ? `M ${x1} ${y1} H ${x2}`
        : `M ${x1} ${y1} H ${(x1 + x2) / 2} V ${y2} H ${x2}`
      return { ...edge, d }
    })
})

function cellPos(node) {
  return { left: `${node.col * PITCH_X}px`, top: `${node.row * PITCH_Y}px` }
}

/** 连线端点 = 节点中心（宽高各自按节点尺寸取半）。 */
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

/** 本级坦克节点图：与下一级坦克节点同一裁剪口径（96×64）。 */
const iconCrops = ref(null)
onMounted(() => {
  loadTankIconCrops().then((crops) => { iconCrops.value = crops })
})
const tankId = computed(() => props.detail?.tank_id ?? props.detail?.tankId ?? null)
function cropStyle(id, boxAspect) {
  const transform = tankIconCropTransform(iconCrops.value?.[String(id)], boxAspect)
  return transform ? { transform } : null
}
const iconStyle = computed(() => cropStyle(tankId.value, NODE_W / NODE_H))
/** 下一级坦克节点的小图同样要套内容框裁剪（原始画布坦克锚左上，不然看着偏）。 */
/** 车辆节点图铺满格子（96×64 → aspect 1.5），与模块图同一裁剪口径。 */
function vehicleIconStyle(id) {
  return cropStyle(id, NODE_W / NODE_H)
}

function activate(node) {
  if (node.kind === 'vehicle') {
    if (node.tankId) emit('open-vehicle', node.tankId)
    return
  }
  if (!node.installed) emit('install', node)
}
</script>

<template>
  <section class="tr-panel" :class="{ 'has-side': prevVehicles.length }" data-testid="research-panel">
    <!-- ============ 左：前驱车 → 当前车面板 ============ -->
    <aside v-if="prevVehicles.length" class="tr-side">
      <div class="tr-prev" data-testid="research-prev-tanks">
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
        <div class="tr-scroll">
          <div class="tr-canvas" :style="canvasStyle">
          <!-- 本级坦克：与下一级坦克同一呈现（节点 + 下方名字），竖干从它右缘接出 -->
          <div
            class="tr-node is-current-tank"
            :style="{ left: `${CURRENT_X}px`, top: `${currentTop}px` }"
            data-testid="research-current-tank"
            :aria-label="detail.name"
            :title="detail.name"
          >
            <span class="tr-node-pic">
              <img v-if="tankId" :src="tankImageUrl(tankId)" alt="" :style="iconStyle" @error="$event.target.hidden = true">
            </span>
            <span class="tr-node-level">{{ romanLevel(detail.tier) }}</span>
            <span class="tr-node-name">{{ detail.name }}</span>
          </div>
          <svg
            class="tr-trunk"
            :width="TRUNK_W"
            :height="gridH"
            :style="{ insetInlineStart: `${NODE_W}px` }"
            aria-hidden="true"
          >
            <defs>
              <marker id="tr-trunk-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                <path d="M0,0 L6,3 L0,6 z" class="tr-arrow-head" />
              </marker>
            </defs>
            <line
              v-for="(line, i) in trunk.lines"
              :key="i"
              class="tr-trunk-line"
              :x1="line.x1 - NODE_W" :y1="line.y1"
              :x2="line.x2 - NODE_W" :y2="line.y2"
              :marker-end="line.arrow ? 'url(#tr-trunk-arrow)' : null"
            />
          </svg>
          <div class="tr-grid" :style="gridInCanvasStyle" data-testid="research-grid">
            <svg class="tr-edges" :width="layout.columns * PITCH_X" :height="layout.rows * PITCH_Y" aria-hidden="true">
              <defs>
                <marker id="tr-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                  <path d="M0,0 L6,3 L0,6 z" class="tr-arrow-head" />
                </marker>
              </defs>
              <path
                v-for="edge in edges"
                :key="`${edge.from.key}->${edge.to.key}`"
                class="tr-edge"
                :class="{ 'is-installed': edge.from.installed && edge.to.installed }"
                :d="edge.d"
                marker-end="url(#tr-arrow)"
              >
                <title>{{ `${nodeLabelText(edge.from)} → ${nodeLabelText(edge.to)}` }}{{ edge.cost?.xp != null ? ` · ${t('research.xp_cost', { xp: edge.cost.xp.toLocaleString() })}` : '' }}</title>
              </path>
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
                <img v-if="node.kind === 'vehicle' && node.tankId" :src="tankImageUrl(node.tankId)" alt="" loading="lazy" :style="vehicleIconStyle(node.tankId)">
                <img v-else-if="nodeIcon(node.kind)" :src="nodeIcon(node.kind)" alt="" width="40" height="40" loading="lazy">
                <span v-else class="tr-node-fallback">{{ nodeLabelText(node).slice(0, 1) }}</span>
              </span>
              <span v-if="node.level != null" class="tr-node-level">{{ romanLevel(node.level) }}</span>
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
  /* 没有前驱车（金币车等）时不保留空侧栏：单列铺满，否则图被挤进 190px 首列 */
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-4);
  padding: var(--space-4);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  background: var(--color-surface-1);
  box-shadow: var(--elevation-1);
  min-inline-size: 0;
  min-block-size: 0;
  align-items: stretch;
}

.tr-panel.has-side { grid-template-columns: 190px minmax(0, 1fr); }
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
.tr-node.is-current-tank { border-color: var(--color-border-strong); }
.tr-node.is-current-tank .tr-node-name { color: var(--color-text-primary); font-weight: 600; }

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
.tr-canvas { position: relative; }
.tr-trunk { position: absolute; inset-block-start: 0; inset-inline-start: 0; pointer-events: none; }
.tr-trunk-line { stroke: var(--color-border-strong); stroke-width: 1.5; }
.tr-grid { position: absolute; inset-block-start: 0; }
.tr-edges { position: absolute; inset: 0; pointer-events: none; }
.tr-edge { stroke: var(--color-border-strong); stroke-width: 1.5; }
/* 已研发链路的线也只提亮成中性白，不用金色（金色 = 高级车） */
.tr-edge.is-installed { stroke: var(--color-text-primary); }
.tr-arrow-head { fill: var(--color-border-strong); }

/* 节点 64×64（客户端 ModuleNode）；已安装 = 高亮 + 勾，点击安装 */
.tr-node {
  position: absolute;
  display: grid;
  place-items: center;
  inline-size: 96px;
  block-size: 64px;
  padding: 0;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-surface-2);
  color: var(--color-text-secondary);
  cursor: pointer;
}
.tr-node:hover { border-color: var(--color-border-strong); color: var(--color-text-primary); }
.tr-node:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }
/* 已安装 = 中性高亮 + 右下勾，不用强调色：蓝/金在客户端是收藏车/高级车的等级编码，
   研发图里借来标“已安装/可切换”会被读成坦克类别（用户 2026-10-27）。 */
.tr-node.is-installed {
  border-color: var(--color-border-strong);
  background: var(--color-surface-3);
}
/* 下一级坦克节点：类型由坦克图 + 等级角标表达，边框保持普通样式 */
.tr-node.is-next-tank {
  color: var(--color-text-primary);
}
.tr-node.is-next-tank:disabled { cursor: default; opacity: 0.6; }

/* 客户端 ModuleNode 的模块图是 97×60 居中（几乎铺满 64×72 节点），不是小角标 */
.tr-node-pic {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  overflow: hidden;
  border-radius: inherit;
}
/* 必须**绝对定位**铺满：grid 容器里 `block-size:100%` 解不出确定高度，
   img 会退回固有尺寸（96×96），被 62 高的容器从下方裁掉 32px——实测如此。 */
.tr-node-pic img {
  position: absolute;
  inset: 0;
  inline-size: 100%;
  block-size: 100%;
  object-fit: contain;
}
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
  inset-block-end: 2px;
  inset-inline-end: 2px;
  display: grid;
  place-items: center;
  inline-size: 14px;
  block-size: 14px;
  border-radius: var(--radius-full);
  background: var(--color-accent);
  color: var(--color-canvas);
}
/* 客户端 ModulesTree 的节点里**只有图标**（名字在 tooltip/详情）；这里把名字放到
   节点下方的行间距里，图标因此能完整铺满格子不被文字盖住。 */
.tr-node-name {
  position: absolute;
  inset-block-start: calc(100% + 1px);
  inset-inline: -8px;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  overflow-wrap: anywhere;
  text-align: center;
  font-family: var(--font-family-sans);
  font-size: var(--font-size-caption-xs);
  line-height: var(--line-height-caption-xs);
  color: var(--color-text-secondary);
  pointer-events: none;
}

/* 平板/手机：横向三段改为纵向堆叠（前驱车 → 当前车 → 研发图） */
@media (width < 1200px) {
  /* has-side 的桌面规则是 .tr-panel.has-side（0,2,0），这里必须同特异性覆盖，否则
     平板/手机会继续保留 190px 前驱车列，把研发图挤成一条无法阅读的滚动缝。 */
  .tr-panel,
  .tr-panel.has-side { grid-template-columns: minmax(0, 1fr); min-block-size: 0; }
  .tr-side { grid-template-columns: minmax(150px, 0.9fr) minmax(0, 1.1fr); align-items: start; }
  .tr-scroll { place-content: start; }
}
@media (width < 768px) {
  .tr-side { grid-template-columns: minmax(0, 1fr); }
}
</style>
