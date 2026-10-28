/**
 * 科技树 / 单车研发图的确定性布局（纯函数，UI 只消费不二次解析）。
 *
 * 数据面 = 资产包 `research/tech_tree/{nation}.json`（上游 --with-research-graph 导出）：
 * - 车辆科技树：`nodes[].x/y` 是客户端 yaml 的原始网格坐标（x=列、y=行，**列≠tier**：
 *   other 树列 1..7 而 tier 4..10），tier 一律读节点自带字段；`premiumRows` 的位置语义
 *   由数据证实（premium 车放最小 y 行 = 树顶部）。
 * - 整车研发边：`edges[]`（from/to 为车辆 stem）。from 车可能不在树里（如 ussr:MS-1
 *   解锁 T-26 但自身不是树节点）——只有两端都能解析才画线。
 * - 单车模块研发图：见 moduleTreeLayout（分层 DAG，客户端网格坐标由模型计算、数据没有，
 *   UI 标注「布局为复刻推导」）。
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
 * 单车模块研发图布局（客户端 ModulesTree 的推导布局）。
 *
 * 客户端网格坐标由模型计算（数据没有），但拓扑是权威的。这里：
 * - **列 = 最长入边路径**（研发流向从左到右，初始模块在第 0 列）；
 * - **行 = 树的叶序**（tidy-tree）：叶子按 DFS 顺序各占一行，内部节点取子节点行的
 *   均值——每个研发分支因此成块紧凑排列，而不是按模块族强行分行；
 * - **挂载线**：数据里只有「炮 → 下一门炮」的研发边，炮塔→炮的挂载关系在结构上
 *   （`turret.guns`）。客户端把炮画在所属炮塔下面并连线，所以每个炮塔都向它挂的炮
 *   画挂载边（同一门炮挂多炮塔时是一个模块节点、多条挂载线）；
 * - **下一级坦克也是图里的节点**：模块 `<unlocks><vehicle>` 边直连到它（客户端同构）。
 *
 * 不同模块族可以同名（实测 740 辆中 19 辆，如 A-20 的底盘与炮塔都叫 A-20_mod_1938），
 * 所有索引按 `kind:stem` 限定。环 = 数据异常，显式抛出（不猜深度）。
 *
 * selection（可选）：tankSetup.resolveSetup 的结果；当前搭载的模块标 installed。
 * options.nextVehicles（可选）：[{ stem, name, tankId, cost, sourceModule, sourceKind }]
 * 作为 kind='vehicle' 节点入图。
 */
