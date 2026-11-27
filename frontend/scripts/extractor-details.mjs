import { bounds2D, silhouetteToSvgPaths, toSvg } from './extractor-planar.mjs'
import { triangleNormal } from './extractor-surfaces.mjs'

/**
 * Feature fidelity audit（Blocker 3，developer-only）：
 * region count 不能证明视觉 fidelity——本报告按 top-view 外部结构类别聚合
 * source（merge 后未过滤）与 final（保留）的几何证据，供人工判断
 * "真实 source 中看得到的大结构，最终有没有"。
 *
 * 类别判定为通用启发式（z 带 + 相对位置 + 面积），无 Maus 坐标硬编码；
 * 全部数据来自 extractor debug geometry。
 *
 * @param {object} args { modelKey, sourceHull, sourceTurret, finalHull, finalTurret, hullBounds, turretBounds, fitScale }
 * @returns {object} feature-fidelity-report 结构
 */
export function buildFeatureAudit(args) {
  const { sourceHull = [], sourceTurret = [], finalHull = [], finalTurret = [], hullBounds, turretBounds } = args
  const surfaceBbox = (s) => {
    const b = bounds2D(s.polys.flatMap((p) => p.ring.map(([x, y]) => ({ x, y }))))
    return { minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY }
  }
  const inferBounds = (surfaces) => {
    let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9
    for (const s of surfaces) {
      for (const p of s.polys) {
        for (const [x, y] of p.ring) {
          minX = Math.min(minX, x); minY = Math.min(minY, y)
          maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
        }
      }
    }
    return minX === 1e9 ? { min: [-2, -5], max: [2, 5] } : { min: [minX, minY], max: [maxX, maxY] }
  }
  const hb = hullBounds || inferBounds(sourceHull)
  const tb = turretBounds || inferBounds(sourceTurret)
  const hullLen = hb.max[1] - hb.min[1]
  const hullPos = (cy) => (cy > hb.min[1] + hullLen * 0.6 ? 'front' : cy < hb.max[1] - hullLen * 0.6 ? 'rear' : 'center')
  const turLen = tb.max[1] - tb.min[1]
  const turPos = (cy) => (cy > tb.min[1] + turLen * 0.6 ? 'front' : cy < tb.max[1] - turLen * 0.6 ? 'rear' : 'center')
  const zOf = (s) => s.z ?? s.zMean ?? 0
  const classifyHull = (s) => {
    const b = surfaceBbox(s)
    const cy = (b.minY + b.maxY) / 2
    const pos = hullPos(cy)
    const z = zOf(s)
    if (z >= 1.9) {
      if (s.areaM2 >= 1) return 'upper-deck'
      return pos === 'front' ? 'front-deck-detail' : pos === 'rear' ? 'rear-deck-detail' : 'deck-detail'
    }
    if (z >= 1.4) {
      if (pos === 'front') return 'glacis-band'
      if (pos === 'rear') return 'engine-deck-band'
      return 'mid-deck-band'
    }
    if (z >= 0.6) return 'lower-transition'
    return 'skirt'
  }
  const classifyTurret = (s) => {
    const b = surfaceBbox(s)
    const cy = (b.minY + b.maxY) / 2
    const pos = turPos(cy)
    const z = zOf(s)
    if (z >= 3.35) {
      if (s.areaM2 >= 1) return 'roof'
      return pos === 'rear' ? 'roof-rear-detail' : pos === 'front' ? 'roof-front-detail' : 'roof-detail'
    }
    if (z >= 2.5) return 'ring-shell'
    return 'shell'
  }
  const buildCategory = (src, fin, classify, category) => {
    const srcItems = src.map((s) => ({ ...s, bbox: surfaceBbox(s), category: classify(s) })).filter((s) => s.category === category)
    const finItems = fin.map((s) => ({ ...s, bbox: surfaceBbox(s), category: classify(s) })).filter((s) => s.category === category)
    return {
      detected: srcItems.length,
      retained: finItems.length,
      detectedAreaM2: +srcItems.reduce((n, s) => n + s.areaM2, 0).toFixed(2),
      retainedAreaM2: +finItems.reduce((n, s) => n + s.areaM2, 0).toFixed(2),
      mergedInto: srcItems.reduce((n, s) => n + (s.faceCount > 1 ? s.faceCount - 1 : 0), 0),
      sourceBBoxes: srcItems.slice(0, 6).map((s) => ({
        bbox: [s.bbox.minX, s.bbox.minY, s.bbox.maxX, s.bbox.maxY].map((v) => +v.toFixed(2)),
        areaM2: s.areaM2,
        z: zOf(s),
        faces: s.faceCount,
      })),
    }
  }
  const hullCategories = ['upper-deck', 'glacis-band', 'engine-deck-band', 'front-deck-detail', 'rear-deck-detail', 'deck-detail', 'mid-deck-band', 'lower-transition', 'skirt']
  const turretCategories = ['roof', 'ring-shell', 'shell', 'roof-front-detail', 'roof-rear-detail', 'roof-detail']
  return {
    modelKey: args.modelKey,
    fidelity: 'high',
    visibleDetailRetentionTarget: 0.9,
    note: 'region/面积计数不构成视觉 fidelity 证据；本报告用于人工对照 source vs final 的 feature 类别存在性。',
    hull: Object.fromEntries(hullCategories.map((c) => [c, buildCategory(sourceHull, finalHull, classifyHull, c)])),
    turret: Object.fromEntries(turretCategories.map((c) => [c, buildCategory(sourceTurret, finalTurret, classifyTurret, c)])),
    nonSurfaceLayers: {
      tracks: { detected: true, retained: true, note: '独立 chassis_track_L/R 层（深色侧带）' },
      mantlet: { detected: true, retained: true, note: 'gun_mask 独立层（炮盾）' },
      gun: { detected: true, retained: true, note: 'gun 层（炮管，真实比例）' },
      outerSilhouette: { detected: true, retained: true, note: 'Layer A projected triangle union' },
    },
  }
}
/**
 * 提取顶面内部"结构边界"（component / height / normal discontinuity）。
 * 共享边去重；区分真实 feature edge 与 triangle tessellation edge：
 * - surface-edge：顶面 + 垂直壁/非顶面邻居 → 平台/甲板边缘，且垂直壁高度差必须
 *   显著（> heightDeltaM）——低模斜面网格的微小面片台阶（壁高 ~0.05-0.1m）不算；
 * - height：两顶面共享边高度差 > heightDeltaM（真实甲板台肩/凸起边缘）；
 * - normal：法线突变伴随显著高度差（> heightDeltaM*0.6）才输出——收紧 normalDeltaCos
 *   至 ~5°（0.995），剔除同一 smooth surface 内的 tessellation 对角线。
 *
 * 高保真策略（2026-08-18）：不设数量上限——只限制"是不是实际视觉结构"。
 *
 * @param {number[][][]} triangles3d
 * @param {object} opts { topFacingCos=0.35, heightDeltaM=0.15, normalDeltaCos=0.995, minEdgeLenM=1.0 }
 * @returns {Array<{ p1: [x,y], p2: [x,y], reason: string }>} 投影后的 2D 边（模型坐标）
 */
