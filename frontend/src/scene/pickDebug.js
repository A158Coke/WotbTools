// 场景拾取调试（?admin=1 / ?debug=1 且 dev 构建生效）：点击 3D 场景 → 报告被点物体的
// 节点名 / 游戏场景系坐标 / destructibles.json 实例（id、serverId cell+slot、类别）等，
// 供「玩家指认 → 开发者定位」的排障回路使用。本文件只放纯函数（可单测）；
// 射线拾取、标记与面板接线在 playbackScene.js。
//
// 坐标约定与 destructibles.js 一致：游戏场景系 = gltf.scene 局部系（x/y 水平、z 上），
// 即 destructibles.json `pos` 与 scenery.glb 节点位置所用坐标系（直接对应回放 x/z）。

/** 节点 → 命名祖先链（自底向上，只收集有 name 的层级；到 stopAt 为止不含 stopAt） */
export function nameChainOf(object, stopAt = null) {
  const out = []
  let o = object
  while (o && o !== stopAt) {
    if (o.name) out.push(o.name)
    o = o.parent
  }
  return out
}

/**
 * 命中对象 → 整条祖先链是否可见（Raycaster 不按 Object3D.visible 过滤：
 * 隐藏的 D_ 损毁替换网格、sky、隐藏父节点下的车辆都会被 intersect 命中，
 * 拾取前必须按链上可见性筛选，否则报告指向画面里不存在的模型）。
 * stopAt 及其祖先不计入（如场景根）。
 */
export function chainVisible(object, stopAt = null) {
  let o = object
  while (o && o !== stopAt) {
    if (o.visible === false) return false
    o = o.parent
  }
  return true
}

/**
 * 点击位置 → 完整清单里最近的实例（destructibles.json 的 instances 全集，
 * 与本局是否发生过破坏事件无关——事件状态表只含被撞过的物体）。
 * 超出 radiusM / 空列表 → null（调用方按「非可破坏物」呈现）。
 */
export function nearestInstance(instances, sx, sy, radiusM = 3) {
  if (!Array.isArray(instances)) return null
  let best = null
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

/**
 * 全量实例 × findMeshes → mesh → 实例 精确归属表（拾取主路径）。
 * 树梢等远离实例锚点的命中点按「命中网格属于哪棵树」归属——距离查询会把
 * 6m 倒树的树梢错联到旁边更近的邻树（评审实测 id=7→id=8）。
 * D_ 损毁态网格一并归属（倒下后点击同样能报 id）。
 */
export function buildMeshOwnerMap(instances, findMeshes, out = new Map()) {
  if (!Array.isArray(instances)) return out
  for (const inst of instances) {
    const p = inst?.pos
    if (!p) continue
    for (const e of findMeshes(p[0], p[1], false)) out.set(e.mesh, inst)
    for (const e of findMeshes(p[0], p[1], true)) out.set(e.mesh, inst)
  }
  return out
}

/**
 * 点击位置 → 最近的 destructible 状态（st.inst.pos 距离判定）。
 * 装配层应优先做「命中网格 ∈ 该状态的 pivot/intactMeshes/deadMeshes」的精确归属，
 * 本函数只做位置兜底（网格成员查询需要 three 对象图，放装配层）。
 * 超出 radiusM / 空 states → null（调用方按「非可破坏物」呈现）。
 */
export function nearestDestructibleState(states, sx, sy, radiusM = 3) {
  if (!Array.isArray(states)) return null
  let best = null
  let bestD = radiusM
  for (const st of states) {
    const p = st?.inst?.pos
    if (!p) continue
    const d = Math.hypot(p[0] - sx, p[1] - sy)
    if (d <= bestD) {
      best = st
      bestD = d
    }
  }
  return best
}

/**
 * 命中状态 → 当前视觉状态标签（读装配层的实时对象图，非回放指针推断）：
 * - prop=3（树倒）：pivot 带非恒定四元数 = 已倒/倒伏中；
 * - prop=1/2（换模）：损毁态网格可见且完好态不可见 = destroyed。
 * 无状态对象图时 label 恒 'intact'（fail-open，只影响展示不影响拾取）。
 */
export function stateVisualLabel(st) {
  if (!st) return null
  if (st.prop === 3) {
    const q = st.pivot?.quaternion
    const fallen = !!q && !!(q.x || q.y || q.z)
    return { prop: 3, label: fallen ? 'fallen/falling' : 'standing' }
  }
  const deadShown = (st.deadMeshes || []).some((m) => m.visible)
  const intactShown = (st.intactMeshes || []).some((m) => m.visible)
  return { prop: st.prop, label: deadShown && !intactShown ? 'destroyed' : 'intact' }
}

const PROP_LABEL = { 0: 'modules', 1: 'fragiles', 2: 'pole', 3: 'tree-fall' }

/**
 * 拾取报告 → 单文本（面板显示 / console / window.__pbPickText 三渠道同一份）。
 * r = { clock, kind, node, chain, vehicle, world, scene, material, inst, vis, err }
 * 坐标一律保留 1 位小数；scene 为游戏场景系（destructibles pos 同系）。
 */
export function formatPickReport(r) {
  const L = []
  L.push(`[scene-pick] t=${Number.isFinite(r.clock) ? r.clock.toFixed(2) : '?'}s kind=${r.kind}`)
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
  return L.join('\n')
}
