import { describe, it, expect } from 'vitest'
import {
  MAX_QUADS, PATCH_QUADS, SUBDIVISION_METRICS, buildAdaptiveTerrain, morphFunc, subdivisionMetrics,
  subdivMorphOf, terrainLodStale,
} from './terrainMesh.js'

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

  it('地形 LOD 滞回是**单向**的：拉近一律细化，拉远才允许变粗，且有 120 ms 节流', () => {
    // 回归（2026-10-10 用户"铁轨被地形遮挡，转动/缩放后时不时变正常"）：旧实现是双向 25% 滞回 ⇒
    // 网格会长期停在"更远视距"的**更粗**层级（同一相机位置可比客户端判据允许的更粗），
    // 粗格插值把地形抬到贴地薄结构之上，且随重建时机时有时无。
    expect(terrainLodStale(0, 100, 0)).toBe(true)          // 首帧必建
    expect(terrainLodStale(100, 96, 500)).toBe(false)      // 拉近 4% < 5% 阈值 ⇒ 不建
    expect(terrainLodStale(100, 90, 500)).toBe(true)       // 拉近 10% ⇒ 立即细化
    expect(terrainLodStale(100, 90, 50)).toBe(false)       // 但受 120 ms 节流
    expect(terrainLodStale(100, 110, 500)).toBe(false)     // 拉远仅 10% ⇒ 允许（仍够细）
    expect(terrainLodStale(100, 150, 500)).toBe(true)      // 拉远 ≥40% ⇒ 可变粗
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

  it('岸线特征（`shores`，第四条判据）：与水面标高相交的补片细到 1 texel，远处也把水陆交界解析出来', () => {
    // 2026-10-10 用户"和地形的交接处还是锯齿状：拉近之后锯齿变细、旋转时形状固定" ⇒ 定案为
    // **网格量化**（不是深度抢闪、不是数据噪声）：岸线在源数据里是 2–5 cm/texel 的平缓坡，
    // 客户端相机近 ⇒ 天然 1 texel 级；我们的回放相机常在上百米外 ⇒ 三条客户端判据（同一相机
    // 位置）合法地给粗格 ⇒ 平缓坡被量化成米级台阶。第四条判据：补片与水面占地相交且格点高度
    // 范围跨越其标高 ⇒ 细分到底（1 texel）；跨界判定与发射几何同源（同一批 texel 值）⇒ 无需余量常数。
    const n = 96, span = 96, step = span / n          // 1 m/texel
    const level = 12.25
    // 平缓坡：h = 10 + 0.03·j（跨 level 于 j≈75）
    const field = make(n, 10, (i, j) => 10 + 0.03 * j)
    const far = { x: 0, y: 400, z: 0 }
    const shore = [{ y: level, x0: -span / 2, x1: span / 2, z0: -span / 2, z1: span / 2 }]
    const coarse = build(field, n, span, far)
    const fine = buildAdaptiveTerrain({ field, n, span, cam: far, fovY: FOV, aspect: ASPECT, shores: shore })
    const mid = Math.floor(n / 2)
    const jCross = Math.ceil((level - 10) / 0.03)      // ≈ 75
    // 远相机下：无岸线判据 ⇒ 交界处是粗格；有判据 ⇒ 1 texel
    expect(coarse.sizeAt[mid * n + jCross]).toBeGreaterThan(1)
    expect(fine.sizeAt[mid * n + jCross]).toBe(1)
    // 只是**特征带**细分：远离标高（h 远低于/高于 level）的补片仍按客户端判据给粗格
    expect(fine.sizeAt[mid * n + 5]).toBeGreaterThan(1)
    expect(fine.sizeAt[mid * n + n - 2]).toBeGreaterThan(1)
    // 三角形数与预算：带内细、带外粗，且不触顶
    expect(fine.quads).toBeGreaterThan(coarse.quads)
    expect(fine.overBudget).toBe(false)
    // 混排（跨级）后仍无裂缝：共享边两侧逐点同高（口径同下一条用例）
    const S = fine.sizeAt
    const boundaries = new Set()
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const s = S[i * n + j]; if (!s) continue
      if (i > 0 && S[(i - 1) * n + j] && S[(i - 1) * n + j] !== s) boundaries.add(`h:${i}`)
      if (j > 0 && S[i * n + j - 1] && S[i * n + j - 1] !== s) boundaries.add(`v:${j}`)
    }
    let samples = 0, maxGap = 0
    for (const b of boundaries) {
      const [kind, at] = b.split(':')
      const fixed = (Number(at) / n) * span - span / 2
      for (let t = -span / 2 + step / 8; t < span / 2 - 1e-9; t += step / 4) {
        const p = kind === 'h' ? [t, fixed] : [fixed, t]
        const r = surfaceAt(fine, p[0], p[1])
        if (!r) continue
        samples++; maxGap = Math.max(maxGap, r[1] - r[0])
      }
    }
    expect(samples).toBeGreaterThan(20)
    expect(maxGap).toBeLessThanOrEqual(1e-4)
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
})
