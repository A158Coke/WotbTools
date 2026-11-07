// 3D Playback 标注的纯几何：terrain-conforming pen ribbon 与 eraser ring。
//
// 坐标约定：本模块只认 scene-map XZ（x 右、z 北）。无 surfaceY 的 row 输出
// vertex Y = sampleHeight(x,z) + lift；带 surfaceY 的 row 是选中表面层，用锚点高度 +
// surfaceN 的局部 plane 生成倾斜 cross-section（无 normal 时退化为水平截面），不再向下采
// terrain。semantic(replay) XZ 与 scene 的 x 取负由 playbackScene 的 adapter 负责；annotation
// SSOT 仍以 semantic XZ 为 canonical，surfaceY/surfaceN 只是可选的 session-local 锚点。
//
import * as THREE from 'three'
import type { Object3D, Vector3 } from 'three'

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
const ANNOTATION_MAX_SEGMENT = 2
/** centerline 中点相对两端线性插值的最大允许误差（米）。 */
const ANNOTATION_MIDPOINT_ERROR = 0.08
/** 递归细分最大深度（2^6 = worst case）。 */
const ANNOTATION_MAX_DEPTH = 6
/** 单条笔迹 semantic 输入点上限；scene 达到上限时冻结 stroke。 */
export const ANNOTATION_MAX_INPUT_POINTS = 4096
/** commit 后的 normalized semantic centerline 上限；超出时重采样，不截断尾。 */
export const ANNOTATION_MAX_COMMITTED_POINTS = 4096
/** 单条笔迹 subdivision 输出点预算；预算不足时降密度，不丢尾部。 */
const ANNOTATION_MAX_PROJECTED_POINTS = 4096
/** miter join 相对 halfWidth 的上限，避免锐角处无限拉长。 */
export const ANNOTATION_MITER_LIMIT = 2.5
/** eraser preview ring 的线段数。 */
export const ANNOTATION_RING_SEGMENTS = 48
/** 横向 adaptive subdivision：midpoint terrain error / 实际 transverse span 触发。 */
const ANNOTATION_CROSS_MIDPOINT_ERROR = 0.08
const ANNOTATION_CROSS_MAX_SEGMENT = 0.5
/** 横向最多 33 个 sample（32 个 cross interval）；更长的笔迹由 vertex budget 再降。 */
const ANNOTATION_MAX_CROSS_SAMPLES = 33
/** 单条 annotation 的 projected vertex 预算；预算不足时降横向密度，不截断 stroke。 */
const ANNOTATION_MAX_RIBBON_VERTICES = 65536
/** 最终 triangle interior 允许的 maximum penetration（米）；超过就继续 cell refinement。 */
const ANNOTATION_CLEARANCE_EPS = 0.05
/** Cell refinement 的硬上限；预算耗尽后 unsafe cell 局部断 strip，不输出已知穿地三角形。 */
const ANNOTATION_MAX_REFINEMENT_ITERATIONS = 6
/** Triangle recursive validation 的 depth/edge/terrain-deviation bounds。 */
const ANNOTATION_VALIDATION_MAX_DEPTH = 3
const ANNOTATION_VALIDATION_EDGE_LIMIT = 2
const ANNOTATION_VALIDATION_DEVIATION_TRIGGER = 0.01
/** 2D cell refinement 可增加的 longitudinal row 上限（与 projected centerline 预算一致）。 */
const ANNOTATION_MAX_PROJECTED_CENTERLINE_POINTS = 4096
/** 单次 eraser gesture 的 semantic path 点上限；scene 超过后抽稀。 */
export const ANNOTATION_MAX_ERASER_POINTS = 1024

const EPS = 1e-9
const DUP_EPS = 1e-6

