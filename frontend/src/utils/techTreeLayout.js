/**
 * 科技树 / 单车研发图的确定性布局（纯函数，UI 只消费不二次解析）。
 *
 * 数据面 = 资产包 `research/tech_tree/{nation}.json`（上游 --with-research-graph 导出）：
 * - 车辆科技树：`nodes[].x/y` 是客户端 yaml 的原始网格坐标（x=列、y=行，**列≠tier**：
 *   other 树列 1..7 而 tier 4..10），tier 一律读节点自带字段；`premiumRows` 的位置语义
 *   由数据证实（premium 车放最小 y 行 = 树顶部）。
 * - 整车研发边：`edges[]`（from/to 为车辆 stem）。from 车可能不在树里（如 ussr:MS-1
 *   解锁 T-26 但自身不是树节点）——只有两端都能解析才画线。
 * - 单车模块研发图：见 moduleTreeLayout。
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
  // pending（已登记未实装的 XI 展示位）不是车辆事实，但它的网格坐标必须进入列/行轴：
  // 否则 pending 所在列缺失时 colIndex.get(x) 为 undefined，UI 会得到 NaN gridColumn。
  const pending = Array.isArray(tree?.pending) ? tree.pending : []
  const pendingCoords = pending.filter(p => p && Number.isFinite(p.x) && Number.isFinite(p.y))
  const columns = [...new Set([...defined.map(n => n.x), ...pendingCoords.map(p => p.x)])].sort((a, b) => a - b)
  const rows = [...new Set([...defined.map(n => n.y), ...pendingCoords.map(p => p.y)])].sort((a, b) => a - b)
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
    pending,
    premiumRows: Number(tree?.meta?.premiumRows) || 0,
  }
}

/**
 * 单车模块研发图布局 —— 按客户端 Modules 界面截图对齐（2026-10-27，KV-1 与 SU-100M1
 * 实机截图）：
 *
 * - **每条「无研发父」的初始模块起一条横向链**，链自上而下按 火炮 → 炮塔 → 发动机 →
 *   履带 排列（KV-1：ZiS-5 线 / Turret_1 线 / M-17T 线 / Chassis_KV1 线）。
 * - 列 = 链上的研发步进；同链下一步右移一列。
 * - **一个节点有多个子分支时，主链留在本行、其余分支向下另起一行**
 *   （SU-100M1：炮2 → {炮 IX 向右继续 / SU-101 坦克落到下一行}）。父节点与第一个子
 *   节点同行，不出现向上斜的箭头。
 * - **下一级坦克也是树里的子节点**（模块 `<unlocks><vehicle>`），排在模块子节点之后。
 * - 模块名与等级都在节点上显示（用户 2026-10-27：名字保留，只优化排布）。
 *
 * 客户端精确网格坐标由 `TankModulesTreeModel` 运行时计算（census §4.4），数据里没有；
 * 这里按上述确定性规则推导。环 = 数据异常，显式抛出。
 */
