// 3D Playback 标注的纯几何：terrain-conforming pen ribbon 与 eraser ring。
//
// 坐标约定：本模块只认 scene-map XZ（x 右、z 北），输出 vertex Y = sampleHeight(x,z) + lift。
// semantic(replay) XZ 与 scene 的 x 取负由 playbackScene 的 adapter 负责；annotation SSOT
// 永远不存世界 Y，也不在这里解释 replay 坐标语义。
//
// 初始阈值来自 Step 0 synthetic deviation/cost 实测（512²、600m span、camera (0,180,220)）；
// 真实地图由人工验收后再调，不在模块里冒充最终产品值。

/** 笔迹离地 lift（米）。低于地形 LOD 插值误差会让 ribbon 扎进 terrain。 */
export const ANNOTATION_LIFT = 0.08
/** adaptive subdivision 的硬最大段长（米）。 */
export const ANNOTATION_MAX_SEGMENT = 2
/** centerline 中点相对两端线性插值的最大允许误差（米）。 */
export const ANNOTATION_MIDPOINT_ERROR = 0.08
/** 递归细分最大深度（2^6 = worst case）。 */
export const ANNOTATION_MAX_DEPTH = 6
/** 单条笔迹 semantic 点上限；scene 达到上限时冻结 stroke。 */
export const ANNOTATION_MAX_POINTS = 4096
/** miter join 相对 halfWidth 的上限，避免锐角处无限拉长。 */
export const ANNOTATION_MITER_LIMIT = 2.5
/** eraser preview ring 的线段数。 */
export const ANNOTATION_RING_SEGMENTS = 48
/** 单次 eraser gesture 的 semantic path 点上限；scene 超过后抽稀。 */
export const ANNOTATION_MAX_ERASER_POINTS = 1024

const EPS = 1e-9
const DUP_EPS = 1e-6

