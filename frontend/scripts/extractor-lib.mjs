/**
 * BlitzKit vehicle model extractor — 纯函数库（vitest 与 CLI 共用）。
 *
 * 坐标语义（经 BlitzKit 源码 + Maus 实测确认，docs/assets/tier-x-models/README.md）：
 * - GLB 顶点（模型坐标）：x=宽、y=长（forward=+y）、z=高；
 * - models.pb origin（引擎坐标）：x=宽、y=高、z=长（forward=-z）；
 * - correctZYTuple 把引擎坐标转为模型坐标：R_x(+90°)(x, y, -z) = (x, z, y)；
 * - 俯视投影 = 模型坐标 (x, y) 平面（丢弃 z 高）；SVG 0° 要求车头朝 12 点
 *   → SVG y = -模型 y。
 */

/** 引擎坐标 → 模型坐标（BlitzKit correctZYTuple 的代数等价）。 */
export function correctZYTuple(v) {
  return { x: v.x, y: v.z, z: v.y }
}

/** 模型坐标 → 2D 俯视投影（x=宽、y=长）。 */
export function projectTopDown(v) {
  return { x: v.x, y: v.y }
}

/**
 * Andrew monotone chain 凸包（2D 点数组 → 逆时针凸包顶点）。
 * 用于 silhouette 提取（hull 近矩形；gun/turret 分组独立凸包）。
 */
export function convexHull2D(points) {
  const pts = points
    .map((p) => ({ x: p.x, y: p.y }))
    .sort((a, b) => (a.x !== b.x ? a.x - b.x : a.y - b.y))
  if (pts.length < 3) return pts
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const lower = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
    upper.push(p)
  }
  lower.pop()
  upper.pop()
  return lower.concat(upper)
}

/** 2D 点集 bounds（用于 fit）。 */
export function bounds2D(points) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  return { minX, minY, maxX, maxY }
}

/**
 * 统一 fit 变换：几何 bounds → viewBox 内（保持长宽比、居中）。
 * paddingRatio：留边比例（默认 0.88——hull/turret 主体落画布内，长炮管允许 overflow）。
 * fit 只由几何 bounds 决定，禁止人工 scale。
 */
export function computeFit(b, viewBox, paddingRatio = 0.88) {
  const w = b.maxX - b.minX
  const h = b.maxY - b.minY
  if (!(w > 0) || !(h > 0)) throw new Error('fit bounds 无效（零面积）')
  const scale = (Math.min(viewBox.width, viewBox.height) * paddingRatio) / Math.max(w, h)
  const cx = (b.minX + b.maxX) / 2
  const cy = (b.minY + b.maxY) / 2
  const tx = viewBox.width / 2 - cx * scale
  const ty = viewBox.height / 2 - cy * scale
  return { scale, tx, ty }
}

/** 模型坐标点 → SVG 坐标（0° 车头朝 12 点：SVG y = -模型 y）。 */
export function toSvg(p, fit) {
  return { x: p.x * fit.scale + fit.tx, y: -p.y * fit.scale + fit.ty }
}

/** 凸包 → SVG path d（模型坐标，含 fit + y flip）。 */
export function hullToPath(hull, fit) {
  if (hull.length < 3) return null
  const d = hull
    .map((p, i) => {
      const s = toSvg(p, fit)
      return `${i === 0 ? 'M' : 'L'}${s.x.toFixed(2)} ${s.y.toFixed(2)}`
    })
    .join(' ')
  return d + ' Z'
}

/** SVG 文档（viewBox 0 0 W H；paths: [{ d, fill?, stroke?, strokeWidth?, fillRule? }]）。 */
export function svgDocument(paths, viewBox) {
  const body = paths
    .map((p) => {
      const attrs = [`d="${p.d}"`]
      if (p.fill) attrs.push(`fill="${p.fill}"`)
      if (p.stroke) attrs.push(`stroke="${p.stroke}"`)
      if (p.strokeWidth) attrs.push(`stroke-width="${p.strokeWidth}"`)
      if (p.fillRule) attrs.push(`fill-rule="${p.fillRule}"`)
      return `  <path ${attrs.join(' ')}/>`
    })
    .join('\n')
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewBox.width} ${viewBox.height}">`,
    body,
    '</svg>',
    '',
  ].join('\n')
}

