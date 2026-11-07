/**
 * XI 升级研发树（客户端 TankProgress/UpgradeProgression）的纯几何与状态计算。
 *
 * 数据面 = 资产包 `research/modules/{nation}.json` 的 `upgradeProgression`
 * （matrix / nodes[id,techName,type,attributes,gridPosition,xpCost,requiredNodes] /
 * alternativeGroups[id,choices,xpCost,gridPosition,requiredNodes] / attributeDefinitions），
 * 由上游 Agent 仓 `tools/export_research_loadout.py` fail-closed 导出（2026-11-08 起）。
 *
 * 本模块只做几何与状态：格网布局、连线分段与箭头位置、可用性/回退集合、
 * 组扇区路径与图标位。单位口径由组件层按已证实白名单呈现；不触账号状态。
 */

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
  /** 段终点 = 箭尖位置（末段已缩进到目标外缘；中段缩进到拐角前 2px） */
  to: [number, number]
  /** 段方向（单位向量，to-from），组件用它画箭头 */
  dir: [number, number]
  arrow: boolean
}

export interface AugmentWire {
  /** 依赖方节点 id；组边为 -1（groupId 有值） */
  targetId: number
  groupId?: string
  segments: AugmentSegment[]
}

export interface AugmentSector {
  nodeId: number
  /** SVG 环扇路径（组圆心坐标系已折算为绝对坐标） */
  path: string
  /** 扇区形心（图标位） */
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

/** 客户端 96px 格网与组扇区几何（UpgradeAlternativeGroup 确认形态） */
export const AUGMENT_CELL = 96
export const AUGMENT_GROUP_RADIUS = 50
export const AUGMENT_SECTOR_SPAN = 46
export const AUGMENT_SECTOR_OFFSETS = [48, 0, -48]
export const AUGMENT_SECTOR_R_IN = 60
export const AUGMENT_SECTOR_R_OUT = 112
/** 组扇区图标形心半径 */
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
  // 校验后按字段构造（仓库惯例：不新增 as-unknown-as 逃逸舱）
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

/** 依 requiredNodes 校验研发可用性：全部前置（techName→id）已安装。 */
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

/** 组已研发 ⟺ 任一备选在 installed（真实 UI 用数字 choice ID 表示组状态，不写组字符串 id）。 */
export function isGroupChosable(group: AugmentGroup, installed: ReadonlySet<number>): boolean {
  return group.choices.some(id => installed.has(id))
}

/** 点击研发：该节点 + 全部未解锁前置（链式），返回新 installed。 */
export function researchWithPrerequisites(
  progression: AugmentProgression,
  nodeId: number,
  installed: ReadonlySet<number>,
): Set<number> {
  const byTech = new Map(progression.nodes.map(n => [n.techName, n]))
  const next = new Set(installed)
  const walk = (node: AugmentNode | undefined): void => {
    if (!node || next.has(node.id)) return
    ;(node.requiredNodes ?? []).forEach(req => walk(byTech.get(req)))
    next.add(node.id)
  }
  walk(progression.nodes.find(n => n.id === nodeId))
  return next
}

/** 点击已研发节点：回退该节点 + 所有直接/间接依赖它的节点与组（组级联卸载并清除备选）。 */
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
  next.delete(nodeId) // 起始节点自身一并卸载（下游由级联处理）
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
      // 组级联卸载：备选节点没有自身 requiredNodes，只删前置会残留 choice 并继续
      // 聚合机制效果；组状态由数字 choice ID 携带（installed 不含组字符串 id），
      // 任一前置被回退即删除该组全部 choice 并清除三选一标记。
      // 每组只处理一次：组前置会一直留在 rolled 里，无此守卫 while 永不收敛。
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

/** 组扇区三选一的 SVG 环扇路径与图标位（绝对坐标）。 */
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

/** 布局：格网坐标、连线分段（箭尖已就位）与组扇区。 */
export function buildAugmentLayout(progression: AugmentProgression): AugmentLayout {
  const cell = AUGMENT_CELL
  const group = progression.alternativeGroups[0] ?? null
  const groupRow = group?.gridPosition?.[0] ?? 0
  // 组圆在网格右缘之外（客户端把 UpgradeAlternativeGroup 渲染为独立控件；
  // gridPosition 只决定前置边的汇入行），与独立复刻版一致。
  const gcx = progression.matrix.columns * cell + 92
  const gcy = (groupRow - 0.5) * cell

  const nodes = progression.nodes
    .filter(n => n.gridPosition)
    .map(n => ({ id: n.id, col: n.gridPosition![1], row: n.gridPosition![0] }))
  const occupied = new Set(nodes.map(n => `${n.row}:${n.col}`))
  const byTech = new Map(progression.nodes.map(n => [n.techName, n]))

  const center = (col: number, row: number): [number, number] =>
    [(col - 0.5) * cell, (row - 0.5) * cell]

  // 正交布线：同轴直线；异侧单拐角（纵先横后，途经节点格改横先纵后）。
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
    // 路由用格坐标；转像素后组边再追加圆缘延伸点（箭尖恰好落在圆缘）
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
        // 末段：箭尖缩进到目标外缘（targetRadius<0 = 终点已就位，用于组圆缘）
        if (targetRadius >= 0) {
          const tipR = targetRadius + 6
          p1 = [p1[0] - dir[0] * tipR, p1[1] - dir[1] * tipR]
        }
        arrow = true
      } else if (len >= 60 && !(groupId && i === pts.length - 3)) {
        // 中段：拐角前 2px；组边的组格心段不画（紧邻圆缘终箭）
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

  // 末段箭尖按 位置:方向 去重（汇聚边共用车道只画一枚）
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

/** 单位口径：客户端参数面板明示 % 的白名单（hangarAbilityParamsConfig + tank_descr_param）。 */
const PERCENT_ATTRIBUTES = new Set([
  'COMBAT_FRENZY_RELOAD_SPEED_BONUS_PER_STACK', 'SAS_AIMING_SPEED', 'SAS_GUN_DISPERSION',
  'ATTRIBUTE_NAME_FIRE_START_CHANCE',
])

export function isPercentAttribute(name: string): boolean {
  return PERCENT_ATTRIBUTES.has(name)
}
