<script setup>
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
  detail: { type: Object, required: true },
  modules: { type: Object, required: true },
  selection: { type: Object, default: null },
  prevVehicles: { type: Array, default: () => [] },
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
    console.error('module tree layout failed:', error)
    return null
  }
})

const NODE_W = 96
const NODE_H = 64
const PITCH_X = 136
const PITCH_Y = 97
const TRUNK_W = 32
const CURRENT_X = 0

const gridStyle = computed(() => ({
  width: `${layout.value.columns * PITCH_X}px`,
  height: `${layout.value.rows * PITCH_Y}px`,
}))

const gridW = computed(() => (layout.value?.columns || 0) * PITCH_X)
const canvasW = computed(() => NODE_W + TRUNK_W + gridW.value)
const gridH = computed(() => (layout.value?.rows || 0) * PITCH_Y)
const canvasStyle = computed(() => ({
  width: `${canvasW.value}px`,
  height: `${gridH.value}px`,
}))
const gridInCanvasStyle = computed(() => ({ ...gridStyle.value, left: `${NODE_W + TRUNK_W}px` }))
const currentTop = computed(() => {
  const l = layout.value
  if (!l?.branches?.length) return 0
  const ys = l.branches.map(b => b.row * PITCH_Y + NODE_H / 2)
  const mid = (Math.min(...ys) + Math.max(...ys)) / 2
  return Math.max(0, Math.min(gridH.value - NODE_H, mid - NODE_H / 2))
})

const trunk = computed(() => {
  const l = layout.value
  if (!l?.branches?.length) return { lines: [], height: gridH.value }
  const ys = l.branches.map(b => b.row * PITCH_Y + NODE_H / 2).sort((a, b) => a - b)
  const top = ys[0]
  const bottom = ys[ys.length - 1]
  const currentY = currentTop.value + NODE_H / 2
  const trunkX = NODE_W + 12
  const lines = [
    { x1: NODE_W, y1: currentY, x2: trunkX, y2: currentY, arrow: false },
    { x1: trunkX, y1: Math.min(top, currentY), x2: trunkX, y2: Math.max(bottom, currentY), arrow: false },
  ]
  for (const y of ys) lines.push({ x1: trunkX, y1: y, x2: NODE_W + TRUNK_W, y2: y, arrow: true })
  return { lines, height: gridH.value }
})

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

const KIND_I18N = { chassis: 'track', turret: 'turret', gun: 'gun', engine: 'engine' }
const KIND_ICON = { chassis: 'chassis', turret: 'turret', gun: 'gun', engine: 'engine' }

function nodeIcon(kind) {
  return moduleIconUrl(KIND_ICON[kind] || '')
}

function nodeLabelText(node) {
  return node.kind === 'vehicle' ? (node.name || node.stem) : moduleName(node.module)
}

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