function numberOr(value: unknown, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function sampleOrNull(sampleHeight: HeightSampler | null | undefined, x: number, z: number): number | null {
  if (typeof sampleHeight !== 'function') return null
  const y = sampleHeight(x, z)
  return Number.isFinite(y) ? y : null
}

const _hitWorld = new THREE.Matrix4()
const _hitInstance = new THREE.Matrix4()
const _hitNormalMatrix = new THREE.Matrix3()
const _hitNormal = new THREE.Vector3()

/**
 * 命中面的 world normal（InstancedMesh 先乘 instanceMatrix）。
 * 3D annotation pick 的“朝上表面”判据和 anchored cross-section 的局部 plane normal。
 */
/** 结构化命中面（three Intersection 与 playback/annotationSurface 的替身都兼容）。 */
export interface AnnotationHitLike {
  object?: { matrixWorld?: THREE.Matrix4 | null } | null | undefined
  face?: { normal?: { x: number; y: number; z: number } } | null | undefined
  instanceId?: number | null | undefined
}

export function hitWorldNormal(hit: AnnotationHitLike | null | undefined, target: Vector3 | null = null): Vector3 | null {
  if (!hit || !hit.face || !hit.object) return null
  const object = hit.object as (Object3D & { isInstancedMesh?: boolean; getMatrixAt(index: number, matrix: THREE.Matrix4): void }) | null | undefined
  if (!object || !object.matrixWorld) return null
  if (hit.instanceId != null && object.isInstancedMesh && typeof object.getMatrixAt === 'function') {
    object.getMatrixAt(hit.instanceId, _hitInstance)
    _hitWorld.multiplyMatrices(object.matrixWorld, _hitInstance)
  } else {
    _hitWorld.copy(object.matrixWorld)
  }
  const faceNormal = hit.face?.normal
  if (!faceNormal || !Number.isFinite(faceNormal.x)) return null
  _hitNormalMatrix.getNormalMatrix(_hitWorld)
  _hitNormal.copy(faceNormal).applyMatrix3(_hitNormalMatrix).normalize()
  return target ? target.copy(_hitNormal) : _hitNormal
}

export function hitWorldNormalY(hit: AnnotationHitLike | null | undefined): number {
  const normal = hitWorldNormal(hit)
  return normal ? normal.y : 0
}

/** 复制 semantic 点，保留可选的 3D 表面锚点（0 是合法值）。 */
function finiteNormal(n: SemanticPoint['surfaceN']): n is { x: number; y: number; z: number } {
  return !!n && Number.isFinite(n.x) && Number.isFinite(n.y) && Number.isFinite(n.z)
}

function copyNormal(n: SemanticPoint['surfaceN']): SemanticPoint['surfaceN'] {
  return finiteNormal(n) ? { x: n.x, y: n.y, z: n.z } : undefined
}

function normalizeNormal(n: SemanticPoint['surfaceN']): SemanticPoint['surfaceN'] {
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
function pointAt(a: SemanticPoint, b: SemanticPoint, t: number): SemanticPoint {
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

const TRIANGLE_CLEARANCE_SAMPLES = [
  [1 / 3, 1 / 3, 1 / 3],
  [0.5, 0.25, 0.25],
  [0.25, 0.5, 0.25],
  [0.25, 0.25, 0.5],
  [0.5, 0.5, 0],
  [0, 0.5, 0.5],
  [0.5, 0, 0.5],
]

interface RibbonFrame {
  /** semantic 水平坐标（x = 回放 x，z = 回放 y） */
  x: number
  z: number
  /** 横向单位向量（左法线） */
  nx: number
  nz: number
  /** miter 后的半宽（米） */
  half: number
  surfaceY?: number
  normal: { x: number; y: number; z: number } | null
}

function ribbonFrames(points: SemanticPoint[], half: number): RibbonFrame[] | null {
  const frames = []
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
    frames.push({
      x: cur.x, z: cur.y, nx: -dz, nz: dx, half: half * miter,
      surfaceY: Number.isFinite(cur.surfaceY) ? cur.surfaceY : undefined,
      normal: normalizeNormal(cur.surfaceN) || null,
    })
  }
  return frames
}

function ribbonRows(frames: RibbonFrame[], fractions: number[], sampleHeight: HeightSampler | null | undefined, liftValue: number) {
  const rows: Array<Array<{ x: number; y: number; z: number } | null>> = []
  const valid: boolean[] = []
  for (const frame of frames) {
    const row: Array<{ x: number; y: number; z: number } | null> = []
    let rowValid = true
    const anchored = Number.isFinite(frame.surfaceY)
    for (const fraction of fractions) {
      if (anchored) {
        // anchored row：整行落在选中的 surface 局部 plane；无 surfaceN 时退化为水平截面。
        const p = crossPoint3D(frame, fraction, liftValue)
        row.push({ x: p.x, y: p.y, z: p.z })
        continue
      }
      const p = crossPoint(frame, fraction)
      const y = sampleOrNull(sampleHeight, p.x, p.z)
      if (y === null) {
        row.push(null)
        rowValid = false
      } else {
        row.push({ x: p.x, y: y + liftValue, z: p.z })
      }
    }
    rows.push(row)
    valid.push(rowValid)
  }
  return { rows, valid }
}

function triangleClear(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }, c: { x: number; y: number; z: number }, sampleHeight: HeightSampler | null | undefined, clearance: number, depth = 0): boolean {
  const ta = sampleOrNull(sampleHeight, a.x, a.z)
  const tb = sampleOrNull(sampleHeight, b.x, b.z)
  const tc = sampleOrNull(sampleHeight, c.x, c.z)
  if (ta === null || tb === null || tc === null) return false
  let maxDeviation = 0
  for (const [wa, wb, wc] of TRIANGLE_CLEARANCE_SAMPLES) {
    const x = wa * a.x + wb * b.x + wc * c.x
    const y = wa * a.y + wb * b.y + wc * c.y
    const z = wa * a.z + wb * b.z + wc * c.z
    const terrain = sampleOrNull(sampleHeight, x, z)
    // clearance = allowed penetration epsilon，不是“必须高于 terrain 的正 clearance”。
    if (terrain === null || y < terrain - clearance) return false
    maxDeviation = Math.max(maxDeviation, Math.abs(terrain - (wa * ta + wb * tb + wc * tc)))
  }
  const maxEdge = Math.max(
    Math.hypot(a.x - b.x, a.z - b.z),
    Math.hypot(b.x - c.x, b.z - c.z),
    Math.hypot(c.x - a.x, c.z - a.z),
  )
  const converged = maxDeviation <= ANNOTATION_VALIDATION_DEVIATION_TRIGGER
    && maxEdge <= ANNOTATION_VALIDATION_EDGE_LIMIT
  if (converged) return true
  // Depth exhaustion is NOT a proof of safety: not converged + cannot recurse = unresolved/fail closed.
  if (depth >= ANNOTATION_VALIDATION_MAX_DEPTH) return false
  // Recursive sub-triangle validation: hidden terrain between the 7 fixed samples
  // must be probed at smaller scales; spatial/error bounds terminate deterministically.
  const ab = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 }
  const bc = { x: (b.x + c.x) / 2, y: (b.y + c.y) / 2, z: (b.z + c.z) / 2 }
  const ca = { x: (c.x + a.x) / 2, y: (c.y + a.y) / 2, z: (c.z + a.z) / 2 }
  return triangleClear(a, ab, ca, sampleHeight, clearance, depth + 1)
    && triangleClear(ab, b, bc, sampleHeight, clearance, depth + 1)
    && triangleClear(ca, bc, c, sampleHeight, clearance, depth + 1)
    && triangleClear(ab, bc, ca, sampleHeight, clearance, depth + 1)
}