/**
 * metadata.json（geometry-source schema，任务 12）。
 * source 字段证明几何来自 BlitzKit 真实模型；generation 记录生成方法与参数。
 */
export function buildMetadata({
  modelKey,
  kind,
  tankId,
  modelGlbUrl,
  modelsPbUrl,
  turretPivot,
  hullBounds,
  turretBounds,
  gunBounds,
  viewBox,
  generationNotes = '',
}) {
  return {
    modelKey,
    kind,
    source: {
      provider: 'blitzkit',
      tankId,
      collisionModel: modelGlbUrl,
      modelDefinitions: modelsPbUrl,
    },
    turretPivot: { x: +turretPivot.x.toFixed(2), y: +turretPivot.y.toFixed(2) },
    generation: {
      method: 'blitzkit-model-topdown-extraction',
      viewBox: `0 0 ${viewBox.width} ${viewBox.height}`,
      hullBounds,
      turretBounds,
      gunBounds,
      notes: generationNotes,
    },
  }
}

/**
 * Blocker 1 — 真实 silhouette 提取（projected triangle polygon union）。
 *
 * 技术取舍（2026-08-17）：
 * - convex hull：会把所有凹轮廓/结构抹成外包矩形（Maus hull.svg 退化成大矩形）→ 禁止用于正式资产；
 * - polygon union（本方案）：每个 3D triangle 投影到 top-down 2D 后精确 union，
 *   保留全部凹轮廓与洞；使用 polygon-clipping（成熟纯 JS 布尔库）；
 * - 备选（未采用）：raster mask + contour trace（锯齿/分辨率权衡）、alpha shape（参数不稳）。
 */
import polygonClipping from 'polygon-clipping'

/**
 * 从 POSITION + INDEX 数组构建三角形列表（3D 顶点引用）。
 * positions: [x0,y0,z0, x1,y1,z1, ...]；indices: [i0,i1,i2, ...]（无索引时按连续 3 顶点）。
 */
export function trianglesFromGeometry({ positions, indices }) {
  const tris = []
  const count = indices ? indices.length / 3 : positions.length / 9
  for (let t = 0; t < count; t++) {
    const i0 = indices ? indices[t * 3] : t * 3
    const i1 = indices ? indices[t * 3 + 1] : t * 3 + 1
    const i2 = indices ? indices[t * 3 + 2] : t * 3 + 2
    tris.push([
      [positions[i0 * 3], positions[i0 * 3 + 1], positions[i0 * 3 + 2]],
      [positions[i1 * 3], positions[i1 * 3 + 1], positions[i1 * 3 + 2]],
      [positions[i2 * 3], positions[i2 * 3 + 1], positions[i2 * 3 + 2]],
    ])
  }
  return tris
}

/**
 * 3D 三角形 → top-down 2D 投影（模型坐标 x/y 平面），丢弃退化三角形（面积 ~0，
 * 如垂直面/共线）。返回 2D 三角形列表 [[[x,y],[x,y],[x,y]], ...]。
 */
export function projectTriangles(triangles3d, epsilon = 1e-9) {
  const out = []
  for (const [a, b, c] of triangles3d) {
    const p1 = [a[0], a[1]]
    const p2 = [b[0], b[1]]
    const p3 = [c[0], c[1]]
    const area = Math.abs((p2[0] - p1[0]) * (p3[1] - p1[1]) - (p2[1] - p1[1]) * (p3[0] - p1[0])) / 2
    if (area > epsilon) out.push([p1, p2, p3])
  }
  return out
}

/**
 * projected triangles 精确 union → [{ ring, holes }]（多边形含洞，GeoJSON 风格）。
 * 确定性：polygon-clipping 纯函数，相同输入相同输出。
 */
export function unionTriangles(triangles2d) {
  const polys = triangles2d.map(([a, b, c]) => [[a, b, c, a]])
  if (polys.length === 0) return []
  const result = polygonClipping.union(...polys)
  return result.map((poly) => ({
    ring: poly[0],
    holes: poly.slice(1),
  }))
}

/**
 * 轻量确定性简化：合并共线连续点（三点叉积 ~0 且中间点落在两端之间时删除中间点）。
 * tolerance 控制共线判定（默认 1e-6）。不做平滑/美化。
 */
