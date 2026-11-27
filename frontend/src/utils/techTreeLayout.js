
const NATION_ORDER = ['ussr', 'germany', 'usa', 'china', 'france', 'uk', 'japan', 'other', 'european']

export function techTreeNations() {
  return [...NATION_ORDER]
}

export function techTreeGrid(tree) {
  const nodes = Array.isArray(tree?.nodes) ? tree.nodes : []
  const edges = Array.isArray(tree?.edges) ? tree.edges : []
  const defined = nodes.filter(n => n && n.stem && Number.isFinite(n.x) && Number.isFinite(n.y))
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

  const cells = new Map()
  const conflicts = []
  for (const node of defined) {
    const key = `${node.x},${node.y}`
    if (cells.has(key)) conflicts.push(key)
    else cells.set(key, node)
  }

  const byStem = new Map(defined.map(n => [n.stem, n]))

  const tiers = defined.map(n => n.tier).filter(t => Number.isFinite(t) && t > 0)
  const minTier = tiers.length ? Math.min(...tiers) : null
  const maxTier = tiers.length ? Math.max(...tiers) : null

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

/** @param {unknown} modules @param {import('../replay-local/compute/tankSetup').SetupSelection | null} selection @param {object} options */
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

  const byKey = new Map(entries.map(e => [e.key, e]))
  const vehicleByStem = new Map((Array.isArray(options.nextVehicles) ? options.nextVehicles : [])
    .map(v => [v.stem, v]))

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
  const placeSubtree = (key, top) => {
    const kids = (childrenOf.get(key) || [])
      .filter(k => byKey.has(k) || (k.startsWith('vehicle:') && vehicleByStem.has(k.slice('vehicle:'.length))))
      .sort(sortKeys)
    if (!kids.length) {
      row.set(key, top)
      return 1
    }
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
    branches: branchRows,
    nextVehicles: [...new Map(vehicleTargets.map(t => {
      const [sourceKind, sourceModule] = t.sourceKey.split(':')
      return [t.stem, { stem: t.stem, cost: t.cost, sourceModule, sourceKind }]
    })).values()],
    hasChain: finalEdges.length > 0,
    derived: true, // 布局为复刻推导（数据文件没有客户端网格坐标）
  }
}

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

export function noChainNoteKey(tier) {
  return Number(tier) === 11 ? 'research.no_chain_note' : 'research.no_chain_note_generic'
}
