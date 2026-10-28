<script setup>
/**
 * 单车研发界面（客户端 ModulesTree 的数据面复刻）。
 *
 * 布局 = utils/techTreeLayout.moduleTreeLayout 的确定性推导（列=依赖深度、行=模块族；
 * 客户端网格坐标由模型计算、数据文件没有——UI 明示「布局为复刻推导」）。节点状态只有
 * 两种数据可证的形态：installed（当前搭载对号，resolveSetup）与未研发（显示解锁成本
 * XP）；不做研发/购买/解锁流程（2026-10-27 裁定：无账号状态）。
 *
 * 模块解锁箭头 = 模块 `<unlocks>` 本车内部边（SVG 拓扑连线）；`<unlocks><vehicle>`
 * 的整车目标由父组件呈现（页面持有科技树数据）。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { moduleIconUrl } from '../utils/researchCatalog.js'
import { moduleTreeLayout } from '../utils/techTreeLayout.js'

const props = defineProps({
  /** tank/{id}.json */
  detail: { type: Object, required: true },
  /** research/modules/{nation}.json 单车条目 */
  modules: { type: Object, required: true },
  /** tankSetup.resolveSetup 结果（?config= 对号的当前搭载） */
  selection: { type: Object, default: null },
})

const emit = defineEmits(['select-config'])

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
  width: `${layout.value.columns * PITCH_X}px`,
  height: `${layout.value.rows * PITCH_Y}px`,
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
        costRaw: u.costRaw ?? null,
      })
    }
  }
  return out
})

const KIND_I18N = { chassis: 'track', turret: 'turret', gun: 'gun', engine: 'engine', radio: 'radio', fuelTank: 'fuel' }
/** 模块类型图标只有 5 张（ModulesTechTree）；radio/fuelTank 无图 → 文字回退。 */
const KIND_ICON = { chassis: 'chassis', turret: 'turret', gun: 'gun', engine: 'engine' }

function nodeIcon(kind) {
  return moduleIconUrl(KIND_ICON[kind] || '')
}

function nodeTitle(node) {
  const name = moduleName(node.module)
  const kindLabel = t(`research.module_${KIND_I18N[node.kind] || node.kind}`)
  const cost = node.cost != null ? t('research.xp_cost', { xp: node.cost.toLocaleString() }) : ''
  const level = node.level != null ? t('agentTanks.tier_n', { tier: node.level }) : ''
  return [name, kindLabel, level, cost].filter(Boolean).join(' · ')
}

const configs = computed(() => (Array.isArray(props.detail?.configs) ? props.detail.configs : []))
</script>

<template>
  <section class="tr-panel" data-testid="research-panel">
    <header class="tr-head">
      <h3 class="tr-title">{{ t('research.modules_title') }}</h3>
      <span class="tr-note">{{ t('research.layout_derived_note') }}</span>
      <label v-if="configs.length > 1" class="tr-config">
        <span>{{ t('agentTanks.select_config') }}</span>
        <select
          :value="selection?.config ?? configs.length - 1"
          data-testid="research-config"
          @change="emit('select-config', Number($event.target.value))"
        >
          <option v-for="(c, i) in configs" :key="i" :value="i">{{ c.label }}</option>
        </select>
      </label>
    </header>

    <p v-if="!layout" class="tr-empty" role="alert">{{ t('research.layout_unavailable') }}</p>
    <div v-else class="tr-scroll">
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
          v-for="node in layout.nodes"
          :key="node.key"
          type="button"
          class="tr-node"
          :class="{ 'is-installed': node.installed }"
          :style="cellPos(node)"
          :title="nodeTitle(node)"
          :aria-label="nodeTitle(node)"
          :data-testid="`research-node-${node.kind}-${node.stem}`"
        >
          <span class="tr-node-pic">
            <img v-if="nodeIcon(node.kind)" :src="nodeIcon(node.kind)" alt="" width="40" height="40" loading="lazy">
            <span v-else class="tr-node-fallback">{{ moduleName(node.module).slice(0, 1) }}</span>
          </span>
          <span v-if="node.level != null && node.kind !== 'gun'" class="tr-node-level">{{ node.level }}</span>
          <span v-if="node.cost != null && !node.installed" class="tr-node-cost">{{ t('research.xp_short', { xp: node.cost.toLocaleString() }) }}</span>
          <span class="tr-node-name">{{ moduleName(node.module) }}</span>
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.tr-panel {
  display: grid;
  gap: var(--space-3);
  padding: var(--space-4);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  background: var(--color-surface-1);
  box-shadow: var(--elevation-1);
  min-inline-size: 0;
}

.tr-head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-2); flex-wrap: wrap; }
.tr-title { margin: 0; font: var(--type-h3); }
.tr-note { color: var(--color-text-secondary); font: var(--type-caption); }
.tr-config { display: inline-flex; align-items: center; gap: var(--space-2); color: var(--color-text-secondary); font: var(--type-caption); }
.tr-config select {
  min-block-size: var(--control-h-md);
  padding: 0 var(--space-2);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  background: var(--color-surface-1);
  color: var(--color-text-primary);
  font: var(--type-body);
}
.tr-config select:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }

.tr-empty { margin: 0; color: var(--color-text-secondary); font: var(--type-body); }

/* 网格：客户端 pitch 语义（列 104 / 行 97），小屏横向滚动 */
.tr-scroll { overflow-x: auto; }
.tr-grid { position: relative; }
.tr-edges { position: absolute; inset: 0; }
.tr-edge { stroke: var(--color-border-strong); stroke-width: 1.5; }
.tr-arrow-head { fill: var(--color-border-strong); }

.tr-node {
  position: absolute;
  display: grid;
  justify-items: center;
  gap: 2px;
  inline-size: 64px;
  padding: 2px;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-surface-2);
  color: var(--color-text-secondary);
  cursor: default;
}
.tr-node.is-installed {
  border-color: var(--color-accent);
  background: color-mix(in oklab, var(--color-accent) 16%, var(--color-surface-1));
}
.tr-node:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }

.tr-node-pic { display: grid; place-items: center; inline-size: 40px; block-size: 40px; }
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
  inset-block-end: 14px;
  padding: 0 3px;
  border-radius: var(--radius-sm);
  background: var(--color-surface-1);
  color: var(--color-warning);
  font: var(--type-caption);
  font-variant-numeric: tabular-nums;
}
.tr-node-name {
  inline-size: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: center;
  font: var(--type-caption);
}
</style>
