import polygonClipping from 'polygon-clipping'

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

/** 模型坐标点 → SVG 坐标（0° 车头朝 12 点：SVG y = -模型 y）。 */
export function toSvg(p, fit) {
  return { x: p.x * fit.scale + fit.tx, y: -p.y * fit.scale + fit.ty }
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
 *
 * 2026-08-18 修复：polygon-clipping 的 ring 可能含相邻重复点（含闭合处首尾重复），
 * 重复点会使叉积退化 → 真实角点被误删（Maus glacis 全宽带塌成细条、turret 环带塌成发丝）。
 * 先按坐标去重再简化，保证真实几何不被破坏。
 */
export function simplifyRing(ring, tolerance = 1e-6) {
  if (ring.length < 4) return ring
  // 相邻重复点去重（含闭合处首尾重复：先去掉尾部与首点相同的点）
  const pts = []
  for (const p of ring) {
    const last = pts[pts.length - 1]
    if (!last || Math.abs(p[0] - last[0]) > 1e-9 || Math.abs(p[1] - last[1]) > 1e-9) pts.push(p)
  }
  if (pts.length > 1) {
    const f = pts[0]
    const l = pts[pts.length - 1]
    if (Math.abs(f[0] - l[0]) <= 1e-9 && Math.abs(f[1] - l[1]) <= 1e-9) pts.pop()
  }
  if (pts.length < 4) return pts
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const dot = (o, a, b) => (a[0] - o[0]) * (b[0] - o[0]) + (a[1] - o[1]) * (b[1] - o[1])
  const out = []
  for (let i = 0; i < pts.length; i++) {
    const prev = pts[(i - 1 + pts.length) % pts.length]
    const cur = pts[i]
    const next = pts[(i + 1) % pts.length]
    const c = cross(prev, cur, next)
    const d = dot(prev, next, cur) // cur 是否在 prev..next 之间
    if (Math.abs(c) > tolerance || d < 0) out.push(cur)
  }
  // 兜底：全部被删时保留去重后的点
  return out.length >= 3 ? out : pts
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