export function moduleTreeLayout(modules, selection = null, options = {}) {
  if (!modules || typeof modules !== 'object') return null
  const turrets = Array.isArray(modules.turrets) ? modules.turrets : []
  const entries = []
  const push = (kind, list) => {
    (Array.isArray(list) ? list : []).forEach((m, index) => {
      if (m?.stem) entries.push({ key: `${kind}:${m.stem}`, module: m, kind, index })
    })
  }
  push('chassis', modules.chassis)
  const gunOccurrences = new Map()
  /**
   * 无炮塔车（客户端 `<hull><fakeTurrets>` ⇒ `hasTurret=false`，固定战斗室）：
   * 客户端研发界面**不显示炮塔行**（SU-100M1 实机截图只有 火炮/发动机/履带 三行），
   * 但炮塔条目仍要留在数据里给 `pickGun` 对号——所以只跳过节点登记。
   */
  const showTurrets = modules.hasTurret !== false
  turrets.forEach((turret, turretIndex) => {
    if (turret?.stem && showTurrets) entries.push({ key: `turret:${turret.stem}`, module: turret, kind: 'turret', index: turretIndex })
    ;(Array.isArray(turret?.guns) ? turret.guns : []).forEach((gun, gunIndex) => {
      if (!gun?.stem) return
      if (!gunOccurrences.has(gun.stem)) {
        gunOccurrences.set(gun.stem, [])
        entries.push({ key: `gun:${gun.stem}`, module: gun, kind: 'gun', index: gunIndex, occurrences: [] })
      }
      gunOccurrences.get(gun.stem).push({ turret: turretIndex, gun: gunIndex })
    })
  })
  push('engine', modules.engines)
  for (const entry of entries) {
    if (entry.kind === 'gun') entry.occurrences = gunOccurrences.get(entry.module.stem) || []
  }
  // 电台 / 油箱不是客户端 ModulesTree 的研发模块（只为整车重量等参数保留）。

  const byKey = new Map(entries.map(e => [e.key, e]))
  const vehicleByStem = new Map((Array.isArray(options.nextVehicles) ? options.nextVehicles : [])
    .map(v => [v.stem, v]))

  /**
   * 候选父边只来自研发边（unlocks）。同一 (from,to) 可能由同一门炮的多个炮塔副本
   * 重复产生；同一目标也可能有多个研发父。先按 (from,to) 去重，再为每个非根节点
   * 选唯一父：成本低者优先，成本相同用 from key 确定性排序。挂载关系（turret.guns）
   * 不画父线——初始模块各自起一条链，与客户端截图一致。
   */
  const edgeCostRank = (cost) => {
    const xp = Number(cost?.xp)
    if (Number.isFinite(xp)) return [0, xp]
    const amount = Number(cost?.tokens?.amount)
    if (Number.isFinite(amount)) return [1, amount]
    return [2, 0]
  }
  const compareEdges = (a, b) => {
    const ca = edgeCostRank(a.cost); const cb = edgeCostRank(b.cost)
    return (ca[0] - cb[0]) || (ca[1] - cb[1]) || a.from.localeCompare(b.from)
  }
  const candidateByPair = new Map()
  const addCandidate = (fromKey, toKey, cost) => {
    if (!fromKey || !toKey || fromKey === toKey) return
    const pair = `${fromKey}->${toKey}`
    const next = { from: fromKey, to: toKey, cost: cost || null }
    const prev = candidateByPair.get(pair)
    if (!prev || compareEdges(next, prev) < 0) candidateByPair.set(pair, next)
  }
  for (const entry of entries) {
    const scans = entry.kind === 'gun' && entry.occurrences.length
      ? entry.occurrences.map(o => turrets[o.turret]?.guns?.[o.gun] || entry.module)
      : [entry.module]
    for (const mod of scans) {
      for (const u of Array.isArray(mod?.unlocks) ? mod.unlocks : []) {
        if (!u?.stem) continue
        addCandidate(entry.key, u.kind === 'vehicle' ? `vehicle:${u.stem}` : `${u.kind}:${u.stem}`, u.cost)
      }
    }
  }
  const selectedByTarget = new Map()
  for (const edge of candidateByPair.values()) {
    const prev = selectedByTarget.get(edge.to)
    if (!prev || compareEdges(edge, prev) < 0) selectedByTarget.set(edge.to, edge)
  }
  const edges = [...selectedByTarget.values()]
  const childrenOf = new Map()
  const parentsOf = new Map()
  const costXpOf = new Map()
  const costTokensOf = new Map()
  const vehicleTargets = []
  for (const edge of edges) {
    if (!childrenOf.has(edge.from)) childrenOf.set(edge.from, [])
    childrenOf.get(edge.from).push(edge.to)
    if (!parentsOf.has(edge.to)) parentsOf.set(edge.to, [])
    parentsOf.get(edge.to).push(edge.from)
    const xp = Number(edge.cost?.xp)
    if (Number.isFinite(xp)) costXpOf.set(edge.to, xp)
    const amount = Number(edge.cost?.tokens?.amount)
    if (Number.isFinite(amount)) {
      costTokensOf.set(edge.to, { currency: edge.cost.tokens.currency || null, amount })
    }
    if (edge.to.startsWith('vehicle:')) {
      vehicleTargets.push({ stem: edge.to.slice('vehicle:'.length), cost: edge.cost, sourceKey: edge.from })
    }
  }

  // 列 = 研发深度（最长父链）；环显式失败。
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

  const installed = installedKeys(modules, selection)

  /**
   * 行 = 每条初始模块一条链；根按 火炮 → 炮塔 → 发动机 → 履带 排序。
   * 子节点排序：模块优先（主链留本行），车辆最后（自然落到下一行）。
   */
  const KIND_ORDER = { gun: 0, turret: 1, engine: 2, chassis: 3, vehicle: 9 }
  const keyKind = key => key.split(':')[0]
  const sortKeys = (a, b) => {
    const ka = keyKind(a); const kb = keyKind(b)
    const ma = byKey.get(a)?.module; const mb = byKey.get(b)?.module
    return (KIND_ORDER[ka] - KIND_ORDER[kb])
      || ((Number(ma?.level) || 0) - (Number(mb?.level) || 0))
      || a.localeCompare(b)
  }
  const roots = entries
    .filter(e => !(parentsOf.get(e.key) || []).length)
    .map(e => e.key)
    .sort(sortKeys)

  const row = new Map()
  /** 子树根放在 top 行；返回占用行数（行不重叠 ⇒ 连线不相交）。 */
  const placeSubtree = (key, top) => {
    const kids = (childrenOf.get(key) || [])
      .filter(k => byKey.has(k) || (k.startsWith('vehicle:') && vehicleByStem.has(k.slice('vehicle:'.length))))
      .sort(sortKeys)
    if (!kids.length) {
      row.set(key, top)
      return 1
    }
    // 第一个子节点（模块优先）与本节点同行；其余子分支依次向下铺
    row.set(key, top)
    let cursor = placeSubtree(kids[0], top)
    for (const kid of kids.slice(1)) cursor += placeSubtree(kid, top + cursor)
    return cursor
  }
  let cursorRow = 0
  const branchRows = []
  for (const rootKey of roots) {
    const height = placeSubtree(rootKey, cursorRow)
    if (row.has(rootKey)) branchRows.push({ rootKey, row: row.get(rootKey), height })
    cursorRow += height
  }
  // 未被任何根覆盖的节点（异常数据兜底）：各自补一行，不丢节点
  for (const entry of entries) if (!row.has(entry.key)) row.set(entry.key, cursorRow++)

  const nodes = entries.map((entry) => ({
    key: entry.key,
    kind: entry.kind,
    stem: entry.module.stem,
    col: depthOf(entry.key),
    row: row.get(entry.key) ?? 0,
    level: Number(entry.module.level) || null,
    price: entry.module.price ?? null,
    installed: installed.has(entry.key),
    cost: costXpOf.get(entry.key) ?? null,
    costTokens: costTokensOf.get(entry.key) ?? null,
    install: entry.kind === 'gun'
      ? { kind: 'gun', occurrences: entry.occurrences }
      : { kind: entry.kind, index: entry.index },
    module: entry.module,
  }))

  // 车辆节点：已作为子节点参与排布，这里补展示事实（未声明的目标不造孤儿节点）。
  const vehicleKeys = [...new Set(edges.filter(e => e.to.startsWith('vehicle:')).map(e => e.to))]
  for (const key of vehicleKeys) {
    if (nodes.some(n => n.key === key)) continue
    const stem = key.slice('vehicle:'.length)
    const info = vehicleByStem.get(stem)
    if (!info) continue
    nodes.push({
      key,
      kind: 'vehicle',
      stem,
      col: depthOf(key),
      row: row.get(key) ?? 0,
      installed: false,
      cost: costXpOf.get(key) ?? null,
      costTokens: costTokensOf.get(key) ?? null,
      level: Number(info.tier) || null,
      tankId: info.tankId ?? null,
      name: info.name ?? null,
      install: null,
    })
  }
  const known = new Set(nodes.map(n => n.key))
  const finalEdges = edges.filter(e => known.has(e.from) && known.has(e.to))

  const columns = nodes.reduce((max, n) => Math.max(max, n.col + 1), 0)
  const rows = nodes.reduce((max, n) => Math.max(max, n.row + 1), 0)

  return {
    columns,
    rows,
    nodes,
    edges: finalEdges,
    /** 每条链（根行）：面板据此画左侧竖干 + 一行一个分叉箭头（客户端同构）。 */
    branches: branchRows,
    nextVehicles: [...new Map(vehicleTargets.map(t => {
      const [sourceKind, sourceModule] = t.sourceKey.split(':')
      return [t.stem, { stem: t.stem, cost: t.cost, sourceModule, sourceKind }]
    })).values()],
    /** 研发边 > 0 ⇔ 有研发链；XI 超测车每族单模块、零成本，只有初始模块。 */
    hasChain: finalEdges.length > 0,
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
