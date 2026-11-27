import type { Object3D } from 'three'
import type { DestructibleInstance } from './destructibles.js'

export function nameChainOf(object: Object3D | null | undefined, stopAt: Object3D | null = null): string[] {
  const out: string[] = []
  let o = object
  while (o && o !== stopAt) {
    if (o.name) out.push(o.name)
    o = o.parent
  }
  return out
}

export interface VisibilityChainNode {
  visible?: boolean
  parent?: VisibilityChainNode | null
}

export function chainVisible(
  object: VisibilityChainNode | Object3D | null | undefined,
  stopAt: VisibilityChainNode | Object3D | null = null,
): boolean {
  let o = object
  while (o && o !== stopAt) {
    if (o.visible === false) return false
    o = o.parent
  }
  return true
}

export function nearestInstance(
  instances: readonly (DestructibleInstance | null | undefined)[] | null,
  sx: number,
  sy: number,
  radiusM = 3,
): DestructibleInstance | null {
  if (!Array.isArray(instances)) return null
  let best: DestructibleInstance | null = null
  let bestD = radiusM
  for (const inst of instances) {
    const p = inst?.pos
    if (!p) continue
    const d = Math.hypot(p[0] - sx, p[1] - sy)
    if (d <= bestD) {
      best = inst
      bestD = d
    }
  }
  return best
}

export function meshOwnerKey(mesh: { uuid: string }, instanceId: number | null | undefined): string {
  return `${mesh.uuid}#${instanceId}`
}

export interface PickMeshEntry {
  batch: { mesh: { uuid: string } }
  idx: number
  name: string
}

export interface MeshOwnerValue {
  inst: DestructibleInstance
  name: string
}

export function buildMeshOwnerMap(
  instances: readonly (DestructibleInstance | null | undefined)[] | null,
  findMeshes: (x: number, y: number, destroyed: boolean) => Iterable<PickMeshEntry>,
  out: Map<string, MeshOwnerValue> = new Map(),
): Map<string, MeshOwnerValue> {
  if (!Array.isArray(instances)) return out
  for (const inst of instances) {
    const p = inst?.pos
    if (!p) continue
    for (const e of findMeshes(p[0], p[1], false)) out.set(meshOwnerKey(e.batch.mesh, e.idx), { inst, name: e.name })
    for (const e of findMeshes(p[0], p[1], true)) out.set(meshOwnerKey(e.batch.mesh, e.idx), { inst, name: e.name })
  }
  return out
}



export interface PickInstanceState {
  prop?: number
  fallQuat?: { w: number } | null
  applied?: boolean
}

export interface PickStateVisual {
  prop: number
  label: string
}

export function stateVisualLabel(st: PickInstanceState | null | undefined): PickStateVisual | null {
  if (!st) return null
  if (st.prop === 3) {
    const w = st.fallQuat?.w
    const fallen = Number.isFinite(w) && Math.abs(1 - (w as number)) > 1e-3
    return { prop: 3, label: fallen ? 'fallen/falling' : 'standing' }
  }
  const destroyed = st.applied === true
  return { prop: st.prop as number, label: destroyed ? 'destroyed' : 'intact' }
}

const PROP_LABEL: Record<number, string> = { 0: 'modules', 1: 'fragiles', 2: 'pole', 3: 'tree-fall' }

export interface PickTerrainDiagnostics {
  truth: number
  meshH?: number | null
  sizeAt?: number | null
  morph?: number | null
  quads?: number | null
  overBudget?: number | null
}

export interface PickRenderDiagnostics {
  type: string
  name?: string | null
  matName?: string | null
  matType?: string | null
  matVisible?: string | null
  transparent?: string | null
  opacity?: string | null
  alphaTest?: string | null
  depthWrite?: string | null
  objVisible?: boolean
  frustumCulled?: boolean
  instanceId?: number | null
  instScale?: number[] | null
  world?: unknown
  sphere?: { c: unknown; r: unknown } | null
}