/** 贴地行网格 cell（ribbonRows 的行内条目；null = 采样空洞，row 断 strip）。 */
type RibbonCell = { x: number; y: number; z: number } | null

/** 对最终 triangulation 的两个 triangle 做 interior clearance 检查；失败 cell 会触发 2D refinement。 */
function ribbonCellFailures(rows: RibbonCell[][], valid: boolean[], crossCount: number, sampleHeight: HeightSampler | null | undefined, clearance: number) {
  const failing: Array<{ i: number; j: number }> = []
  let checked = 0
  for (let i = 0; i < rows.length - 1; i++) {
    if (!valid[i] || !valid[i + 1]) continue
    for (let j = 0; j < crossCount - 1; j++) {
      const a = rows[i][j]
      const b = rows[i][j + 1]
      const c = rows[i + 1][j + 1]
      const d = rows[i + 1][j]
      if (!a || !b || !c || !d) continue   // valid 行内 cell 不会是 null；防御性跳过（与 valid 门控同语义）
      checked++
      if (!triangleClear(a, b, d, sampleHeight, clearance)
        || !triangleClear(b, c, d, sampleHeight, clearance)) {
        failing.push({ i, j })
      }
    }
  }
  return { failing, checked }
}

function unitDirection(a: SemanticPoint, b: SemanticPoint) {
  const dx = b.x - a.x
  const dz = b.y - a.y
  const len = Math.hypot(dx, dz)
  if (!(len > EPS)) return null
  return { x: dx / len, z: dz / len }
}

