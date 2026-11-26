<script setup lang="ts">
import { computed, type CSSProperties } from 'vue'
import { useI18n } from 'vue-i18n'
import { RotateCcw, TriangleAlert } from 'lucide-vue-next'
import { formatXpCompact } from '../utils/xpFormat.js'
import { romanLevel } from '../utils/tierFormat.js'
import EmptyState from './EmptyState.vue'
import AppButton from './AppButton.vue'

interface TechNode {
  stem: string
  tankId: number
  tier: number
  x: number
  y: number
  preview?: boolean
}

interface TechEdge {
  from: string
  to: string
  sourceModule?: string
  cost?: { xp?: number }
  x1: number
  y1: number
  x2: number
  y2: number
  fromNode: TechNode
  toNode: TechNode
}

interface PendingNode {
  stem: string
  x: number
  y: number
}

interface GridLayout {
  columns: number[]
  rows: number[]
  colIndex: ReadonlyMap<number, number>
  rowIndex: ReadonlyMap<number, number>
  cells: ReadonlyMap<string, TechNode>
  drawnEdges: TechEdge[]
  pending: PendingNode[]
  minTier: number | null
  maxTier: number | null
}

interface TierRow {
  tier: number
  nodes: TechNode[]
}

interface TankSummary {
  name?: string
  is_premium?: boolean
  is_collector?: boolean
}

const props = defineProps<{
  state: 'loading' | 'ready' | 'error'
  error: string
  tierRows: TierRow[] | null
  grid: GridLayout | null
  summaries: Readonly<Record<string, TankSummary>>
  costByStem: ReadonlyMap<string, number>
  imageUrl: (tankId: number) => string
  iconStyle: (tankId: number) => CSSProperties | null
}>()

const emit = defineEmits<{
  retry: []
  selectNode: [node: TechNode]
}>()

const { t } = useI18n()
const CELL_W = 216
const CELL_H = 96
const summaryOf = (node: TechNode) => props.summaries[String(node.tankId)] || null
const nameOf = (node: TechNode) => summaryOf(node)?.name || null
const gridStyle = computed(() => ({
  gridTemplateColumns: `repeat(${props.grid?.columns.length || 0}, ${CELL_W}px)`,
  gridTemplateRows: `repeat(${props.grid?.rows.length || 0}, ${CELL_H}px)`,
}))
const svgSize = computed(() => ({
  width: (props.grid?.columns.length || 0) * CELL_W,
  height: (props.grid?.rows.length || 0) * CELL_H,
}))
const rulerStyle = computed(() => ({
  gridTemplateColumns: `repeat(${props.grid?.columns.length || 0}, ${CELL_W}px)`,
}))

function edgePath(edge: TechEdge) {
  const xOut = (edge.x1 + 1) * CELL_W - 20
  const yFrom = edge.y1 * CELL_H + CELL_H / 2
  const xBoundary = edge.x2 * CELL_W
  const yTo = edge.y2 * CELL_H + CELL_H / 2
  const xIn = edge.x2 * CELL_W + 13
  if (edge.y1 === edge.y2) return `M ${xOut} ${yFrom} L ${xIn} ${yTo}`
  return `M ${xOut} ${yFrom} L ${xBoundary} ${yFrom} L ${xBoundary} ${yTo} L ${xIn} ${yTo}`
}

function hideBrokenImage(event: Event) {
  if (event.currentTarget instanceof HTMLImageElement) event.currentTarget.hidden = true
}
</script>

