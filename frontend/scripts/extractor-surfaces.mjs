import polygonClipping from 'polygon-clipping'
import { projectTriangles, simplifyRing, unionTriangles } from './extractor-planar.mjs'


export function triangleNormal(a, b, c) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2]
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2]
  return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx]
}

/**
 * 视觉表面合并（HIGH-FIDELITY，Blocker 1/2/4）：
 * 把 model.glb 的 triangle tessellation / low-poly topology 合并为视觉连续表面。
 *
 * 规则：共享 3D 边的相邻 top-facing 面片，若（法线差 ≤ mergeAngleDeg 且
 * 高度差 ≤ mergeHeightDeltaM）→ 属于同一视觉表面（union-find）。
 * 只有真实结构分离才拆：height step / vertical wall / physical gap /
 * strong normal discontinuity / isolated raised-recessed feature
 * （即不满足连续条件 → 不合并）。
 *
 * 最终：连续 roof/deck/斜面 是一个/少量 polygon，而不是十几个 tessellation
 * triangles（Maus turret ring 61 面 → 6 表面；roof 297 面 → 34 表面；
/**
 * Raw top-facing triangle projection（Blocker 1：source ground truth）：
 * 每个 top-facing 三角形独立投影为 2D polygon——不做视觉表面合并、不做遮挡/微小过滤。
 * 这是 model.glb top-down 投影的最原始表达（可显示 source 三角化结构），
 * 仅用于 debug：source-top-projection.svg（与 final 对照，判断大结构是否消失）。
 * 注意：相邻三角形共享边会产生视觉 seam——这正是"raw source"的语义。
 *
 * @param {number[][][]} triangles3d
 * @param {object} opts { topFacingCos=0.35 }
 * @returns {Array<{ring, holes}>} 每个 top-facing 三角形一个 polygon（2D 模型坐标）
 */
export function projectTopFacingPolygons(triangles3d, opts = {}) {
  const topFacingCos = opts.topFacingCos ?? 0.35
  const polys = []
  for (const tri of triangles3d) {
    const n = triangleNormal(tri[0], tri[1], tri[2])
    const len = Math.hypot(n[0], n[1], n[2])
    if (len < 1e-12) continue
    const nz = n[2] / len
    if (nz <= topFacingCos) continue
    const p = projectTriangles([tri])[0]
    if (!p) continue
    polys.push({ ring: p, holes: [] })
  }
  return polys
}

/**
 * 视觉表面合并（HIGH-FIDELITY，Blocker 1/2/4）：
 * 把 model.glb 的 triangle tessellation / low-poly topology 合并为视觉连续表面。
 *
 * 规则：共享 3D 边的相邻 top-facing 面片，若（法线差 ≤ mergeAngleDeg 且
 * 高度差 ≤ mergeHeightDeltaM）→ 属于同一视觉表面（union-find）。
 * 只有真实结构分离才拆：height step / vertical wall / physical gap /
 * strong normal discontinuity / isolated raised-recessed feature
 * （即不满足连续条件 → 不合并）。
 *
 * @param {number[][][]} triangles3d
 * @param {object} opts { topFacingCos=0.35, mergeAngleDeg=20, mergeHeightDeltaM=0.4 }
 * @returns {Array<{ polys, areaM2, zMean, faceCount }>} 视觉连续表面（2D union 已做）
 */
