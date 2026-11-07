<script setup lang="ts">
/**
 * XI 升级研发树（客户端 TankProgress/UpgradeProgression 复刻）。
 *
 * 数据面 = 资产包 research/modules/{nation}.json 的 upgradeProgression
 * （matrix/gridPosition/xpCost/requiredNodes/alternativeGroups/attributeDefinitions，
 * 上游 Agent 仓导出）；图标 = common/research/icons/upgrades（客户端 @2x 贴图）。
 * 几何与状态计算在 replay-local/compute/tankAugmentTree.ts（纯函数，单测覆盖）。
 *
 * 交互（预览态，无账号）：单击未研发节点即研发（连带前置）；单击已研发节点
 * 回退其下游分支；组圆研发/回退；扇区三选一。数值显示口径见 formatEffect。
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  AUGMENT_CELL, buildAugmentLayout, isPercentAttribute,
  parseAugmentProgression, researchWithPrerequisites, rollbackSubtree,
} from '../replay-local/compute/tankAugmentTree'
import type { AugmentGroup } from '../replay-local/compute/tankAugmentTree'

interface UpgradeAttribute { name: string; value: number | boolean }
interface AugmentNodeView { id: number; techName: string; type?: string; attributes?: UpgradeAttribute[]; gridPosition?: [number, number]; xpCost?: number; requiredNodes?: string[]; displayName?: string; description?: string }

const props = defineProps<{
  modules: Record<string, unknown>
  /** 已研发节点 id 表（URL 状态投影；父层为唯一 owner） */
  installed: number[]
  /** 组备选：groupId → 已选节点 id */
  chosen: Record<string, number>
}>()

const { t, te } = useI18n()

const progression = computed(() => parseAugmentProgression(props.modules))
/** 该车绑定的机制 stem（vehicleAbilities；键与 augment_mechanics 三语表对齐） */
const abilityStems = computed<string[]>(() => Array.isArray(props.modules.vehicleAbilities)
  ? props.modules.vehicleAbilities.filter((v): v is string => typeof v === 'string')
  : [])
const mechanicKey = computed(() => abilityStems.value[0] ?? '')
const mechanicPath = computed(() => (mechanicKey.value
  ? `agentTanks.configurator.augment_mechanics.${mechanicKey.value}` : ''))
const mechanicName = computed(() => {
  const p = mechanicPath.value
  return p && te(`${p}.name`) ? t(`${p}.name`) : mechanicKey.value
})
const mechanicDescription = computed(() => {
  const p = mechanicPath.value
  return p && te(`${p}.description`) ? t(`${p}.description`) : ''
})

const installedSet = computed(() => new Set(props.installed))
const chosen = computed(() => props.chosen)
/** 选中项 id：节点/备选为数字 id，组为字符串组 id */
const selectedId = ref<number | string | null>(null)

const emit = defineEmits<{
  /** 研发/回退 → 父层写回 URL（upgrade=custom + abilities=已研发 id 表） */
  (e: 'research', installedIds: number[]): void
  (e: 'research-all'): void
  (e: 'research-none'): void
}>()

const layout = computed(() => (progression.value ? buildAugmentLayout(progression.value) : null))
const group = computed(() => progression.value?.alternativeGroups[0] ?? null)
const nodesById = computed<Map<number, AugmentNodeView>>(() => new Map((progression.value?.nodes ?? []).map(n => [n.id, n as AugmentNodeView])))
const width = computed(() => (layout.value ? layout.value.columns * AUGMENT_CELL + 324 : 0))
const height = computed(() => (layout.value ? Math.max(layout.value.rows * AUGMENT_CELL, 340) : 0))
const gcx = computed(() => (layout.value?.group ? layout.value.group.x : 0))
const gcy = computed(() => (layout.value?.group ? layout.value.group.y : 0))
const groupInstalled = computed(() => !!group.value
  && group.value.choices.some(id => installedSet.value.has(id)))
type SelectedView =
  | { kind: 'node'; node: AugmentNodeView }
  | { kind: 'alt'; node: AugmentNodeView; group: AugmentGroup }
  | { kind: 'group'; group: AugmentGroup }
