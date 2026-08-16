/**
 * Texture-Baked Top-View prototype（Phase B）— 纯函数契约测试（B16 #9-18）。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
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
    // turret 三角形在 bounds 外 → 不渲染；输出仍为 hull 独立资产
    const i = (24 * 32 + 24) * 4
    expect(out.rgba[i + 3]).toBe(0) // turret 区域透明
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
    const i = (16 * 64 + 32) * 4
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

describe('Phase B — neutralize（B8 中性化）', () => {
  it('去色保留亮度（luma 主导）且局部对比保留', () => {
    const [r, g, b] = neutralize([100, 150, 200], 0.75)
    const luma = 0.299 * 100 + 0.587 * 150 + 0.114 * 200
    expect(r).toBeCloseTo(luma * 0.25 + 100 * 0.75, 3)
    expect(g).toBeCloseTo(luma * 0.25 + 150 * 0.75, 3)
    expect(b).toBeCloseTo(luma * 0.25 + 200 * 0.75, 3)
  })
})