function numberOr(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function sampleOrNull(sampleHeight, x, z) {
  if (typeof sampleHeight !== 'function') return null
  const y = sampleHeight(x, z)
  return Number.isFinite(y) ? y : null
}

/**
 * 过滤非有限点、连续重复点，并把单点/空输入归一成 []。
 * 不重新排序、不插值；保序是 semantic eraser 断段语义的前提。
 */
export function sanitizePoints(points, { maxPoints = ANNOTATION_MAX_POINTS } = {}) {
  if (!Array.isArray(points)) return []
  const limit = Number.isFinite(maxPoints) && maxPoints >= 2 ? Math.floor(maxPoints) : ANNOTATION_MAX_POINTS
  const out = []
  for (const p of points) {
    const x = Number(p && p.x)
    const y = Number(p && p.y)
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    const prev = out[out.length - 1]
    if (prev && Math.hypot(x - prev.x, y - prev.y) <= DUP_EPS) continue
    out.push({ x, y })
    if (out.length >= limit) break
  }
  return out.length >= 2 ? out : []
}

/**
 * 在两个 semantic 点之间做 adaptive subdivision：
 * - world XZ 距离超过 maxSegment；
 * - 或 centerline 中点地形高度与两端线性插值差超过 midpointError。
 * sampleHeight 返回 null 时不做误差细分（空洞交给 ribbon strip break），但仍可因距离细分。
 * 返回包含首尾端点的点列；上限 maxPoints（达到上限后提前结束，保证有界）。
 */
export function subdividePolyline(points, sampleHeight, {
  maxSegment = ANNOTATION_MAX_SEGMENT,
  midpointError = ANNOTATION_MIDPOINT_ERROR,
  maxDepth = ANNOTATION_MAX_DEPTH,
  maxPoints = ANNOTATION_MAX_POINTS,
} = {}) {
  const clean = sanitizePoints(points, { maxPoints })
  if (clean.length < 2) return []
  const limit = Number.isFinite(maxPoints) && maxPoints >= 2 ? Math.floor(maxPoints) : ANNOTATION_MAX_POINTS
  // 只允许两个点时无法再细分；保留首尾端点，不能返回空导致整条笔迹消失。
  if (limit <= 2) return [{ ...clean[0] }, { ...clean[clean.length - 1] }]
  const seg = numberOr(maxSegment, ANNOTATION_MAX_SEGMENT)
  const tol = numberOr(midpointError, ANNOTATION_MIDPOINT_ERROR)
  const depthLimit = Math.max(0, Math.floor(numberOr(maxDepth, ANNOTATION_MAX_DEPTH)))
  const out = [{ ...clean[0] }]

  const recurse = (a, b, depth) => {
    if (out.length >= limit) return
    const dx = b.x - a.x
    const dz = b.y - a.y
    const dist = Math.hypot(dx, dz)
    let split = dist > seg && depth < depthLimit
    if (!split) {
      const sa = sampleOrNull(sampleHeight, a.x, a.y)
      const sb = sampleOrNull(sampleHeight, b.x, b.y)
      if (sa !== null && sb !== null) {
        const mx = (a.x + b.x) / 2
        const mz = (a.y + b.y) / 2
        const sm = sampleOrNull(sampleHeight, mx, mz)
        if (sm !== null && Math.abs(sm - (sa + sb) / 2) > tol && depth < depthLimit) split = true
      }
    }
    if (split) {
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      recurse(a, mid, depth + 1)
      recurse(mid, b, depth + 1)
      return
    }
    if (out.length < limit) out.push({ x: b.x, y: b.y })
  }

  for (let i = 1; i < clean.length && out.length < limit; i++) recurse(clean[i - 1], clean[i], 0)
  return out.length >= 2 ? out.slice(0, limit) : []
}

function unitDirection(a, b) {
  const dx = b.x - a.x
  const dz = b.y - a.y
  const len = Math.hypot(dx, dz)
  if (!(len > EPS)) return null
  return { x: dx / len, z: dz / len }
}

/**
 * committed pen -> 贴地 ribbon。每个语义点生成左右两个边缘点：
 *   left  = p + normal * halfWidth * miterScale
 *   right = p - normal * halfWidth * miterScale
 * 两个边缘点分别采样 terrain，绝不只采 centerline。任一边缘采样为 null 时该点断开 strip。
 * 返回 { strips:[{positions,indices}], pointCount } 或 null。
 */
export function buildPenRibbon(annotation, {
  sampleHeight,
  lift = ANNOTATION_LIFT,
  maxSegment = ANNOTATION_MAX_SEGMENT,
  midpointError = ANNOTATION_MIDPOINT_ERROR,
  maxDepth = ANNOTATION_MAX_DEPTH,
  maxPoints = ANNOTATION_MAX_POINTS,
} = {}) {
  if (!annotation || annotation.type !== 'pen') return null
  if (typeof sampleHeight !== 'function') return null
  const width = Number(annotation.width)
  if (!Number.isFinite(width) || width <= 0) return null
  const points = subdividePolyline(annotation.points, sampleHeight, { maxSegment, midpointError, maxDepth, maxPoints })
  if (points.length < 2) return null
  const half = width / 2
  const liftValue = numberOr(lift, ANNOTATION_LIFT)
  const left = []
  const right = []
  const valid = []

  for (let i = 0; i < points.length; i++) {
    const prev = points[i - 1]
    const cur = points[i]
    const next = points[i + 1]
    const dirIn = prev ? unitDirection(prev, cur) : null
    const dirOut = next ? unitDirection(cur, next) : null
    let dx = 0
    let dz = 0
    let miter = 1
    if (dirIn && dirOut) {
      dx = dirIn.x + dirOut.x
      dz = dirIn.z + dirOut.z
      const len = Math.hypot(dx, dz)
      if (len <= 1e-6) {
        // 180° 折返/几乎相反：用 outgoing 方向兜底，保持有限而不是除以 0。
        dx = dirOut.x
        dz = dirOut.z
      } else {
        dx /= len
        dz /= len
      }
      const cosT = Math.max(-1, Math.min(1, dirIn.x * dirOut.x + dirIn.z * dirOut.z))
      const cosHalf = Math.sqrt(Math.max(1e-6, (1 + cosT) / 2))
      miter = Math.min(ANNOTATION_MITER_LIMIT, 1 / Math.max(0.4, cosHalf))
    } else if (dirIn) {
      dx = dirIn.x
      dz = dirIn.z
    } else if (dirOut) {
      dx = dirOut.x
      dz = dirOut.z
    } else {
      return null
    }
    const nx = -dz
    const nz = dx
    const lx = cur.x + nx * half * miter
    const lz = cur.y + nz * half * miter
    const rx = cur.x - nx * half * miter
    const rz = cur.y - nz * half * miter
    const ly = sampleOrNull(sampleHeight, lx, lz)
    const ry = sampleOrNull(sampleHeight, rx, rz)
    left.push(ly === null ? null : { x: lx, y: ly + liftValue, z: lz })
    right.push(ry === null ? null : { x: rx, y: ry + liftValue, z: rz })
    valid.push(ly !== null && ry !== null)
  }

  const strips = []
  let i = 0
  while (i < points.length) {
    if (!valid[i]) { i++; continue }
    let j = i
    while (j + 1 < points.length && valid[j + 1]) j++
    if (j > i) {
      const count = j - i + 1
      const positions = new Float32Array(count * 2 * 3)
      const indices = []
      for (let k = 0; k < count; k++) {
        const L = left[i + k]
        const R = right[i + k]
        const o = k * 6
        positions[o] = L.x
        positions[o + 1] = L.y
        positions[o + 2] = L.z
        positions[o + 3] = R.x
        positions[o + 4] = R.y
        positions[o + 5] = R.z
        if (k > 0) {
          const lp = (k - 1) * 2
          const rp = lp + 1
          const lc = k * 2
          const rc = lc + 1
          indices.push(lp, rp, lc, rp, rc, lc)
        }
      }
      strips.push({ positions, indices: new Uint32Array(indices) })
    }
    i = j + 1
  }
  if (!strips.length) return null
  return { strips, pointCount: points.length }
}

/**
 * eraser 预览圆环：只用于 scene 的 LineLoop，不进 annotation state/history。
 * 边缘采样失败（出地形）时回退 center 高度，保证 ring 不会缺段；这是预览 affordance，
 * 不是 durable geometry。
 */
export function buildEraserRing(center, radius, sampleHeight, {
  segments = ANNOTATION_RING_SEGMENTS,
  lift = ANNOTATION_LIFT / 2,
} = {}) {
  if (!center || !Number.isFinite(Number(center.x)) || !Number.isFinite(Number(center.y))) return null
  const r = Number(radius)
  if (!Number.isFinite(r) || r <= 0 || typeof sampleHeight !== 'function') return null
  const n = Math.max(8, Math.min(128, Math.floor(numberOr(segments, ANNOTATION_RING_SEGMENTS))))
  const cx = Number(center.x)
  const cz = Number(center.y)
  const centerY = sampleOrNull(sampleHeight, cx, cz)
  const liftValue = numberOr(lift, ANNOTATION_LIFT / 2)
  const positions = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    const angle = (i / n) * Math.PI * 2
    const x = cx + Math.cos(angle) * r
    const z = cz + Math.sin(angle) * r
    const y = sampleOrNull(sampleHeight, x, z)
    positions[i * 3] = x
    positions[i * 3 + 1] = (y === null ? (centerY === null ? 0 : centerY) : y) + liftValue
    positions[i * 3 + 2] = z
  }
  return { positions, segments: n }
}
