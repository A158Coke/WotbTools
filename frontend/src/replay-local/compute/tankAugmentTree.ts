
type Data = Record<string, unknown>

export interface AugmentNode {
  id: number
  techName: string
  type: string
  attributes: Array<{ name: string; value: number | boolean }>
  gridPosition?: [number, number]
  xpCost?: number
  requiredNodes?: string[]
  displayName?: string
  description?: string
  icon?: string
}

export interface AugmentGroup {
  id: string
  choices: number[]
  xpCost?: number
  gridPosition?: [number, number]
  requiredNodes?: string[]
  displayName?: string
  description?: string
  icon?: string
}

export interface AugmentProgression {
  matrix: { rows: number; columns: number }
  nodes: AugmentNode[]
  alternativeGroups: AugmentGroup[]
  attributeDefinitions: Record<string, Data>
}

export interface AugmentSegment {
  from: [number, number]
  to: [number, number]
  dir: [number, number]
  arrow: boolean
}

export interface AugmentWire {
  targetId: number
  groupId?: string
  segments: AugmentSegment[]
}

export interface AugmentSector {
  nodeId: number
  path: string
  cx: number
  cy: number
}

export interface AugmentLayout {
  rows: number
  columns: number
  cell: number
  nodes: Array<{ id: number; col: number; row: number }>
  group: { id: string; x: number; y: number; radius: number } | null
  sectors: AugmentSector[]
  wires: AugmentWire[]
}

export const AUGMENT_CELL = 96
export const AUGMENT_GROUP_RADIUS = 50
export const AUGMENT_SECTOR_SPAN = 46
export const AUGMENT_SECTOR_OFFSETS = [48, 0, -48]
export const AUGMENT_SECTOR_R_IN = 60
export const AUGMENT_SECTOR_R_OUT = 112
export const AUGMENT_SECTOR_ICON_R = 86

