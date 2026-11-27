import polygonClipping from 'polygon-clipping'

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

export function toSvg(p, fit) {
  return { x: p.x * fit.scale + fit.tx, y: -p.y * fit.scale + fit.ty }
}

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

export function unionTriangles(triangles2d) {
  const polys = triangles2d.map(([a, b, c]) => [[a, b, c, a]])
  if (polys.length === 0) return []
  const result = polygonClipping.union(...polys)
  return result.map((poly) => ({
    ring: poly[0],
    holes: poly.slice(1),
  }))
}

export function simplifyRing(ring, tolerance = 1e-6) {
  if (ring.length < 4) return ring
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
    const d = dot(prev, next, cur)
    if (Math.abs(c) > tolerance || d < 0) out.push(cur)
  }
  return out.length >= 3 ? out : pts
}


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
