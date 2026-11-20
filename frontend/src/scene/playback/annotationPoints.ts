/** semantic annotation 点：X = 回放 x、Y = 回放 z（canonical 语义）；可选 3D 表面锚点。 */
export interface SemanticPoint {
  x: number
  y: number
  /** session-local 3D 表面锚点高度（0 是合法值） */
  surfaceY?: number
  /** 表面锚点的局部 plane normal */
  surfaceN?: { x: number; y: number; z: number }
}

/** 3D pen annotation（renderer/eraser 共用的 durable centerline；type 收窄在调用侧）。 */
export interface PenAnnotation {
  type: 'pen'
  color?: unknown
  width?: number
  points: SemanticPoint[]
}

/** 语义高度采样（scene terrain 真值；NaN/越界由返回值表达）。 */
export type HeightSampler = (x: number, z: number) => number | null

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
/** 单条笔迹 semantic 输入点上限；scene 达到上限时冻结 stroke。 */
export const ANNOTATION_MAX_INPUT_POINTS = 4096
/** commit 后的 normalized semantic centerline 上限；超出时重采样，不截断尾。 */
export const ANNOTATION_MAX_COMMITTED_POINTS = 4096
/** 单条笔迹 subdivision 输出点预算；预算不足时降密度，不丢尾部。 */
export const ANNOTATION_MAX_PROJECTED_POINTS = 4096
/** miter join 相对 halfWidth 的上限，避免锐角处无限拉长。 */
export const ANNOTATION_MITER_LIMIT = 2.5
/** eraser preview ring 的线段数。 */
export const ANNOTATION_RING_SEGMENTS = 48
/** 横向 adaptive subdivision：midpoint terrain error / 实际 transverse span 触发。 */
export const ANNOTATION_CROSS_MIDPOINT_ERROR = 0.08
export const ANNOTATION_CROSS_MAX_SEGMENT = 0.5
/** 横向最多 33 个 sample（32 个 cross interval）；更长的笔迹由 vertex budget 再降。 */
export const ANNOTATION_MAX_CROSS_SAMPLES = 33
/** 单条 annotation 的 projected vertex 预算；预算不足时降横向密度，不截断 stroke。 */
export const ANNOTATION_MAX_RIBBON_VERTICES = 65536
/** 最终 triangle interior 允许的 maximum penetration（米）；超过就继续 cell refinement。 */
export const ANNOTATION_CLEARANCE_EPS = 0.05
/** Cell refinement 的硬上限；预算耗尽后 unsafe cell 局部断 strip，不输出已知穿地三角形。 */
export const ANNOTATION_MAX_REFINEMENT_ITERATIONS = 6
/** Triangle recursive validation 的 depth/edge/terrain-deviation bounds。 */
export const ANNOTATION_VALIDATION_MAX_DEPTH = 3
export const ANNOTATION_VALIDATION_EDGE_LIMIT = 2
export const ANNOTATION_VALIDATION_DEVIATION_TRIGGER = 0.01
/** 2D cell refinement 可增加的 longitudinal row 上限（与 projected centerline 预算一致）。 */
export const ANNOTATION_MAX_PROJECTED_CENTERLINE_POINTS = 4096
/** 单次 eraser gesture 的 semantic path 点上限；scene 超过后抽稀。 */
export const ANNOTATION_MAX_ERASER_POINTS = 1024

export const EPS = 1e-9
const DUP_EPS = 1e-6