function record(value: unknown): value is Data {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function parseAugmentProgression(modules: unknown): AugmentProgression | null {
  if (!record(modules) || modules.tier !== 11) return null
  const progression = modules.upgradeProgression
  if (!record(progression) || !record(progression.matrix)
    || !Array.isArray(progression.nodes) || !Array.isArray(progression.alternativeGroups)
    || !record(progression.attributeDefinitions)) {
    return null
  }
  const rows = typeof progression.matrix.rows === 'number' ? progression.matrix.rows : 0
  const columns = typeof progression.matrix.columns === 'number' ? progression.matrix.columns : 0
  if (!rows || !columns) return null
  const nodes = (progression.nodes as unknown[]).filter(record).map(node => ({
    id: node.id as number,
    techName: node.techName as string,
    type: node.type as string,
    attributes: (Array.isArray(node.attributes) ? node.attributes : [])
      .filter(record)
      .map(attr => ({ name: attr.name as string, value: attr.value as number | boolean })),
    gridPosition: Array.isArray(node.gridPosition)
      ? [node.gridPosition[0] as number, node.gridPosition[1] as number] as [number, number]
      : undefined,
    xpCost: typeof node.xpCost === 'number' ? node.xpCost : undefined,
    requiredNodes: Array.isArray(node.requiredNodes)
      ? (node.requiredNodes as string[])
      : undefined,
    displayName: typeof node.displayName === 'string' ? node.displayName : undefined,
    description: typeof node.description === 'string' ? node.description : undefined,
    icon: typeof node.icon === 'string' ? node.icon : undefined,
  })) as AugmentNode[]
  const alternativeGroups = (progression.alternativeGroups as unknown[]).filter(record).map(group => ({
    id: group.id as string,
    choices: (Array.isArray(group.choices) ? group.choices : []).map(choice => choice as number),
    xpCost: typeof group.xpCost === 'number' ? group.xpCost : undefined,
    gridPosition: Array.isArray(group.gridPosition)
      ? [group.gridPosition[0] as number, group.gridPosition[1] as number] as [number, number]
      : undefined,
    requiredNodes: Array.isArray(group.requiredNodes)
      ? (group.requiredNodes as string[])
      : undefined,
    displayName: typeof group.displayName === 'string' ? group.displayName : undefined,
    description: typeof group.description === 'string' ? group.description : undefined,
    icon: typeof group.icon === 'string' ? group.icon : undefined,
  })) as AugmentGroup[]
  const attributeDefinitions: Record<string, Data> = {}
  for (const [name, def] of Object.entries(progression.attributeDefinitions)) {
    if (record(def)) attributeDefinitions[name] = { ...def }
  }
  return {
    matrix: { rows, columns },
    nodes,
    alternativeGroups,
    attributeDefinitions,
  }
}

export function isNodeAvailable(
  node: AugmentNode,
  installed: ReadonlySet<number>,
  progression: AugmentProgression,
): boolean {
  const idByTech = new Map(progression.nodes.map(n => [n.techName, n.id]))
  return (node.requiredNodes ?? []).every(req => {
    const id = idByTech.get(req)
    return id != null && installed.has(id)
  })
}

export function isGroupChosable(group: AugmentGroup, installed: ReadonlySet<number>): boolean {
  return group.choices.some(id => installed.has(id))
}

export function researchWithPrerequisites(
  progression: AugmentProgression,
  nodeId: number,
  installed: ReadonlySet<number>,
): Set<number> {
  const byTech = new Map(progression.nodes.map(n => [n.techName, n]))
  const next = new Set(installed)
  const seen = new Set<string>()
  const walk = (node: AugmentNode | undefined): void => {
    if (!node || seen.has(node.techName)) return
    seen.add(node.techName)
    ;(node.requiredNodes ?? []).forEach(req => walk(byTech.get(req)))
    next.add(node.id)
  }
  walk(progression.nodes.find(n => n.id === nodeId))
  return next
}

export function researchGroupChoice(
  progression: AugmentProgression,
  groupId: string,
  choiceId: number,
  installed: ReadonlySet<number>,
): Set<number> {
  const group = progression.alternativeGroups.find(g => g.id === groupId)
  if (!group || !group.choices.includes(choiceId)) return new Set(installed)
  const byTech = new Map(progression.nodes.map(n => [n.techName, n]))
  const next = new Set(installed)
  for (const req of group.requiredNodes ?? []) {
    const reqNode = byTech.get(req)
    if (reqNode) researchWithPrerequisites(progression, reqNode.id, next).forEach(id => next.add(id))
  }
  for (const other of group.choices) next.delete(other)
  next.add(choiceId)
  return next
}

export function rollbackSubtree(
  progression: AugmentProgression,
  nodeId: number,
  installed: ReadonlySet<number>,
  chosen: Readonly<Record<string, number>>,
): { installed: Set<number>; chosen: Record<string, number> } {
  const rolled = new Set<string>()
  const node = progression.nodes.find(n => n.id === nodeId)
  if (node) rolled.add(node.techName)
  const next = new Set(installed)
  next.delete(nodeId)
  const nextChosen: Record<string, number> = { ...chosen }
  const cascadedGroups = new Set<string>()
  let changed = true
  while (changed) {
    changed = false
    for (const n of progression.nodes) {
      if (rolled.has(n.techName) || !next.has(n.id)) continue
      if ((n.requiredNodes ?? []).some(req => rolled.has(req))) {
        next.delete(n.id)
        rolled.add(n.techName)
        changed = true
      }
    }
    for (const g of progression.alternativeGroups) {
      if (cascadedGroups.has(g.id)) continue
      if ((g.requiredNodes ?? []).some(req => rolled.has(req))) {
        cascadedGroups.add(g.id)
        for (const c of g.choices) next.delete(c)
        delete nextChosen[g.id]
        changed = true
      }
    }
  }
  return { installed: next, chosen: nextChosen }
}

export function buildAugmentSectors(
  progression: AugmentProgression,
  gcx: number,
  gcy: number,
): AugmentSector[] {
  const group = progression.alternativeGroups[0]
  if (!group) return []
  const sectors: AugmentSector[] = []
  group.choices.forEach((nodeId, i) => {
    const centerDeg = AUGMENT_SECTOR_OFFSETS[i]
    if (centerDeg == null) return
    const a0 = ((centerDeg - AUGMENT_SECTOR_SPAN / 2) * Math.PI) / 180
    const a1 = ((centerDeg + AUGMENT_SECTOR_SPAN / 2) * Math.PI) / 180
    const pt = (r: number, a: number): [number, number] =>
      [gcx + r * Math.cos(a), gcy - r * Math.sin(a)]
    const [x0, y0] = pt(AUGMENT_SECTOR_R_IN, a0)
    const [x1, y1] = pt(AUGMENT_SECTOR_R_OUT, a0)
    const [x2, y2] = pt(AUGMENT_SECTOR_R_OUT, a1)
    const [x3, y3] = pt(AUGMENT_SECTOR_R_IN, a1)
    const path = `M${x0.toFixed(1)},${y0.toFixed(1)} L${x1.toFixed(1)},${y1.toFixed(1)}`
      + ` A${AUGMENT_SECTOR_R_OUT},${AUGMENT_SECTOR_R_OUT} 0 0 0 ${x2.toFixed(1)},${y2.toFixed(1)}`
      + ` L${x3.toFixed(1)},${y3.toFixed(1)}`
      + ` A${AUGMENT_SECTOR_R_IN},${AUGMENT_SECTOR_R_IN} 0 0 1 ${x0.toFixed(1)},${y0.toFixed(1)} Z`
    const rm = AUGMENT_SECTOR_ICON_R
    const [cx, cy] = pt(rm, (centerDeg * Math.PI) / 180)
    sectors.push({ nodeId, path, cx, cy })
  })
  return sectors
}

export function buildAugmentLayout(progression: AugmentProgression): AugmentLayout {
  const cell = AUGMENT_CELL
  const group = progression.alternativeGroups[0] ?? null
  const groupRow = group?.gridPosition?.[0] ?? 0
  const gcx = progression.matrix.columns * cell + 92
  const gcy = (groupRow - 0.5) * cell

  const nodes = progression.nodes
    .filter(n => n.gridPosition)
    .map(n => ({ id: n.id, col: n.gridPosition![1], row: n.gridPosition![0] }))
  const occupied = new Set(nodes.map(n => `${n.row}:${n.col}`))
  const byTech = new Map(progression.nodes.map(n => [n.techName, n]))

  const center = (col: number, row: number): [number, number] =>
    [(col - 0.5) * cell, (row - 0.5) * cell]

  function route(from: [number, number], to: [number, number]): Array<[number, number]> {
    const [fc, fr] = from
    const [tc, tr] = to
    const straight = (): { pts: Array<[number, number]>; blocked: boolean } => {
      const out: Array<[number, number]> = [[fc, fr]]
      let blocked = false
      let r = fr
      let c = fc
      const sr = Math.sign(tr - fr)
      const sc = Math.sign(tc - fc)
      while (r !== tr || c !== tc) {
        r += sr
        c += sc
        if (!(r === tr && c === tc) && occupied.has(`${r}:${c}`)) blocked = true
        out.push([c, r])
      }
      return { pts: out, blocked }
    }
    const verticalFirst = (): { pts: Array<[number, number]>; blocked: boolean } => {
      const out: Array<[number, number]> = [[fc, fr]]
      let blocked = false
      let r = fr
      let c = fc
      while (r !== tr) {
        r += Math.sign(tr - r)
        if (!(r === tr && c === fc) && occupied.has(`${r}:${c}`)) blocked = true
        out.push([c, r])
      }
      while (c !== tc) {
        c += Math.sign(tc - c)
        if (!(r === tr && c === tc) && occupied.has(`${r}:${c}`)) blocked = true
        out.push([c, r])
      }
      return { pts: out, blocked }
    }
    const horizontalFirst = (): { pts: Array<[number, number]>; blocked: boolean } => {
      const out: Array<[number, number]> = [[fc, fr]]
      let blocked = false
      let r = fr
      let c = fc
      while (c !== tc) {
        c += Math.sign(tc - c)
        if (!(r === fr && c === tc) && occupied.has(`${r}:${c}`)) blocked = true
        out.push([c, r])
      }
      while (r !== tr) {
        r += Math.sign(tr - r)
        if (!(r === tr && c === tc) && occupied.has(`${r}:${c}`)) blocked = true
        out.push([c, r])
      }
      return { pts: out, blocked }
    }
    if (fr === tr || fc === tc) return straight().pts
    const a = verticalFirst()
    if (!a.blocked) return a.pts
    const b = horizontalFirst()
    return (b.blocked ? a.pts : b.pts)
  }

  const wires: AugmentWire[] = []
  function emit(
    targetId: number,
    groupId: string | undefined,
    from: [number, number],
    to: [number, number],
    targetRadius: number,
  ): void {
    const gridPts = route(from, to)
    const pts: Array<[number, number]> = gridPts.map(([c, r]) => center(c, r))
    if (groupId) pts.push([gcx - (AUGMENT_GROUP_RADIUS + 6), gcy])
    const segments: AugmentSegment[] = []
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i]
      let p1 = pts[i + 1]
      const isLast = i === pts.length - 2
      const [dx, dy] = [p1[0] - p0[0], p1[1] - p0[1]]
      const len = Math.hypot(dx, dy) || 1
      const dir: [number, number] = [dx / len, dy / len]
      let arrow = false
      if (isLast) {
        if (targetRadius >= 0) {
          const tipR = targetRadius + 6
          p1 = [p1[0] - dir[0] * tipR, p1[1] - dir[1] * tipR]
        }
        arrow = true
      } else if (len >= 60 && !(groupId && i === pts.length - 3)) {
        p1 = [p1[0] - dir[0] * 2, p1[1] - dir[1] * 2]
        arrow = true
      }
      segments.push({ from: p0, to: p1, dir, arrow })
    }
    wires.push({ targetId, groupId, segments })
  }


  for (const node of progression.nodes) {
    if (!node.gridPosition) continue
    for (const req of node.requiredNodes ?? []) {
      const rn = byTech.get(req)
      if (!rn?.gridPosition) continue
      emit(node.id, undefined,
        [rn.gridPosition[1], rn.gridPosition[0]],
        [node.gridPosition[1], node.gridPosition[0]], 32)
    }
  }
  for (const g of progression.alternativeGroups) {
    if (!g.gridPosition) continue
    for (const req of g.requiredNodes ?? []) {
      const rn = byTech.get(req)
      if (!rn?.gridPosition) continue
      emit(-1, g.id,
        [rn.gridPosition[1], rn.gridPosition[0]],
        [g.gridPosition[1], g.gridPosition[0]], -6)
    }
  }

  const seenArrows = new Set<string>()
  for (const wire of wires) {
    for (const seg of wire.segments) {
      if (!seg.arrow) continue
      const key = `${Math.round(seg.to[0] / 4)}:${Math.round(seg.to[1] / 4)}`
        + `:${Math.round(seg.dir[0] * 10)}:${Math.round(seg.dir[1] * 10)}`
      if (seenArrows.has(key)) seg.arrow = false
      else seenArrows.add(key)
    }
  }

  return {
    rows: progression.matrix.rows,
    columns: progression.matrix.columns,
    cell,
    nodes,
    group: group
      ? { id: group.id, x: gcx, y: gcy, radius: AUGMENT_GROUP_RADIUS }
      : null,
    sectors: buildAugmentSectors(progression, gcx, gcy),
    wires,
  }
}
