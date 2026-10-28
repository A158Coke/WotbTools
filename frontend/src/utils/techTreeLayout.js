/**
 * 科技树 / 单车研发图的确定性布局（纯函数，UI 只消费不二次解析）。
 *
 * 数据面 = 资产包 `research/tech_tree/{nation}.json`（上游 --with-research-graph 导出）：
 * - 车辆科技树：`nodes[].x/y` 是客户端 yaml 的原始网格坐标（x=列、y=行，**列≠tier**：
 *   other 树列 1..7 而 tier 4..10），tier 一律读节点自带字段；`premiumRows` 在数据里
 *   只承诺「底部带的行数」，其展示语义（轻坦带）客户端模型持有——布局不做 band 划分，
 *   按原始 x/y 渲染（fail-closed：不猜测 band 归属）。
 * - 整车研发边：`edges[]`（from/to 为车辆 stem）。from 车可能不在树里（如 ussr:MS-1
 *   解锁 T-26 但自身不是树节点）——只有两端都能解析才画线。
 * - 单车模块研发图：模块解锁是嵌套 `<unlocks>` 拓扑，**客户端的网格坐标由模型计算、
 *   数据文件没有**；这里用「列 = 依赖深度（最长链）、行 = 模块族」的确定性推导，
 *   UI 上标注「布局为复刻推导」，不声称与客户端逐像素一致。
 */

const NATION_ORDER = ['ussr', 'germany', 'usa', 'china', 'france', 'uk', 'japan', 'other', 'european']

/** 科技树页签的国别顺序（与上游导出器 NATIONS 同序）。 */
export function techTreeNations() {
  return [...NATION_ORDER]
}

/**
 * 车辆科技树网格：列/行取节点坐标的并集（压缩空洞），等级锚点按列判定——
 * 列内全部已定义节点 tier 一致时该列可标注 tier，否则 null（other 树之外不应出现，
 * 出现即如实留空，不猜）。
 */
export function techTreeGrid(tree) {
  const nodes = Array.isArray(tree?.nodes) ? tree.nodes : []
  const edges = Array.isArray(tree?.edges) ? tree.edges : []
  const defined = nodes.filter(n => n && n.stem && Number.isFinite(n.x) && Number.isFinite(n.y))
  const columns = [...new Set(defined.map(n => n.x))].sort((a, b) => a - b)
  const rows = [...new Set(defined.map(n => n.y))].sort((a, b) => a - b)
  const colIndex = new Map(columns.map((x, i) => [x, i]))
  const rowIndex = new Map(rows.map((y, i) => [y, i]))

  const tierByColumn = new Map()
  for (const x of columns) {
    const tiers = new Set(defined.filter(n => n.x === x && Number.isFinite(n.tier) && n.tier > 0).map(n => n.tier))
    tierByColumn.set(x, tiers.size === 1 ? [...tiers][0] : null)
  }

  /** key = `${x},${y}` → 节点（同格冲突 = 数据异常，保留首个并记录，不静默覆盖）。 */
  const cells = new Map()
  const conflicts = []
  for (const node of defined) {
    const key = `${node.x},${node.y}`
    if (cells.has(key)) conflicts.push(key)
    else cells.set(key, node)
  }

  const byStem = new Map(defined.map(n => [n.stem, n]))

  /** 等级锚点窗口（客户端 LevelCell 的可见区间：cells.minLevel..maxLevel；XI 预览=11）。 */
  const tiers = defined.map(n => n.tier).filter(t => Number.isFinite(t) && t > 0)
  const minTier = tiers.length ? Math.min(...tiers) : null
  const maxTier = tiers.length ? Math.max(...tiers) : null

  /** 只保留两端都可解析的边（from 车不在树上时无法画线，但数据保留给消费方）。 */
  const drawnEdges = []
  for (const edge of edges) {
    const from = byStem.get(edge?.from)
    const to = byStem.get(edge?.to)
    if (!from || !to || from === to) continue
    drawnEdges.push({
      ...edge,
      fromNode: from,
      toNode: to,
      x1: colIndex.get(from.x),
      y1: rowIndex.get(from.y),
      x2: colIndex.get(to.x),
      y2: rowIndex.get(to.y),
    })
  }

  return {
    columns,
    rows,
    colIndex,
    rowIndex,
    tierByColumn,
    cells,
    conflicts,
    drawnEdges,
    minTier,
    maxTier,
    pending: Array.isArray(tree?.pending) ? tree.pending : [],
    premiumRows: Number(tree?.meta?.premiumRows) || 0,
  }
}