/** Cross sample 上限由单笔 vertex budget 约束；至少 2，最多 33（含 center）。 */
function annotationCrossBudget(pointCount: number): number {
  return Math.max(2, Math.min(ANNOTATION_MAX_CROSS_SAMPLES, Math.floor(ANNOTATION_MAX_RIBBON_VERTICES / Math.max(1, pointCount))))
}

function crossPoint(frame: RibbonFrame, fraction: number) {
  const offset = frame.half * (1 - 2 * fraction)
  return { x: frame.x + frame.nx * offset, z: frame.z + frame.nz * offset }
}

/**
 * Anchored row 的 cross vertex：先保留 canonical semantic XZ offset，再仅用命中局部
 * plane equation 求 Y。不能把 cross vector 投到 plane 后重新 normalize——那会让
 * 斜面上的 XZ visible width 小于 semanticWidthFromSlider 的 map-space width。
 */
function crossPoint3D(frame: RibbonFrame, fraction: number, liftValue: number) {
  const offset = frame.half * (1 - 2 * fraction)
  const x = frame.x + frame.nx * offset
  const z = frame.z + frame.nz * offset
  // anchored row 恒带 finite surfaceY（ribbonFrames 只在 finite 时写入锚点）
  const anchor = frame.surfaceY as number
  let y = anchor
  const n = frame.normal
  if (n && Math.abs(n.y) > 1e-6) {
    y = anchor - (n.x * (x - frame.x) + n.z * (z - frame.z)) / n.y
  }
  return { x, y: y + liftValue, z }
}

/** 在 A/B 中点检测 terrain error 或实际 transverse span（含 miter）。 */
function crossIntervalNeedsSplit(frames: RibbonFrame[], sampleHeight: HeightSampler | null | undefined, fa: number, fb: number): boolean {
  const fm = (fa + fb) / 2
  for (const frame of frames) {
    // anchored row 的 cross 在 surface plane 内；span 必须按 3D 长度判，不能只看水平投影。
    if (Number.isFinite(frame.surfaceY)) {
      const pa = crossPoint3D(frame, fa, 0)
      const pb = crossPoint3D(frame, fb, 0)
      // canonical footprint 是 XZ；Y 只是 plane-derived，不能把斜率算进 width 细分。
      if (Math.hypot(pb.x - pa.x, pb.z - pa.z) > ANNOTATION_CROSS_MAX_SEGMENT) return true
      continue
    }
    const pa = crossPoint(frame, fa)
    const pb = crossPoint(frame, fb)
    const pm = crossPoint(frame, fm)
    const ha = sampleOrNull(sampleHeight, pa.x, pa.z)
    const hb = sampleOrNull(sampleHeight, pb.x, pb.z)
    const hm = sampleOrNull(sampleHeight, pm.x, pm.z)
    if (ha === null || hb === null || hm === null) continue
    if (Math.hypot(pb.x - pa.x, pb.z - pa.z) > ANNOTATION_CROSS_MAX_SEGMENT) return true
    if (Math.abs(hm - (ha + hb) / 2) > ANNOTATION_CROSS_MIDPOINT_ERROR) return true
  }
  return false
}

