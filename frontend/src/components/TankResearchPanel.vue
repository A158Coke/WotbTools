<script setup>
/**
 * 单车研发界面（客户端 ModulesTree 的数据面复刻）。
 *
 * 布局（客户端 ModulesTree.yaml）：左侧 PreviousTanks（前驱车纵向列表）→ 当前车面板
 * （TankPanel：图标/名称/等级/兵种/当前搭载）→ 右侧模块网格。网格 = 客户端常量
 * 64×64 节点 + 104/97 pitch；**节点坐标由客户端模型计算，数据没有**，这里用
 * 「列 = 最长入边深度、行 = 模块族」的确定性推导，UI 明示「布局为复刻推导」。
 *
 * 交互 = 客户端「点击节点 → 安装」（不提供配置下拉）：点炮塔/炮/发动机/履带节点即把
 * 该模块装到当前配置上（炮塔/炮经 `?config=` 对号，发动机/履带写引擎/履带下标）。
 * 不做研发/购买/解锁流程（2026-10-27 裁定：无账号状态），未装模块只显示解锁 XP。
 */
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowLeft, Check } from 'lucide-vue-next'
import { tankImageUrl, loadTankIconCrops } from '../scene/agentData.js'
import { tankIconCropTransform } from '../utils/tankIconCrop.js'
import { moduleIconUrl } from '../utils/researchCatalog.js'
import { moduleTreeLayout } from '../utils/techTreeLayout.js'

const props = defineProps({
  /** tank/{id}.json */
  detail: { type: Object, required: true },
  /** research/modules/{nation}.json 单车条目 */
  modules: { type: Object, required: true },
  /** tankSetup.resolveSetup 结果（?config= 对号的当前搭载） */
  selection: { type: Object, default: null },
  /** 前驱车：[{ node, cost, name }]（科技树边 to=当前车；可能多父） */
  prevVehicles: { type: Array, default: () => [] },
  /** 后继车：[{ stem, cost, name, tankId }]（模块 `<unlocks><vehicle>` 目标；网格右端节点） */
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
    return moduleTreeLayout(props.modules, props.selection)
  } catch (error) {
    // 拓扑环等数据异常：整块降级为不可用（fail-closed），不渲染半残图。
    console.error('module tree layout failed:', error)
    return null
  }
})

const CELL = 64
const PITCH_X = 104
const PITCH_Y = 97

const gridStyle = computed(() => ({
  width: `${(layout.value.columns + (props.nextVehicles.length ? 1 : 0)) * PITCH_X}px`,
  height: `${Math.max(layout.value.rows, props.nextVehicles.length) * PITCH_Y}px`,
}))

function cellPos(node) {
  return { left: `${node.col * PITCH_X}px`, top: `${node.row * PITCH_Y}px` }
}

/** 解锁箭头：父子节点中心的连线（SVG，拓扑等价）。 */
const edges = computed(() => {
  const l = layout.value
  if (!l) return []
  const byKey = new Map(l.nodes.map(n => [n.key, n]))
  const out = []
  for (const node of l.nodes) {
    for (const u of Array.isArray(node.module?.unlocks) ? node.module.unlocks : []) {
      if (!u?.stem || u.kind === 'vehicle') continue
      const target = byKey.get(`${u.kind}:${u.stem}`)
      if (!target) continue
      out.push({
        key: `${node.key}->${target.key}`,
        from: node,
        to: target,
        cost: u.cost || null,
      })
    }
  }
  return out
})

/** 后继车节点占网格最右一列（不参与模块深度计算）。 */
const nextVehicleNodes = computed(() => props.nextVehicles.map((v, i) => ({ ...v, row: i })))

const KIND_I18N = { chassis: 'track', turret: 'turret', gun: 'gun', engine: 'engine' }
/** 模块类型图标（客户端 ModulesTechTree 图集）。 */
const KIND_ICON = { chassis: 'chassis', turret: 'turret', gun: 'gun', engine: 'engine' }

function nodeIcon(kind) {
  return moduleIconUrl(KIND_ICON[kind] || '')
}