export function simplifyRing(ring, tolerance = 1e-6) {
  if (ring.length < 4) return ring
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const dot = (o, a, b) => (a[0] - o[0]) * (b[0] - o[0]) + (a[1] - o[1]) * (b[1] - o[1])
  const out = []
  for (let i = 0; i < ring.length; i++) {
    const prev = ring[(i - 1 + ring.length) % ring.length]
    const cur = ring[i]
    const next = ring[(i + 1) % ring.length]
    const c = cross(prev, cur, next)
    const d = dot(prev, next, cur) // cur 是否在 prev..next 之间
    if (Math.abs(c) > tolerance || d < 0) out.push(cur)
  }
  // 兜底：全部被删时保留原始点
  return out.length >= 3 ? out : ring
}

/**
 * silhouette 多边形 → SVG path（outer ring + holes，fill-rule evenodd）。
 * 同一 fit 变换（toSvg）。返回 [{ d, fill, fillRule }]。
 */
export function silhouetteToSvgPaths(polygons, fit, fill) {
  const paths = []
  for (const poly of polygons) {
    const parts = [poly.ring, ...poly.holes]
    const subpaths = parts
      .map((ring) => simplifyRing(ring).map((p) => toSvg({ x: p[0], y: p[1] }, fit)))
      .filter((pts) => pts.length >= 3)
    if (subpaths.length === 0) continue
    const d = subpaths
      .map((pts) =>
        pts.map((s, i) => `${i === 0 ? 'M' : 'L'}${s.x.toFixed(2)} ${s.y.toFixed(2)}`).join(' ') + ' Z',
      )
      .join(' ')
    paths.push({ d, fill, fillRule: 'evenodd' })
  }
  return paths
}
/**
 * Layer B — 真实模型驱动的内部结构细节提取（本轮目标）。
 *
 * 思路（调查 Maus 顶面 z 分布后确定）：
 * - hull 顶面存在多个高度层（主甲板 z≈2.2 / 过渡 1.0-1.6 / 裙板 0.4-0.9）；
 * - 对每个 triangle 用法线判定 top-facing，按高度聚类成"主要表面区域"；
 * - 顶面内部边按 高度差/法线差 提取"主要结构边界"；
 * - 全部经过屏幕空间过滤（marker 28px → 1px ≈ 11.4 SVG units）。
 * 禁止输出 wireframe（边数量与长度受阈值约束）。
 */

/**
 * 三角形法线（未归一化向量 [nx,ny,nz]）。
 */
export function triangleNormal(a, b, c) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2]
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2]
  return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx]
}

/**
 * 提取 top-facing 主要表面区域（高度层聚类 + union）。
 *
 * @param {number[][][]} triangles3d  [[[x,y,z],...], ...]
 * @param {object} opts { topFacingCos=0.35, zTolerance=0.15, minAreaM2=0.15 }
 *   topFacingCos: normal.z/|normal| 阈值（0.35 ≈ 70° 内视为顶面）；
 *   zTolerance:   高度层聚类容差（层间 gap 超过则分层，模型米）；
 *   minAreaM2:    区域最小投影面积（模型平方米），过滤碎块。
 * @returns {Array<{ z: number, polys: Array<{ring, holes}>, areaM2: number }>}
 */
export function extractTopSurfaces(triangles3d, opts = {}) {
  const topFacingCos = opts.topFacingCos ?? 0.35
  const zTolerance = opts.zTolerance ?? 0.15
  const minAreaM2 = opts.minAreaM2 ?? 0.15
  // 1) top-facing 筛选 + 重心 z
  const faces = []
  for (const tri of triangles3d) {
    const n = triangleNormal(tri[0], tri[1], tri[2])
    const len = Math.hypot(n[0], n[1], n[2])
    if (len < 1e-12) continue
    const nz = n[2] / len
    if (nz <= topFacingCos) continue
    const cz = (tri[0][2] + tri[1][2] + tri[2][2]) / 3
    faces.push({ tri, z: cz })
  }
  // 2) 高度聚类（按 z 排序，gap > zTolerance 分层）
  faces.sort((a, b) => a.z - b.z)
  const layers = []
  for (const f of faces) {
    const last = layers[layers.length - 1]
    if (last && f.z - last.z <= zTolerance) last.faces.push(f)
    else layers.push({ z: f.z, faces: [f] })
  }
  // 3) 每层投影 union；每个 polygon 单独面积过滤（防碎片混入）
  const out = []
  for (const layer of layers) {
    const tris2d = layer.faces.map((f) => f.tri.map((p) => [p[0], p[1]]))
    const polys = unionTriangles(tris2d)
    if (polys.length === 0) continue
    const kept = []
    let area = 0
    for (const poly of polys) {
      const a = ringArea(poly.ring)
      if (a < minAreaM2) continue
      kept.push(poly)
      area += a
    }
    if (kept.length === 0) continue
    out.push({ z: +layer.z.toFixed(2), polys: kept, areaM2: +area.toFixed(3) })
  }
  return out
}