const selected = computed<SelectedView | null>(() => {
  const id = selectedId.value
  if (id == null) return null
  const node = typeof id === 'number' ? nodesById.value.get(id) : undefined
  if (node && node.gridPosition) return { kind: 'node', node }
  const g = group.value
  if (!g) return null
  if (g.id === id) return { kind: 'group', group: g }
  if (typeof id === 'number') {
    const alt = nodesById.value.get(id)
    if (alt && g.choices.includes(id)) return { kind: 'alt', node: alt, group: g }
  }
  return null
})
const groupSelected = computed(() => selected.value?.kind === 'group' || selected.value?.kind === 'alt')

const ICON_URLS = import.meta.glob<string>('../../../common/research/icons/upgrades/*.webp', {
  import: 'default', eager: true,
})
function iconUrl(resPath: unknown, fallback: string): string {
  const base = String(resPath || fallback || '').split('/').pop()
  return (base && ICON_URLS[`../../../common/research/icons/upgrades/${base}.webp`]) || ''
}
function nodeIcon(node: AugmentNodeView | null | undefined): string {
  const first = node?.attributes?.[0]?.name
  const def = first ? progression.value?.attributeDefinitions[first] : null
  return iconUrl(def?.icon, `mech_${mechanicKey.value}`)
}
const mechIconUrl = computed(() => iconUrl('', `mech_${mechanicKey.value}`))

function effectText(attr: UpgradeAttribute): string {
  const name = attr.name
  const label = t(`agentTanks.configurator.upgrade_attributes.${name}`)
  const value = attr.value
  if (typeof value === 'boolean') {
    if (name === 'SAS_ALLOW_ACTIVATE_ON_HIT') return `${label} ${t(`agentTanks.configurator.upgrade_trigger_${value ? 'hit' : 'damage'}`)}`
    return `${label} ${t(`agentTanks.configurator.upgrade_${value ? 'yes' : 'no'}`)}`
  }
  // 口径与 TankConfigPanel.upgradeAmount 一致：MODIFIER_MULTIPLY 是系数（×0.98
  // = 散布乘 0.98 即降 2%），不能渲染成 +0.98 的加法。
  if (progression.value?.attributeDefinitions[name]?.modifier === 'MODIFIER_MULTIPLY') {
    return `${label} ×${value}`
  }
  const sign = value > 0 ? '+' : ''
  const text = isPercentAttribute(name) ? `${sign}${Math.round(value * 100)} %` : `${sign}${value}`
  return `${label} ${text}`
}
function nodeEffectLines(node: AugmentNodeView | null | undefined): string[] {
  return (node?.attributes ?? []).map(effectText)
}

