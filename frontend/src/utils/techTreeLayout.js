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
 * 单车模块研发图布局（列 = 依赖深度，行 = 模块族）。
 *
 * 模块全集 = chassis/turrets(+guns 去重)/engines/radios/fuelTanks。解锁边取模块自己的
 * `<unlocks>`（kind=chassis/turret/gun/engine，目标限**本车**模块 stem；vehicle 目标
 * 单列为 nextVehicles）。深度 = 从无入边模块出发的最长链（记忆化 DFS，环 = 数据异常
 * 显式抛出，不猜深度）。族顺序固定：chassis → turret → gun → engine → radio →
 * fuelTank；gun 按首次出现的炮塔归属去重（同一门炮挂多个炮塔时数值独立，但研发图
 * 是一份拓扑）。同族内按 (level, stem) 稳定排序。
 *
 * selection（可选）：tankSetup.resolveSetup 的结果；turret/gun/engine/track 命中下标
 * 的模块标 `installed`（回放/配置器的当前搭载对号）。
 */
export function moduleTreeLayout(modules, selection = null) {
  if (!modules || typeof modules !== 'object') return null
  const entries = []
  const push = (kind, list, family) => {
    (Array.isArray(list) ? list : []).forEach((m, index) => {
      if (m?.stem) entries.push({ module: m, kind, family, index })
    })
  }
  push('chassis', modules.chassis, 'chassis')
  /** 炮：同一门炮可挂多个炮塔（数值独立）；网格按 stem 去重为一份拓扑，
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
  /** 本车内部的模块解锁边（目标必须能对号本车模块；vehicle 目标单列）。 */
  const intra = new Map()
  const nextVehicles = []
  for (const { module, kind } of entries) {
    for (const u of Array.isArray(module.unlocks) ? module.unlocks : []) {
      if (!u?.stem) continue
      if (u.kind === 'vehicle') {
        nextVehicles.push({ stem: u.stem, cost: u.cost || null, sourceModule: module.stem, sourceKind: kind })
        continue
      }
      const targetKey = `${u.kind}:${u.stem}`
      if (!byKey.has(targetKey)) continue
      const nodeKey = `${kind}:${module.stem}`
      if (!intra.has(nodeKey)) intra.set(nodeKey, [])
      intra.get(nodeKey).push({ to: targetKey, cost: u.cost || null, costRaw: u.costRaw ?? null, kind: u.kind })
    }
  }

  // 深度 = 最长**入边**路径（stock 模块无入边 → 第 0 列，研发流向向右）；记忆化；
  // 环 = 客户端拓扑不该出现，显式失败。
  const incoming = new Map()
  for (const [from, outs] of intra) {
    for (const edge of outs) {
      if (!incoming.has(edge.to)) incoming.set(edge.to, [])
      incoming.get(edge.to).push(from)
    }
  }
  const depth = new Map()
  const visiting = new Set()
  const depthOf = (stem) => {
    if (depth.has(stem)) return depth.get(stem)
    if (visiting.has(stem)) throw new Error(`module unlock cycle at ${stem}`)
    visiting.add(stem)
    let value = 0
    for (const src of incoming.get(stem) || []) value = Math.max(value, depthOf(src) + 1)
    visiting.delete(stem)
    depth.set(stem, value)
    return value
  }
  for (const { kind, module } of entries) depthOf(`${kind}:${module.stem}`)

  /** 入边成本：指向本模块的解锁边里取最小 XP（多父时客户端同样有多条线）。 */
  const costOf = new Map()
  for (const [from, outs] of intra) {
    for (const edge of outs) {
      const xp = Number(edge.cost?.xp)
      const prev = costOf.get(edge.to)
      if (prev == null || (Number.isFinite(xp) && xp < prev)) {
        costOf.set(edge.to, Number.isFinite(xp) ? xp : prev)
      }
    }
  }

  const FAMILY_ORDER = { chassis: 0, turret: 1, gun: 2, engine: 3 }
  const families = new Map()
  for (const entry of entries) {
    if (!families.has(entry.family)) families.set(entry.family, [])
    families.get(entry.family).push(entry)
  }
  const familyNames = [...families.keys()].sort((a, b) => FAMILY_ORDER[a] - FAMILY_ORDER[b])

  const nodes = []
  let maxDepth = 0
  const installed = installedStems(modules, selection)
  familyNames.forEach((family, rowIndex) => {
    const members = families.get(family)
      .map(e => ({ ...e, level: Number(e.module.level) || 0 }))
      .sort((a, b) => (a.level - b.level) || a.module.stem.localeCompare(b.module.stem))
    for (const { module, kind, index, occurrences } of members) {
      const col = depthOf(`${kind}:${module.stem}`)
      maxDepth = Math.max(maxDepth, col)
      /** 点击安装的描述（下标对号；炮带全部 (turret,gun) 出现位置）。 */
      const install = kind === 'gun'
        ? { kind, occurrences }
        : { kind, index }
      nodes.push({
        key: `${kind}:${module.stem}`,
        kind,
        stem: module.stem,
        col,
        row: rowIndex,
        level: Number(module.level) || null,
        price: module.price ?? null,
        installed: installed.has(`${kind}:${module.stem}`),
        cost: costOf.get(`${kind}:${module.stem}`) ?? null,
        install,
        module,
      })
    }
  })

  return {
    columns: maxDepth + 1,
    rows: familyNames.length,
    nodes,
    nextVehicles,
    /** 本车内部解锁边数 = 0 ⇔ 无研发链（XI 超测车：每族单模块、零成本——数据可证）。 */
    hasChain: intra.size > 0,
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
