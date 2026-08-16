/**
 * Texture-Baked Top-View prototype（Phase B）— 纯函数契约测试（B16 #9-18）。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { bakeTopView, encodePng, interpolateUV, neutralize, sampleTexture } from '../../scripts/texture-bake-lib.mjs'

const ASSETS = fileURLToPath(new URL('./assets/maus/', import.meta.url))

/** 1×1 白纹理（单像素）。 */
const whiteTex = { data: new Uint8Array([255, 255, 255, 255]), width: 1, height: 1 }
/** 2×2 四色纹理。 */
const quadTex = {
  data: new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]),
  width: 2,
  height: 2,
}

const OPAQUE = { baseColor: 0, occlusion: -1, normal: -1, alphaMode: 'OPAQUE', alphaCutoff: 0.05 }
const bounds = { minX: 0, minY: 0, maxX: 4, maxY: 4 }

describe('Phase B9 — UV barycentric interpolation', () => {
  it('重心坐标 → UV 插值正确', () => {
    const uvs = [0, 0, 1, 0, 0, 1]
    expect(interpolateUV(uvs, 1, 0, 0)).toEqual([0, 0])
    expect(interpolateUV(uvs, 0, 1, 0)).toEqual([1, 0])
    expect(interpolateUV(uvs, 0, 0, 1)).toEqual([0, 1])
    const mid = interpolateUV(uvs, 1 / 3, 1 / 3, 1 / 3)
    expect(mid[0]).toBeCloseTo(1 / 3, 6)
    expect(mid[1]).toBeCloseTo(1 / 3, 6)
  })
})

describe('Phase B10 — texture sampling deterministic', () => {
  it('相同输入两次采样输出一致', () => {
    const a = sampleTexture(quadTex.data, 2, 2, 0.5, 0.5)
    const b = sampleTexture(quadTex.data, 2, 2, 0.5, 0.5)
    expect(a).toEqual(b)
  })
  it('wrap 采样（UV 超出 [0,1] 不越界）', () => {
    const c = sampleTexture(quadTex.data, 2, 2, 1.5, 1.5)
    const d = sampleTexture(quadTex.data, 2, 2, 0.5, 0.5)
    expect(c).toEqual(d)
  })
})

describe('Phase B11 — alpha cutoff（MASK 材质）', () => {
  it('alpha < cutoff 的片元透明且不遮挡下层（不写 z）', () => {
    // 下层白面 + 上层半透明 MASK 面（alpha 0.01 < cutoff 0.05 → 丢弃）
    const maskTex = { data: new Uint8Array([255, 0, 0, 2]), width: 1, height: 1 } // alpha=2/255
    const lower = { p: [0, 0, 1, 4, 0, 1, 0, 4, 1], uv: [0, 0, 1, 0, 0, 1], material: 0 }
    const upper = { p: [0.5, 0.5, 2, 3.5, 0.5, 2, 0.5, 3.5, 2], uv: [0, 0, 1, 0, 0, 1], material: 1 }
    const out = bakeTopView({
      triangles: [lower, upper],
      textures: [whiteTex, maskTex],
      materials: [OPAQUE, { baseColor: 1, occlusion: -1, normal: -1, alphaMode: 'MASK', alphaCutoff: 0.05 }],
      bounds,
      resolution: 32,
    })
    // 上层被 alpha 丢弃 → 下层可见（白色，alpha 255）
    const i = (8 * 32 + 8) * 4
    expect(out.rgba[i + 3]).toBe(255) // 不透明（下层）
    expect(out.rgba[i]).toBe(255) // 白色（下层）
  })
})

describe('Phase B12 — z-buffer topmost surface', () => {
  it('重叠三角形取 z 最高者', () => {
    const lower = { p: [0, 0, 1, 4, 0, 1, 0, 4, 1], uv: null, material: 0 }
    const upper = { p: [0, 0, 3, 4, 0, 3, 0, 4, 3], uv: null, material: 0 }
    const out = bakeTopView({ triangles: [lower, upper], textures: [whiteTex], materials: [OPAQUE], bounds, resolution: 32 })
    const i = (8 * 32 + 8) * 4
    expect(out.rgba[i + 3]).toBe(255)
  })
})