function emitState(next: Set<number>): void {
  emit('research', [...next])
}
function onNodeClick(node: AugmentNodeView | undefined): void {
  if (!node || !progression.value) return
  selectedId.value = node.id
  if (!installedSet.value.has(node.id)) {
    emitState(researchWithPrerequisites(progression.value, node.id, installedSet.value))
    return
  }
  emitState(rollbackSubtree(progression.value, node.id, installedSet.value, chosen.value).installed)
}
function onGroupClick(): void {
  const g = group.value
  if (!g || !progression.value) return
  selectedId.value = g.id
  const byTech = new Map(progression.value.nodes.map(n => [n.techName, n]))
  if (!groupIsInstalled(g)) {
    // 研发组 = 全部前置链 + 默认选第一备选（客户端 top 语义）
    const next = new Set(installedSet.value)
    for (const req of g.requiredNodes ?? []) {
      const reqNode = byTech.get(req)
      if (reqNode) researchWithPrerequisites(progression.value, reqNode.id, next)
        .forEach(id => next.add(id))
    }
    next.add(g.choices[0])
    emitState(next)
    return
  }
  // 回退组：清三选一（前置节点保留）
  const next = new Set(installedSet.value)
  for (const choice of g.choices) next.delete(choice)
  emitState(next)
}
function groupIsInstalled(g: AugmentGroup): boolean {
  return g.choices.some(id => installedSet.value.has(id))
}
/** 可点击单元的无障碍名：技术名 + 当前状态（节点/组/备选共用口径）。 */
function nodeAriaLabel(node: AugmentNodeView | null | undefined): string {
  if (!node) return ''
  const status = installedSet.value.has(node.id)
    ? t('agentTanks.configurator.augment_installed')
    : t('agentTanks.configurator.augment_can_research')
  return `${node.techName} · ${status}`
}
function groupAriaLabel(g: AugmentGroup): string {
  const name = g.displayName || mechanicName.value || g.id
  const status = groupIsInstalled(g)
    ? t('agentTanks.configurator.augment_installed')
    : t('agentTanks.configurator.augment_can_research')
  return `${name} · ${status}`
}
function onSectorClick(nodeId: number): void {
  const g = group.value
  if (!g || !progression.value) return
  selectedId.value = nodeId
  // 选备选 = 研发组前置链 + 该备选（组状态由 choices 携带）；组内互斥
  const next = new Set(installedSet.value)
  const byTech = new Map(progression.value.nodes.map(n => [n.techName, n]))
  for (const req of g.requiredNodes ?? []) {
    const reqNode = byTech.get(req)
    if (reqNode) researchWithPrerequisites(progression.value, reqNode.id, next).forEach(id => next.add(id))
  }
  for (const other of g.choices) next.delete(other)
  next.add(nodeId)
  emitState(next)
}
function researchAll(): void {
  emit('research-all')
}
function researchNone(): void {
  emit('research-none')
  selectedId.value = null
}
const fmtCost = (v: number): string => String(Math.trunc(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
const fmtCompact = (v: number): string => (v >= 1000 ? `${Math.round(v / 100) / 10}k` : String(v))

interface SelectedEffectRow { id: number; label?: string; lines: string[]; chosen?: boolean }
/** 节点/备选选中：增量行（字符串表） */
const selectedNodeLines = computed<string[]>(() => {
  const sel = selected.value
  return sel && sel.kind !== 'group' ? nodeEffectLines(sel.node) : []
})
/** 组选中：三选一行（含选中标记） */
const selectedGroupRows = computed<SelectedEffectRow[]>(() => {
  const sel = selected.value
  if (!sel || sel.kind !== 'group') return []
  return sel.group.choices.map(choiceId => {
    const alt = nodesById.value.get(choiceId)
    return { id: choiceId, label: alt?.displayName || alt?.techName, lines: nodeEffectLines(alt), chosen: chosen.value[sel.group.id] === choiceId }
  })
})
const selectedIsNode = computed(() => selected.value?.kind === 'node' || selected.value?.kind === 'alt')
const selectedInstalled = computed(() => {
  const sel = selected.value
  if (!sel) return false
  if (sel.kind === 'node') return installedSet.value.has(sel.node.id)
  return sel.group.choices.some(id => installedSet.value.has(id))
})
const selectedNode = computed(() => (selected.value && selected.value.kind !== 'group' ? selected.value.node : null))
const selectedGroup = computed(() => (selected.value && selected.value.kind !== 'node' ? selected.value.group : null))
</script>

<template>
  <div class="at-root" data-testid="tank-augment-tree">
    <div class="at-head">
      <p class="at-hint">{{ t('agentTanks.configurator.augment_hint') }}</p>
      <div class="at-actions">
        <button type="button" class="at-pillbtn" data-testid="tank-augment-all" @click="researchAll">
          {{ t('agentTanks.configurator.augment_all_researched') }}
        </button>
        <button type="button" class="at-pillbtn" data-testid="tank-augment-none" @click="researchNone">
          {{ t('agentTanks.configurator.augment_none') }}
        </button>
      </div>
    </div>

    <template v-if="progression && layout">
      <div class="at-tree" data-testid="tank-augment-tree-canvas">
        <div class="at-stage" :style="{ width: width + 'px', height: height + 'px' }">
          <svg class="at-wires" :width="width" :height="height" aria-hidden="true">
            <line
              v-if="layout.group" :x1="layout.columns * AUGMENT_CELL + 4" :y1="12"
              :x2="layout.columns * AUGMENT_CELL + 4" :y2="height - 12" class="at-divider"
            />
            <g v-for="(wire, wi) in layout.wires" :key="'w' + wi">
              <polyline
                v-for="(seg, si) in wire.segments" :key="si"
                :points="`${seg.from[0]},${seg.from[1]} ${seg.to[0]},${seg.to[1]}`" class="at-line"
              />
              <polygon
                v-for="(seg, si) in (wire.segments.filter(s => s.arrow))" :key="'a' + si"
                :points="(() => {
                  const [tx, ty] = seg.to; const [dx, dy] = seg.dir
                  const bx = tx - dx * 11, by = ty - dy * 11
                  return `${tx},${ty} ${bx - dy * 5},${by + dx * 5} ${bx + dy * 5},${by - dx * 5}`
                })()" class="at-arrow"
              />
            </g>
            <path
              v-for="sector in layout.sectors" :key="'s' + sector.nodeId"
              :d="sector.path" class="at-sector" :class="{
                'at-sector-installed': groupInstalled,
                'at-sector-chosen': group != null && chosen[group.id] === sector.nodeId,
                'at-sector-selected': selectedId === sector.nodeId,
              }"
            />
          </svg>

          <button
            v-for="node in layout.nodes" :key="'n' + node.id"
            type="button" class="at-cell" :data-testid="`tank-augment-node-${node.id}`"
            :aria-label="nodeAriaLabel(nodesById.get(node.id))"
            :aria-pressed="installedSet.has(node.id)"
            :style="{ left: (node.col - 1) * AUGMENT_CELL + 'px', top: (node.row - 1) * AUGMENT_CELL + 'px' }"
            @click="onNodeClick(nodesById.get(node.id))"
          >
            <span
              class="at-node" :class="{
                'at-diamond': nodesById.get(node.id)?.type === 'NODETYPE_MECHANIC',
                'at-installed': installedSet.has(node.id),
                'at-selected': selectedId === node.id,
                'at-rootnode': !(nodesById.get(node.id)?.requiredNodes || []).length,
              }"
            >
              <img class="at-ico" :src="nodeIcon(nodesById.get(node.id))" alt="" loading="lazy">
            </span>
            <span v-if="!installedSet.has(node.id)" class="at-price">{{ fmtCompact(nodesById.get(node.id)?.xpCost ?? 0) }}<svg class="at-star" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 0 L9.8 6.2 L16 8 L9.8 9.8 L8 16 L6.2 9.8 L0 8 L6.2 6.2 Z" fill="#8fb6d9"/></svg></span>
          </button>

          <template v-if="group">
            <button
              type="button" class="at-cell at-cursor" :style="{ left: gcx - 48 + 'px', top: gcy - 48 + 'px' }"
              data-testid="tank-augment-group"
              :aria-label="groupAriaLabel(group)"
              :aria-pressed="groupInstalled"
              @click="onGroupClick"
            >
              <span
                class="at-node at-group-node" :class="{
                  'at-installed': groupInstalled,
                  'at-selected': groupSelected,
                }"
              >
                <img class="at-orn" :src="iconUrl('', 't11_augment_ornaments')" alt="">
                <img class="at-ico" :src="mechIconUrl" alt="">
              </span>
              <span v-if="!groupInstalled" class="at-price at-price-group">{{ fmtCompact(group.xpCost ?? 0) }}<svg class="at-star" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 0 L9.8 6.2 L16 8 L9.8 9.8 L8 16 L6.2 9.8 L0 8 L6.2 6.2 Z" fill="#8fb6d9"/></svg></span>
            </button>
            <button
              v-for="sector in layout.sectors" :key="'h' + sector.nodeId"
              type="button" class="at-cell at-cursor"
              :style="{ left: sector.cx - 48 + 'px', top: sector.cy - 48 + 'px' }"
              :aria-label="nodeAriaLabel(nodesById.get(sector.nodeId))"
              :aria-pressed="chosen[group.id] === sector.nodeId"
              @click="onSectorClick(sector.nodeId)"
            >
              <img
                class="at-sector-ico" :src="nodeIcon(nodesById.get(sector.nodeId))"
                :alt="nodesById.get(sector.nodeId)?.techName"
              >
            </button>
          </template>
        </div>
      </div>

      <div class="at-bottom" data-testid="tank-augment-info">
        <template v-if="selected">
          <div class="at-brow">
            <div class="at-bico"><img :src="selectedIsNode ? nodeIcon(selectedNode) : mechIconUrl" alt=""></div>
            <div class="at-bmain">
              <div class="at-btitle">
                {{ selectedIsNode ? t('agentTanks.configurator.augment_node_title') : (group?.displayName || '') }}
              </div>
              <div class="at-bstatus" :class="{ 'at-ok': selectedInstalled }">
                {{ selectedInstalled ? t('agentTanks.configurator.augment_installed') : t('agentTanks.configurator.augment_can_research') }}
              </div>
              <div v-if="selectedIsNode" class="at-beff">
                <span v-for="(line, i) in selectedNodeLines" :key="i" class="at-effline">{{ line }}</span>
              </div>
              <div class="at-braw">{{ selectedNode?.techName }} · {{ (selectedNode?.type || '').replace('NODETYPE_', '') }}</div>
            </div>
            <div class="at-bcost">
              <span v-if="selectedNode?.xpCost" class="at-fullcost">{{ fmtCost(selectedNode.xpCost) }}<svg class="at-star" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 0 L9.8 6.2 L16 8 L9.8 9.8 L8 16 L6.2 9.8 L0 8 L6.2 6.2 Z" fill="#8fb6d9"/></svg></span>
            </div>
          </div>
          <div v-if="!selectedIsNode && selectedGroup" class="at-groupdesc">
            <p class="at-braw">{{ selectedGroup.description }}</p>
            <template v-for="(opt, i) in selectedGroupRows" :key="opt.id">
              <div v-if="i > 0" class="at-or">{{ t('agentTanks.configurator.augment_or') }}</div>
              <div class="at-optrow">
                <span class="at-braw">{{ opt.label }}</span>
                <span class="at-effline">{{ opt.lines.join(' / ') }}</span>
                <span v-if="opt.chosen" class="at-tag">{{ t('agentTanks.configurator.augment_choice') }}</span>
              </div>
            </template>
            <p class="at-hint">{{ t('agentTanks.configurator.augment_options_hint') }}</p>
          </div>
        </template>
        <div v-else class="at-brow">
          <div class="at-bico"><img :src="mechIconUrl" alt=""></div>
          <div class="at-bmain">
            <div class="at-btitle">{{ mechanicName || mechanicKey }}</div>
            <div class="at-bstatus">{{ `${props.modules.name} · XI · ${layout.rows}×${layout.columns}` }}</div>
            <div class="at-beff">{{ mechanicDescription }}</div>
          </div>
          <div class="at-bcost at-mutedhint">{{ t('agentTanks.configurator.augment_can_research') }}</div>
        </div>
      </div>
    </template>
    <p v-else class="at-note">{{ t('agentTanks.configurator.upgrade_unavailable') }}</p>
  </div>