/**
 * 单车模块研发图布局（客户端 ModulesTree 的分层 DAG 近似）。
 *
 * **不是按模块族强行分行**：客户端网格坐标由模型计算（数据没有），但拓扑是权威的——
 * 这里用标准分层 DAG：
 * - 列 = 最长入边路径（研发流向从左到右；初始模块在第 0 列）；
 * - 行 = 就着自己的父节点放（炮挂在它的炮塔旁边、升级底盘接在上一级底盘下面），
 *   同列冲突时向下找第一个空位（确定性、无随机）；
 * - **下一级坦克也是图里的节点**：模块 `<unlocks><vehicle>` 边直连到它（客户端同构），
 *   所以「最后一门炮 → MT25」的连线会画出来。
 *
 * 不同模块族可以同名（实测 A-20 的底盘与炮塔都叫 A-20_mod_1938），所有索引用
 * `kind:stem` 限定。环 = 数据异常，显式抛出（不猜深度）。
 *
 * selection（可选）：tankSetup.resolveSetup 的结果；当前搭载的模块标 installed。
 * options.nextVehicles（可选）：[{ stem, name, tankId, cost, sourceModule, sourceKind }]，
 * 作为 kind='vehicle' 的节点入图（点击由 UI 负责切车）。
 */
export function moduleTreeLayout(modules, selection = null, options = {}) {
  if (!modules || typeof modules !== 'object') return null
  const entries = []
  const push = (kind, list, family) => {
    (Array.isArray(list) ? list : []).forEach((m, index) => {
      if (m?.stem) entries.push({ module: m, kind, family, index })
    })
  }
  push('chassis', modules.chassis, 'chassis')
  /** 炮：同一门炮可挂多个炮塔（数值独立）。网格按 stem 去重为一份拓扑，
   * 但保留全部 (turret 下标, gun 下标) 出现位置——点安装时按当前炮塔优先对号。 */
  const gunSeen = new Map()
  ;(Array.isArray(modules.turrets) ? modules.turrets : []).forEach((turret, turretIndex) => {
    if (turret?.stem) entries.push({ module: turret, kind: 'turret', family: 'turret', index: turretIndex })
    ;(Array.isArray(turret?.guns) ? turret.guns : []).forEach((gun, gunIndex) => {
      if (!gun?.stem) return
      const occurrence = { turret: turretIndex, gun: gunIndex }
      if (gunSeen.has(gun.stem)) {
        gunSeen.get(gun.stem).occurrences.push(occurrence)
        return
      }
      const entry = { module: gun, kind: 'gun', family: 'gun', index: gunIndex, occurrences: [occurrence] }
      gunSeen.set(gun.stem, entry)
      entries.push(entry)
    })
  })
  push('engine', modules.engines, 'engine')
  // 电台 / 油箱不是客户端 ModulesTree 的研发模块（它们在 modules/*.json 里只为整车重量
  // 等参数计算保留），研发网格不渲染——UI 与客户端一致只出现底盘/炮塔/炮/发动机。

  // 注意：**不同模块族可能同名**（实测 A-20 的底盘 A-20_mod_1938 与炮塔同名），
  // 所有内部索引都必须按 `kind:stem` 限定，否则安装标记/研发深度会跨族串味。
  const byKey = new Map(entries.map(e => [`${e.kind}:${e.module.stem}`, e]))

  /** 模块间解锁边 + 记录指向下一级坦克的边（vehicle 目标不进 byKey）。 */
  const moduleEdges = [] // { from, to, cost }
  const parentsOf = new Map() // key → [parentKey]
  const vehicleTargets = [] // { stem, cost, sourceKey }
  for (const { kind, module } of entries) {
    const fromKey = `${kind}:${module.stem}`
    for (const u of Array.isArray(module.unlocks) ? module.unlocks : []) {
      if (!u?.stem) continue
      if (u.kind === 'vehicle') {
        vehicleTargets.push({ stem: u.stem, cost: u.cost || null, sourceKey: fromKey })
        continue
      }
      const toKey = `${u.kind}:${u.stem}`
      if (!byKey.has(toKey)) continue
      moduleEdges.push({ from: fromKey, to: toKey, cost: u.cost || null })
      if (!parentsOf.has(toKey)) parentsOf.set(toKey, [])
      parentsOf.get(toKey).push(fromKey)
    }
  }

  /**
   * 炮塔 → 炮：数据里只有「炮 → 下一门炮」的研发边，**挂载关系**在结构上（炮在
   * turret.guns 里）。客户端把炮画在所属炮塔下面，所以布局把炮的第一个出现炮塔
   * 作为它的父节点——否则所有炮都会变成无入边的根、挤到第 0 列。
   */
  for (const entry of entries) {
    if (entry.kind !== 'gun' || !entry.occurrences?.length) continue
    const turretIndex = entry.occurrences[0].turret
    const turretStem = modules.turrets?.[turretIndex]?.stem
    if (!turretStem) continue
    const gunKey = `gun:${entry.module.stem}`
    const turretKey = `turret:${turretStem}`
    if (!byKey.has(turretKey)) continue
    if (!parentsOf.has(gunKey)) parentsOf.set(gunKey, [])
    parentsOf.get(gunKey).push(turretKey)
  }

  // 列 = 最长入边路径（记忆化）；环显式失败。
  const depth = new Map()
  const visiting = new Set()
  const depthOf = (key) => {
    if (depth.has(key)) return depth.get(key)
    if (visiting.has(key)) throw new Error(`module unlock cycle at ${key}`)
    visiting.add(key)
    let value = 0
    for (const parent of parentsOf.get(key) || []) value = Math.max(value, depthOf(parent) + 1)
    visiting.delete(key)
    depth.set(key, value)
    return value
  }
  for (const { kind, module } of entries) depthOf(`${kind}:${module.stem}`)

  /** 入边成本：指向本节点的解锁边里取最小 XP（多父时客户端同样有多条线）。 */
  const costOf = new Map()
  for (const edge of moduleEdges) {
    const xp = Number(edge.cost?.xp)
    if (!Number.isFinite(xp)) continue
    const prev = costOf.get(edge.to)
    if (prev == null || xp < prev) costOf.set(edge.to, xp)
  }

  const installed = installedStems(modules, selection)
  const FAMILY_ORDER = { chassis: 0, turret: 1, gun: 2, engine: 3 }
  const meta = new Map(entries.map(e => [`${e.kind}:${e.module.stem}`, e]))
  const vehicleByStem = new Map((Array.isArray(options.nextVehicles) ? options.nextVehicles : [])
    .map(v => [v.stem, v]))

  // ---- 分层排布：列由 depth 决定，行就着父节点放，冲突向下找空位 ----
  const pos = new Map() // key → { col, row }
  const taken = new Map() // col → Set(row)
  const takeRow = (col, preferred) => {
    if (!taken.has(col)) taken.set(col, new Set())
    const rows = taken.get(col)
    let row = Math.max(0, preferred)
    while (rows.has(row)) row += 1
    rows.add(row)
    return row
  }
  const preferredRow = (key) => {
    const parents = parentsOf.get(key) || []
    const rows = parents.map(p => pos.get(p)?.row).filter(r => Number.isInteger(r))
    if (!rows.length) return 0
    return Math.round(rows.reduce((a, b) => a + b, 0) / rows.length)
  }
  const maxDepth = entries.length ? Math.max(...entries.map(e => depthOf(`${e.kind}:${e.module.stem}`))) : 0
  for (let col = 0; col <= maxDepth; col += 1) {
    const keys = entries
      .map(e => `${e.kind}:${e.module.stem}`)
      .filter(key => depthOf(key) === col)
      .sort((a, b) => {
        const ea = meta.get(a); const eb = meta.get(b)
        return (preferredRow(a) - preferredRow(b))
          || (FAMILY_ORDER[ea.kind] - FAMILY_ORDER[eb.kind])
          || ((Number(ea.module.level) || 0) - (Number(eb.module.level) || 0))
          || a.localeCompare(b)
      })
    for (const key of keys) {
      pos.set(key, { col, row: takeRow(col, preferredRow(key)) })
    }
  }

  const nodes = []
  for (const entry of entries) {
    const key = `${entry.kind}:${entry.module.stem}`
    const { col, row } = pos.get(key)
    nodes.push({
      key,
      kind: entry.kind,
      stem: entry.module.stem,
      col,
      row,
      level: Number(entry.module.level) || null,
      price: entry.module.price ?? null,
      installed: installed.has(key),
      cost: costOf.get(key) ?? null,
      install: entry.kind === 'gun'
        ? { kind: entry.kind, occurrences: entry.occurrences }
        : { kind: entry.kind, index: entry.index },
      module: entry.module,
    })
  }

  // ---- 下一级坦克节点：接在解锁它的模块右侧，并保留那条边 ----
  const vehicleEdges = []
  for (const target of vehicleTargets) {
    const sourcePos = pos.get(target.sourceKey)
    if (!sourcePos) continue
    // 只有调用方声明了该目标车（有名称/tankId 等展示事实）才入图——否则先由
    // nextVehicles 列表交给页面补事实，下一次渲染再成为网格节点（不造无信息的孤儿节点）。
    const info = vehicleByStem.get(target.stem)
    if (!info) continue
    const key = `vehicle:${target.stem}`
    if (!pos.has(key)) {
      pos.set(key, { col: sourcePos.col + 1, row: takeRow(sourcePos.col + 1, sourcePos.row) })
      nodes.push({
        key,
        kind: 'vehicle',
        stem: target.stem,
        col: pos.get(key).col,
        row: pos.get(key).row,
        installed: false,
        cost: Number(target.cost?.xp) || null,
        tankId: info.tankId ?? null,
        name: info.name ?? null,
        install: null,
      })
    }
    vehicleEdges.push({ from: target.sourceKey, to: key, cost: target.cost })
  }

  const columns = nodes.reduce((max, n) => Math.max(max, n.col + 1), 0)
  const rows = nodes.reduce((max, n) => Math.max(max, n.row + 1), 0)

  return {
    columns,
    rows,
    nodes,
    edges: [...moduleEdges, ...vehicleEdges],
    nextVehicles: [...new Map(vehicleTargets.map(t => {
      const [sourceKind, sourceModule] = t.sourceKey.split(':')
      return [t.stem, { stem: t.stem, cost: t.cost, sourceModule, sourceKind }]
    })).values()],
    /** 本车内部解锁边数 = 0 ⇔ 无研发链（XI 超测车：每族单模块、零成本——数据可证）。 */
    hasChain: moduleEdges.length > 0,
    derived: true, // 布局为复刻推导（数据文件没有客户端网格坐标）
  }
}

/** 当前搭载（resolveSetup 结果）实际选中的模块 stem 集合（按 stem 对号，不按下标）。 */
function installedStems(modules, selection) {
  const set = new Set()
  if (!selection?.canConfigure) return set
  const turret = (Array.isArray(modules?.turrets) ? modules.turrets : [])[selection.turret]
  if (turret?.stem) set.add(`turret:${turret.stem}`)
  const gun = (Array.isArray(turret?.guns) ? turret.guns : [])[selection.gun]
  if (gun?.stem) set.add(`gun:${gun.stem}`)
  const engine = (Array.isArray(modules?.engines) ? modules.engines : [])[selection.engine]
  if (engine?.stem) set.add(`engine:${engine.stem}`)
  const track = (Array.isArray(modules?.chassis) ? modules.chassis : [])[selection.track]
  if (track?.stem) set.add(`chassis:${track.stem}`)
  return set
}