export function mergeVisualSurfaces(triangles3d, opts = {}) {
  const topFacingCos = opts.topFacingCos ?? 0.35
  const mergeAngleDeg = opts.mergeAngleDeg ?? 20
  const mergeHeightDeltaM = opts.mergeHeightDeltaM ?? 0.4
  const faces = []
  for (let inputIdx = 0; inputIdx < triangles3d.length; inputIdx++) {
    const tri = triangles3d[inputIdx]
    const n = triangleNormal(tri[0], tri[1], tri[2])
    const len = Math.hypot(n[0], n[1], n[2])
    if (len < 1e-12) continue
    const nz = n[2] / len
    if (nz <= topFacingCos) continue
    const [a, b, c] = tri
    const area = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2
    faces.push({
      tri,
      inputIdx,
      z: (tri[0][2] + tri[1][2] + tri[2][2]) / 3,
      n: [n[0] / len, n[1] / len, n[2] / len],
      area,
    })
  }
  const keyOf = (a, b) => {
    const pa = a.map((v) => v.toFixed(6)).join(',')
    const pb = b.map((v) => v.toFixed(6)).join(',')
    return pa < pb ? pa + '|' + pb : pb + '|' + pa
  }
  const edgeOwners = new Map()
  for (let i = 0; i < faces.length; i++) {
    const tri = faces[i].tri
    for (let e = 0; e < 3; e++) {
      const k = keyOf(tri[e], tri[(e + 1) % 3])
      if (!edgeOwners.has(k)) edgeOwners.set(k, [])
      edgeOwners.get(k).push(i)
    }
  }
  const parent = faces.map((_, i) => i)
  const find = (x) => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]]
      x = parent[x]
    }
    return x
  }
  const mergeCount = { merged: 0 }
  for (const owners of edgeOwners.values()) {
    if (owners.length < 2) continue
    for (let i = 0; i < owners.length; i++) {
      for (let j = i + 1; j < owners.length; j++) {
        const a = faces[owners[i]]
        const b = faces[owners[j]]
        const dot = a.n[0] * b.n[0] + a.n[1] * b.n[1] + a.n[2] * b.n[2]
        const ang = (Math.acos(Math.min(1, Math.max(-1, dot))) * 180) / Math.PI
        const dz = Math.abs(a.z - b.z)
        if (ang <= mergeAngleDeg && dz <= mergeHeightDeltaM && find(owners[i]) !== find(owners[j])) {
          parent[find(owners[i])] = find(owners[j])
          mergeCount.merged++
        }
      }
    }
  }
  const comps = new Map()
  for (let i = 0; i < faces.length; i++) {
    const root = find(i)
    if (!comps.has(root)) comps.set(root, [])
    comps.get(root).push(i)
  }
  const out = []
  for (const comp of comps.values()) {
    const polys = unionTriangles(comp.map((i) => faces[i].tri.map((p) => [p[0], p[1]])))
    if (polys.length === 0) continue
    const area = polys.reduce((s, p) => s + ringArea(p.ring), 0)
    const wSum = comp.reduce((s, i) => s + faces[i].area, 0)
    const zMean = wSum > 0 ? comp.reduce((s, i) => s + faces[i].z * faces[i].area, 0) / wSum : 0
    const faceIdx = comp.map((i) => faces[i].inputIdx)
    out.push({ polys, areaM2: +area.toFixed(3), zMean: +zMean.toFixed(2), faceCount: comp.length, faceIdx })
  }
  out.sort((a, b) => b.areaM2 - a.areaM2)
  return { surfaces: out, stats: { rawFaces: faces.length, mergedFaces: mergeCount.merged, surfaceCount: out.length } }
}

/**
 * 提取视觉连续表面区域（HIGH-FIDELITY）。
 * 基于 mergeVisualSurfaces：连续 roof/deck/斜面 → 单一区域；
 * 真实凸起（hatch/cupola/台阶带）→ 独立区域（自然分离，无需 zMean 切斜面）。
 * 仅过滤：asset-space 极端微小（minAreaM2）；退化 sliver 由 CLI asset 过滤处理。
 *
 * @param {number[][][]} triangles3d
 * @param {object} opts { topFacingCos=0.35, mergeAngleDeg=20, mergeHeightDeltaM=0.4, minAreaM2=0.01 }
 * @returns {Array<{ z: number, polys: Array<{ring, holes}>, areaM2: number, faceCount: number }>}
 */
export function extractTopSurfaces(triangles3d, opts = {}) {
  const minAreaM2 = opts.minAreaM2 ?? 0.01
  const { surfaces } = mergeVisualSurfaces(triangles3d, opts)
  return surfaces
    .filter((s) => s.areaM2 >= minAreaM2)
    .map((s) => ({ z: s.zMean, polys: s.polys, areaM2: s.areaM2, faceCount: s.faceCount }))
}

/**
 * 遮挡过滤（hidden geometry 剔除，HIGH-FIDELITY）：
 * 俯视可见性 = 顶层优先。按 z 降序累积已覆盖区域（2D polygon union），
 * 若某表面的投影 ≥ (1 - occludeRatio) 被更高处表面覆盖 → 属于 hidden geometry
 * （甲板下方的裙板固定件/悬挂面等，俯视不可见）→ 过滤。
 * 部分可见的表面保留（如甲板边缘台阶带露出部分）。
 *
 * @param {Array<{z, polys, areaM2}>} surfaces 按 z 升序传入
 * @param {object} opts { occludeRatio=0.9 }
 * @returns {Array} 过滤后按 z 升序
 */
export function filterOccludedSurfaces(surfaces, opts = {}) {
  const occludeRatio = opts.occludeRatio ?? 0.9
  const sorted = [...surfaces].sort((a, b) => b.z - a.z)
  let covered = []
  const kept = []
  for (const s of sorted) {
    const myUnion = polygonClipping.union(...s.polys.map((p) => [p.ring, ...p.holes]))
    if (covered.length > 0) {
      const visible = polygonClipping.difference(myUnion, ...covered)
      const visArea = visible.reduce((sum, poly) => sum + ringArea(poly[0]), 0)
      const myArea = myUnion.reduce((sum, poly) => sum + ringArea(poly[0]), 0)
      if (myArea > 0 && visArea / myArea < 1 - occludeRatio) continue
    }
    kept.push(s)
    covered = polygonClipping.union(covered, myUnion)
  }
  return kept.sort((a, b) => a.z - b.z)
}