/** 2D ring 面积（Shoelace，正值）。 */
export function ringArea(ring) {
  let area = 0
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]
    const q = ring[(i + 1) % ring.length]
    area += p[0] * q[1] - q[0] * p[1]
  }
  return Math.abs(area) / 2
}

/**
 * 提取顶面内部"主要结构边界"（高度差 / 法线差）。
 * 共享边去重；只输出强结构边（非 wireframe）。
 *
 * @param {number[][][]} triangles3d
 * @param {object} opts { topFacingCos=0.35, heightDeltaM=0.15, normalDeltaCos=0.92, minEdgeLenM=0.5 }
 * @returns {Array<{ p1: [x,y], p2: [x,y], reason: string }>} 投影后的 2D 边（模型坐标）
 */
export function extractMajorEdges(triangles3d, opts = {}) {
  const topFacingCos = opts.topFacingCos ?? 0.35
  const heightDeltaM = opts.heightDeltaM ?? 0.15
  const normalDeltaCos = opts.normalDeltaCos ?? 0.92
  const minEdgeLenM = opts.minEdgeLenM ?? 0.5
  // 三角形索引 → 法线/重心 z/投影边
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
  // 边表（按 3D 顶点坐标归一化 key）
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
    if (owners.length < 2) continue // 外轮廓边交给 Layer A
    const lenM = Math.hypot(a[0] - b[0], a[1] - b[1])
    if (lenM < minEdgeLenM) continue
    // 按 top-facing / 非 top-facing 邻居分组（一条边可被 >2 个三角形共享）
    const topOwners = owners.filter((i) => tris[i].nz > topFacingCos)
    const nonTopOwners = owners.filter((i) => tris[i].nz <= topFacingCos)
    let reason = null
    if (topOwners.length >= 1 && nonTopOwners.length >= 1) {
      // 顶面边缘边：顶面 + 垂直壁/非顶面邻居 → 平台/甲板边缘
      // （engine deck 边界、甲板台肩、屋顶边缘）
      reason = 'surface-edge'
    } else if (topOwners.length >= 2) {
      const t1 = tris[topOwners[0]]
      const t2 = tris[topOwners[1]]
      const heightDelta = Math.abs(t1.z - t2.z)
      const dot = t1.normal[0] * t2.normal[0] + t1.normal[1] * t2.normal[1] + t1.normal[2] * t2.normal[2]
      // 高度差驱动（主判据）；法线突变仅在伴随显著高度差时辅助触发（防密集格栅线）
      if (heightDelta > heightDeltaM) reason = 'height'
      else if (heightDelta > heightDeltaM * 0.6 && dot < normalDeltaCos) reason = 'normal'
    }
    if (!reason) continue
    out.push({ p1: [a[0], a[1]], p2: [b[0], b[1]], reason })
  }
  return out
}

/**
 * 屏幕空间过滤：SVG units 阈值 = minPx × (viewBox 宽 / markerPx)。
 * markerPx 为实际 marker 屏幕尺寸（BattlePlayback 28px 桌面 / 22px 移动端）。
 */
export function minSvgUnits(minPx, viewBoxWidth, markerPx) {
  return minPx * (viewBoxWidth / markerPx)
}

/**
 * top surfaces → SVG fill paths（每层一个区域 path，含 holes）。
 */
export function surfacesToSvgPaths(surfaces, fit, fill) {
  const paths = []
  for (const s of surfaces) {
    paths.push(...silhouetteToSvgPaths(s.polys, fit, fill))
  }
  return paths
}

/**
 * major edges → SVG stroke path（合并为一条 d，多 M 段）。
 */
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