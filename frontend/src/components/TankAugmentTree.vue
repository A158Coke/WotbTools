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
import type { AugmentProgression } from '../replay-local/compute/tankAugmentTree'

interface UpgradeAttribute { name: string; value: number | boolean }
interface AugmentNodeView { id: number; techName: string; type?: string; attributes?: UpgradeAttribute[]; gridPosition?: [number, number]; xpCost?: number; requiredNodes?: string[]; displayName?: string; description?: string }

const props = defineProps<{
  modules: Record<string, unknown>
  /** 已研发节点 id 表（URL 状态投影；父层为唯一 owner） */
  installed: number[]
  /** 组备选：groupId → 已选节点 id */
  chosen: Record<string, number>
}>()

interface MechanicInfo { name: string; description: string }
const { t, locale } = useI18n()

const progression = computed(() => parseAugmentProgression(props.modules))
const mechanicKey = computed(() => (props.modules.vehicleAbilities || [])[0] || '')
const mechanicName = computed(() => {
  const key = mechanicKey.value
  if (!key) return ''
  const msg = t(`agentTanks.configurator.augment_mechanics.${key}`)
  return msg.startsWith('agentTanks.') ? key : String(msg).split('\n')[0]
})
const mechanicDescription = computed(() => {
  const key = mechanicKey.value
  if (!key) return ''
  const msg = t(`agentTanks.configurator.augment_mechanics.${key}`)
  return msg.startsWith('agentTanks.') ? '' : String(msg).split('\n').slice(1).join('\n')
})

const installedSet = computed(() => new Set(props.installed))
const chosen = computed(() => props.chosen)
const selectedId = ref<number | null>(null)

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
interface SelectedView { kind: 'node' | 'alt' | 'group'; node?: AugmentNodeView; group?: AugmentGroup & Record<string, unknown> }
const selected = computed<SelectedView | null>(() => {
  const id = selectedId.value
  if (id == null) return null
  const node = nodesById.value.get(id)
  if (node && node.gridPosition) return { kind: 'node', node }
  const g = group.value
  if (!g) return null
  if (g.id === id) return { kind: 'group', group: g }
  if (g.choices.includes(id)) return { kind: 'alt', node: nodesById.value.get(id), group: g }
  return null
})
const groupSelected = computed(() => selected.value?.kind === 'group' || selected.value?.kind === 'alt')

