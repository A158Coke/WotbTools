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

/** SVG 文档（viewBox 0 0 W H）。
 * 支持 detail-level grouping（高保真资产为未来 runtime LOD 准备结构）：
 *   svgDocument({ groups: [{ group: 'vehicle-primary', paths: [...] }, ...] }, viewBox)
 * 输出：
 *   <g class="vehicle-primary">...</g>
 * 也兼容平铺 paths（旧调用）。
 */
export function svgDocument(input, viewBox) {
  const emitPath = (p) => {
    const attrs = [`d="${p.d}"`]
    if (p.fill) attrs.push(`fill="${p.fill}"`)
    if (p.stroke) attrs.push(`stroke="${p.stroke}"`)
    if (p.strokeWidth) attrs.push(`stroke-width="${p.strokeWidth}"`)
    if (p.fillRule) attrs.push(`fill-rule="${p.fillRule}"`)
    return `  <path ${attrs.join(' ')}/>`
  }
  const groups = Array.isArray(input) ? [{ group: null, paths: input }] : input.groups
  const body = groups
    .map(({ group, paths }) => {
      const inner = paths.map(emitPath).join('\n')
      if (!group) return inner
      return `  <g class="${group}">\n${inner}\n  </g>`
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
 *   bumpDelta:    层内凸起判定的 z 抬升阈值（米）；
 *   minBumpAreaM2: 凸起区域最小投影面积（模型平方米）；
 *   bumpHeightDeltaM: 凸起分量与外部面的共享边高度差下限——低于该值视为
 *     连续斜面面片（tessellation），高于或完全隔离视为真实凸起。
 * @returns {Array<{ z: number, polys: Array<{ring, holes}>, areaM2: number }>}
 *
 * 高保真策略（2026-08-18，HIGH-FIDELITY ASSET）：
 * - 目标 >=90% 可见俯视结构保留：surfaces 全部 top-facing 区域（仅滤极端微小），
 *   bumps 用「连通分量隔离/高度不连续」判据区分真实凸起与斜面面片；
 * - 不按相对占比过滤（真实 hatch 即使只占屋顶 3-5% 也保留）；
 * - 仅删除：sub-pixel 微小 / 连续斜面 tessellation / 极端小面积。
 */
export function extractTopSurfaces(triangles3d, opts = {}) {
  const topFacingCos = opts.topFacingCos ?? 0.35
  const zTolerance = opts.zTolerance ?? 0.5
  const minAreaM2 = opts.minAreaM2 ?? 0.01
  const bumpDelta = opts.bumpDelta ?? 0.08
  const minBumpAreaM2 = opts.minBumpAreaM2 ?? 0.01
  const bumpHeightDeltaM = opts.bumpHeightDeltaM ?? 0.06
  // 1) top-facing 筛选 + 重心 z + 面积
  const faces = []
  for (const tri of triangles3d) {
    const n = triangleNormal(tri[0], tri[1], tri[2])
    const len = Math.hypot(n[0], n[1], n[2])
    if (len < 1e-12) continue
    const nz = n[2] / len
    if (nz <= topFacingCos) continue
    const cz = (tri[0][2] + tri[1][2] + tri[2][2]) / 3
    const [a, b, c] = tri
    const area = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2
    faces.push({ tri, z: cz, area })
  }
  // 2) 粗高度聚类（zTolerance 0.5：连续曲面合并为主层，只分离明显高度带）
  faces.sort((a, b) => a.z - b.z)
  const layers = []
  for (const f of faces) {
    const last = layers[layers.length - 1]
    if (last && f.z - last.z <= zTolerance) last.faces.push(f)
    else layers.push({ z: f.z, faces: [f] })
  }
  // 3D 共享边 key（跨层一致）
  const keyOf = (a, b) => {
    const pa = a.map((v) => v.toFixed(6)).join(',')
    const pb = b.map((v) => v.toFixed(6)).join(',')
    return pa < pb ? pa + '|' + pb : pb + '|' + pa
  }
  // 3) 每层：主平面区域 + 层内凸起（raised regions：hatch / cupola / 甲板凸块）
  const out = []
  for (const layer of layers) {
    const facesL = layer.faces
    // 面积加权平均 z（主面主导，避免小凸起抬高均值导致漏检）
    let zs = 0
    let ws = 0
    for (const f of facesL) { zs += f.z * f.area; ws += f.area }
    const zMeanFinal = ws > 0 ? zs / ws : 0
    const bumpThreshold = zMeanFinal + bumpDelta
    const bumpIdx = []
    const mainFaces = []
    for (let i = 0; i < facesL.length; i++) {
      if (facesL[i].z > bumpThreshold) bumpIdx.push(i)
      else mainFaces.push(facesL[i])
    }
    // 层内共享边邻接（3D 边，跨 top/non-top 邻居也记录——bump 判据需要与分量外
    // 所有 top-facing 面比较，区分连续斜面面片与真实凸起）
    const edgeOwners = new Map()
    for (let i = 0; i < facesL.length; i++) {
      const tri = facesL[i].tri
      for (let e = 0; e < 3; e++) {
        const k = keyOf(tri[e], tri[(e + 1) % 3])
        if (!edgeOwners.has(k)) edgeOwners.set(k, [])
        edgeOwners.get(k).push(i)
      }
    }
    const keepPolys = (fs, minA) => {
      const tris2d = fs.map((f) => f.tri.map((p) => [p[0], p[1]]))
      const polys = unionTriangles(tris2d)
      const kept = []
      let area = 0
      for (const poly of polys) {
        const a = ringArea(poly.ring)
        if (a < minA) continue
        kept.push(poly)
        area += a
      }
      return kept.length > 0 ? { kept, area } : null
    }
    const main = keepPolys(mainFaces, minAreaM2)
    if (!main) continue
    const entry = { z: +layer.z.toFixed(2), polys: main.kept, areaM2: +main.area.toFixed(3), bumps: [] }
    if (bumpIdx.length >= 1) {
      // 凸起分量：bump 面经共享边连通（同一层内）
      const inBump = new Set(bumpIdx)
      const visited = new Set()
      const comps = []
      for (const h of bumpIdx) {
        if (visited.has(h)) continue
        const comp = []
        const q = [h]
        visited.add(h)
        while (q.length) {
          const cur = q.pop()
          comp.push(cur)
          const tri = facesL[cur].tri
          for (let e = 0; e < 3; e++) {
            const k = keyOf(tri[e], tri[(e + 1) % 3])
            for (const nb of edgeOwners.get(k) || []) {
              if (inBump.has(nb) && !visited.has(nb)) { visited.add(nb); q.push(nb) }
            }
          }
        }
        comps.push(comp)
      }
      // 分量保留判据：与分量外任何 top-facing 面无共享边（隔离凸起，如 cupola/hatch
      // 隔垂直壁）→ 保留；有共享边但最大高度差 > bumpHeightDeltaM（台阶）→ 保留；
      // 有共享边且高度连续（连续斜面面片，tessellation）→ 剔除。
      const keptComps = []
      for (const comp of comps) {
        let touchesOutside = false
        let maxDzOutside = 0
        for (const fi of comp) {
          const tri = facesL[fi].tri
          for (let e = 0; e < 3; e++) {
            const k = keyOf(tri[e], tri[(e + 1) % 3])
            for (const oj of edgeOwners.get(k) || []) {
              if (comp.includes(oj)) continue
              touchesOutside = true
              maxDzOutside = Math.max(maxDzOutside, Math.abs(facesL[fi].z - facesL[oj].z))
            }
          }
        }
        if (!touchesOutside || maxDzOutside > bumpHeightDeltaM) keptComps.push(comp)
      }
      if (keptComps.length > 0) {
        const keptFaces = keptComps.flat()
        const bump = keepPolys(keptFaces.map((i) => facesL[i]), minBumpAreaM2)
        if (bump) {
          entry.bumps = [{ z: +(zMeanFinal + bumpDelta + 0.05).toFixed(2), polys: bump.kept, areaM2: +bump.area.toFixed(3) }]
        }
      }
    }
    out.push(entry)
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
      // 顶面边缘边：顶面 + 垂直壁邻居 → 平台/甲板边缘。
      // 壁高（非 top-facing 邻居的顶点 z 跨度）必须显著（> heightDeltaM）：
      // 低模斜面网格的面片台阶壁（~0.05-0.1m）是 tessellation，不输出；
      // 用顶点 z 跨度而非三角形重心（重心会把壁高低估一半）。
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
      // 高度差驱动（主判据）；法线突变仅在伴随显著高度差时辅助触发。
      // normalDeltaCos 收紧（~5°）：同一平滑曲面内的面片法线微小差异不算 feature。
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
 * 屏幕空间过滤：SVG units 阈值 = minPx × (viewBox 宽 / markerPx)。
 * markerPx 为实际 marker 屏幕尺寸（BattlePlayback 28px 桌面 / 22px 移动端）。
 * 高保真策略：仅用于 asset-space 微小结构判断（如 minDetailUnits=0.3），
 * 不再按 20-30px marker 过滤真实 detail（runtime LOD 负责小尺寸）。
 */
export function minSvgUnits(minPx, viewBoxWidth, markerPx) {
  return minPx * (viewBoxWidth / markerPx)
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
/**
 * 层内凸起（hatch / cupola / 甲板凸块）→ SVG fill paths。
 */
export function bumpsToSvgPaths(surfaces, fit, fill) {
  const paths = []
  for (const s of surfaces) {
    for (const b of s.bumps) {
      paths.push(...silhouetteToSvgPaths(b.polys, fit, fill))
    }
  }
  return paths
}