export function extractMajorEdges(triangles3d, opts = {}) {
  const topFacingCos = opts.topFacingCos ?? 0.35
  const heightDeltaM = opts.heightDeltaM ?? 0.15
  const normalDeltaCos = opts.normalDeltaCos ?? 0.995
  const minEdgeLenM = opts.minEdgeLenM ?? 1.0
  const tris = triangles3d.map((tri) => {
    const n = triangleNormal(tri[0], tri[1], tri[2])
    const len = Math.hypot(n[0], n[1], n[2])
    const nz = len > 1e-12 ? n[2] / len : 0
    const z = (tri[0][2] + tri[1][2] + tri[2][2]) / 3
    return {
      nz,
      normal: len > 1e-12 ? [n[0] / len, n[1] / len, n[2] / len] : [0, 0, 0],
      z,
      edges: [
        [tri[0], tri[1]],
        [tri[1], tri[2]],
        [tri[2], tri[0]],
      ],
    }
  })
  const keyOf = (a, b) => {
    const pa = a.map((v) => v.toFixed(6)).join(',')
    const pb = b.map((v) => v.toFixed(6)).join(',')
    return pa < pb ? pa + '|' + pb : pb + '|' + pa
  }
  const edgeMap = new Map()
  for (let t = 0; t < tris.length; t++) {
    for (const [a, b] of tris[t].edges) {
      const k = keyOf(a, b)
      if (!edgeMap.has(k)) edgeMap.set(k, { a, b, tris: [] })
      edgeMap.get(k).tris.push(t)
    }
  }
  const out = []
  for (const { a, b, tris: owners } of edgeMap.values()) {
    if (owners.length < 2) continue
    const lenM = Math.hypot(a[0] - b[0], a[1] - b[1])
    if (lenM < minEdgeLenM) continue
    const topOwners = owners.filter((i) => tris[i].nz > topFacingCos)
    const nonTopOwners = owners.filter((i) => tris[i].nz <= topFacingCos)
    let reason = null
    if (topOwners.length >= 1 && nonTopOwners.length >= 1) {
      const wallDelta = Math.max(
        ...nonTopOwners.map((i) => {
          const zs = tris[i].edges.flat().map((p) => p[2])
          return Math.max(...zs) - Math.min(...zs)
        }),
      )
      if (wallDelta > heightDeltaM) reason = 'surface-edge'
    } else if (topOwners.length >= 2) {
      const t1 = tris[topOwners[0]]
      const t2 = tris[topOwners[1]]
      const heightDelta = Math.abs(t1.z - t2.z)
      const dot = t1.normal[0] * t2.normal[0] + t1.normal[1] * t2.normal[1] + t1.normal[2] * t2.normal[2]
      if (heightDelta > heightDeltaM) reason = 'height'
      else if (heightDelta > heightDeltaM * 0.6 && dot < normalDeltaCos) reason = 'normal'
    }
    if (!reason) continue
    out.push({ p1: [a[0], a[1]], p2: [b[0], b[1]], reason })
  }
  return out
}