/** 从 center sample 开始，自适应细分 cross fractions，直到误差合格或 vertex budget 用尽。 */
function adaptiveCrossFractions(frames: RibbonFrame[], sampleHeight: HeightSampler | null | undefined, pointCount: number): number[] {
  const maxSamples = annotationCrossBudget(pointCount)
  if (maxSamples < 3) return [0, 1]
  let fractions = [0, 0.5, 1]
  while (fractions.length < maxSamples) {
    const additions = []
    for (let i = 0; i < fractions.length - 1; i++) {
      if (fractions.length + additions.length >= maxSamples) break
      const a = fractions[i]
      const b = fractions[i + 1]
      if (crossIntervalNeedsSplit(frames, sampleHeight, a, b)) additions.push((a + b) / 2)
    }
    if (!additions.length) break
    fractions = [...fractions, ...additions].sort((a, b) => a - b)
  }
  return fractions
}

/**
 * 地形 LOD 变化后只刷新高度：ribbon 的 XZ 拓扑来自语义点，与 LOD 无关。
 * 每个顶点采样一次，是逐帧可承受的量级；细分校验只在提交时做。
 * 采样不到的顶点保持原高度。
 */
export function reprojectRibbonPositions(positions: Float32Array, sampleHeight: HeightSampler, lift = ANNOTATION_LIFT, anchored?: Uint8Array | boolean[] | null): Float32Array {
  for (let i = 0; i + 2 < positions.length; i += 3) {
    // anchored 顶点属于选中表面层：LOD 重建只刷新 terrain 顶点，锚点高度保持。
    if (anchored && anchored[i / 3]) continue
    const y = sampleHeight(positions[i], positions[i + 2])
    if (y != null && Number.isFinite(y)) positions[i + 1] = y + lift
  }
  return positions
}

/**
 * committed pen -> 贴地 ribbon。每个语义点生成 cross-width grid（center + adaptive fractions），
 * 每行顶点都采样 terrain；任一 cross sample 为 null 时该 row 断开 strip。
 * 最终对每个 cell 的两个 triangle interior 做 clearance validation；失败时同时细分
 * longitudinal row 与 cross fraction，预算耗尽则跳过 unsafe cell（不输出已知穿地 triangle）。
 * 返回 { strips, pointCount, crossCount, vertexCount, vertexBudget, validation } 或 null。
 */
/** 贴地 ribbon 的单条 strip（顶点/索引已按 unsafe-cell 断 strip 处理）。 */
export interface PenRibbonStrip {
  positions: Float32Array
  indices: Uint32Array
  rowCount: number
  crossCount: number
  /** 逐 row 的锚点标记（LOD 重建时锚点行保持表面高度） */
  anchored: Uint8Array
}

export interface PenRibbonResult {
  strips: PenRibbonStrip[]
  pointCount: number
  crossCount: number
  vertexCount: number
  vertexBudget: number
  validation: {
    iterations: number
    cellsChecked: number
    unsafeCells: number
    rowCount: number
    crossCount: number
  }
}