export function moduleTreeLayout(modules, selection = null, options = {}) {
  if (!modules || typeof modules !== 'object') return null
  const turrets = Array.isArray(modules.turrets) ? modules.turrets : []
  const entries = []
  const push = (kind, list, family) => {
    (Array.isArray(list) ? list : []).forEach((m, index) => {
      if (m?.stem) entries.push({ key: `${kind}:${m.stem}`, module: m, kind, family, index })
    })
  }
  push('chassis', modules.chassis, 'chassis')
  /** 炮按 stem 去重为一个节点（同一 localId = 同一模块），保留全部安装位置。 */
  const gunOccurrences = new Map()
  turrets.forEach((turret, turretIndex) => {
    if (turret?.stem) {
      entries.push({ key: `turret:${turret.stem}`, module: turret, kind: 'turret', family: 'turret', index: turretIndex })
    }
    ;(Array.isArray(turret?.guns) ? turret.guns : []).forEach((gun, gunIndex) => {
      if (!gun?.stem) return
      if (!gunOccurrences.has(gun.stem)) {
        gunOccurrences.set(gun.stem, [])
        entries.push({ key: `gun:${gun.stem}`, module: gun, kind: 'gun', family: 'gun', index: gunIndex, occurrences: [] })
      }
      gunOccurrences.get(gun.stem).push({ turret: turretIndex, gun: gunIndex })
    })
  })
  push('engine', modules.engines, 'engine')
  // 电台 / 油箱不是客户端 ModulesTree 的研发模块（它们在 modules/*.json 里只为整车重量
  // 等参数计算保留），研发网格不渲染——UI 与客户端一致只出现底盘/炮塔/炮/发动机。

  const byKey = new Map(entries.map(e => [e.key, e]))
  for (const entry of entries) {
    if (entry.kind === 'gun') entry.occurrences = gunOccurrences.get(entry.module.stem) || []
  }

  const edges = []
  const edgeIndex = new Map()
  const parentsOf = new Map()
  const vehicleTargets = []
  const vehicleSeen = new Set()

  /**
   * primary 边参与分层（列/行）：研发边 + 每门炮的**第一个**挂载炮塔。
   * 其余炮塔的挂载线只画线、不参与分层——否则同一门炮被每个炮塔各推一列，
   * 列数虚增、连线横穿中间节点（实测 KV-1 的 122mm 被推到第 3 列）。
   */
  const addEdge = (fromKey, toKey, cost, mount = false, primary = true) => {
    if (!byKey.has(toKey)) return
    const id = `${fromKey}->${toKey}`
    const existing = edgeIndex.get(id)
    if (existing) {
      // 同一对节点既有挂载又有研发边：保留研发成本（挂载 cost=null 不覆盖）
      if (cost?.xp != null && existing.cost?.xp == null && existing.cost == null) existing.cost = cost
      if (!mount) existing.mount = false
      return
    }
    const edge = { from: fromKey, to: toKey, cost: cost || null, mount }
    edgeIndex.set(id, edge)
    edges.push(edge)
    if (!primary) return
    if (!parentsOf.has(toKey)) parentsOf.set(toKey, [])
    if (!parentsOf.get(toKey).includes(fromKey)) parentsOf.get(toKey).push(fromKey)
  }
  const addVehicleTarget = (stem, cost, sourceKey) => {
    const id = `${sourceKey}->${stem}`
    if (vehicleSeen.has(id)) return
    vehicleSeen.add(id)
    vehicleTargets.push({ stem, cost: cost || null, sourceKey })
  }

  // 挂载边：每个炮塔 → 它挂的每一门炮（客户端把炮画在所属炮塔下并连线）；
  // 只有第一份挂载参与分层（见 addEdge primary）。
  const firstMount = new Map() // gun stem → 首个挂载炮塔下标
  turrets.forEach((turret, turretIndex) => {
    if (!turret?.stem) return
    const turretKey = `turret:${turret.stem}`
    ;(Array.isArray(turret?.guns) ? turret.guns : []).forEach((gun) => {
      if (!gun?.stem) return
      const primary = !firstMount.has(gun.stem)
      if (primary) firstMount.set(gun.stem, turretIndex)
      addEdge(turretKey, `gun:${gun.stem}`, null, true, primary)
    })
  })

  // 研发边：逐条目扫 `<unlocks>`；炮的边要**逐炮塔副本**收集（副本上的边可能不同，
  // 实测 3 辆：japan NC27、european P88/CC55mod54 的第二份炮副本带 vehicle 边）。
  for (const entry of entries) {
    const scans = entry.kind === 'gun' && entry.occurrences.length
      ? entry.occurrences.map(o => turrets[o.turret]?.guns?.[o.gun] || entry.module)
      : [entry.module]
    for (const mod of scans) {
      for (const u of Array.isArray(mod?.unlocks) ? mod.unlocks : []) {
        if (!u?.stem) continue
        if (u.kind === 'vehicle') {
          addVehicleTarget(u.stem, u.cost, entry.key)
          continue
        }
        addEdge(entry.key, `${u.kind}:${u.stem}`, u.cost || null)
      }
    }
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
  for (const entry of entries) depthOf(entry.key)

  /** 入边成本：指向本节点的**研发**边里取最小 XP（挂载边无成本）。 */
  const costOf = new Map()
  for (const edge of edges) {
    const xp = Number(edge.cost?.xp)
    if (!Number.isFinite(xp)) continue
    const prev = costOf.get(edge.to)
    if (prev == null || xp < prev) costOf.set(edge.to, xp)
  }

  const installed = installedKeys(modules, selection)
  const FAMILY_ORDER = { chassis: 0, turret: 1, gun: 2, engine: 3 }
  const meta = new Map(entries.map(e => [e.key, e]))
  const vehicleByStem = new Map((Array.isArray(options.nextVehicles) ? options.nextVehicles : [])
    .map(v => [v.stem, v]))

  const childrenOf = new Map()
  for (const edge of edges) {
    if (!childrenOf.has(edge.from)) childrenOf.set(edge.from, [])
    childrenOf.get(edge.from).push(edge.to)
  }
  const childOrder = (a, b) => {
    const ea = meta.get(a); const eb = meta.get(b)
    if (!ea || !eb) return a.localeCompare(b)
    return (FAMILY_ORDER[ea.kind] - FAMILY_ORDER[eb.kind])
      || ((Number(ea.module.level) || 0) - (Number(eb.module.level) || 0))
      || a.localeCompare(b)
  }

  // ---- 行：tidy-tree 叶序（叶子各占一行，内部节点取子节点行均值） ----
  const row = new Map()
  let nextLeafRow = 0
  const placed = new Set()
  const placeRow = (key) => {
    if (row.has(key)) return row.get(key)
    if (placed.has(key)) return row.get(key) ?? 0
    placed.add(key)
    const children = (childrenOf.get(key) || []).filter(k => byKey.has(k) || k.startsWith('vehicle:'))
    if (!children.length) {
      const value = nextLeafRow
      nextLeafRow += 1
      row.set(key, value)
      return value
    }
    const rows = children.sort(childOrder).map(placeRow)
    const value = Math.round(rows.reduce((a, b) => a + b, 0) / rows.length)
    row.set(key, value)
    return value
  }
  const roots = entries
    .filter(e => !(parentsOf.get(e.key) || []).length)
    .map(e => e.key)
    .sort(childOrder)
  for (const key of roots) placeRow(key)
  // 未被任何根覆盖的节点（异常数据兜底）：各自按叶序补一行，不丢节点
  for (const entry of entries) if (!row.has(entry.key)) placeRow(entry.key)

  const nodes = entries.map((entry) => ({
    key: entry.key,
    kind: entry.kind,
    stem: entry.module.stem,
    col: depthOf(entry.key),
    row: row.get(entry.key),
    level: Number(entry.module.level) || null,
    price: entry.module.price ?? null,
    installed: installed.has(entry.key),
    cost: costOf.get(entry.key) ?? null,
    install: entry.kind === 'gun'
      ? { kind: 'gun', occurrences: entry.occurrences }
      : { kind: entry.kind, index: entry.index },
    module: entry.module,
  }))

  /** 同格让位：tidy-tree 行是"理想行"，同一 (列,行) 上的第二个节点依次下移，
   *  保证网格一格一节点（顺序确定：族 → 等级 → key）。 */
  const occupied = new Set()
  const cellKey = (col, row) => `${col}:${row}`
  const freeRow = (col, preferred) => {
    let r = Math.max(0, preferred)
    while (occupied.has(cellKey(col, r))) r += 1
    occupied.add(cellKey(col, r))
    return r
  }
  nodes.sort((a, b) => (a.col - b.col) || (a.row - b.row)
    || (FAMILY_ORDER[a.kind] - FAMILY_ORDER[b.kind]) || a.key.localeCompare(b.key))
  for (const node of nodes) node.row = freeRow(node.col, node.row)

  // ---- 下一级坦克节点：接在解锁它的模块右侧，并保留那条边 ----
  for (const target of vehicleTargets) {
    const source = nodes.find(n => n.key === target.sourceKey)
    if (!source) continue
    // 只有调用方声明了该目标车（有名称/tankId 等展示事实）才入图——否则先由
    // nextVehicles 列表交给页面补事实，下一次渲染再成为网格节点（不造无信息的孤儿节点）。
    const info = vehicleByStem.get(target.stem)
    if (!info) continue
    const key = `vehicle:${target.stem}`
    let vehicle = nodes.find(n => n.key === key)
    if (!vehicle) {
      // 行：贴着解锁它的模块（同格已被占则依次下移）
      vehicle = {
        key,
        kind: 'vehicle',
        stem: target.stem,
        col: source.col + 1,
        row: freeRow(source.col + 1, source.row),
        installed: false,
        cost: Number(target.cost?.xp) || null,
        tankId: info.tankId ?? null,
        name: info.name ?? null,
        install: null,
        sourceKey: source.key,
      }
      nodes.push(vehicle)
    }
    edges.push({ from: target.sourceKey, to: key, cost: target.cost, mount: false })
  }

  const columns = nodes.reduce((max, n) => Math.max(max, n.col + 1), 0)
  const rows = nodes.reduce((max, n) => Math.max(max, n.row + 1), 0)

  return {
    columns,
    rows,
    nodes,
    edges,
    nextVehicles: [...new Map(vehicleTargets.map(t => {
      const [sourceKind, sourceModule] = t.sourceKey.split(':')
      return [t.stem, { stem: t.stem, cost: t.cost, sourceModule, sourceKind }]
    })).values()],
    /** 研发边（非挂载）> 0 ⇔ 有研发链；XI 超测车每族单模块、零成本，只有挂载边。 */
    hasChain: edges.some(edge => !edge.mount),
    derived: true, // 布局为复刻推导（数据文件没有客户端网格坐标）
  }
}

/** 当前搭载（resolveSetup 结果）实际选中的模块 key。 */
function installedKeys(modules, selection) {
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
