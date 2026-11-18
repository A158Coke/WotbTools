import { describe, it, expect } from 'vitest'
import {
  SUBDIVISION_METRICS, buildAdaptiveTerrain, CLIENT_NORMAL_CAMERA_FOV_H, buildRefineMask,
  morphFunc, subdivisionMetrics, groundMapUv, subdivMorphOf, terrainLodState, terrainLodStale,
  terrainLodStaleReason,
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

  it('terrainLodStaleReason：给出触发判据，布尔 terrainLodStale 由它派生（判据数值不变）', () => {
    const st = (o = {}) => ({
      d: 100, px: 0, py: 100, pz: 0, ux: 0, uy: 1, uz: 0, fovY: 0.8, aspect: 16 / 9, ...o,
    })
    expect(terrainLodStaleReason(null, st(), 0)).toBe('first')
    expect(terrainLodStaleReason(st(), st({ d: 90, py: 90 }), 500)).toBe('distance')
    expect(terrainLodStaleReason(st(), st({ d: 150, py: 150 }), 500)).toBe('distance')
    expect(terrainLodStaleReason(st(), st({ px: 6 }), 500)).toBe('lateral')          // 侧向 6% ≥ 5%
    expect(terrainLodStaleReason(st(), st({ fovY: 0.81 }), 500)).toBe('fov')
    expect(terrainLodStaleReason(st(), st({ aspect: 16 / 9 * 1.01 }), 500)).toBe('aspect')
    expect(terrainLodStaleReason(st(), st({ d: 96, py: 96 }), 500)).toBeNull()
    expect(terrainLodStaleReason(st(), st({ d: 90, py: 90 }), 50)).toBeNull()        // 节流挡住
    for (const cur of [st(), st({ d: 90, py: 90 }), st({ px: 6 }), st({ fovY: 0.81 }), st({ aspect: 2 })]) {
      for (const since of [0, 50, 500]) {
        expect(terrainLodStale(st(), cur, since)).toBe(terrainLodStaleReason(st(), cur, since) !== null)
      }
    }
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

})