export function numberOr(value: unknown, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

export function sampleOrNull(sampleHeight: HeightSampler | null | undefined, x: number, z: number): number | null {
  if (typeof sampleHeight !== 'function') return null
  const y = sampleHeight(x, z)
  return Number.isFinite(y) ? y : null
}

/** 复制 semantic 点，保留可选的 3D 表面锚点（0 是合法值）。 */
function finiteNormal(n: SemanticPoint['surfaceN']): n is { x: number; y: number; z: number } {
  return !!n && Number.isFinite(n.x) && Number.isFinite(n.y) && Number.isFinite(n.z)
}

function copyNormal(n: SemanticPoint['surfaceN']): SemanticPoint['surfaceN'] {
  return finiteNormal(n) ? { x: n.x, y: n.y, z: n.z } : undefined
}

export function normalizeNormal(n: SemanticPoint['surfaceN']): SemanticPoint['surfaceN'] {
  if (!finiteNormal(n)) return undefined
  const len = Math.hypot(n.x, n.y, n.z)
  if (!(len > 1e-6)) return undefined
  return { x: n.x / len, y: n.y / len, z: n.z / len }
}

function copyPoint(p: SemanticPoint): SemanticPoint {
  const out: SemanticPoint = { x: p.x, y: p.y }
  if (Number.isFinite(p.surfaceY)) out.surfaceY = p.surfaceY
  const normal = copyNormal(p.surfaceN)
  if (normal) out.surfaceN = normal
  return out
}

/** 两端都有 finite surfaceY / surfaceN 才插值；单侧缺失不猜另一侧。 */
export function pointAt(a: SemanticPoint, b: SemanticPoint, t: number): SemanticPoint {
  const out: SemanticPoint = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
  if (a.surfaceY != null && b.surfaceY != null && Number.isFinite(a.surfaceY) && Number.isFinite(b.surfaceY)) {
    out.surfaceY = a.surfaceY + (b.surfaceY - a.surfaceY) * t
  }
  if (finiteNormal(a.surfaceN) && finiteNormal(b.surfaceN)) {
    const an = a.surfaceN
    const bn = b.surfaceN
    out.surfaceN = normalizeNormal({
      x: an.x + (bn.x - an.x) * t,
      y: an.y + (bn.y - an.y) * t,
      z: an.z + (bn.z - an.z) * t,
    })
  }
  return out
}

/**
 * 过滤非有限点、连续重复点，并把单点/空输入归一成 []。
 * 不重新排序、不插值；保序是 semantic eraser 断段语义的前提。
 */
export function sanitizePoints(points: readonly (SemanticPoint | null | undefined)[] | null | undefined, { maxPoints = ANNOTATION_MAX_INPUT_POINTS as number | null }: { maxPoints?: number | null } = {}): SemanticPoint[] {
  if (!Array.isArray(points)) return []
  const finiteLimit = typeof maxPoints === 'number' && Number.isFinite(maxPoints) && maxPoints >= 2
  const limit: number = finiteLimit ? Math.floor(maxPoints as number) : (maxPoints == null || maxPoints === Infinity ? Infinity : ANNOTATION_MAX_INPUT_POINTS)
  const out: SemanticPoint[] = []
  for (const p of points) {
    const x = Number(p && p.x)
    const y = Number(p && p.y)
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    const prev = out[out.length - 1]
    if (prev && Math.hypot(x - prev.x, y - prev.y) <= DUP_EPS) {
      // 同一 XZ 从 terrain 跨到 bridge 时，后一个点的锚点不能因去重被丢掉。
      if (!Number.isFinite(prev.surfaceY) && Number.isFinite(p.surfaceY)) prev.surfaceY = Number(p.surfaceY)
      if (!prev.surfaceN) {
        const normal = normalizeNormal(p.surfaceN)
        if (normal) prev.surfaceN = normal
      }
      continue
    }
    const next: SemanticPoint = { x, y }
    if (Number.isFinite(p.surfaceY)) next.surfaceY = Number(p.surfaceY)
    const normal = normalizeNormal(p.surfaceN)
    if (normal) next.surfaceN = normal
    out.push(next)
    if (Number.isFinite(limit) && out.length >= limit) break
  }
  return out.length >= 2 ? out : []
}

/** 等距重采样（保留首尾）；只用于预算不足时的降密度，不丢整段尾部。 */
function resampleByIndex(points: SemanticPoint[], limit: number): SemanticPoint[] {
  if (limit >= points.length) return points.map((p) => ({ ...p }))
  // anchor-state transition 是 topology boundary：降密度也不得跳过它。
  // 必须同时保护 transition 两侧 i-1 / i；只保 i 会在桥尾把最后一个 anchor 删掉。
  const anchored = (p: SemanticPoint): boolean => Number.isFinite(p.surfaceY)
  const mandatorySet = new Set([0, points.length - 1])
  const transitionPairs = []
  for (let i = 1; i < points.length; i++) {
    if (anchored(points[i]) !== anchored(points[i - 1])) {
      mandatorySet.add(i - 1)
      mandatorySet.add(i)
      transitionPairs.push([i - 1, i])
    }
  }
  const mandatory = [...mandatorySet].sort((a, b) => a - b)
  if (limit <= mandatory.length) {
    // 预算连 mandatory 都放不下时，至少保住 first/last 与尽可能多的 transition pair；
    // 绝不能简单 prefix 丢掉尾点。优先保靠近尾部的 pair（最接近当前 stroke 的跨层点）。
    const picked = new Set([0, points.length - 1])
    for (let t = transitionPairs.length - 1; t >= 0; t--) {
      for (const idx of transitionPairs[t]) {
        if (picked.size >= limit) break
        if (idx !== 0 && idx !== points.length - 1) picked.add(idx)
      }
    }
    for (const idx of mandatory) {
      if (picked.size >= limit) break
      picked.add(idx)
    }
    return [...picked].sort((a, b) => a - b).slice(0, limit).map((idx) => ({ ...points[idx] }))
  }
  const extra = limit - mandatory.length
  const spans = []
  let totalSpan = 0
  for (let i = 1; i < mandatory.length; i++) {
    const span = mandatory[i] - mandatory[i - 1]
    spans.push({ a: mandatory[i - 1], b: mandatory[i], span, take: 0 })
    totalSpan += span
  }
  if (totalSpan <= 0) return points.slice(0, limit).map((p) => ({ ...p }))
  let remaining = extra
  for (const s of spans) {
    s.take = Math.floor((extra * s.span) / totalSpan)
    remaining -= s.take
  }
  // Largest-remainder allocation keeps the output exactly at limit.
  const order = [...spans].sort((x, y) => (y.span * extra) % totalSpan - (x.span * extra) % totalSpan)
  for (let i = 0; i < remaining; i++) order[i % order.length].take++
  const out = [{ ...points[0] }]
  for (const s of spans) {
    for (let j = 1; j <= s.take; j++) {
      const idx = s.a + Math.round(((s.b - s.a) * j) / (s.take + 1))
      out.push({ ...points[idx] })
    }
    out.push({ ...points[s.b] })
  }
  return out
}

/**
 * 在两个 semantic 点之间做 adaptive subdivision：
 * - world XZ 距离超过 maxSegment；
 * - 或 centerline 中点地形高度与两端线性插值差超过 midpointError。
 * sampleHeight 返回 null 时不做误差细分（空洞交给 ribbon strip break），但仍可因距离细分。
 *
 * 输入上限与输出预算分离：maxInputPoints 是 semantic 输入 cap；maxPoints 是 projected 输出
 * budget。输出预算不足时按 segment 长度分配额外细分点，并始终保留每个输入 segment 的终点，
 * 因此首点、尾点和完整 span 都不会被 prefix truncation 丢掉；最多在密度上降级。
 */
export function subdividePolyline(points: readonly (SemanticPoint | null | undefined)[] | null | undefined, sampleHeight: HeightSampler | null | undefined, {
  maxSegment = ANNOTATION_MAX_SEGMENT,
  midpointError = ANNOTATION_MIDPOINT_ERROR,
  maxDepth = ANNOTATION_MAX_DEPTH,
  maxPoints = ANNOTATION_MAX_PROJECTED_POINTS,
  maxInputPoints = ANNOTATION_MAX_INPUT_POINTS as number | null,
}: {
  maxSegment?: number
  midpointError?: number
  maxDepth?: number
  maxPoints?: number
  maxInputPoints?: number | null
} = {}): SemanticPoint[] {
  const clean = sanitizePoints(points, { maxPoints: maxInputPoints })
  if (clean.length < 2) return []
  const limit = Number.isFinite(maxPoints) && maxPoints >= 2 ? Math.floor(maxPoints) : ANNOTATION_MAX_PROJECTED_POINTS
  // 只允许两个点时无法再细分；保留首尾端点，不能返回空导致整条笔迹消失。
  if (limit <= 2) return [{ ...clean[0] }, { ...clean[clean.length - 1] }]
  if (clean.length >= limit) return resampleByIndex(clean, limit)

  const seg = numberOr(maxSegment, ANNOTATION_MAX_SEGMENT)
  const tol = numberOr(midpointError, ANNOTATION_MIDPOINT_ERROR)
  const depthLimit = Math.max(0, Math.floor(numberOr(maxDepth, ANNOTATION_MAX_DEPTH)))
  const lengths = []
  let totalLength = 0
  for (let i = 1; i < clean.length; i++) {
    const len = Math.hypot(clean[i].x - clean[i - 1].x, clean[i].y - clean[i - 1].y)
    lengths.push(len)
    totalLength += len
  }
  const totalExtra = Math.max(0, limit - clean.length)
  const out = [{ ...clean[0] }]

  const subdivideSegment = (a: SemanticPoint, b: SemanticPoint, depth: number, budget: number): void => {
    let used = 0
    const recurse = (x: SemanticPoint, y: SemanticPoint, d: number): void => {
      const dx = y.x - x.x
      const dz = y.y - x.y
      const dist = Math.hypot(dx, dz)
      let split = dist > seg && d < depthLimit
      // 两端都锚定在场景表面时，midpoint 属于同一层，不得再按 terrain 跳动细分。
      const anchored = Number.isFinite(x.surfaceY) && Number.isFinite(y.surfaceY)
      if (!split && !anchored) {
        const sa = sampleOrNull(sampleHeight, x.x, x.y)
        const sb = sampleOrNull(sampleHeight, y.x, y.y)
        if (sa !== null && sb !== null) {
          const mx = (x.x + y.x) / 2
          const mz = (x.y + y.y) / 2
          const sm = sampleOrNull(sampleHeight, mx, mz)
          if (sm !== null && Math.abs(sm - (sa + sb) / 2) > tol && d < depthLimit) split = true
        }
      }
      if (split && used < budget) {
        used++
        const mid = pointAt(x, y, 0.5)
        recurse(x, mid, d + 1)
        recurse(mid, y, d + 1)
        return
      }
      // 预算耗尽也一定 append segment 终点：完整跨度优先于密度。
      out.push(copyPoint(y))
    }
    recurse(a, b, depth)
  }

  for (let i = 1; i < clean.length; i++) {
    const isLast = i === clean.length - 1
    const remainingSlots = limit - out.length
    const proportional = totalLength > 0
      ? Math.floor((totalExtra * lengths[i - 1]) / totalLength)
      : 0
    const budget = Math.max(0, Math.min(remainingSlots - 1, isLast ? remainingSlots - 1 : proportional))
    subdivideSegment(clean[i - 1], clean[i], 0, budget)
  }
  return out.length >= 2 ? out : []
}

/**
 * 轻量 semantic XZ 平滑：一次 Chaikin corner cutting（默认 strength=0.2），只处理 x/y，
 * 不接触 world Y。首尾点保留，输出始终落在相邻输入 segment 的包围盒内（不会越出战场）。
 */
export function smoothPolyline(points: readonly (SemanticPoint | null | undefined)[] | null | undefined, { iterations = 1, strength = 0.2 }: { iterations?: number; strength?: number } = {}): SemanticPoint[] {
  let current = sanitizePoints(points, { maxPoints: null })
  if (current.length < 3) return current
  const rounds = Math.max(0, Math.floor(numberOr(iterations, 1)))
  const s = Math.max(0, Math.min(0.49, numberOr(strength, 0.2)))
  const anchored = (p: SemanticPoint): boolean => Number.isFinite(p.surfaceY)
  const chaikinRun = (run: SemanticPoint[]): SemanticPoint[] => {
    if (run.length < 3) return run.map((p) => ({ ...p }))
    const out = [{ ...run[0] }]
    for (let i = 1; i < run.length; i++) {
      const a = run[i - 1]
      const b = run[i]
      out.push(pointAt(a, b, s))
      out.push(pointAt(a, b, 1 - s))
    }
    out.push({ ...run[run.length - 1] })
    return out
  }
  for (let round = 0; round < rounds; round++) {
    const next: SemanticPoint[] = []
    let start = 0
    for (let i = 1; i <= current.length; i++) {
      // anchor-state transition 是 topology boundary：terrain run 与 surface-anchored run
      // 分开做 Chaikin，边界控制点原样保留；否则第一个 bridge anchor 会被平滑吃掉。
      if (i === current.length || anchored(current[i]) !== anchored(current[start])) {
        next.push(...chaikinRun(current.slice(start, i)))
        start = i
      }
    }
    current = next
  }
  return current
}

/**
 * Commit boundary 的唯一 semantic normalizer：sanitize → light Chaikin smoothing →
 * committed budget resample。首尾/完整 span 保留；返回的 points 就是 renderer 与
 * eraser 共同消费的 durable centerline，renderer 不再二次平滑。
 */
export function normalizePenPoints(points: readonly (SemanticPoint | null | undefined)[] | null | undefined): SemanticPoint[] {
  const clean = sanitizePoints(points, { maxPoints: null })
  if (clean.length < 3) return clean.map((p) => ({ ...p }))
  const smoothed = smoothPolyline(clean)
  return smoothed.length > ANNOTATION_MAX_COMMITTED_POINTS
    ? resampleByIndex(smoothed, ANNOTATION_MAX_COMMITTED_POINTS)
    : smoothed
}
