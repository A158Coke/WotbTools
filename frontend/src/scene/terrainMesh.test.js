import { describe, it, expect } from 'vitest'
import {
  MAX_QUADS, PATCH_QUADS, SUBDIVISION_METRICS, TERRAIN_LAYOUT_ENGINE_VERTEX, buildAdaptiveTerrain,
  CLIENT_NORMAL_CAMERA_FOV_H, buildRefineMask,
  decodeTerrainField, morphFunc, subdivisionMetrics, groundMapUv, subdivMorphOf, terrainLodState,
  terrainLodStale, pairedTerrainBinUrl, terrainBinMatchesMeta,
  terrainFieldMetaValid, terrainBoundsOk,
} from './terrainMesh.js'
import { createHash } from 'node:crypto'

// 自适应地形网格（客户端 `LandscapeSubdivision` 同构）契约。偏离的后果：要么地形把贴地薄结构
// （铁轨/路缘/贴花）盖住（2026-10-09 用户报障），要么平缓区逐 texel 毛刺戳出齐平接缝（同日另一报障）。
const FOV = (55 * Math.PI) / 180
const ASPECT = 16 / 9

describe('地形网格（客户端补片级自适应 LOD，引擎 LandscapeSubdivision 口径）', () => {
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

  it('阈值口径：tanFovY = tan(vfov/2)、阈值随（水平）fov 在 zoom/normal 预设间插值', () => {
    // 客户端 `PrepareSubdivision`：fovLerp 用**水平** fov（引擎 Camera::GetFOV() 口径）；
    // 阈值 = zoom + (normal − zoom)·fovLerp；tanFovY = tanf(fov/2)/aspect ≡ tan(vfov/2)。
    const wide = subdivisionMetrics(FOV, ASPECT)
    expect(wide.tanFovY).toBeCloseTo(Math.tan(FOV / 2), 12)
    const hFovDeg = (2 * Math.atan(Math.tan(FOV / 2) * ASPECT) * 180) / Math.PI
    expect(wide.fovLerp).toBeCloseTo(Math.min(1, Math.max(0, (hFovDeg - 6.5) / (70 - 6.5))), 9)
    const M = SUBDIVISION_METRICS
    expect(wide.maxHeightError).toBeCloseTo(
      M.zoomMaxHeightError + (M.normalMaxHeightError - M.zoomMaxHeightError) * wide.fovLerp, 12)
    expect(wide.maxPatchRadiusError).toBeCloseTo(
      M.zoomMaxPatchRadiusError + (M.normalMaxPatchRadiusError - M.zoomMaxPatchRadiusError) * wide.fovLerp, 12)
    // 窄 fov（狙击镜量级）⇒ 阈值走 zoom 端（客户端在此刻意放宽，见 SubdivisionMetrics）
    const zoom = subdivisionMetrics((8 * Math.PI) / 180, ASPECT)
    expect(zoom.fovLerp).toBeLessThan(0.2)
    expect(zoom.maxHeightError).toBeGreaterThan(wide.maxHeightError)
    expect(zoom.maxPatchRadiusError).toBeGreaterThan(wide.maxPatchRadiusError)
    // tolScale 只作用屏幕阈值（?terrainlod）；绝对 3 m 上限不随它变
    const half = subdivisionMetrics(FOV, ASPECT, 0.5)
    expect(half.maxHeightError).toBeCloseTo(wide.maxHeightError / 2, 12)
    expect(half.maxPatchRadiusError).toBeCloseTo(wide.maxPatchRadiusError / 2, 12)
    expect(half.maxAbsoluteHeightError).toBe(wide.maxAbsoluteHeightError)
  })

  it('阈值 fov 按客户端口径传入：水平 fov 来自相机配置，不随画布宽高比滑动', () => {
    // 引擎 `PrepareSubdivision`：`fovLerp` 直接吃 `camera->GetFOV()`（**水平**口径，取自相机配置），
    // 宽高比只进投影项 `tanFovY = tanf(fov/2)/aspect`。回放自由相机没有狙击镜档（zoomFov 6.5°）
    // ⇒ 运行时恒传 `CLIENT_NORMAL_CAMERA_FOV_H`：否则窄画布把「55° 竖直 × aspect」折算成小水平角，
    // 阈值滑向 zoom 端（放松最多 ~1.8×），同一机位我们的网格比客户端更粗——正是 2026-10-14 用户
    // 「客户端可达机位仍被粗格盖住」的成因之一。
    const portrait = 0.5
    const derived = subdivisionMetrics(FOV, portrait)                      // 旧口径：由画布折算
    expect(derived.fovLerp).toBeLessThan(0.9)
    const clientWay = subdivisionMetrics(FOV, portrait, 1, CLIENT_NORMAL_CAMERA_FOV_H)
    expect(clientWay.fovLerp).toBe(1)                                      // 恒 normal 档
    const M = SUBDIVISION_METRICS
    expect(clientWay.maxHeightError).toBeCloseTo(M.normalMaxHeightError, 12)
    expect(clientWay.maxPatchRadiusError).toBeCloseTo(M.normalMaxPatchRadiusError, 12)
    expect(clientWay.tanFovY).toBeCloseTo(derived.tanFovY, 12)             // 投影项仍是真实相机
    expect(clientWay.maxAbsoluteHeightError).toBe(M.normalMaxAbsoluteHeightError)
    // 非正/非法覆盖值一律回落「由 fovY×aspect 折算」的纯函数语义
    expect(subdivisionMetrics(FOV, portrait, 1, 0).fovLerp).toBeCloseTo(derived.fovLerp, 12)
    expect(subdivisionMetrics(FOV, portrait, 1, NaN).fovLerp).toBeCloseTo(derived.fovLerp, 12)
    // 宽画布下两种口径本来就同为 normal 档 —— 这次收紧只影响窄画布
    expect(subdivisionMetrics(FOV, ASPECT, 1, CLIENT_NORMAL_CAMERA_FOV_H).fovLerp)
      .toBe(subdivisionMetrics(FOV, ASPECT).fovLerp)
  })

  it('走廊掩码（B）：掩码内强制到最细层，「粗格插值抬过贴地薄板」的覆盖清零', () => {
    // 2026-10-14 用户裁定 B 方案。机制复刻：细分判据只约束**相对**误差（≤ 0.014·d·tanFovY），
    // 而贴地薄板（extras.decal：铁轨基板/压顶/铺装）净空常仅 3–30 cm ⇒ 阈值内的残余插值误差
    // 就能把它盖住（真图实测 250 m 机位 rails_003 39.7% / rails_002 6.7% 钢条顶点被盖）。
    // 这里用合成场复现：缓沟 + 一条"贴地薄板"（板顶 = 真值 + 0.10 m，与铁轨基板同量级）。
    const n = 128, span = 600, jc = n / 2, row = n / 2, sigma = 8, depth = 1.5
    const field = new Float32Array(n * n)
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      field[i * n + j] = 20 - depth * Math.exp(-(((j - jc) / sigma) ** 2))
    }
    const truth = (j) => field[row * n + j]
    // 覆盖判定：该处发射格（sizeAt）内的双线性面 ≥ 板顶 − 2 cm（与拾取/分析同口径的插值模型）
    const covered = (res, j) => {
      const st = res.sizeAt[row * n + j]
      const j0 = Math.floor(j / st) * st, fj = (j - j0) / st
      const h = field[row * n + j0] * (1 - fj) + field[row * n + Math.min(j0 + st, n - 1)] * fj
      return h >= truth(j) + 0.10 - 0.02
    }
    const cam = { x: 0, y: 200, z: -1200 }                     // 视距 ~1200 m：格子粗到 8 texel
    const base = buildAdaptiveTerrain({ field, n, span, cam, fovY: FOV, aspect: ASPECT })
    let hitBase = 0
    for (let j = jc - 2; j <= jc + 2; j++) if (covered(base, j)) hitBase++
    expect(hitBase).toBeGreaterThan(0)                          // 前提：无掩码时确实被粗格盖住
    const M = 2
    const pts = []
    for (let j = jc - M; j <= jc + M; j++) pts.push((j / n - 0.5) * span, 0)
    const mask = buildRefineMask(pts, n, span, 2)
    const withMask = buildAdaptiveTerrain({ field, n, span, cam, fovY: FOV, aspect: ASPECT, refineMask: mask })
    let hitMask = 0
    for (let j = jc - M; j <= jc + M; j++) if (covered(withMask, j)) hitMask++
    expect(hitMask).toBe(0)                                     // 掩码后：走廊内不再被盖
    let masked = 0
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      if (!mask[i * n + j]) continue
      masked++
      expect(withMask.sizeAt[i * n + j]).toBe(1)                // 掩码内 = 1 texel（真值分辨率）
    }
    expect(masked).toBeGreaterThan(0)
    expect(withMask.quads).toBeGreaterThan(base.quads)          // 只加细分
    // 掩码不参与判据的其它输入：不传掩码时与旧行为逐字节一致（同一相机两次构建）
    const again = buildAdaptiveTerrain({ field, n, span, cam, fovY: FOV, aspect: ASPECT })
    expect(Array.from(again.sizeAt)).toEqual(Array.from(base.sizeAt))
    expect(again.quads).toBe(base.quads)
  })

  it('buildRefineMask：足迹点按 texel 标位、外扩按 margin、越界不越写', () => {
    const n = 32, span = 320                                   // texel = 10 m
    const pts = [0, 0, 100, 0]                                 // 世界 (0,0) 与 (100,0)
    const m1 = buildRefineMask(pts, n, span, 1)
    const at = (i, j) => m1[i * n + j]
    // 场景系：x↔列 j、z↔行 i ⇒ (0,0) → (16,16)；(100,0) → (16,26)
    for (const [i, j] of [[16, 16], [16, 26], [15, 15], [17, 27], [16, 25]]) expect(at(i, j), `i=${i} j=${j}`).toBe(1)
    expect(at(14, 14)).toBe(0); expect(at(18, 18)).toBe(0)
    // margin = 0 ⇒ 只标点自身
    const m0 = buildRefineMask(pts, n, span, 0)
    expect(m0[16 * n + 16]).toBe(1); expect(m0[15 * n + 16]).toBe(0)
    // 外扩只在界内写：单点在最后一列（j = 31）、margin 2 ⇒ 3 列 × 5 行 = 15 个 texel
    const mEdge = buildRefineMask([150, 0], n, span, 2)
    expect(mEdge.reduce((a, b) => a + b, 0)).toBe(15)
    // 完全越界的足迹点直接跳过；非有限值同样跳过
    expect(buildRefineMask([-300, -300, 400, 400], n, span, 2).reduce((a, b) => a + b, 0)).toBe(0)
    expect(buildRefineMask([NaN, 0, 0, Infinity], n, span, 1).reduce((a, b) => a + b, 0)).toBe(0)
  })

  it('地形 LOD 滞回是**单向**的：拉近一律细化，拉远才允许变粗，且有 120 ms 节流', () => {
    // 回归（2026-10-10 用户"铁轨被地形遮挡，转动/缩放后时不时变正常"）：旧实现是双向 25% 滞回 ⇒
    // 网格会长期停在"更远视距"的**更粗**层级（同一相机位置可比客户端判据允许的更粗），
    // 粗格插值把地形抬到贴地薄结构之上，且随重建时机时有时无。
    // 纯径向移动（相机沿视轴推拉）：位置与视距同步变化，侧向分量 = 0。
    const st = (o = {}) => ({
      d: 100, px: 0, py: 100, pz: 0, ux: 0, uy: 1, uz: 0, fovY: 0.8, aspect: 16 / 9, ...o,
    })
    expect(terrainLodStale(null, st(), 0)).toBe(true)             // 首帧必建
    expect(terrainLodStale(st(), st({ d: 96, py: 96 }), 500)).toBe(false)   // 拉近 4% < 5% ⇒ 不建
    expect(terrainLodStale(st(), st({ d: 90, py: 90 }), 500)).toBe(true)    // 拉近 10% ⇒ 立即细化
    expect(terrainLodStale(st(), st({ d: 90, py: 90 }), 50)).toBe(false)    // 但受 120 ms 节流
    expect(terrainLodStale(st(), st({ d: 110, py: 110 }), 500)).toBe(false) // 拉远仅 10% ⇒ 允许（仍够细）
    expect(terrainLodStale(st(), st({ d: 150, py: 150 }), 500)).toBe(true)  // 拉远 ≥40% ⇒ 可变粗
  })

  it('groundMapUv：回退/低档底图朝向契约（旧 PlaneGeometry+rotπ 逐点等价；review P1 回归锁）', () => {
    // 缺 UV 的后果（2026-10-10 review P1）：低档/均衡档与分层材质不可用时地形走
    // `MeshBasicMaterial({ map: mapTexture })`，自适应网格没有 uv 属性 ⇒ 整张底图退化成
    // 单 texel 常量。朝向必须是旧 `PlaneGeometry(size,size)+rotation.set(−π/2,0,π)` 的等价式。
    const s = 600
    const P = new Float32Array([
      -s / 2, 0, -s / 2,   // 世界四角 → uv 四角
      s / 2, 0, -s / 2,
      -s / 2, 0, s / 2,
      s / 2, 0, s / 2,
    ])
    expect([...groundMapUv(P, s)]).toEqual([1, 0, 0, 0, 1, 1, 0, 1])
    expect([...groundMapUv(new Float32Array([0, 0, 0]), s)]).toEqual([0.5, 0.5])
    // 地图中心偏移（backend X-Map-Meta 口径）：按 (X−cx)/(Z−cz) 归一
    expect([...groundMapUv(new Float32Array([0, 0, 0]), s, -s / 2, 0)]).toEqual([0, 0.5])
    expect([...groundMapUv(new Float32Array([-s / 2, 0, 0]), s, -s / 2, 0)]).toEqual([0.5, 0.5])
    // 方向锁：+x ⇒ u 减小（左列 = +X）、+z ⇒ v 增大（顶行 = +Z）；
    // ⚠️ 与分层着色器 tc 的 v 号**相反**是契约（cm.webp 与 ground.webp 导出侧 v 互翻）
    const uv = groundMapUv(P, s)
    expect(uv[0]).toBeGreaterThan(uv[2])          // x 越小 u 越大
    expect(uv[5]).toBeGreaterThan(uv[1])          // z 越大 v 越大
  })

  it('terrainLodState 快照：视距/位置/视轴/FOV/aspect —— 判据读什么，滞回就比什么', () => {
    const s = terrainLodState({ position: { x: 0, y: 100, z: 0 }, fov: 45 }, { x: 0, y: 0, z: 0 }, 21 / 9)
    expect(s.d).toBeCloseTo(100, 12)
    expect([s.px, s.py, s.pz]).toEqual([0, 100, 0])
    expect([s.ux, s.uy, s.uz]).toEqual([0, 1, 0])          // 视轴 target → camera
    expect(s.fovY).toBeCloseTo((45 * Math.PI) / 180, 12)
    expect(s.aspect).toBeCloseTo(21 / 9, 12)
    // 相机与目标重合（d=0）：视轴退化为 0，不产出 NaN（滞回按首帧处理，见下一用例）
    const z = terrainLodState({ position: { x: 1, y: 2, z: 3 }, fov: 30 }, { x: 1, y: 2, z: 3 }, 16 / 9)
    expect(z.d).toBe(0)
    expect([z.ux, z.uy, z.uz]).toEqual([0, 0, 0])
  })

  it('地形 LOD 判据与构建同源：绕转（视距不变）/FOV/aspect 变化都必须重建（review P2 回归锁）', () => {
    // 缺陷场景（2026-10-10 review）：滞回只看视距 ⇒ "相机绕目标水平旋转、视距恒等"时永远
    // 跳过重建，而 buildAdaptiveTerrain 的判据读相机三维位置 ⇒ 网格停在旧相机位置的 LOD
    // 分布上（近处该细的贴片保持粗格），违反"永不比客户端更粗"。onResize 同理只改投影不重建。
    const st = (o = {}) => ({
      d: 100, px: 0, py: 100, pz: 0, ux: 0, uy: 1, uz: 0, fovY: 0.8, aspect: 16 / 9, ...o,
    })
    // 绕转：视距 100 不变，相机在水平面移动（视轴 ∥ +y ⇒ 位移全是侧向分量）
    expect(terrainLodStale(st(), st({ px: 4 }), 500)).toBe(false)   // 侧向 4 m < 5%·100 ⇒ 不建
    expect(terrainLodStale(st(), st({ px: 6 }), 500)).toBe(true)    // 侧向 6 m ≥ 5 m ⇒ 重建
    expect(terrainLodStale(st(), st({ px: 6 }), 50)).toBe(false)    // 同样受 120 ms 节流
    // 沿视轴的分量不算侧向：纯径向拉远 10%（位置与视距同步）仍允许不重建
    expect(terrainLodStale(st(), st({ px: 0, py: 110, d: 110 }), 500)).toBe(false)
    // 斜向：侧向分量按垂直于视轴投影（px=6、py=106 ⇒ 侧向 6，径向 6）⇒ 重建
    expect(terrainLodStale(st(), st({ px: 6, py: 106, d: Math.hypot(6, 106) }), 500)).toBe(true)
    // FOV（阈值随水平 FOV 插值）与 aspect（投影系数）：超过 0.1% 相对变化即重建
    expect(terrainLodStale(st(), st({ fovY: 0.8004 }), 500)).toBe(false)   // +0.05% < 0.1%
    expect(terrainLodStale(st(), st({ fovY: 0.9 }), 500)).toBe(true)       // +12.5%
    expect(terrainLodStale(st(), st({ aspect: 21 / 9 }), 500)).toBe(true)  // 16:9 → 21:9
  })

  it('morphFunc / subdivMorph：客户端 `Landscape.cpp:1213` 与 `SubdividePatch` 末尾的直译', () => {
    // morphFunc(x) = 4(1−x)⁵ − 5(1−x)⁴ + 1
    expect(morphFunc(0)).toBeCloseTo(0, 12)
    expect(morphFunc(1)).toBeCloseTo(1, 12)
    expect(morphFunc(0.5)).toBeCloseTo(0.8125, 12)          // 4·0.5⁵ − 5·0.5⁴ + 1
    expect(morphFunc(-1)).toBe(0)                            // 入参夹到 [0,1]
    expect(morphFunc(2)).toBeCloseTo(1, 12)
    const M = SUBDIVISION_METRICS
    const th = { maxHeightError: M.normalMaxHeightError, maxPatchRadiusError: M.normalMaxPatchRadiusError };
    // 根补片（*0 = 阈值本身）⇒ error0Delta = 0 ⇒ morph = 0（引擎首次调用即如此）
    expect(subdivMorphOf(th.maxHeightError, th.maxPatchRadiusError, th.maxHeightError, th.maxPatchRadiusError, th))
      .toBe(0)
    // 误差贴近阈值的终止补片（父补片刚过阈值）⇒ morph → 1（向"双抽头均值"靠满）
    const m1 = subdivMorphOf(th.maxHeightError * 0.999, 0, th.maxHeightError * 1.01, 0, th)
    expect(m1).toBeGreaterThan(0.9)
    // 误差远低于阈值、且父补片远高于阈值 ⇒ 仍有可观 morph（引擎口径如此）
    const m2 = subdivMorphOf(0, 0, th.maxHeightError * 10, 0, th)
    expect(m2).toBeGreaterThan(0.1)
    expect(m2).toBeLessThan(1)
  })

  it('两通道口径：平面地形上 morph 必须**恒等**（双抽头均值在直线上 = 原值）', () => {
    // 引擎的"averaged"通道 = 该纹素与相距一个 step 的对侧邻居之半和（CreateHeightTextureData）。
    // 线性地形上两者恒等 ⇒ morph 无论多大都不改变几何：这是"morph 只抹非线性起伏、不改坡面"的判据，
    // 也是它不会动到路基/坡面这类**线性**构造的保证（用户报障的挡土墙正骑在高度图台阶上）。
    const n = 64, span = 600
    const plane = new Float32Array(n * n)
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) plane[i * n + j] = 20 + 0.01 * i + 0.02 * j   // 纯线性
    }
    const m = build(field2(plane), n, span, { x: 0, y: 30, z: 0 })
    for (let k = 0; k < m.positions.length; k += 3) {
      const x = m.positions[k], y = m.positions[k + 1], z = m.positions[k + 2]
      const i = (z / span + 0.5) * n, j = (x / span + 0.5) * n
      if (i >= n || j >= n) {
        // 外圈：着色器 zeroLodMul 走 mip0 零偏移 ⇒ 取夹取后的边界 texel（客户端同款），不是平面外推
        const ci = Math.min(n - 1, Math.round(i)), cj = Math.min(n - 1, Math.round(j))
        expect(y).toBeCloseTo(20 + 0.01 * ci + 0.02 * cj, 3)
        continue
      }
      expect(y).toBeCloseTo(20 + 0.01 * i + 0.02 * j, 3)     // 内部：顶点仍落在该平面上
    }
    function field2(a) { return a }
  })

  it('两通道口径：曲面上 morph 只**收缩**起伏（不放大），且顶点不外扩到邻域之外', () => {
    const n = 64, span = 600
    const bump = make(n, 20, (i, j) => 20 + 6 * Math.exp(-((i - 32) ** 2 + (j - 32) ** 2) / 60))
    const m = build(bump, n, span, { x: 0, y: 25, z: 0 })     // 近距 ⇒ 半径判据主导 ⇒ morph 明显
    let minY = Infinity, maxY = -Infinity, minF = Infinity, maxF = -Infinity
    for (let k = 0; k < bump.length; k++) {
      if (bump[k] < minF) minF = bump[k]
      if (bump[k] > maxF) maxF = bump[k]
    }
    for (let k = 0; k < m.positions.length; k += 3) {
      const y = m.positions[k + 1]
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
    expect(minY).toBeGreaterThanOrEqual(minF - 1e-4)          // 恒定值域：抽取/均值都不外扩
    expect(maxY).toBeLessThanOrEqual(maxF + 1e-4)
    // 峰值由**细分**解决（父补片被高度/绝对判据切开 ⇒ error0Delta = 0 ⇒ morph = 0）⇒ 峰保持原高；
    // morph 作用在"半径判据主导"的平缓处（见平面恒等用例的机制说明）。
    let peak = -Infinity
    for (let k = 0; k < m.positions.length; k += 3) peak = Math.max(peak, m.positions[k + 1])
    expect(peak).toBeGreaterThan(maxF - 0.01)                 // 峰未被抹平
    expect(peak).toBeLessThanOrEqual(maxF + 1e-4)
  })

  it('终止补片满足客户端三条判据（屏幕半径 / 屏幕高度 / 绝对 3 m）', () => {
    // 直接检验"网格不比客户端允许的更粗"：每个终止补片（非最细层）的判据值都必须低于阈值。
    // 半径判据是客户端 `||` 最左项，也是"贴近的薄结构不被地形盖住"的那条。
    const n = 128
    const field = make(n, 20, (i, j) => 20 + 8 * Math.sin(i / 5) * Math.cos(j / 5) + (j > 80 ? 6 : 0))
    const m = build(field, n, 600, { x: 0, y: 60, z: 40 })
    const M = m.metrics
    const probed = m.patches.filter((p) => !p.floored)
    expect(probed.length).toBeGreaterThan(20)
    for (const p of probed) {
      expect(p.radiusError).toBeLessThan(M.maxPatchRadiusError)
      expect(p.heightError).toBeLessThan(M.maxHeightError)
      expect(p.err).toBeLessThanOrEqual(M.maxAbsoluteHeightError)
    }
  })

  it('半径判据的世界空间后果：单元格边长 ≤ 0.08·视距 + 1 texel（"薄结构被地形盖住"回归）', () => {
    // 旧口径（顶点=texel 原值、只按高度误差细分、**每格一个四边形**）在 250 m 处留下 75 m 整格，
    // 实测在铁轨拾取点高出真值 +0.56 m ⇒ 越过铁轨 0.27 m 净空把组件盖住（2026-10-09 用户报障）。
    // 客户端：终止补片的顶点间距 = 补片边长/8（8×8 内部网格），半径判据再把补片压到屏幕尺度
    // ⇒ 单元格 ≈ 4% 视距。此断言即"不再出现 75 m 整格"的量化形式。
    const n = 256
    const tex = 600 / n
    const field = make(n, 20, (i, j) => 20 + 8 * Math.sin(i / 5) * Math.cos(j / 5))
    for (const cam of [{ x: 0, y: 20, z: 0 }, { x: 0, y: 250, z: 0 }, { x: 40, y: 400, z: -30 }]) {
      const m = build(field, n, 600, cam)
      const pos = m.positions, idx = m.indices
      let worst = 0
      for (let t = 0; t < idx.length; t += 3) {
        const A = idx[t] * 3, B = idx[t + 1] * 3, C = idx[t + 2] * 3
        const ex = Math.max(Math.abs(pos[A] - pos[B]), Math.abs(pos[A] - pos[C]), Math.abs(pos[B] - pos[C]))
        const ez = Math.max(Math.abs(pos[A + 2] - pos[B + 2]), Math.abs(pos[A + 2] - pos[C + 2]),
          Math.abs(pos[B + 2] - pos[C + 2]))
        const x = (pos[A] + pos[B] + pos[C]) / 3, y = (pos[A + 1] + pos[B + 1] + pos[C + 1]) / 3
        const z = (pos[A + 2] + pos[B + 2] + pos[C + 2]) / 3
        const d = Math.hypot(x - cam.x, y - cam.y, z - cam.z)
        worst = Math.max(worst, Math.max(ex, ez) / (0.08 * Math.max(d, 1) + tex))
      }
      expect(m.quads).toBeGreaterThan(64)          // 不是"整图最粗"
      expect(worst).toBeLessThanOrEqual(1)         // 每个单元格都在屏幕尺度内
    }
  })

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

// 高度场列口径（2026-10-13 用户"wotbtools 墙前有土包、游戏里没有"）：引擎顶点 k 在 `k/size`、取 texel k
// （`Heightmap::GetPoint` / `tilemask-vp.sl`，corner 口径）；场景 x = −游戏 x 的镜像若按 `size−1−c`
// 离散翻转列，翻转后第 c 列的真实位置是 `((c+1)/n − 0.5)·span` ⇒ 整张地形沿场景 −x 偏一格。
// 实测（6 张图）：编辑器贴地实例的原点高度与地形逐毫米吻合的数量只在"列偏一格"时成峰
// （plant 9→177、karelia 5→157、italy 0→301），行方向无偏。
describe('decodeTerrainField（高度场 = 场景系引擎顶点口径）', () => {
  const n = 8
  /** 引擎原始高度图（游戏朝向：列 = 游戏 x 从 min 起，行 = 游戏 y），值互不相同便于定位 */
  const raw = Array.from({ length: n * n }, (_, i) => 100 + i)
  const pack = (pick) => {
    const out = new Uint16Array(n * n)
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) out[r * n + c] = raw[r * n + pick(c)]
    return out.buffer
  }
  const legacyPack = () => pack((c) => n - 1 - c)                        // 旧打包器：离散翻转
  const enginePack = () => pack((c) => Math.min(n - c, n - 1))           // terrainLayout 2：corner 口径镜像
  // layout 必须显式：缺省 layout 不再按 1 猜（旧包 terrainLayout 缺失 ⇒ fail-closed 2D）
  const meta = (extra = {}) => ({ size: n, zmin: 0, zmax: 65535, terrainLayout: 1, ...extra })
  /** 场景顶点 j（x_j = (j/n − 0.5)·span）处的引擎真值：游戏 x = −x_j ⇒ 源列 n−j（GetHeightClamp 夹到 n−1） */
  const engineAt = (r, j) => raw[r * n + Math.min(n - j, n - 1)]

  it('两种布局解出同一张场景系引擎顶点高度场（旧包在读取边界平移一列）', () => {
    const legacy = decodeTerrainField(legacyPack(), meta())
    const engine = decodeTerrainField(enginePack(), meta({ terrainLayout: TERRAIN_LAYOUT_ENGINE_VERTEX }))
    for (let r = 0; r < n; r++) {
      for (let j = 0; j < n; j++) {
        expect(engine[r * n + j]).toBe(engineAt(r, j))
        expect(legacy[r * n + j]).toBe(engineAt(r, j))
      }
    }
  })

  it('行方向不动：只有列（镜像轴）补正', () => {
    const legacy = decodeTerrainField(legacyPack(), meta())
    const src = new Uint16Array(legacyPack())
    for (let r = 0; r < n; r++) {
      expect(legacy[r * n]).toBe(src[r * n])                   // 第 0 列 = 场景 −x 边界，夹取自身
      for (let j = 1; j < n; j++) expect(legacy[r * n + j]).toBe(src[r * n + j - 1])
    }
  })

  it('米制换算：zmin + u16·(zmax − zmin)/65535', () => {
    const buf = new Uint16Array(n * n).fill(65535).buffer
    const f = decodeTerrainField(buf, { size: n, zmin: 20, zmax: 100, terrainLayout: 2 })
    expect(f[0]).toBeCloseTo(100)
    const z = decodeTerrainField(new Uint16Array(n * n).buffer,
                                 { size: n, zmin: 20, zmax: 100, terrainLayout: 1 })
    expect(z[n * n - 1]).toBeCloseTo(20)
  })

  it('fail-closed：尺寸不符 / 未知布局 / 缺 layout 或高度范围 ⇒ null', () => {
    expect(decodeTerrainField(new Uint16Array(n * n - 1).buffer, meta())).toBeNull()
    expect(decodeTerrainField(null, meta())).toBeNull()
    expect(decodeTerrainField(enginePack(), meta({ terrainLayout: 3 }))).toBeNull()
    expect(decodeTerrainField(enginePack(), meta({ terrainLayout: '2' }))).toBeNull()
    // terrain.json 缺失/缺字段时不得按缺省 layout 1 + zmax 100 解码（会差一列且高度缩放错）
    expect(decodeTerrainField(enginePack(), { size: n, zmin: 0, zmax: 65535 })).toBeNull()
    expect(decodeTerrainField(enginePack(), { size: n, zmax: 65535, terrainLayout: 2 })).toBeNull()
    expect(decodeTerrainField(enginePack(), { size: n, zmin: 0, terrainLayout: 2 })).toBeNull()
    expect(terrainFieldMetaValid(meta())).toBe(true)
    expect(terrainFieldMetaValid({ size: n, zmin: 0, zmax: 65535 })).toBe(false)
    expect(terrainFieldMetaValid({ size: n, zmin: 10, zmax: 9, terrainLayout: 2 })).toBe(false)
    expect(terrainFieldMetaValid({ size: n, zmin: 10, zmax: 10, terrainLayout: 2 })).toBe(true)
    // null / '' / false 不得被 Number() 强转成 0 后当作合法高度范围
    for (const bad of [null, '', false]) {
      expect(terrainFieldMetaValid({ size: n, zmin: bad, zmax: 100, terrainLayout: 2 })).toBe(false)
      expect(terrainFieldMetaValid({ size: n, zmin: 0, zmax: bad, terrainLayout: 2 })).toBe(false)
    }
    // 单点高度场（size=1）会让 buildAdaptiveTerrain 抛错并同时失去地形/底图，提前拒绝
    expect(terrainFieldMetaValid({ size: 1, zmin: 0, zmax: 1, terrainLayout: 2 })).toBe(false)
    expect(decodeTerrainField(new Uint16Array([0]).buffer, { size: 1, zmin: 0, zmax: 1, terrainLayout: 2 })).toBeNull()
  })

  it('worldBounds 契约：只接受居中正方形（当前消费口径）', () => {
    expect(terrainBoundsOk({ worldBounds: { min: [-300, -300, 0], max: [300, 300, 70] } })).toBe(true)
    expect(terrainBoundsOk({ worldBounds: { min: [-300, -290, 0], max: [300, 310, 70] } })).toBe(false)
    expect(terrainBoundsOk({ worldBounds: { min: [-200, -300, 0], max: [400, 300, 70] } })).toBe(false)
    expect(terrainBoundsOk({ worldBounds: { min: [null, -300, 0], max: [300, 300, 70] } })).toBe(false)
    expect(terrainBoundsOk({ worldBounds: { min: ['-300', '-300', 0], max: ['300', '300', 70] } })).toBe(false)
    expect(terrainBoundsOk({})).toBe(true)   // 旧包无 bounds：由 span 校验兜底
  })
})