<template>
  <p v-if="state === 'loading'" class="tt-status" role="status">{{ t('research.loading') }}</p>
  <EmptyState
    v-else-if="state === 'error'"
    role="alert"
    data-testid="techtree-error"
    :icon="TriangleAlert"
    :title="t('research.load_error_title')"
    :description="error || t('agentTanks.error_desc')"
  >
    <AppButton variant="primary" @click="emit('retry')">
      <RotateCcw :size="16" aria-hidden="true" />
      {{ t('agentTanks.retry') }}
    </AppButton>
  </EmptyState>

  <div v-else-if="tierRows" class="tt-tiers" data-testid="techtree-tiers">
    <p v-if="!tierRows.length" class="tt-status" role="status">{{ t('research.no_type_match') }}</p>
    <section v-for="row in tierRows" :key="row.tier" class="tt-tier-row" :aria-label="t('agentTanks.tier_n', { tier: row.tier })" :data-testid="`techtree-tier-${row.tier}`">
      <span class="tt-tier-label" aria-hidden="true">{{ romanLevel(row.tier) }}</span>
      <div class="tt-tier-cards">
        <button
          v-for="node in row.nodes"
          :key="node.stem"
          type="button"
          class="tt-cell tt-tier-cell"
          :class="{
            'is-preview': node.preview,
            'is-premium': summaryOf(node)?.is_premium,
            'is-collector': !summaryOf(node)?.is_premium && summaryOf(node)?.is_collector,
          }"
          :data-testid="`techtree-cell-${node.stem}`"
          :aria-label="`${nameOf(node) || node.stem} · ${t('agentTanks.tier_n', { tier: node.tier })}`"
          @click="emit('selectNode', node)"
        >
          <span class="tt-card">
            <span class="tt-card-icon">
              <img :src="imageUrl(node.tankId)" alt="" loading="lazy" decoding="async" :style="iconStyle(node.tankId)" @error="hideBrokenImage">
            </span>
            <span class="tt-card-name">{{ nameOf(node) || node.stem }}</span>
            <span v-if="costByStem.get(node.stem) != null" class="tt-card-cost">{{ t('research.xp_short', { xp: formatXpCompact(costByStem.get(node.stem)!) }) }}</span>
          </span>
        </button>
      </div>
    </section>
  </div>

  <div v-else-if="grid" class="tt-scroll" data-testid="techtree-grid">
    <div class="tt-canvas" :style="{ minWidth: `${grid.columns.length * CELL_W}px` }">
      <div class="tt-body" :style="gridStyle">
        <svg class="tt-edges" :width="svgSize.width" :height="svgSize.height" aria-hidden="true">
          <defs>
            <marker id="tt-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
              <path d="M0,0 L7,3.5 L0,7 z" class="tt-arrow-head" />
            </marker>
          </defs>
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
          :class="{
            'is-preview': node.preview,
            'is-premium': summaryOf(node)?.is_premium,
            'is-collector': !summaryOf(node)?.is_premium && summaryOf(node)?.is_collector,
          }"
          :style="{ gridColumn: String(grid.colIndex.get(node.x)! + 1), gridRow: String(grid.rowIndex.get(node.y)! + 1) }"
          :data-testid="`techtree-cell-${node.stem}`"
          :aria-label="`${nameOf(node) || node.stem} · ${t('agentTanks.tier_n', { tier: node.tier })}`"
          @click="emit('selectNode', node)"
        >
          <span class="tt-card">
            <span class="tt-card-icon">
              <img :src="imageUrl(node.tankId)" alt="" loading="lazy" decoding="async" :style="iconStyle(node.tankId)" @error="hideBrokenImage">
            </span>
            <span class="tt-card-name">{{ nameOf(node) || node.stem }}</span>
            <span class="tt-card-meta">
              <span class="tt-pill">{{ romanLevel(node.tier) }}</span>
              <span v-if="node.preview" class="tt-pill is-preview">{{ t('research.preview') }}</span>
            </span>
            <span v-if="costByStem.get(node.stem) != null" class="tt-card-cost">{{ t('research.xp_short', { xp: formatXpCompact(costByStem.get(node.stem)!) }) }}</span>
          </span>
        </button>
        <span
          v-for="node in grid.pending"
          :key="`pending-${node.stem}`"
          class="tt-cell is-pending"
          :style="{ gridColumn: String(grid.colIndex.get(node.x)! + 1), gridRow: String(grid.rowIndex.get(node.y)! + 1) }"
          :title="t('research.pending_title', { stem: node.stem })"
          :data-testid="`techtree-pending-${node.stem}`"
        >
          <span class="tt-card is-placeholder">
            <span class="tt-pending-label">{{ t('research.pending') }}</span>
          </span>
        </span>
      </div>
      <div class="tt-ruler" :style="rulerStyle" data-testid="techtree-levels">
        <span v-for="(x, i) in grid.columns" :key="`ruler-${x}`" class="tt-ruler-cell">
          {{ grid.minTier != null && grid.minTier + i <= grid.maxTier! ? romanLevel(grid.minTier + i) : '' }}
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tt-status { margin: 0; color: var(--color-text-secondary); font: var(--type-body); }
.tt-tiers { flex: 1 1 0; min-block-size: 0; overflow-y: auto; display: grid; align-content: start; gap: var(--space-2); background: var(--color-surface-1); border: 1px solid var(--color-border-subtle); border-radius: var(--radius-lg); padding: var(--space-2); }
.tt-tier-row { display: grid; grid-template-columns: var(--space-10) minmax(0, 1fr); align-items: center; }
.tt-tier-label { color: var(--color-accent-text); font: var(--type-h3); font-weight: 700; text-align: center; }
.tt-tier-cards { display: flex; gap: var(--space-2); overflow-x: auto; overscroll-behavior-inline: contain; padding-block: var(--space-1); }
.tt-tier-cell { flex: none; }
.tt-scroll { flex: 1 1 0; min-block-size: 0; overflow: auto; background: var(--color-surface-1); border: 1px solid var(--color-border-subtle); border-radius: var(--radius-lg); }
.tt-canvas { display: grid; gap: 0; min-inline-size: 0; align-content: start; }
.tt-body { position: relative; display: grid; }
.tt-edges { position: absolute; inset: 0; pointer-events: none; overflow: visible; }
.tt-edge { fill: none; stroke: var(--color-border-strong); stroke-width: 1.5; }
.tt-arrow-head { fill: var(--color-border-strong); }
.tt-ruler { position: sticky; inset-block-end: 0; display: grid; background: var(--color-surface-2); }
.tt-ruler-cell { display: grid; place-items: center; block-size: 24px; color: var(--color-text-secondary); font: var(--type-caption); font-weight: 700; }
.tt-cell { display: grid; place-items: center; padding: 0; border: 0; background: transparent; min-inline-size: 0; cursor: pointer; }
.tt-cell:focus-visible { outline: none; }
.tt-cell:focus-visible .tt-card { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }
.tt-card { position: relative; display: block; inline-size: 176px; block-size: 64px; overflow: hidden; border: 1px solid var(--color-border-subtle); border-radius: var(--radius-md); background: var(--color-surface-1); }
.tt-cell:hover .tt-card { border-color: var(--color-border-strong); }
.tt-cell.is-premium .tt-card { border-color: color-mix(in oklab, var(--color-warning) 45%, var(--color-border-subtle)); }
.tt-cell.is-collector .tt-card { border-color: color-mix(in oklab, var(--color-info) 55%, var(--color-border-subtle)); }
.tt-cell.is-preview .tt-card { border-style: dashed; border-color: color-mix(in oklab, var(--color-warning) 55%, var(--color-border-subtle)); }
.tt-cell.is-pending { cursor: default; }
.tt-card.is-placeholder { display: grid; place-items: center; border-style: dashed; background: var(--color-surface-2); opacity: 0.72; }
.tt-pending-label { color: var(--color-text-secondary); font: var(--type-caption); }
.tt-card-icon { position: absolute; inset-block-start: 4px; inset-inline-start: 40px; inline-size: 97px; block-size: 60px; overflow: hidden; }
.tt-card-icon img { position: absolute; inset: 0; inline-size: 100%; block-size: 100%; object-fit: contain; }
.tt-card-name { position: absolute; inset-block-end: 0; inset-inline: 0; padding: 0 4px 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: center; background: linear-gradient(to top, var(--color-surface-1) 70%, transparent); color: var(--color-text-primary); font: var(--type-caption); font-weight: 600; }
.tt-card-meta { position: absolute; inset-block-start: 2px; inset-inline-start: 4px; display: flex; gap: 2px; }
.tt-card-cost { position: absolute; inset-block-start: 2px; inset-inline-end: 4px; color: var(--color-warning); font: var(--type-caption); font-variant-numeric: tabular-nums; font-weight: 600; }
.tt-pill { padding: 0 var(--space-1); border-radius: var(--radius-full); corner-shape: round; background: var(--color-surface-3); color: var(--color-text-secondary); font: var(--type-caption); font-weight: 600; white-space: nowrap; }
.tt-pill.is-preview { background: color-mix(in oklab, var(--color-info) 14%, var(--color-surface-1)); color: var(--color-info); }

@media (width < 768px) {
  .tt-tier-cell .tt-card { inline-size: 92px; block-size: 48px; display: grid; place-items: center; }
  .tt-tier-cell .tt-card-icon { position: relative; inset: auto; inline-size: 43.65px; block-size: 27px; }
  .tt-tiers { gap: var(--space-1); }
  .tt-tier-row { grid-template-columns: 28px minmax(0, 1fr); }
  .tt-tier-label { font: var(--type-caption); }
  .tt-tier-cards { padding-block: 2px; }
}
</style>