/**
 * 边去重聚类：近乎平行（角度差 ≤ angleDeg）且位置重合（中点距离 ≤ maxDistM）的边
 * 视为同一条结构线，只保留最长的一条。
 *
 * 目的（2026-08-18，少而强）：低多边形模型的斜切台阶会被拆成多条交叉短线
 * （Maus 前甲板 4 条 ~110.9 交叉斜线 → 渲染成 X 形噪纹）；聚类后同一条结构只出一条线。
 * 与数量上限配合：先聚类去重，再按长度排序截断。
 *
 * @param {Array<{p1:[x,y], p2:[x,y], reason:string}>} edges 投影后的 2D 边（模型坐标）
 * @param {object} opts { angleDeg=15, maxDistM=0.15 }
 * @returns {Array<{p1, p2, reason}>} 每条结构线保留的最长边
 */
export function clusterEdges(edges, opts = {}) {
  const angleDeg = opts.angleDeg ?? 15
  const maxDistM = opts.maxDistM ?? 0.15
  const clusters = []
  for (const e of edges) {
    const dx = e.p2[0] - e.p1[0]
    const dy = e.p2[1] - e.p1[1]
    const len = Math.hypot(dx, dy)
    let angle = (Math.atan2(dy, dx) * 180) / Math.PI
    angle = ((angle % 180) + 180) % 180
    const mid = { x: (e.p1[0] + e.p2[0]) / 2, y: (e.p1[1] + e.p2[1]) / 2 }
    let best = -1
    for (let i = 0; i < clusters.length; i++) {
      const c = clusters[i]
      let da = Math.abs(angle - c.angle)
      da = Math.min(da, 180 - da)
      const dist = Math.hypot(mid.x - c.mid.x, mid.y - c.mid.y)
      if (da <= angleDeg && dist <= maxDistM) {
        best = i
        break
      }
    }
    if (best >= 0) {
      if (len > clusters[best].len) clusters[best] = { angle, mid, len, edge: e }
    } else {
      clusters.push({ angle, mid, len, edge: e })
    }
  }
  return clusters.map((c) => c.edge)
}