export function buildPenRibbon(annotation: PenAnnotation | null | undefined, {
  sampleHeight,
  lift = ANNOTATION_LIFT,
  maxSegment = ANNOTATION_MAX_SEGMENT,
  midpointError = ANNOTATION_MIDPOINT_ERROR,
  maxDepth = ANNOTATION_MAX_DEPTH,
  maxPoints = ANNOTATION_MAX_PROJECTED_POINTS,
  refine = true,
}: {
  /** 缺省时 buildPenRibbon fail-closed 返回 null（与 JS 同式 typeof 守卫） */
  sampleHeight?: HeightSampler
  lift?: number
  maxSegment?: number
  midpointError?: number
  maxDepth?: number
  maxPoints?: number
  refine?: boolean
} = {}): PenRibbonResult | null {
  if (!annotation || annotation.type !== 'pen') return null
  if (typeof sampleHeight !== 'function') return null
  const width = Number(annotation.width)
  if (!Number.isFinite(width) || width <= 0) return null
  // annotation.points 已是 commit-normalized durable centerline；renderer 只做
  // terrain subdivision + cross-width tessellation，不再修改 semantic centerline。
  const points = subdividePolyline(annotation.points, sampleHeight, {
    maxSegment, midpointError, maxDepth, maxPoints, maxInputPoints: null,
  })
  if (points.length < 2) return null
  const half = width / 2
  const liftValue = numberOr(lift, ANNOTATION_LIFT)
  let rowPoints = points
  let frames = ribbonFrames(rowPoints, half)
  if (!frames) return null
  let fractions = adaptiveCrossFractions(frames, sampleHeight, rowPoints.length)
  let crossCount = fractions.length
  let rows: RibbonCell[][] = []
  let valid: boolean[] = []
  let failures: { failing: Array<{ i: number; j: number }>; checked: number } = { failing: [], checked: 0 }
  let iterations = 0

  for (; iterations <= ANNOTATION_MAX_REFINEMENT_ITERATIONS; iterations++) {
    const built = ribbonRows(frames, fractions, sampleHeight, liftValue)
    rows = built.rows
    valid = built.valid
    if (!refine) break   // 草稿逐点重建，只做一次贴地，不跑逐 cell 校验
    failures = ribbonCellFailures(rows, valid, crossCount, sampleHeight, ANNOTATION_CLEARANCE_EPS)
    if (!failures.failing.length || iterations === ANNOTATION_MAX_REFINEMENT_ITERATIONS) break

    const rowSplits = new Set(failures.failing.map((cell) => cell.i))
    const crossSplits = new Set(failures.failing.map((cell) => cell.j))
    const nextRowCount = rowPoints.length + rowSplits.size
    const nextCrossCount = fractions.length + crossSplits.size
    const canRows = rowSplits.size > 0
      && nextRowCount <= ANNOTATION_MAX_PROJECTED_CENTERLINE_POINTS
      && nextRowCount * fractions.length <= ANNOTATION_MAX_RIBBON_VERTICES
    const canCross = crossSplits.size > 0
      && nextCrossCount <= ANNOTATION_MAX_CROSS_SAMPLES
      && (canRows ? nextRowCount : rowPoints.length) * nextCrossCount <= ANNOTATION_MAX_RIBBON_VERTICES
    if (!canRows && !canCross) break

    let changed = false
    if (canRows) {
      const nextRows = []
      for (let i = 0; i < rowPoints.length; i++) {
        nextRows.push(rowPoints[i])
        if (rowSplits.has(i)) {
          const a = rowPoints[i]
          const b = rowPoints[i + 1]
          nextRows.push(pointAt(a, b, 0.5))
        }
      }
      rowPoints = nextRows
      changed = true
    }
    if (canCross) {
      const nextFractions = new Set(fractions)
      for (const j of crossSplits) nextFractions.add((fractions[j] + fractions[j + 1]) / 2)
      fractions = [...nextFractions].sort((a, b) => a - b)
      crossCount = fractions.length
      changed = true
    }
    if (!changed) break
    if (canRows) {
      frames = ribbonFrames(rowPoints, half)
      if (!frames) return null
    }
  }

  const unsafe = new Set(failures.failing.map((cell) => cell.i * (crossCount - 1) + cell.j))

  const strips = []
  let i = 0
  while (i < rowPoints.length) {
    if (!valid[i]) { i++; continue }
    let j = i
    while (j + 1 < rowPoints.length && valid[j + 1]) j++
    if (j > i) {
      const rowCount = j - i + 1
      const anchored = new Uint8Array(rowCount)
      for (let k = 0; k < rowCount; k++) {
        anchored[k] = Number.isFinite(frames[i + k].surfaceY) ? 1 : 0
      }
      const positions = new Float32Array(rowCount * crossCount * 3)
      const indices: number[] = []
      for (let k = 0; k < rowCount; k++) {
        for (let c = 0; c < crossCount; c++) {
          const cell = rows[i + k][c]
          if (!cell) continue   // unsafe/断 strip 行已由 strip 边界排除；防御性跳过
          const o = (k * crossCount + c) * 3
          positions[o] = cell.x
          positions[o + 1] = cell.y
          positions[o + 2] = cell.z
        }
      }
      for (let k = 0; k < rowCount - 1; k++) {
        for (let c = 0; c < crossCount - 1; c++) {
          const cellKey = (i + k) * (crossCount - 1) + c
          if (unsafe.has(cellKey)) continue
          const a = k * crossCount + c
          const b = a + 1
          const d = a + crossCount
          const e = d + 1
          indices.push(a, b, d, b, e, d)
        }
      }
      strips.push({ positions, indices: new Uint32Array(indices), rowCount, crossCount, anchored })
    }
    i = j + 1
  }
  if (!strips.length) return null
  const vertexCount = strips.reduce((sum, strip) => sum + strip.positions.length / 3, 0)
  return {
    strips,
    pointCount: rowPoints.length,
    crossCount,
    vertexCount,
    vertexBudget: ANNOTATION_MAX_RIBBON_VERTICES,
    validation: {
      iterations,
      cellsChecked: failures.checked,
      unsafeCells: unsafe.size,
      rowCount: rowPoints.length,
      crossCount,
    },
  }
}