export interface PickReport {
  clock?: number
  kind?: string
  err?: string
  node?: string
  chain?: string[]
  vehicle?: { eid: number; name?: string; tank_id?: number | null } | null
  world?: number[] | null
  scene?: number[] | null
  material?: string | null
  inst?: DestructibleInstance | null
  serverIdKnown?: boolean
  vis?: PickStateVisual | null
  terrain?: PickTerrainDiagnostics | null
  render?: PickRenderDiagnostics | null
}

export function formatPickReport(r: PickReport): string {
  const L: string[] = []
  L.push(`[scene-pick] t=${typeof r.clock === 'number' && Number.isFinite(r.clock) ? r.clock.toFixed(2) : '?'}s kind=${r.kind}`)
  if (r.err) L.push(`  err: ${r.err}`)
  if (r.vehicle) L.push(`  vehicle: eid=${r.vehicle.eid} ${r.vehicle.name || `tank_${r.vehicle.tank_id ?? '?'}`}`)
  if (r.node) L.push(`  node: ${r.node}`)
  if (r.chain && r.chain.length > 1) L.push(`  chain: ${r.chain.join(' < ')}`)
  if (r.world) L.push(`  world: (${r.world.map((v) => v.toFixed(1)).join(', ')})`)
  if (r.scene) L.push(`  scene: (${r.scene.map((v) => v.toFixed(1)).join(', ')})  // destructibles pos 系`)
  if (r.material) L.push(`  material: ${r.material}`)
  if (r.inst) {
    const s = r.inst.serverId
    const srv = s ? ` serverId={cell:[${s.cell[0]},${s.cell[1]}],slot:${s.slot}}` : ' serverId=无(不在lka)'
    L.push(`  destructible: id=${r.inst.id} ${r.inst.kind} ${r.inst.name}${srv}`)
    const pl = r.vis ? ` 当前=${r.vis.label}(prop=${r.vis.prop}${PROP_LABEL[r.vis.prop] ? '/' + PROP_LABEL[r.vis.prop] : ''})` : ''
    if (pl) L.push(`  state:${pl}`)
    if (r.inst.pos) L.push(`  inst.pos: (${r.inst.pos.map((v) => Number(v).toFixed(1)).join(', ')})`)
  }
  if (r.terrain) {
    const t = r.terrain
    const d = (t.meshH != null && Number.isFinite(t.truth)) ? ` Δ=${(t.meshH - t.truth).toFixed(3)}` : ''
    L.push(`  terrain: truth=${Number.isFinite(t.truth) ? t.truth.toFixed(3) : '?'}`
      + ` mesh=${t.meshH != null ? t.meshH.toFixed(3) : '?'}${d}`
      + ` size=${t.sizeAt ?? '?'} morph=${t.morph != null ? t.morph.toFixed(2) : '?'}`
      + ` quads=${t.quads ?? '?'} overB=${t.overBudget ?? '?'}`)
  }
  if (r.render) {
    const d = r.render
    L.push(`  render: ${d.type}(${d.name ?? '?'}) mat=${d.matName ?? '?'}[${d.matType}]`
      + ` matVisible=${d.matVisible} transparent=${d.transparent} opacity=${d.opacity}`
      + ` alphaTest=${d.alphaTest} depthWrite=${d.depthWrite}`)
    L.push(`    obj.visible=${d.objVisible} frustumCulled=${d.frustumCulled}`
      + ` instanceId=${d.instanceId ?? '-'}`
      + ` instScale=${d.instScale ? '[' + d.instScale.map((v) => v.toFixed(2)).join(',') + ']' : '-'}`
      + ` world=[${d.world}]`
      + ` sphere=${d.sphere ? `c[${d.sphere.c}] r=${d.sphere.r}` : '?'}`)
  }
  return L.join('\n')
}