/**
 * 顶视可见性（真实 z-buffer，A3：视觉层必须遵守 orthographic top-visible）。
 *
 * 在正交俯视栅格上做逐像素 z-buffer 遮挡判定：每个 top-facing 三角形按投影
 * bbox 栅格化（像素内双线性 z 插值），z 最大者赢得该像素（owner 数组）。
 * 返回每个输入 top-facing 三角形的可见像素数。
 *
 * 与 filterOccludedSurfaces（zMean 2D-union 近似）的区别：逐像素真实遮挡——
 * 部分可见结构（低于主面但仍露出的凸起、甲板缘条）正确保留；被完全遮挡的
 * 结构（如顶视被甲板盖住的 tracks）得到 0。
 *
 * 确定性：纯算术栅格化，相同输入相同输出。
 * 性能：只遍历每三角形投影 bbox；Maus ~1200 top-facing 三角形、resolution=1024
 * 约 1-3 秒（developer CLI 可接受）。
 *
 * @param {number[][][]} triangles3d 模型坐标三角形（x宽,y长,z高）
 * @param {object} opts { topFacingCos=0.35, bounds={minX,minY,maxX,maxY}, resolution=1024 }
 * @returns {{ visiblePx: number[], topFacing: number[][][], bounds, width, height, pxPerM }}
 *   visiblePx[i] 与输入 triangles3d[i] 一一对应（非 top-facing = 0）；
 *   topFacing 为 top-facing 三角形子集（debug 用）。
 */
export function rasterVisibility(triangles3d, opts = {}) {
  const topFacingCos = opts.topFacingCos ?? 0.35
  const resolution = opts.resolution ?? 1024
  const groups = opts.groups ?? null
  const faces = []
  for (let ti = 0; ti < triangles3d.length; ti++) {
    const tri = triangles3d[ti]
    const n = triangleNormal(tri[0], tri[1], tri[2])
    const len = Math.hypot(n[0], n[1], n[2])
    if (len < 1e-12) continue
    if (n[2] / len <= topFacingCos) continue
    faces.push({ tri, inputIdx: ti })
  }
  const empty = { visiblePx: [], topFacing: [], bounds: null, width: 0, height: 0, pxPerM: 0 }
  if (faces.length === 0) return empty
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  if (opts.bounds) {
    minX = opts.bounds.minX; minY = opts.bounds.minY; maxX = opts.bounds.maxX; maxY = opts.bounds.maxY
  } else {
    for (const f of faces) {
      for (const p of f.tri) {
        if (p[0] < minX) minX = p[0]
        if (p[0] > maxX) maxX = p[0]
        if (p[1] < minY) minY = p[1]
        if (p[1] > maxY) maxY = p[1]
      }
    }
  }
  const w = maxX - minX
  const h = maxY - minY
  if (!(w > 0) || !(h > 0)) return empty
  const scale = resolution / Math.max(w, h)
  const W = Math.max(1, Math.ceil(w * scale))
  const H = Math.max(1, Math.ceil(h * scale))
  const zbuf = new Float32Array(W * H).fill(-Infinity)
  const owner = new Int32Array(W * H).fill(-1)
  for (let fi = 0; fi < faces.length; fi++) {
    const [a, b, c] = faces[fi].tri
    const ax = (a[0] - minX) * scale, ay = (a[1] - minY) * scale
    const bx = (b[0] - minX) * scale, by = (b[1] - minY) * scale
    const cx = (c[0] - minX) * scale, cy = (c[1] - minY) * scale
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx)))
    const x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)))
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy)))
    const y1 = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)))
    if (x1 < x0 || y1 < y0) continue
    const v0x = bx - ax, v0y = by - ay
    const v1x = cx - ax, v1y = cy - ay
    const d = v0x * v1y - v0y * v1x
    if (Math.abs(d) < 1e-12) continue
    for (let y = y0; y <= y1; y++) {
      const row = y * W
      for (let x = x0; x <= x1; x++) {
        const qx = x + 0.5 - ax, qy = y + 0.5 - ay
        const w1 = (qx * v1y - qy * v1x) / d
        const w2 = (v0x * qy - v0y * qx) / d
        const w0 = 1 - w1 - w2
        if (w0 < 0 || w1 < 0 || w2 < 0) continue
        const z = w0 * a[2] + w1 * b[2] + w2 * c[2]
        const idx = row + x
        if (z > zbuf[idx]) {
          zbuf[idx] = z
          owner[idx] = fi
        }
      }
    }
  }
  const perInput = new Uint32Array(triangles3d.length)
  const topFacing = new Array(faces.length)
  for (let i = 0; i < faces.length; i++) {
    perInput[faces[i].inputIdx] = 0
    topFacing[i] = faces[i].tri
  }
  for (let i = 0; i < owner.length; i++) {
    const o = owner[i]
    if (o >= 0) perInput[faces[o].inputIdx]++
  }
  const visibleMask = new Uint8Array(W * H)
  for (let i = 0; i < owner.length; i++) if (owner[i] >= 0) visibleMask[i] = 1
  let visibleGroupPx = null
  if (groups) {
    const maxG = Math.max(-1, ...groups)
    visibleGroupPx = new Uint32Array(maxG + 1)
    for (let i = 0; i < owner.length; i++) {
      const o = owner[i]
      if (o >= 0) {
        const g = groups[faces[o].inputIdx]
        if (g >= 0) visibleGroupPx[g]++
      }
    }
    visibleGroupPx = Array.from(visibleGroupPx)
  }
  return {
    visiblePx: Array.from(perInput),
    topFacing,
    bounds: { minX, minY, maxX, maxY },
    width: W,
    height: H,
    pxPerM: scale,
    visibleMask,
    visibleGroupPx,
  }
}