describe('Phase B13 — hull/turret 独立 bake', () => {
  it('hull 场景不含 turret 三角形（独立资产语义）', () => {
    const hullTri = { p: [0, 0, 1, 4, 0, 1, 0, 4, 1], uv: null, material: 0 }
    const turretTri = { p: [8, 8, 2, 9, 8, 2, 8, 9, 2], uv: null, material: 0 } // 画布外（hull 场景 bounds 内不可见）
    const out = bakeTopView({
      triangles: [hullTri, turretTri],
      textures: [whiteTex],
      materials: [OPAQUE],
      bounds,
      resolution: 32,
    })
    // hull 三角形覆盖模型 x+y<=4（0..4 方块的一半）；Y flip 后行序反向但覆盖面不变
    const insideHull = (8 * 32 + 24) * 4 // 像素 (24,8) = 模型 (3.06,2.94) → x+y>4 → hull 外
    expect(out.rgba[insideHull + 3]).toBe(0)
    // turret 三角形在 bounds 外（x/y 均越界）→ Y flip 下被裁剪跳过；输出仍为 hull 独立资产
    const clampedCorner = (0 * 32 + 31) * 4 // 像素 (31,0) = 模型 (3.94,3.94)：hull 外 + turret 不渲染 → 透明
    expect(out.rgba[clampedCorner + 3]).toBe(0)
    const inHull = (16 * 32 + 8) * 4 // 像素 (8,16) = 模型 (1,2) → x+y=3 <= 4 → hull 内
    expect(out.rgba[inHull + 3]).toBe(255)
  })
})

describe('Phase B14 — turretPivot 不变（bake 与 SVG 共用 fit）', () => {
  it('bake-report 的 turretPivot 与正式 metadata 一致', () => {
    const report = JSON.parse(readFileSync(ASSETS + 'bake-report.json', 'utf8'))
    const meta = JSON.parse(readFileSync(ASSETS + 'metadata.json', 'utf8'))
    expect(report.turretPivot).toEqual(meta.turretPivot)
    expect(report.output.logicalViewBox).toBe('0 0 320 320')
    expect(report.output.physicalPixelSize).toEqual([640, 640])
  })
})

describe('Phase B15 — transparent background', () => {
  it('车辆外像素 alpha = 0（无黑/白底）', () => {
    const tri = { p: [1, 1, 1, 3, 1, 1, 1, 3, 1], uv: [0, 0, 1, 0, 0, 1], material: 0 }
    const out = bakeTopView({ triangles: [tri], textures: [whiteTex], materials: [OPAQUE], bounds, resolution: 64 })
    expect(out.rgba[0 * 4 + 3]).toBe(0) // 角落（车辆外）透明
    // Y flip 后模型 (1..3, 1..3) 覆盖 raster 行 16..48；像素 (32,40) = 模型 (2,1.5) → 车辆内
    const i = (40 * 64 + 32) * 4
    expect(out.rgba[i + 3]).toBeGreaterThan(0) // 车辆内不透明
  })
})

describe('Phase B16 — stable output hash（确定性）', () => {
  const tri = { p: [0, 0, 1, 4, 0, 1, 0, 4, 1], uv: [0, 0, 1, 0, 0, 1], material: 0 }
  it('bakeTopView 相同输入两次输出一致', () => {
    const a = bakeTopView({ triangles: [tri], textures: [whiteTex], materials: [OPAQUE], bounds, resolution: 32 })
    const b = bakeTopView({ triangles: [tri], textures: [whiteTex], materials: [OPAQUE], bounds, resolution: 32 })
    expect(Buffer.from(a.rgba).equals(Buffer.from(b.rgba))).toBe(true)
  })
  it('encodePng 相同输入两次输出一致（稳定 hash）', () => {
    const a = encodePng(new Uint8Array([1, 2, 3, 4]), 1, 1)
    const b = encodePng(new Uint8Array([1, 2, 3, 4]), 1, 1)
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true)
  })
})