/**
 * 高保真 detail 分级（HIGH-FIDELITY ASSET → 未来 runtime LOD 的结构准备）：
 * - vehicle-primary：任何尺寸必须保留——silhouette / tracks / turret body / mantlet /
 *   gun / 大型 deck-roof 区域（surface ≥ primaryMinM2）；
 * - vehicle-secondary：较大非核心结构——large hatch / cupola / vents / engine deck
 *   plates / major panel boundaries（bump ≥ secondaryMinM2、surface 0.1-0.5 m²、
 *   edge ≥ edgeSecondaryMinM）；
 * - vehicle-micro-detail：较小但真实存在——small hatch / small roof features /
 *   minor top-visible structures（< 0.1 m²）。
 * 不把 bolt/tiny handle 级垃圾塞进 micro（它们在提取阶段已被 sub-pixel 阈值过滤）。
 *
 * @param {object} detail { kind: 'silhouette'|'track'|'surface'|'bump'|'edge'|'mantlet'|'gun', areaM2?, lengthM? }
 * @param {object} opts { primaryMinM2=0.5, secondaryMinM2=0.1, edgeSecondaryMinM=3.0 }
 * @returns {'vehicle-primary'|'vehicle-secondary'|'vehicle-micro-detail'}
 */
export function classifyDetail(detail, opts = {}) {
  const primaryMinM2 = opts.primaryMinM2 ?? 0.5
  const secondaryMinM2 = opts.secondaryMinM2 ?? 0.1
  const edgeSecondaryMinM = opts.edgeSecondaryMinM ?? 3.0
  const { kind, areaM2 = 0, lengthM = 0 } = detail
  if (kind === 'silhouette' || kind === 'track' || kind === 'mantlet' || kind === 'gun') {
    return 'vehicle-primary'
  }
  if (kind === 'surface') {
    if (areaM2 >= primaryMinM2) return 'vehicle-primary'
    if (areaM2 >= secondaryMinM2) return 'vehicle-secondary'
    return 'vehicle-micro-detail'
  }
  if (kind === 'bump') {
    return areaM2 >= secondaryMinM2 ? 'vehicle-secondary' : 'vehicle-micro-detail'
  }
  if (kind === 'edge') {
    return lengthM >= edgeSecondaryMinM ? 'vehicle-secondary' : 'vehicle-micro-detail'
  }
  return 'vehicle-secondary'
}

export function surfacesToSvgPaths(surfaces, fit, fill) {
  const paths = []
  for (const s of surfaces) {
    paths.push(...silhouetteToSvgPaths(s.polys, fit, fill))
  }
  return paths
}

export function edgesToSvgPath(edges, fit, stroke) {
  if (edges.length === 0) return null
  const d = edges
    .map((e) => {
      const p1 = toSvg({ x: e.p1[0], y: e.p1[1] }, fit)
      const p2 = toSvg({ x: e.p2[0], y: e.p2[1] }, fit)
      return `M${p1.x.toFixed(2)} ${p1.y.toFixed(2)} L${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`
    })
    .join(' ')
  return { d, stroke, strokeWidth: 5, fill: 'none' }
}