export function visibilityPixel(worldX, worldY, vis) {
  const px = Math.floor((worldX - vis.bounds.minX) * vis.pxPerM)
  const py = Math.floor((worldY - vis.bounds.minY) * vis.pxPerM)
  if (px < 0 || py < 0 || px >= vis.width || py >= vis.height) return -1
  return py * vis.width + px
}

function segmentsProperIntersect(a, b, c, d) {
  const cross = (o, p, q) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0])
  const d1 = cross(a, b, c)
  const d2 = cross(a, b, d)
  const d3 = cross(c, d, a)
  const d4 = cross(c, d, b)
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
}

function isSelfIntersecting(ring) {
  const n = ring.length
  for (let i = 0; i < n; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % n]
    for (let j = i + 1; j < n; j++) {
      const nextJ = (j + 1) % n
      if (nextJ === i || j === (i + 1) % n) continue
      const c = ring[j]
      const d = ring[nextJ]
      if (segmentsProperIntersect(a, b, c, d)) return true
    }
  }
  return false
}

/**
 * 几何退化 polygon 过滤（A2：替代"长且窄=artifact"的 sliver 规则）。
 *
 * 背景（information-loss-audit.md §4.2）：旧规则（宽高比>12 且窄边<0.15m）误删
 * 真实长条结构（3.5m×0.087m 甲板缘条，320px 下 110×2.7px 可见）。真实 detail
 * 的删除风险优先于少量 polygon-clipping artifact——artifact 只按几何退化判定：
 * 1. 自交 ring（非简单多边形，数值伪影）；
 * 2. near-zero 面积（< minAreaM2，默认 1e-6 m²）；
 * 3. 数值 sliver：投影 bbox 窄边 < minEdgeLenM（默认 0.005m=5mm，320 下 0.16px
 *    ——3.5m×0.001m 数值长条过滤；3.5m×0.087m 真实缘条保留）；
 * 4. duplicate coincident polygon（点序列完全重合，去重）。
 * 真实长条只要面积非退化 + source 几何连续 + 320 asset-space 稳定投影 → 保留。
 *
 * @param {Array<{ring, holes}>} polys
 * @param {object} opts { minEdgeLenM=0.005, minAreaM2=1e-6 }
 * @returns {{ kept: Array, removed: Array }}
 */
export function filterDegeneratePolys(polys, opts = {}) {
  const minEdgeLenM = opts.minEdgeLenM ?? 0.005
  const minAreaM2 = opts.minAreaM2 ?? 1e-6
  const kept = []
  const removed = []
  const seen = new Set()
  for (const poly of polys) {
    const ring = simplifyRing(poly.ring)
    if (ring.length < 3) {
      removed.push(poly)
      continue
    }
    if (ringArea(ring) < minAreaM2) {
      removed.push(poly)
      continue
    }
    const key = ring.map((p) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`).join('|')
    if (seen.has(key)) {
      removed.push(poly)
      continue
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const p of ring) {
      if (p[0] < minX) minX = p[0]
      if (p[0] > maxX) maxX = p[0]
      if (p[1] < minY) minY = p[1]
      if (p[1] > maxY) maxY = p[1]
    }
    const narrow = Math.min(maxX - minX, maxY - minY)
    if (narrow < minEdgeLenM || isSelfIntersecting(ring)) {
      removed.push(poly)
      continue
    }
    seen.add(key)
    kept.push(poly)
  }
  return { kept, removed }
}

function ringArea(ring) {
  let area = 0
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]
    const q = ring[(i + 1) % ring.length]
    area += p[0] * q[1] - q[0] * p[1]
  }
  return Math.abs(area) / 2
}