/**
 * eraser 预览圆环：只用于 scene 的 LineLoop，不进 annotation state/history。
 * 边缘采样失败（出地形）时回退 center 高度，保证 ring 不会缺段；这是预览 affordance，
 * 不是 durable geometry。
 */
export function buildEraserRing(center: SemanticPoint | null | undefined, radius: number, sampleHeight: HeightSampler, {
  segments = ANNOTATION_RING_SEGMENTS,
  lift = ANNOTATION_LIFT / 2,
}: {
  segments?: number
  lift?: number
} = {}): { positions: Float32Array; segments: number } | null {
  if (!center || !Number.isFinite(Number(center.x)) || !Number.isFinite(Number(center.y))) return null
  const r = Number(radius)
  if (!Number.isFinite(r) || r <= 0 || typeof sampleHeight !== 'function') return null
  const n = Math.max(8, Math.min(128, Math.floor(numberOr(segments, ANNOTATION_RING_SEGMENTS))))
  const cx = Number(center.x)
  const cz = Number(center.y)
  // eraser cursor 落在选中表面时，整个 ring 留在该层；否则沿用 terrain。
  const centerAnchor = Number.isFinite(center.surfaceY) ? Number(center.surfaceY) : null
  const centerY = centerAnchor !== null ? centerAnchor : sampleOrNull(sampleHeight, cx, cz)
  const normal = centerAnchor !== null ? normalizeNormal(center.surfaceN) : undefined
  const liftValue = numberOr(lift, ANNOTATION_LIFT / 2)
  const positions = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    const angle = (i / n) * Math.PI * 2
    const x = cx + Math.cos(angle) * r
    const z = cz + Math.sin(angle) * r
    let y = centerAnchor !== null ? centerAnchor : sampleOrNull(sampleHeight, x, z)
    if (centerAnchor !== null && normal && Math.abs(normal.y) > 1e-6) {
      // semantic eraser 仍是 XZ circle；visual ring 点投到同一 surface plane。
      const dx = x - cx
      const dz = z - cz
      y = centerAnchor - (normal.x * dx + normal.z * dz) / normal.y
    }
    positions[i * 3] = x
    positions[i * 3 + 1] = (y === null ? (centerY === null ? 0 : centerY) : y) + liftValue
    positions[i * 3 + 2] = z
  }
  return { positions, segments: n }
}