function nodeTitle(node) {
  const name = moduleName(node.module)
  const kindLabel = t(`research.module_${KIND_I18N[node.kind] || node.kind}`)
  const cost = node.cost != null ? t('research.xp_cost', { xp: node.cost.toLocaleString() }) : ''
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
          <span v-if="prev.cost != null" class="tr-prev-cost">{{ t('research.xp_short', { xp: prev.cost.toLocaleString() }) }}</span>
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

    <!-- ============ 右：模块网格（点击即安装） ============ -->
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
          <div class="tr-grid" :style="gridStyle" data-testid="research-grid">
            <svg class="tr-edges" :width="layout.columns * PITCH_X" :height="layout.rows * PITCH_Y" aria-hidden="true">
              <defs>
                <marker id="tr-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                  <path d="M0,0 L6,3 L0,6 z" class="tr-arrow-head" />
                </marker>
              </defs>
              <line
                v-for="edge in edges"
                :key="edge.key"
                class="tr-edge"
                :class="{ 'is-installed': edge.from.installed && edge.to.installed }"
                :x1="edge.from.col * PITCH_X + CELL / 2"
                :y1="edge.from.row * PITCH_Y + CELL / 2"
                :x2="edge.to.col * PITCH_X + CELL / 2"
                :y2="edge.to.row * PITCH_Y + CELL / 2"
                marker-end="url(#tr-arrow)"
              >
                <title>{{ `${moduleName(edge.from.module)} → ${moduleName(edge.to.module)}` }}{{ edge.cost?.xp != null ? ` · ${t('research.xp_cost', { xp: edge.cost.xp.toLocaleString() })}` : '' }}</title>
              </line>
            </svg>
            <button
              v-for="next in nextVehicleNodes"
              :key="`next-${next.stem}`"
              type="button"
              class="tr-node is-next-tank"
              :style="{ left: `${layout.columns * PITCH_X}px`, top: `${next.row * PITCH_Y}px` }"
              :title="`${next.name || next.stem}${next.cost != null ? ` · ${t('research.xp_cost', { xp: next.cost.toLocaleString() })}` : ''}`"
              :data-testid="`research-next-vehicle-${next.stem}`"
              @click="next.tankId ? emit('open-vehicle', next.tankId) : null"
            >
              <span class="tr-node-pic">
                <img v-if="next.tankId" :src="tankImageUrl(next.tankId)" alt="" loading="lazy">
                <span v-else class="tr-node-fallback">{{ (next.name || next.stem).slice(0, 1) }}</span>
              </span>
              <span v-if="next.cost != null" class="tr-node-cost">{{ t('research.xp_short', { xp: next.cost.toLocaleString() }) }}</span>
              <span class="tr-node-name">{{ next.name || next.stem }}</span>
            </button>
            <button
              v-for="node in layout.nodes"
              :key="node.key"
              type="button"
              class="tr-node"
              :class="{ 'is-installed': node.installed }"
              :style="cellPos(node)"
              :title="nodeTitle(node)"
              :aria-label="nodeTitle(node)"
              :aria-pressed="node.installed ? 'true' : 'false'"
              :data-testid="`research-node-${node.kind}-${node.stem}`"
              @click="emit('install', node)"
            >
              <span class="tr-node-pic">
                <img v-if="nodeIcon(node.kind)" :src="nodeIcon(node.kind)" alt="" width="40" height="40" loading="lazy">
                <span v-else class="tr-node-fallback">{{ moduleName(node.module).slice(0, 1) }}</span>
              </span>
              <span v-if="node.level != null && node.kind !== 'gun'" class="tr-node-level">{{ node.level }}</span>
              <span v-if="node.cost != null && !node.installed" class="tr-node-cost">{{ t('research.xp_short', { xp: node.cost.toLocaleString() }) }}</span>
              <span v-if="node.installed" class="tr-node-check" aria-hidden="true"><Check :size="12" /></span>
              <span class="tr-node-name">{{ moduleName(node.module) }}</span>
            </button>
          </div>
        </div>
      </template>
    </div>
  </section>
</template>

<style scoped>
/* 客户端 ModulesTree 的横向结构：前驱车列表 → 当前车面板 → 模块网格 */
.tr-panel {
  display: grid;
  grid-template-columns: minmax(150px, 0.8fr) minmax(200px, 1fr) minmax(0, 2.6fr);
  gap: var(--space-4);
  padding: var(--space-4);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  background: var(--color-surface-1);
  box-shadow: var(--elevation-1);
  min-inline-size: 0;
  align-items: start;
}

.tr-side { display: grid; gap: var(--space-3); min-inline-size: 0; }
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

.tr-main { display: grid; gap: var(--space-2); min-inline-size: 0; }
.tr-head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-2); flex-wrap: wrap; }
.tr-title { margin: 0; font: var(--type-h3); }
.tr-note { color: var(--color-text-secondary); font: var(--type-caption); }
.tr-empty { margin: 0; color: var(--color-text-secondary); font: var(--type-body); }

/* 网格：客户端 pitch 语义（列 104 / 行 97），小屏横向滚动 */
.tr-scroll { overflow-x: auto; }
.tr-grid { position: relative; }
.tr-edges { position: absolute; inset: 0; pointer-events: none; }
.tr-edge { stroke: var(--color-border-strong); stroke-width: 1.5; }
.tr-edge.is-installed { stroke: var(--color-accent-text); }
.tr-arrow-head { fill: var(--color-border-strong); }

/* 节点 64×64（客户端 ModuleNode）；已安装 = 高亮 + 勾，可点击安装 */
.tr-node {
  position: absolute;
  display: grid;
  justify-items: center;
  gap: 2px;
  inline-size: 64px;
  block-size: 64px;
  padding: 2px;
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

.tr-node-pic { display: grid; place-items: center; inline-size: 32px; block-size: 32px; }
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
.tr-node-cost {
  position: absolute;
  inset-block-end: 12px;
  padding: 0 3px;
  border-radius: var(--radius-sm);
  background: var(--color-surface-1);
  color: var(--color-warning);
  font: var(--type-caption);
  font-variant-numeric: tabular-nums;
}
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
.tr-node.is-next-tank { border-color: var(--color-info); background: color-mix(in oklab, var(--color-info) 12%, var(--color-surface-1)); }
.tr-node.is-next-tank .tr-node-pic img { object-fit: contain; }
.tr-node-name {
  inline-size: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: center;
  font: var(--type-caption);
  align-self: end;
}

/* 平板/手机：客户端横向三段改为纵向堆叠（前驱车 → 当前车 → 网格） */
@media (width < 1200px) {
  .tr-panel { grid-template-columns: minmax(0, 1fr); }
  .tr-side { grid-template-columns: minmax(150px, 0.9fr) minmax(0, 1.1fr); align-items: start; }
}
@media (width < 768px) {
  .tr-side { grid-template-columns: minmax(0, 1fr); }
}
</style>
