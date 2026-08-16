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

/** SVG 文档（viewBox 0 0 W H；paths: [{ d, fill }]）。 */
export function svgDocument(paths, viewBox) {
  const body = paths
    .map((p) => `  <path d="${p.d}" fill="${p.fill}"/>`)
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
      method: 'collision-glb-topdown-projection',
      viewBox: `0 0 ${viewBox.width} ${viewBox.height}`,
      hullBounds,
      turretBounds,
      gunBounds,
      notes: generationNotes,
    },
  }
}