describe('Phase B17 — texture missing controlled behavior', () => {
  it('material 引用缺失纹理 → 受控输出（不崩溃；中性色 fallback）', () => {
    const tri = { p: [0, 0, 1, 4, 0, 1, 0, 4, 1], uv: [0, 0, 1, 0, 0, 1], material: 0 }
    const out = bakeTopView({
      triangles: [tri],
      textures: [], // 无纹理
      materials: [{ baseColor: 0, occlusion: -1, normal: -1, alphaMode: 'OPAQUE', alphaCutoff: 0.05 }],
      bounds,
      resolution: 32,
    })
    const i = (8 * 32 + 8) * 4
    expect(out.rgba[i + 3]).toBe(255) // 有表面
    expect(out.rgba[i]).toBe(255) // fallback 中性白
  })
})

describe('Phase B18 — production/runtime 无 BlitzKit 网络', () => {
  it('texture-bake-lib 纯函数库不含网络调用', () => {
    const src = readFileSync(new URL('../../scripts/texture-bake-lib.mjs', import.meta.url), 'utf8')
    expect(src).not.toMatch(/\bfetch\s*\(/)
    expect(src).not.toMatch(/https?:\/\//)
  })
})

describe('Phase B19 — RASTER_Y_AXIS_CONTRACT（方向测试：model +Y → raster top，0° = 12 点）', () => {
  const DIR_BOUNDS = { minX: 0, minY: 0, maxX: 4, maxY: 4 }
  // 非对称三角形：apex 在模型 +Y（forward 端），底边在 -Y（rear 端）
  const asymTri = { p: [1, 1, 1, 3, 1, 1, 2, 4, 1], uv: null, material: 0 }

  const rowSpan = (out, y) => {
    let cnt = 0
    for (let x = 0; x < out.width; x++) if (out.rgba[(y * out.width + x) * 4 + 3] > 40) cnt++
    return cnt
  }

  it('+Y apex 必须出现在 raster 上方（top rows），-Y 底边在下方', () => {
    const out = bakeTopView({ triangles: [asymTri], textures: [whiteTex], materials: [OPAQUE], bounds: DIR_BOUNDS, resolution: 64 })
    // 找首/末覆盖行（raster 行 = 屏幕 y，上小下大）
    let topRow = -1, bottomRow = -1
    for (let y = 0; y < out.height; y++) {
      if (rowSpan(out, y) > 0) { if (topRow < 0) topRow = y; bottomRow = y }
    }
    // apex（model y=4）→ 翻转后必须贴 raster top；底边（model y=1）贴下方
    expect(topRow).toBeLessThanOrEqual(1)
    expect(bottomRow).toBeGreaterThanOrEqual(47)
    // 顶窄底宽（apex 细、底边宽）——0° = 车头朝 12 点
    const topMean = (rowSpan(out, topRow) + rowSpan(out, topRow + 1)) / 2
    const botMean = (rowSpan(out, bottomRow) + rowSpan(out, bottomRow - 1)) / 2
    expect(topMean).toBeLessThan(botMean)
  })

  it('Y flip 对确定性无副作用（相同输入两次输出一致）', () => {
    const a = bakeTopView({ triangles: [asymTri], textures: [whiteTex], materials: [OPAQUE], bounds: DIR_BOUNDS, resolution: 32 })
    const b = bakeTopView({ triangles: [asymTri], textures: [whiteTex], materials: [OPAQUE], bounds: DIR_BOUNDS, resolution: 32 })
    expect(Buffer.from(a.rgba).equals(Buffer.from(b.rgba))).toBe(true)
    expect(a.covered).toBe(b.covered)
  })
})

describe('Phase B20 — orientation regression（正式资产 bake-report 真实 raster 方向指纹）', () => {
  // 用户指定回归组：Grille 15 / Maus / Leopard 1 / FV4005（turret + hull）
  const REGRESSION_KEYS = ['grille-15', 'maus', 'leopard-1', 'fv4005']
  const readReport = (key) => JSON.parse(readFileSync(fileURLToPath(new URL(`./assets/${key}/bake-report.json`, import.meta.url)), 'utf8'))

  it('turret raster 的 top 覆盖行 = 完整炮塔装配的 forward 端（gunBounds.maxY）', () => {
    for (const key of REGRESSION_KEYS) {
      const rep = readReport(key)
      const ori = rep.rasterOrientation?.turret
      expect(ori, `${key} 缺 rasterOrientation.turret`).toBeTruthy()
      const expectedTop = Math.max(rep.turretBounds.max[1], rep.gunBounds.max[1])
      expect(Math.abs(ori.topModelY - expectedTop), `${key} topModelY 不是 forward 端`).toBeLessThan(0.01)
      expect(Math.abs(ori.topCoveredModelY - expectedTop), `${key} 实际 top 覆盖行不在 forward 端（方向错误）`).toBeLessThan(0.1)
      expect(ori.bottomCoveredModelY).toBeLessThan(ori.topCoveredModelY)
      // 炮管（forward）窄于炮塔体（rear）——gun 必须在图片上方
      expect(ori.topWidthMean, `${key} top 行不窄于 bottom 行（gun 未朝上）`).toBeLessThan(ori.bottomWidthMean)
    }
  })

  it('hull raster 的 top 覆盖行 = 车体 forward 端（hullBounds.maxY）', () => {
    for (const key of REGRESSION_KEYS) {
      const rep = readReport(key)
      const ori = rep.rasterOrientation?.hull
      expect(ori, `${key} 缺 rasterOrientation.hull`).toBeTruthy()
      expect(Math.abs(ori.topCoveredModelY - rep.hullBounds.max[1]), `${key} hull top 覆盖行不在 forward 端（方向错误）`).toBeLessThan(0.1)
      expect(ori.topCoveredModelY).toBeGreaterThan(ori.bottomCoveredModelY)
    }
  })

  it('Grille 15 炮口（gun forward endpoint +8.04）位于 turret.webp 上方（像素级）', () => {
    const rep = readReport('grille-15')
    const ori = rep.rasterOrientation.turret
    expect(ori.topModelY).toBeCloseTo(8.04, 2) // gunBounds.maxY
    expect(ori.topRowCovered).toBeLessThanOrEqual(2) // forward 端贴 raster top
    expect(ori.topWidthMean).toBeLessThan(ori.bottomWidthMean * 0.75) // 炮管明显窄于炮塔体
  })

  it('全部资产 bake-report 都带方向指纹且 hull top = forward 端', () => {
    const assetsDir = fileURLToPath(new URL('./assets/', import.meta.url))
    const keys = readdirSync(assetsDir).filter((n) => /^[a-z0-9-]+$/.test(n))
    expect(keys.length).toBeGreaterThanOrEqual(78)
    for (const key of keys) {
      const rep = readReport(key)
      const ori = rep.rasterOrientation?.hull
      expect(ori, `${key} 缺 rasterOrientation.hull`).toBeTruthy()
      expect(Math.abs(ori.topCoveredModelY - rep.hullBounds.max[1]), `${key} hull top 覆盖行不在 forward 端`).toBeLessThan(0.15)
      expect(ori.topCoveredModelY).toBeGreaterThan(ori.bottomCoveredModelY)
    }
  })
})

describe('Phase B — neutralize（B8 中性化，Blocker 3 语义反向修复）', () => {
  it('amount = 去色强度：0=原色、1=纯灰（文档语义与实现一致）', () => {
    const luma = 0.299 * 100 + 0.587 * 150 + 0.114 * 200
    // amount=0 → 完全原色
    const [r0, g0, b0] = neutralize([100, 150, 200], 0)
    expect(r0).toBe(100)
    expect(g0).toBe(150)
    expect(b0).toBe(200)
    // amount=1 → 纯灰（luma）
    const [r1, g1, b1] = neutralize([100, 150, 200], 1)
    expect(r1).toBeCloseTo(luma, 9)
    expect(g1).toBeCloseTo(luma, 9)
    expect(b1).toBeCloseTo(luma, 9)
  })

  it('bake 默认 desaturate=0.25 → 75% 原色 + 25% luma（与旧反向语义 0.75 视觉等价）', () => {
    const [r, g, b] = neutralize([100, 150, 200], 0.25)
    const luma = 0.299 * 100 + 0.587 * 150 + 0.114 * 200
    expect(r).toBeCloseTo(100 * 0.75 + luma * 0.25, 3)
    expect(g).toBeCloseTo(150 * 0.75 + luma * 0.25, 3)
    expect(b).toBeCloseTo(200 * 0.75 + luma * 0.25, 3)
  })
})
