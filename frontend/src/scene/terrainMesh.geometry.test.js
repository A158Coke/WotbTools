import { describe, it, expect } from 'vitest'
import {
  MAX_QUADS, PATCH_QUADS, buildAdaptiveTerrain, subdivisionMetrics, terrainSurfaceHeightAt,
} from './terrainMesh.js'

const FOV = (55 * Math.PI) / 180
const ASPECT = 16 / 9

describe('地形网格生成几何与表面一致性', () => {
  const make = (n, fill, at = null) => {
    const f = new Float32Array(n * n).fill(fill)
    if (at) for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) f[i * n + j] = at(i, j)
    return f
  }

  const build = (field, n, span, cam) =>
    buildAdaptiveTerrain({ field, n, span, cam, fovY: FOV, aspect: ASPECT })

  /** 网格在 (x,z) 的表面高度区间（覆盖三角形取 min/max；未被覆盖 = null） */
  const surfaceAt = (m, x, z) => {
    const pos = m.positions, idx = m.indices
    let lo = null, hi = null
    for (let t = 0; t < idx.length; t += 3) {
      const A = idx[t] * 3, B = idx[t + 1] * 3, C = idx[t + 2] * 3
      const x1 = pos[A], z1 = pos[A + 2], x2 = pos[B], z2 = pos[B + 2], x3 = pos[C], z3 = pos[C + 2]
      const d = (z2 - z3) * (x1 - x3) + (x3 - x2) * (z1 - z3)
      if (Math.abs(d) < 1e-12) continue
      const a = ((z2 - z3) * (x - x3) + (x3 - x2) * (z - z3)) / d
      const b = ((z3 - z1) * (x - x3) + (x1 - x3) * (z - z3)) / d
      const c = 1 - a - b
      if (a < -1e-9 || b < -1e-9 || c < -1e-9) continue
      const y = a * pos[A + 1] + b * pos[B + 1] + c * pos[C + 1]
      lo = lo === null ? y : Math.min(lo, y)
      hi = hi === null ? y : Math.max(hi, y)
    }
    return lo === null ? null : [lo, hi]
  }

  // ---- 缩小版参考对照（2026-10-11 PR 评审遗留项）----
  // 按引擎 `LandscapeSubdivision` 语义**独立**重写细分判定（不复用模块的补片表/递归），与
  // `buildAdaptiveTerrain` 的终止补片集逐补片对比——锁定三处逐行对齐修复（子树误差聚合 /
  // 包围盒聚合 / 反对角平均）不被后续改动悄悄破坏。只对照"判定"，morph 不在内。
  // 仅收规整四叉树（每层 perAxis 恰为 2 倍，n=64/128 即此）；非整倍 n 的夹取口径由既有
  // 行为用例（无空洞 / 混排无裂缝）看护。
  const refTerminatedPatches = (field, n, span, cam, fovY, aspect) => {
    const H = (i, j) => field[Math.min(i, n - 1) * n + Math.min(j, n - 1)]
    const wx = (j) => (j / n - 0.5) * span
    const wz = (i) => (i / n - 0.5) * span
    const M = subdivisionMetrics(fovY, aspect)
    const rootStep = Math.max(1, 2 ** Math.floor(Math.log2(Math.max(1, Math.floor(n / PATCH_QUADS)))))
    const K = Math.round(Math.log2(rootStep)) + 1
    const levels = []
    for (let L = 0; L < K; L++) {
      const patchSize = PATCH_QUADS * (rootStep >> L)
      levels.push({
        patchSize, perAxis: Math.max(1, Math.ceil(n / patchSize)),
        step: patchSize / PATCH_QUADS, err: [], pos: [], box: [],
      })
    }
    // ① 各层 own 采样：8×8 四边形 × 5 样本（引擎 UpdatePatchInfo；最细层不采样 ⇒ 0）
    for (let L = 0; L < K; L++) {
      const lv = levels[L], deepest = L === K - 1, step = lv.step, h = step >> 1
      for (let iy = 0; iy < lv.perAxis; iy++) {
        for (let ix = 0; ix < lv.perAxis; ix++) {
          const i0 = iy * lv.patchSize, j0 = ix * lv.patchSize
          let err = 0, pi = i0, pj = j0
          let mnX = Infinity, mxX = -Infinity, mnZ = Infinity, mxZ = -Infinity, mnH = Infinity, mxH = -Infinity
          for (let a = 0; a <= PATCH_QUADS; a++) {
            const ii = Math.min(i0 + a * step, n), z = wz(ii)
            if (z < mnZ) mnZ = z
            if (z > mxZ) mxZ = z
            for (let b = 0; b <= PATCH_QUADS; b++) {
              const jj = Math.min(j0 + b * step, n), x = wx(jj), y = H(ii, jj)
              if (x < mnX) mnX = x
              if (x > mxX) mxX = x
              if (y < mnH) mnH = y
              if (y > mxH) mxH = y
            }
          }
          if (!deepest) {
            for (let a = 0; a < PATCH_QUADS; a++) {
              for (let b = 0; b < PATCH_QUADS; b++) {
                const ci = i0 + a * step, cj = j0 + b * step
                if (ci >= n || cj >= n) continue
                const p00 = H(ci, cj), p01 = H(ci, cj + step)
                const p10 = H(ci + step, cj), p11 = H(ci + step, cj + step)
                for (const [qi, qj, ap] of [
                  [ci, cj + h, (p00 + p01) / 2],
                  [ci + h, cj, (p00 + p10) / 2],
                  [ci + h, cj + h, (p00 + p11) / 2],   // 双奇对角 = 反对角两点（p00/p11）
                  [ci + step, cj + h, (p10 + p11) / 2],
                  [ci + h, cj + step, (p01 + p11) / 2],
                ]) {
                  const e = H(qi, qj) - ap
                  if (Math.abs(e) > Math.abs(err)) { err = e; pi = qi; pj = qj }
                }
              }
            }
          }
          const idx = iy * lv.perAxis + ix
          lv.err[idx] = err; lv.pos[idx] = [pi, pj]
          lv.box[idx] = [mnX, mxX, mnZ, mxZ, mnH, mxH]
        }
      }
    }
    // ② 自底向上：子的误差（含其子树）与包围盒并入父（子索引 = 2×父 + 象限）
    for (let L = K - 2; L >= 0; L--) {
      const lv = levels[L], ch = levels[L + 1]
      for (let iy = 0; iy < lv.perAxis; iy++) {
        for (let ix = 0; ix < lv.perAxis; ix++) {
          const idx = iy * lv.perAxis + ix
          for (const [di, dj] of [[0, 0], [0, 1], [1, 0], [1, 1]]) {
            const cidx = (2 * iy + di) * ch.perAxis + (2 * ix + dj)
            if (Math.abs(ch.err[cidx]) > Math.abs(lv.err[idx])) { lv.err[idx] = ch.err[cidx]; lv.pos[idx] = ch.pos[cidx] }
            const pb = lv.box[idx], cb = ch.box[cidx]
            pb[0] = Math.min(pb[0], cb[0]); pb[1] = Math.max(pb[1], cb[1])
            pb[2] = Math.min(pb[2], cb[2]); pb[3] = Math.max(pb[3], cb[3])
            pb[4] = Math.min(pb[4], cb[4]); pb[5] = Math.max(pb[5], cb[5])
          }
        }
      }
    }
    // ③ 三条判据（半径 / 屏幕高度 / 绝对 3 m）+ 递归
    const out = []
    const rec = (i0, j0, step, level) => {
      let subdivide = false
      if (step > 1) {
        const lv = levels[level]
        const idx = Math.floor(i0 / lv.patchSize) * lv.perAxis + Math.floor(j0 / lv.patchSize)
        const errAbs = Math.abs(lv.err[idx])
        const [pi, pj] = lv.pos[idx]
        const heightError = errAbs / (Math.hypot(cam.x - wx(pj), cam.y - H(pi, pj), cam.z - wz(pi)) * M.tanFovY)
        const b = lv.box[idx]
        const bx = (b[0] + b[1]) / 2, by = (b[4] + b[5]) / 2, bz = (b[2] + b[3]) / 2
        const radius = Math.sqrt((b[1] - bx) ** 2 + (b[5] - by) ** 2 + (b[3] - bz) ** 2)
        const radiusError = radius / (Math.hypot(cam.x - bx, cam.y - by, cam.z - bz) * M.tanFovY)
        subdivide = radiusError >= M.maxPatchRadiusError
          || heightError >= M.maxHeightError
          || errAbs > M.maxAbsoluteHeightError
      }
      if (subdivide) {
        const h2 = step >> 1
        if (h2 * 2 === step) {
          for (const [di, dj] of [[0, 0], [0, 1], [1, 0], [1, 1]]) {
            rec(i0 + di * PATCH_QUADS * h2, j0 + dj * PATCH_QUADS * h2, h2, level + 1)
          }
          return
        }
      }
      out.push([i0, j0, step])
    }
    for (let i = 0; i < n; i += rootStep * PATCH_QUADS) {
      for (let j = 0; j < n; j += rootStep * PATCH_QUADS) rec(i, j, rootStep, 0)
    }
    return out
  }

  it('平坦地形：只有半径判据起作用 ⇒ 近处细、远处粗，且网格处处等于 texel 原值', () => {
    const n = 256
    const flat = make(n, 20)
    const near = build(flat, n, 600, { x: 0, y: 15, z: 0 })
    const far = build(flat, n, 600, { x: 0, y: 500, z: 0 })
    expect(near.quads).toBeGreaterThan(far.quads)
    expect(far.quads).toBeLessThan((n * n) / 4)    // 平地远处不无脑铺满
    for (let k = 0; k < near.positions.length; k += 3) expect(near.positions[k + 1]).toBeCloseTo(20, 6)
  })

  it('陡坎（超 3 m 绝对容差）细化；高度只作抽样/沿边内插，不外扩', () => {
    const n = 128
    const field = make(n, 20, (_i, j) => (j >= 64 ? 30 : 20))   // 10 m 台阶
    const m = build(field, n, 600, { x: 0, y: 300, z: 0 })
    const flat = build(make(n, 20), n, 600, { x: 0, y: 300, z: 0 })
    expect(m.quads).toBeGreaterThan(flat.quads)
    for (let k = 0; k < m.positions.length; k += 3) {
      const y = m.positions[k + 1]
      expect(y).toBeGreaterThanOrEqual(20 - 1e-4)
      expect(y).toBeLessThanOrEqual(30 + 1e-4)
      expect(Math.abs(m.positions[k])).toBeLessThanOrEqual(300 + 1e-6)
      expect(Math.abs(m.positions[k + 2])).toBeLessThanOrEqual(300 + 1e-6)
    }
  })

  it('贴地薄板不被地形盖住：凹谷内平整场坪上的 0.27 m 板，网格不得高过板顶', () => {
    // 铁轨类构件的净空只有 0.2~0.3 m（forgecity 实测板面 22.30–22.60、地形真值 22.33）。
    // 本用例守"平整场坪内部被精确复现、网格不拱起"（抽样口径 + 补片内部 8×8 网格的后果）；
    // **本次回归的判定性锁**是上一条「单元格边长 ≤ 0.08·视距」——实测旧口径模拟（判据放松 ⇒
    // 75 m 整格）在该条上比值 3.61 判失败，现状 0.46 通过。
    const n = 256, span = 600
    const tex = span / n
    const field = new Float32Array(n * n)
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const x = (j / n - 0.5) * span, z = (i / n - 0.5) * span
        field[i * n + j] = 20 - 3 * Math.cos(x / 60) * Math.cos(z / 60)
      }
    }
    const i0 = 80, i1 = 176, j0 = 80, j1 = 176            // 场坪：225×225 m（谷底）
    for (let i = i0; i < i1; i++) for (let j = j0; j < j1; j++) field[i * n + j] = 17.27
    const cam = { x: 0, y: 250, z: -140 }
    const m = build(field, n, span, cam)
    // 局部最大单元格（用于把采样点退到"至少一格"以内，避开合法的边界过渡带）
    const pos = m.positions, idx = m.indices
    const xa = ((j0 / n) - 0.5) * span, xb = ((j1 / n) - 0.5) * span
    const za = ((i0 / n) - 0.5) * span, zb = ((i1 / n) - 0.5) * span
    let maxCell = 0
    for (let t = 0; t < idx.length; t += 3) {
      const A = idx[t] * 3, B = idx[t + 1] * 3, C = idx[t + 2] * 3
      const cx = (pos[A] + pos[B] + pos[C]) / 3, cz = (pos[A + 2] + pos[B + 2] + pos[C + 2]) / 3
      if (cx < xa || cx > xb || cz < za || cz > zb) continue
      maxCell = Math.max(maxCell,
        Math.abs(pos[A] - pos[B]), Math.abs(pos[A] - pos[C]),
        Math.abs(pos[A + 2] - pos[B + 2]), Math.abs(pos[A + 2] - pos[C + 2]))
    }
    expect(maxCell).toBeGreaterThan(0)
    expect(maxCell).toBeLessThan(0.08 * 250 + 2 * tex)     // 半径判据的世界空间后果
    // 退界取 4 个最大格步长：客户端 morph 会把场坪**边界一圈**（±1 格步长）拉向谷坡（实测 +0.25 m），
    // 这是客户端自身行为；此处只验"场坪内部被精确复现"。
    const inset = 4 * maxCell + tex
    let worst = -Infinity, samples = 0
    for (let x = xa + inset; x <= xb - inset; x += tex) {
      for (let z = za + inset; z <= zb - inset; z += tex) {
        const r = surfaceAt(m, x, z)
        if (!r) continue
        samples++
        worst = Math.max(worst, r[1])
      }
    }
    expect(samples).toBeGreaterThan(100)
    expect(worst).toBeLessThanOrEqual(17.27 + 0.05)
  })

  it('细分判据只有客户端三条：传"岸线标高表"不再改变 tessellation（第四条判据已删，2026-10-11 评审）', () => {
    // 背景：2026-10-10 曾加过第四条"岸线特征"判据（与水面标高相交的补片强制细分到底）。
    // 2026-10-11 PR 评审：DAVA `SubdividePatch` 没有这条——"纯客户端三判据"的目标不允许自研
    // 判据 ⇒ 已删除（岸线视觉由水材质/coastLine 处理，不改地形 tessellation）。本用例锁定删除：
    // 传入额外的 `shores` 字段（旧 API 形状）必须被忽略，几何与不传时逐字节一致。
    const n = 96, span = 96
    const field = make(n, 10, (i, j) => 10 + 0.03 * j)
    const far = { x: 0, y: 400, z: 0 }
    const base = build(field, n, span, far)
    const withShores = buildAdaptiveTerrain({
      field, n, span, cam: far, fovY: FOV, aspect: ASPECT,
      shores: [{ y: 12.25, x0: -span / 2, x1: span / 2, z0: -span / 2, z1: span / 2 }],
    })
    expect(Array.from(withShores.sizeAt)).toEqual(Array.from(base.sizeAt))
    expect(withShores.quads).toBe(base.quads)
    const mid = Math.floor(n / 2)
    const jCross = Math.ceil((12.25 - 10) / 0.03)      // ≈ 75：旧判据曾在此细到 1 texel
    expect(withShores.sizeAt[mid * n + jCross]).toBeGreaterThan(1)   // 三判据下合法地给粗格
  })

  it('无裂缝：相邻四边形混排尺寸（含跨级 LOD）+ 交界两侧逐点同高（几何检查）', () => {
    // 回归（2026-10-09 用户"这次引入了横竖条纹"）：共享边两侧顶点密度不同 ⇒ T 型接缝。
    // 口径：顶点高度 = 该处最粗相邻四边形所在层级的**边界直线**值（端点递归）⇒ 同一 (i,j) 恒同高、
    // 细侧折线落在粗侧直线上 ⇒ 无需 2:1 平衡也**无裂缝**。
    const n = 128, span = 600
    const field = make(n, 20, (i, j) => 20 + 8 * Math.sin(i / 5) * Math.cos(j / 5) + (j > 80 ? 6 : 0))
    const m = build(field, n, span, { x: 0, y: 240, z: 60 })
    const S = m.sizeAt
    const sizes = new Set(Array.from(S).filter(Boolean))
    expect(sizes.size).toBeGreaterThan(1)          // 混排（含跨级）⇒ 连续性检查非空转
    const step = span / n
    const boundaries = new Set()
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const s = S[i * n + j]; if (!s) continue
        if (i > 0 && S[(i - 1) * n + j] && S[(i - 1) * n + j] !== s) boundaries.add(`h:${i}`)
        if (j > 0 && S[i * n + j - 1] && S[i * n + j - 1] !== s) boundaries.add(`v:${j}`)
      }
    }
    let samples = 0, maxGap = 0
    for (const b of boundaries) {
      const [kind, at] = b.split(':')
      const fixed = (Number(at) / n) * span - span / 2
      for (let t = -span / 2 + step / 8; t < span / 2 - 1e-9; t += step / 4) {
        const p = kind === 'h' ? [t, fixed] : [fixed, t]
        const r = surfaceAt(m, p[0], p[1])
        if (!r) continue
        samples++
        maxGap = Math.max(maxGap, r[1] - r[0])
      }
    }
    expect(samples).toBeGreaterThan(50)
    // 阈值 1e-4 m：顶点以 float32 存储，30 m 高度处 1 ulp ≈ 2e-6 m
    expect(maxGap).toBeLessThanOrEqual(1e-4)
  })

  // 超时放宽：本用例刻意铺满整张 128×128 混排层级地图（覆盖/法线逐采样点复查），
  // 本机 ~2 s，但共享 CI runner 曾超 5 s 默认值（2026-10-10 `gh run` 38043907258 计时超时）。
  it('无空洞且全朝上：采样点必被覆盖、三角形法线恒 +y（混排层级下网格仍是完整地图）', { timeout: 30000 }, () => {
    const n = 128, span = 600
    const field = make(n, 20, (i, j) => 20 + 8 * Math.sin(i / 5) * Math.cos(j / 5) + (j > 80 ? 6 : 0))
    const m = build(field, n, span, { x: 0, y: 240, z: 60 })
    const pos = m.positions, idx = m.indices
    const step = span / n
    let holes = 0, samples = 0, up = 0, tris = 0
    for (let x = -span / 2 + step / 2; x < span / 2 - 1e-9; x += step / 2) {
      for (let z = -span / 2 + step / 2; z < span / 2 - 1e-9; z += step / 2) {
        samples++
        if (!surfaceAt(m, x, z)) holes++
      }
    }
    expect(samples).toBeGreaterThan(1000)
    expect(holes).toBe(0)
    for (let t = 0; t < idx.length; t += 3) {
      const A = idx[t] * 3, B = idx[t + 1] * 3, C = idx[t + 2] * 3
      const ux = pos[B] - pos[A], uz = pos[B + 2] - pos[A + 2]
      const vx = pos[C] - pos[A], vz = pos[C + 2] - pos[A + 2]
      tris++
      if (uz * vx - ux * vz > 0) up++
    }
    expect(up).toBe(tris)
  })

  it('契约常量与预算：补片 8 四边形、节点上限、返回判据快照', () => {
    expect(PATCH_QUADS).toBe(8)
    expect(MAX_QUADS).toBeGreaterThan(10000)
    const m = buildAdaptiveTerrain({ field: make(64, 20), n: 64, span: 600, cam: { x: 0, y: 100, z: 0 }, fovY: FOV })
    expect(m.quads).toBe(m.indices.length / 6)
    expect(m.overBudget).toBe(false)
    expect(m.metrics.tanFovY).toBeCloseTo(Math.tan(FOV / 2), 12)
    expect(m.patches.length).toBeGreaterThan(0)
  })

  it('局部表面查询与生成网格三角面一致，覆盖非共面顶点、morph 和当前 LOD', () => {
    const n = 2, span = 600
    const field = make(n, 20, (i, j) => ((i === 0 && j === 1) || (i === 1 && j === 0)) ? 21.2 : 20)
    const mesh = build(field, n, span, { x: 0, y: 100, z: 0 })
    const x = -150, z = -150
    const oracle = surfaceAt(mesh, x, z)
    expect(oracle).not.toBeNull()
    expect(oracle[0]).toBeCloseTo(21.2, 4) // 非共面格中心落在两个高顶点构成的反对角边上。
    expect(terrainSurfaceHeightAt({ ...mesh, n, span }, x, z)).toBeCloseTo(oracle[0], 5)
    expect(terrainSurfaceHeightAt({ ...mesh, n, span }, span / 2, z)).toBeNull()

    const lodN = 64
    const lodField = make(lodN, 20, (i, j) => 20 + 3 * Math.sin(i / 7) * Math.cos(j / 9))
    const lodMesh = build(lodField, lodN, span, { x: 0, y: 75, z: 0 })
    for (const [sx, sz] of [[0, 0], [17, -43], [-122, 90], [205, 180]]) {
      const rendered = surfaceAt(lodMesh, sx, sz)
      expect(rendered).not.toBeNull()
      expect(terrainSurfaceHeightAt({ ...lodMesh, n: lodN, span }, sx, sz)).toBeCloseTo(rendered[0], 5)
    }
  })

  it('非 8 对齐尺寸的正边与正角裁剪格使用 emitter 写入的 quad origin', () => {
    const n = 101, span = 600
    const field = make(n, 20, (i, j) => 20 + ((i + j) % 7) * 0.3)
    const mesh = build(field, n, span, { x: 0, y: 10000, z: 0 })
    const query = (i, j) => {
      const x = ((j + 0.5) / n - 0.5) * span
      const z = ((i + 0.5) / n - 0.5) * span
      const oracle = surfaceAt(mesh, x, z)
      expect(oracle).not.toBeNull()
      const sampled = terrainSurfaceHeightAt({ ...mesh, n, span }, x, z)
      expect(sampled).not.toBeNull()
      expect(sampled).toBeCloseTo(oracle[0], 5)
      return { cell: i * n + j, sampled }
    }

    // n=101 且远距离相机使正边保留 step=8；emitter 在 i=96 处将边格裁为 step=5。
    const edge = query(98, 50)
    expect(mesh.originIAt[edge.cell]).toBe(96)
    expect(mesh.sizeAt[edge.cell]).toBe(5)

    // 正 X + 正 Z 同时裁剪；查询仍命中实际发射的 [96,101) 角 quad。
    const corner = query(98, 98)
    expect(mesh.originIAt[corner.cell]).toBe(96)
    expect(mesh.originJAt[corner.cell]).toBe(96)
    expect(mesh.sizeAt[corner.cell]).toBe(5)

    // 标准对齐尺寸和现有非共面三角面回归继续覆盖常规路径。
    const alignedN = 64
    const aligned = build(make(alignedN, 20), alignedN, span, { x: 0, y: 100, z: 0 })
    const alignedX = 0, alignedZ = 0
    const alignedOracle = surfaceAt(aligned, alignedX, alignedZ)
    expect(terrainSurfaceHeightAt({ ...aligned, n: alignedN, span }, alignedX, alignedZ)).toBeCloseTo(alignedOracle[0], 5)
  })

  it('参考对照（引擎语义独立重写）：终止补片集逐补片一致——锁定三处转写修复不被改坏', () => {
    // 2026-10-11 PR 评审遗留项：原验证（Python 参考移植逐补片比较）在仓外、无法持续复现 ⇒
    // 固化一个**缩小版**参照：同一判据按引擎语义独立重写（5 样本 / 四叉树自底向上聚合 /
    // 三条判据），与实现逐补片对比。若未来有人改坏子树误差聚合 / 包围盒聚合 / 反对角平均
    // （或把自研判据塞回递归），本用例先于行为用例翻红。
    const cases = [
      { n: 64, span: 600, cam: { x: 0, y: 240, z: 60 }, gen: (i, j) => 20 + 8 * Math.sin(i / 5) * Math.cos(j / 5) },
      { n: 64, span: 600, cam: { x: 200, y: 500, z: -150 }, gen: (i, j) => 20 + 0.4 * j + (i > 32 ? 4 : 0) },
      { n: 128, span: 600, cam: { x: -40, y: 90, z: 30 }, gen: (i, j) => 12 + 20 * Math.exp(-(((i - 64) ** 2 + (j - 50) ** 2) / 1500)) },
      { n: 128, span: 600, cam: { x: 0, y: 40, z: 0 }, gen: (i, j) => 20 + 3 * Math.sin(i / 11) + 2 * Math.cos(j / 7) },
    ]
    for (const c of cases) {
      const field = make(c.n, 0, c.gen)
      const m = build(field, c.n, c.span, c.cam)
      expect(m.overBudget).toBe(false)              // 预算未触顶 ⇒ 递归口径与参考一致
      const key = (p) => `${p[0]}:${p[1]}:${p[2]}`
      const got = m.patches.map((p) => [p.i0, p.j0, p.step]).map(key).sort()
      const want = refTerminatedPatches(field, c.n, c.span, c.cam, FOV, ASPECT).map(key).sort()
      expect(got.length).toBeGreaterThan(8)         // 非空转：确有终止补片参与比较
      expect(got).toEqual(want)
    }
  })
})