</template>

<style scoped>
/* 设计语言：颜色/字号/圆角/阴影只引用语义 token（docs/frontend/design-language.md） */
.at-root { color: var(--color-text-primary); font: var(--type-body); }
.at-head { display: flex; gap: 10px; align-items: flex-start; justify-content: space-between; padding: 4px 2px 10px; }
.at-hint { margin: 4px 0 0; color: var(--color-text-tertiary); font: var(--type-caption); max-width: 640px; }
.at-actions { display: flex; gap: 8px; }
.at-pillbtn {
  background: var(--color-surface-1); border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-full); padding: 4px 14px;
  color: var(--color-text-primary); font: var(--type-caption); cursor: pointer;
}
.at-pillbtn:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }
.at-tree {
  background: var(--color-surface-2); border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg); overflow: auto; width: fit-content; margin: 0 auto; max-width: 100%;
}
.at-stage { position: relative; margin: 0 auto; }
.at-wires { position: absolute; inset: 0; pointer-events: none; }
.at-line { fill: none; stroke: var(--color-border-strong); stroke-width: 2; }
.at-arrow { fill: var(--color-border-strong); }
.at-divider { stroke: var(--color-border-subtle); stroke-width: 1.5; }
.at-sector { fill: var(--color-surface-3); stroke: var(--color-border-strong); stroke-width: 1.5; }
.at-sector-installed { fill: var(--color-border-strong); }
.at-sector-chosen { fill: var(--color-accent); stroke: var(--color-accent); stroke-width: 3; }
.at-sector-selected { stroke: var(--color-accent-text); stroke-width: 3; }
/* 可点击单元是原生 button（键盘 Enter/Space 天然可用）：清掉 UA 外观，保留格位 */
.at-cell {
  position: absolute; width: 96px; height: 96px;
  appearance: none; border: 0; background: none; padding: 0; margin: 0;
  color: inherit; font: inherit; text-align: initial; cursor: pointer;
}
.at-cell:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); border-radius: var(--radius-lg); }
.at-node {
  position: absolute; left: 16px; top: 16px; width: 64px; height: 64px;
  border-radius: var(--radius-full); background: var(--color-surface-3);
  display: flex; align-items: center; justify-content: center;
}
.at-diamond { border-radius: var(--radius-md); transform: rotate(45deg); }
.at-diamond > :deep(*) { transform: rotate(-45deg); }
.at-installed { background: var(--color-border-strong); }
.at-selected { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }
.at-rootnode::before {
  content: ""; position: absolute; inset: -14px; border-radius: var(--radius-full);
  background: var(--color-accent); opacity: .18;
}
.at-ico { width: 38px; height: 38px; object-fit: contain; pointer-events: none; position: relative; }
.at-diamond .at-ico { width: 34px; height: 34px; }
.at-price {
  position: absolute; left: 50%; bottom: 3px; transform: translateX(-50%);
  display: flex; gap: 3px; align-items: baseline; font: var(--type-caption);
  font-weight: 600; white-space: nowrap;
}
.at-price .at-star, .at-star { width: 11px; height: 11px; align-self: center; }
.at-group-node { width: 100px; height: 100px; border-radius: var(--radius-full); left: -2px; top: -2px; position: absolute; }
.at-group-node .at-orn { position: absolute; inset: -4px; width: 108px; height: 108px; max-width: none; max-height: none; opacity: .9; pointer-events: none; }
.at-group-node .at-ico { width: 46px; height: 46px; object-fit: contain; }
.at-sector-ico { position: absolute; left: 50%; top: 50%; transform: translate(-50%,-50%); width: 32px; height: 32px; object-fit: contain; }
.at-bottom {
  margin-top: 12px; background: var(--color-surface-1); border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg); padding: 14px 16px; min-height: 76px;
}
.at-brow { display: flex; gap: 14px; align-items: flex-start; }
.at-bico { flex: 0 0 auto; width: 48px; height: 48px; border-radius: var(--radius-lg); background: var(--color-surface-3); display: flex; align-items: center; justify-content: center; }
.at-bico img { width: 30px; height: 30px; object-fit: contain; }
.at-bmain { flex: 1 1 auto; min-width: 0; }
.at-btitle { font: var(--type-h3); }
.at-bstatus { color: var(--color-accent-text); font: var(--type-caption); }
.at-bstatus.at-ok { color: var(--color-success); }
.at-beff { margin-top: 6px; color: var(--color-text-tertiary); font: var(--type-caption); }
.at-effline { display: inline-block; margin-right: 14px; }
.at-braw { font-family: ui-monospace, Consolas, monospace; font-size: var(--font-size-caption-xs); color: var(--color-text-tertiary); word-break: break-all; }
.at-bcost { text-align: right; font: var(--type-h3); }
.at-mutedhint { color: var(--color-text-tertiary); font: var(--type-caption); font-weight: 400; }
.at-fullcost { display: flex; align-items: center; gap: 6px; }
.at-fullcost .at-star { width: 14px; height: 14px; }
.at-groupdesc { margin-top: 10px; border-top: 1px solid var(--color-border-subtle); padding-top: 10px; }
.at-optrow { display: flex; gap: 10px; align-items: baseline; padding: 2px 0; flex-wrap: wrap; }
.at-or { color: var(--color-text-tertiary); font: var(--type-caption); margin: 4px 0 2px; }
.at-tag { background: var(--color-surface-3); color: var(--color-success); border-radius: var(--radius-md); padding: 0 8px; font: var(--type-caption); }
.at-note { color: var(--color-text-tertiary); font: var(--type-caption); }
</style>
