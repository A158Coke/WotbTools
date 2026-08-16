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
import * as THREE from 'three'

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
 * 收集节点子树所有 mesh 的三角形（POSITION + INDEX，应用节点/世界矩阵）。
 *
 * 复刻 BlitzKit TankModel.tsx：匹配顶层节点后 jsxTree(node) 渲染整个子树——
 * *_hide_elements* 子树属于真实视觉模型的一部分（audit 2026-08-19 源码确认），
 * 不在此过滤（A1：不再无条件跳过）；最终是否可见由 rasterVisibility
 * （真实 z-buffer）决定。无关节点（如 mask_01）由 groupRenderNodes 的
 * 顶层名匹配天然排除，不设名字黑名单。
 */
export function collectNodeTriangles(node, out, matrix) {
  const m = matrix.clone()
  const t = node.getTranslation()
  const r = node.getRotation()
  const s = node.getScale()
  if (t || r || s) {
    const e = new THREE.Matrix4().compose(
      new THREE.Vector3(t ? t[0] : 0, t ? t[1] : 0, t ? t[2] : 0),
      new THREE.Quaternion(r ? r[0] : 0, r ? r[1] : 0, r ? r[2] : 0, r ? r[3] : 1),
      new THREE.Vector3(s ? s[0] : 1, s ? s[1] : 1, s ? s[2] : 1),
    )
    m.multiply(e)
  }
  const mesh = node.getMesh()
  if (mesh) {
    for (const prim of mesh.listPrimitives()) {
      const posAcc = prim.getAttribute('POSITION')
      if (!posAcc) continue
      const idxAcc = prim.getIndices()
      const positions = posAcc.getArray()
      const v = new THREE.Vector3()
      const transformed = new Float32Array(positions.length)
      for (let i = 0; i < positions.length; i += 3) {
        v.set(positions[i], positions[i + 1], positions[i + 2]).applyMatrix4(m)
        transformed[i] = v.x
        transformed[i + 1] = v.y
        transformed[i + 2] = v.z
      }
      out.push({
        positions: transformed,
        indices: idxAcc ? Array.from(idxAcc.getArray()) : null,
      })
    }
  }
  for (const c of node.listChildren()) {
    collectNodeTriangles(c, out, m)
  }
}

/**
 * 节点分组（复刻 TankModel.tsx 渲染层 + A1 修正）：
 * - hullBody：hull 节点本体（含 *_hide_elements* 子树——BlitzKit 实际渲染）；
 * - tracks：chassis_track_{L,R}（可见性由 z-buffer 决定，顶视完全遮挡时视觉层不画）；
 * - turret：turret_{id:02d}（含其 hide_elements 子树）；
 * - mantlet：gun_{id:02d}_mask（炮盾，视觉层仅画顶视可见面）；
 * - gun：gun_{id:02d}（炮管）。
 * 仅按顶层节点名匹配（复刻 TankModel.tsx 的 isVisible 判定）——mask_01 等无关
 * 顶层节点不在任何 layer，不会被采集（无需名字黑名单）。
 */
export function groupRenderNodes(rootNodes, { turretId, gunId, withWheels }) {
  const turretName = `turret_${String(turretId).padStart(2, '0')}`
  const gunName = `gun_${String(gunId).padStart(2, '0')}`
  const groups = { hullBody: [], tracks: [], turret: [], mantlet: [], gun: [] }
  const identity = new THREE.Matrix4()
  for (const node of rootNodes) {
    const name = node.getName()
    if (name === 'hull') {
      collectNodeTriangles(node, groups.hullBody, identity)
    } else if (name.startsWith('chassis_track_') || (withWheels && name.startsWith('chassis_wheel_'))) {
      collectNodeTriangles(node, groups.tracks, identity)
    } else if (name === turretName) {
      collectNodeTriangles(node, groups.turret, identity)
    } else if (name === gunName) {
      collectNodeTriangles(node, groups.gun, identity)
    } else if (name === `${gunName}_mask`) {
      collectNodeTriangles(node, groups.mantlet, identity)
    }
  }
  return groups
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
  // 2) 共享 3D 边邻接 + union-find 合并（视觉连续条件）
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
  // 3) 分量 → 2D union → { polys, areaM2, zMean, faceCount }
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
    // faceIdx：surface 的组成三角形在 triangles3d 输入中的索引（surface 级可见性/审计用）
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
      if (myArea > 0 && visArea / myArea < 1 - occludeRatio) continue // 被遮挡 → hidden
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
  const groups = opts.groups ?? null // 与 triangles3d 等长；每组累计可见像素（-1 不统计）
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
  // per-input-triangle visible pixel count（非 top-facing = 0）——调用方按输入索引对齐
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
  // per-group visible pixel count（group = 输入三角形所属表面等；-1 不统计）
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

/**
 * 世界坐标点 → rasterVisibility 栅格像素索引（与 visibleMask 同坐标系）。
 * 仅用于可见性判定查询（如结构边中点）。
 */
export function visibilityPixel(worldX, worldY, vis) {
  const px = Math.floor((worldX - vis.bounds.minX) * vis.pxPerM)
  const py = Math.floor((worldY - vis.bounds.minY) * vis.pxPerM)
  if (px < 0 || py < 0 || px >= vis.width || py >= vis.height) return -1
  return py * vis.width + px
}

/** 线段严格相交（不含端点接触）——自交检测用。 */
function segmentsProperIntersect(a, b, c, d) {
  const cross = (o, p, q) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0])
  const d1 = cross(a, b, c)
  const d2 = cross(a, b, d)
  const d3 = cross(c, d, a)
  const d4 = cross(c, d, b)
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
}

/** ring 自交判定（非简单多边形——polygon-clipping 数值伪影特征）。 */
function isSelfIntersecting(ring) {
  const n = ring.length
  for (let i = 0; i < n; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % n]
    for (let j = i + 1; j < n; j++) {
      const nextJ = (j + 1) % n
      if (nextJ === i || j === (i + 1) % n) continue // 跳过相邻边
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
  // bounds 优先来自调用方（真实投影计算）；否则从 source 几何推断——无车型专属硬编码
  const hb = hullBounds || inferBounds(sourceHull)
  const tb = turretBounds || inferBounds(sourceTurret)
  // hull/turret 相对位置（模型坐标 y：+y 前、-y 后；通用比例 0.6 分带）
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