// json/bin 配对（PR #615 review P2）：terrain.json（no-cache）与 bin（max-age=3600）独立请求，发布切换期
// "新 json + 缓存旧 bin" 会跳过补正、"旧 json + 新 bin" 会再平移一列（实测 plant 250019/262144 个高度不同、
// 最大差 5.6 m）。上游 terrain.json 带 terrainBinSha256 作配对锚点。
describe('terrain json/bin 配对（terrainBinSha256）', () => {
  const bytes = new Uint16Array([1, 2, 3, 4]).buffer
  const sha = createHash('sha256').update(Buffer.from(bytes)).digest('hex')

  it('bin URL 以 sha 作缓存键；无合法 sha（旧包）原样返回', () => {
    expect(pairedTerrainBinUrl('/map/plant/terrain.u16.bin', { terrainBinSha256: sha }))
      .toBe(`/map/plant/terrain.u16.bin?sha256=${sha}`)
    expect(pairedTerrainBinUrl('/x.bin?a=1', { terrainBinSha256: sha })).toBe(`/x.bin?a=1&sha256=${sha}`)
    expect(pairedTerrainBinUrl('/x.bin', {})).toBe('/x.bin')
    expect(pairedTerrainBinUrl('/x.bin', { terrainBinSha256: 'not-a-sha' })).toBe('/x.bin')
    expect(pairedTerrainBinUrl('/x.bin', { terrainBinSha256: sha.toUpperCase() })).toBe('/x.bin')
  })

  it('字节与声明 sha 一致才算配对；不一致 ⇒ false（调用方 fail-closed 回退 2D）', async () => {
    expect(await terrainBinMatchesMeta(bytes, { terrainBinSha256: sha })).toBe(true)
    const other = new Uint16Array([1, 2, 3, 5]).buffer
    expect(await terrainBinMatchesMeta(other, { terrainBinSha256: sha })).toBe(false)
  })

  it('旧包无 sha ⇒ true；有 sha 但环境无 WebCrypto ⇒ false（不能假装配对成功）', async () => {
    expect(await terrainBinMatchesMeta(bytes, {})).toBe(true)
    expect(await terrainBinMatchesMeta(bytes, { terrainBinSha256: sha }, null)).toBe(false)
  })
})
