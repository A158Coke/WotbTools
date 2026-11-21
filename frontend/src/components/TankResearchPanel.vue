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
import { moduleTreeLayout, noChainNoteKey } from '../utils/techTreeLayout.js'
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
 * 无法阅读/点击（整图 scale 不是合法布局手段）。 */
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
          {{ t(noChainNoteKey(detail.tier)) }}
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

<style scoped src="./tank-research-panel.css"></style>