const ICON_URLS = import.meta.glob('../../../common/research/icons/upgrades/*.webp', {
  import: 'default', eager: true,
})
function iconUrl(resPath: unknown, fallback: string): string {
  const base = String(resPath || fallback || '').split('/').pop()
  return (base && ICON_URLS[`../../../common/research/icons/upgrades/${base}.webp`]) || ''
}
function nodeIcon(node: AugmentNodeView | undefined): string {
  const first = node.attributes?.[0]?.name
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
  const sign = value > 0 ? '+' : ''
  const text = isPercentAttribute(name) ? `${sign}${Math.round(value * 100)} %` : `${sign}${value}`
  return `${label} ${text}`
}
function nodeEffectLines(node: AugmentNodeView | undefined): string[] {
  return (node.attributes ?? []).map(effectText)
}
function nodeLabel(node: AugmentNodeView): string {
  return node.displayName || node.techName
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
function groupIsInstalled(g: AugmentGroup & Record<string, unknown>): boolean {
  return g.choices.some(id => installedSet.value.has(id))
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
const selectedEffects = computed<SelectedEffectRow[]>(() => {
  const sel = selected.value
  if (!sel) return []
  if (sel.kind === 'group') {
    const g = sel.group
    return (g.choices ?? []).map(choiceId => {
      const alt = nodesById.value.get(choiceId)
      return { id: choiceId, label: alt?.displayName || alt?.techName, lines: nodeEffectLines(alt), chosen: chosen.value[g.id] === choiceId }
    })
  }
  if (sel.kind === 'alt') return nodeEffectLines(sel.node)
  return nodeEffectLines(sel.node)
})
const selectedIsNode = computed(() => selected.value?.kind === 'node' || selected.value?.kind === 'alt')
const selectedInstalled = computed(() => {
  if (!selected.value) return false
  if (selected.value.kind === 'node') return installedSet.value.has(selected.value.node.id)
  const g = selected.value.group
  return !!g && g.choices.some(id => installedSet.value.has(id))
})
const selectedNode = computed(() => (selected.value?.kind === 'node' ? selected.value.node : selected.value?.kind === 'alt' ? selected.value.node : null))
const selectedGroup = computed(() => (selected.value ? (selected.value.group ?? null) : null))
</script>

<template>
  <div class="at-root" data-testid="tank-augment-tree">
    <div class="at-head">
      <p class="at-hint">{{ t('agentTanks.configurator.augment_hint') }}</p>
      <div class="at-actions">
        <button type="button" class="at-pillbtn" data-testid="tank-augment-all" @click="researchAll">All researched</button>
        <button type="button" class="at-pillbtn" data-testid="tank-augment-none" @click="researchNone">None</button>
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
                'at-sector-chosen': chosen[group.id] === sector.nodeId,
                'at-sector-selected': selectedId === sector.nodeId,
              }"
              role="button" tabindex="0"
              :aria-label="nodesById.get(sector.nodeId)?.techName"
              @click="onSectorClick(sector.nodeId)"
              @keydown.enter="onSectorClick(sector.nodeId)"
            />
          </svg>

          <div
            v-for="node in layout.nodes" :key="'n' + node.id"
            class="at-cell" :data-testid="`tank-augment-node-${node.id}`"
            :style="{ left: (node.col - 1) * AUGMENT_CELL + 'px', top: (node.row - 1) * AUGMENT_CELL + 'px' }"
            @click="onNodeClick(nodesById.get(node.id))"
          >
            <div
              class="at-node" :class="{
                'at-diamond': nodesById.get(node.id)?.type === 'NODETYPE_MECHANIC',
                'at-installed': installedSet.has(node.id),
                'at-selected': selectedId === node.id,
                'at-rootnode': !(nodesById.get(node.id)?.requiredNodes || []).length,
              }"
            >
              <img class="at-ico" :src="nodeIcon(nodesById.get(node.id))" alt="" loading="lazy">
            </div>
            <div v-if="!installedSet.has(node.id)" class="at-price">{{ fmtCompact(nodesById.get(node.id)?.xpCost ?? 0) }}<svg class="at-star" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 0 L9.8 6.2 L16 8 L9.8 9.8 L8 16 L6.2 9.8 L0 8 L6.2 6.2 Z" fill="#8fb6d9"/></svg></div>
          </div>

          <template v-if="layout.group">
            <div
              class="at-cell at-cursor" :style="{ left: gcx - 48 + 'px', top: gcy - 48 + 'px' }"
              data-testid="tank-augment-group"
              @click="onGroupClick"
            >
              <div
                class="at-node at-group-node" :class="{
                  'at-installed': groupInstalled,
                  'at-selected': groupSelected,
                }"
              >
                <img class="at-orn" :src="iconUrl('', 't11_augment_ornaments')" alt="">
                <img class="at-ico" :src="mechIconUrl" alt="">
              </div>
              <div v-if="!groupInstalled" class="at-price at-price-group">{{ fmtCompact(group.xpCost ?? 0) }}<svg class="at-star" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 0 L9.8 6.2 L16 8 L9.8 9.8 L8 16 L6.2 9.8 L0 8 L6.2 6.2 Z" fill="#8fb6d9"/></svg></div>
            </div>
            <div
              v-for="sector in layout.sectors" :key="'h' + sector.nodeId"
              class="at-cell at-cursor"
              :style="{ left: sector.cx - 48 + 'px', top: sector.cy - 48 + 'px' }"
              @click="onSectorClick(sector.nodeId)"
            >
              <img
                class="at-sector-ico" :src="nodeIcon(nodesById.get(sector.nodeId))"
                :alt="nodesById.get(sector.nodeId)?.techName"
              >
            </div>
          </template>
        </div>
      </div>

      <div class="at-bottom" data-testid="tank-augment-info">
        <template v-if="selected">
          <div class="at-brow">
            <div class="at-bico"><img :src="selectedIsNode ? nodeIcon(selectedNode) : mechIconUrl" alt=""></div>
            <div class="at-bmain">
              <div class="at-btitle">
                {{ selectedIsNode ? 'Augment' : (group?.displayName || '') }}
              </div>
              <div class="at-bstatus" :class="{ 'at-ok': selectedInstalled }">
                {{ selectedInstalled ? t('agentTanks.configurator.augment_installed') : t('agentTanks.configurator.augment_can_research') }}
              </div>
              <div v-if="selectedIsNode" class="at-beff">
                <span v-for="(line, i) in selectedEffects" :key="i" class="at-effline">{{ line }}</span>
              </div>
              <div class="at-braw">{{ selectedNode?.techName }} · {{ (selectedNode?.type || '').replace('NODETYPE_', '') }}</div>
            </div>
            <div class="at-bcost">
              <span v-if="selectedNode?.xpCost" class="at-fullcost">{{ fmtCost(selectedNode.xpCost) }}<svg class="at-star" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 0 L9.8 6.2 L16 8 L9.8 9.8 L8 16 L6.2 9.8 L0 8 L6.2 6.2 Z" fill="#8fb6d9"/></svg></span>
            </div>
          </div>
          <div v-if="!selectedIsNode && selectedGroup" class="at-groupdesc">
            <p class="at-braw">{{ selectedGroup.description }}</p>
            <template v-for="(opt, i) in selectedEffects" :key="opt.id">
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
.at-root {
  --at-ink: 44,47,49;
  --at-muted: 138,143,147;
  --at-line: 154,160,164;
  --at-cardb: 226,222,219;
  --at-node: 142,147,152;
  --at-node-inst: 90,95,99;
  --at-amber: 232,150,30;
  --at-green: 47,158,68;
  color: rgb(var(--at-ink));
  font-size: 14px;
  line-height: 1.45;
}
.at-head { display: flex; gap: 10px; align-items: flex-start; justify-content: space-between; padding: 4px 2px 10px; }
.at-title { font-weight: 600; font-size: 15px; }
.at-hint { margin: 4px 0 0; color: rgb(var(--at-muted)); font-size: 12px; max-width: 640px; }
.at-actions { display: flex; gap: 8px; }
.at-pillbtn { background: #fff; border: 1px solid rgb(var(--at-cardb)); border-radius: 16px; padding: 4px 14px; font-size: 12.5px; color: rgb(var(--at-ink)); cursor: pointer; }
.at-tree { background: #f8f6f4; border: 1px solid rgb(var(--at-cardb)); border-radius: 14px; overflow: auto; width: fit-content; margin: 0 auto; max-width: 100%; }
.at-stage { position: relative; margin: 0 auto; }
.at-wires { position: absolute; inset: 0; pointer-events: none; }
.at-line { fill: none; stroke: rgb(var(--at-line)); stroke-width: 2; }
.at-arrow { fill: rgb(var(--at-line)); }
.at-divider { stroke: rgba(154,160,164,.4); stroke-width: 1.5; }
.at-sector { fill: rgb(var(--at-node)); stroke: rgba(154,160,164,.55); stroke-width: 1.5; cursor: pointer; transition: stroke .15s, filter .15s; }
.at-sector-chosen { fill: rgba(232,150,30,.4); stroke: rgb(var(--at-amber)); stroke-width: 3.5; filter: drop-shadow(0 0 7px rgba(232,150,30,.7)); }
.at-sector-selected { stroke: rgb(var(--at-amber)); stroke-width: 3; }
.at-sector-installed { fill: rgb(var(--at-node-inst)); }
.at-cell { position: absolute; width: 96px; height: 96px; }
.at-cursor { cursor: pointer; }
.at-node { position: absolute; left: 16px; top: 16px; width: 64px; height: 64px; border-radius: 32px; background: rgb(var(--at-node)); display: flex; align-items: center; justify-content: center; }
.at-diamond { border-radius: 9px; transform: rotate(45deg); }
.at-diamond > :deep(*) { transform: rotate(-45deg); }
.at-installed { background: rgb(var(--at-node-inst)); }
.at-selected { box-shadow: 0 0 0 2.5px rgb(var(--at-amber)), 0 0 10px rgba(var(--at-amber),.45); }
.at-rootnode::before { content: ""; position: absolute; inset: -14px; border-radius: 46px; background: radial-gradient(closest-side, rgba(232,150,30,.5), rgba(232,150,30,0)); }
.at-diamond.at-rootnode::before { inset: -19px; border-radius: 18px; }
.at-ico { width: 38px; height: 38px; object-fit: contain; pointer-events: none; position: relative; }
.at-diamond .at-ico { width: 34px; height: 34px; }
.at-price { position: absolute; left: 50%; bottom: 3px; transform: translateX(-50%); display: flex; gap: 3px; align-items: baseline; font-size: 12.5px; font-weight: 600; white-space: nowrap; }
.at-price .at-star, .at-star { width: 11px; height: 11px; align-self: center; }
.at-group-node { width: 100px; height: 100px; border-radius: 50px; left: -2px; top: -2px; position: absolute; }
.at-group-node .at-orn { position: absolute; inset: -4px; width: 108px; height: 108px; max-width: none; max-height: none; opacity: .9; pointer-events: none; }
.at-group-node .at-ico { width: 46px; height: 46px; object-fit: contain; }
.at-sector-ico { position: absolute; left: 50%; top: 50%; transform: translate(-50%,-50%); width: 32px; height: 32px; object-fit: contain; }
.at-bottom { margin-top: 12px; background: #fbfaf9; border: 1px solid rgb(var(--at-cardb)); border-radius: 14px; padding: 14px 16px; min-height: 76px; }
.at-brow { display: flex; gap: 14px; align-items: flex-start; }
.at-bico { flex: 0 0 auto; width: 48px; height: 48px; border-radius: 12px; background: rgb(var(--at-node)); display: flex; align-items: center; justify-content: center; }
.at-bico img { width: 30px; height: 30px; object-fit: contain; }
.at-bmain { flex: 1 1 auto; min-width: 0; }
.at-btitle { font-weight: 600; font-size: 15px; }
.at-bstatus { color: rgb(var(--at-amber)); font-size: 13px; }
.at-bstatus.at-ok { color: rgb(var(--at-green)); }
.at-beff { margin-top: 6px; color: rgb(var(--at-muted)); font-size: 13px; }
.at-effline { display: inline-block; margin-right: 14px; }
.at-braw { font-family: ui-monospace, Consolas, monospace; font-size: 11px; color: rgb(var(--at-muted)); word-break: break-all; }
.at-bcost { text-align: right; font-size: 15px; font-weight: 600; }
.at-fullcost { display: flex; align-items: center; gap: 6px; }
.at-fullcost .at-star { width: 14px; height: 14px; }
.at-groupdesc { margin-top: 10px; border-top: 1px solid rgb(var(--at-cardb)); padding-top: 10px; }
.at-optrow { display: flex; gap: 10px; align-items: baseline; padding: 2px 0; flex-wrap: wrap; }
.at-or { color: rgb(var(--at-muted)); font-size: 11px; margin: 4px 0 2px; }
.at-tag { background: rgba(47,158,68,.14); color: rgb(var(--at-green)); border-radius: 8px; padding: 0 8px; font-size: 10px; }
.at-note { color: rgb(var(--at-muted)); font-size: 13px; }
.at-mutedhint { color: rgb(var(--at-muted)); font-weight: 400; font-size: 12px; }
</style>
 
