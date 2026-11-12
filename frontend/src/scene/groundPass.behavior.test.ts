// 地面 pass 资源工厂行为测试（#827 接替 sceneryMaterials.test.js 的 :773/:679 源码守卫）：
// - makeGroundMaterial 分层分支：uHbSoft 必须是 Vector4（曾误写 uniform float ⇒ JS 下发
//   Vector4 收到 NaN ⇒ 9 张 HEIGHT_BLEND 图地面取错层色）；类型声明与下发值一致；
// - makeWaterCoast：淡出阈值量纲 = 本渲染器深度分辨率（uDepthUlp = 2/2^depthBits），
//   由调用方按各自上下文实测 depthBits 传入。
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { makeGroundMaterial, makeWaterCoast } from './groundPass.js'

const layers = {
  tiling: [1, 1],
  tile_scale: [1, 1, 1, 1],
  tile_colors: [[1, 1, 1], [0.5, 0.5, 0.5]],
  flat_color: [0, 0, 0],
  lm_adjust: [0, 1, 1],
  tilemask_weight: 0.5,
  hb_scale: [1, 1, 1, 1],
  hb_offset: [0, 0, 0, 0],
  hb_softness: [0.25, 0.5, 0.75, 1.0],
}

const texs = {
  cm: new THREE.Texture(), lm: new THREE.Texture(),
  tile0: new THREE.Texture(), tile1: new THREE.Texture(),
  mask0: new THREE.Texture(), mask1: new THREE.Texture(),
}

describe('makeGroundMaterial（分层地表）', () => {
  it(':773 HEIGHT_BLEND 下发值 uHbSoft/uHbScale/uHbOffset 均为 Vector4（声明类型对齐）', () => {
    const mat = makeGroundMaterial({ layers, texs, size: 600 }) as THREE.ShaderMaterial
    expect(mat.isShaderMaterial).toBe(true)
    for (const u of ['uHbSoft', 'uHbScale', 'uHbOffset']) {
      expect(mat.uniforms[u].value).toBeInstanceOf(THREE.Vector4)
    }
    // JS 下发值逐分量保留（值 NaN 会让混合权重全废）
    const hb = mat.uniforms.uHbSoft.value as THREE.Vector4
    expect(hb.x).toBeCloseTo(0.25)
    expect(hb.w).toBeCloseTo(1.0)
    // 着色器声明侧同样是 vec4（uniform1f 收到对象 ⇒ NaN 的根因）
    expect(mat.fragmentShader).toMatch(/uniform vec4 uHbSoft;/)
    expect(mat.fragmentShader).not.toMatch(/uniform float uHbSoft;/)
  })

  it('无分层（旧包）→ 回退底图 MeshBasicMaterial', () => {
    const mapTexture = new THREE.Texture()
    const mat = makeGroundMaterial({ size: 600, mapTexture }) as THREE.MeshBasicMaterial
    expect(mat.isMeshBasicMaterial).toBe(true)
    expect(mat.map).toBe(mapTexture)
  })
})

describe('makeWaterCoast（海岸线资源）', () => {
  it(':679 淡出阈值 = 2/2^depthBits（随调用方实测位深变化），高度纹理数据纹理口径', () => {
    const field = new Float32Array(64).fill(3)
    const coast = makeWaterCoast({ field, n: 8, span: 600, near: 0.5, far: 4000 })
    expect(coast.depthUlp).toBeCloseTo(2 / 2 ** 24, 20)   // 缺省 24bit
    expect(coast.mapSpan).toBe(600)
    expect(coast.heightTex.image.width).toBe(8)
    expect(coast.heightTex.colorSpace).toBe(THREE.NoColorSpace)   // 数据纹理（C3 口径）
    // 16bit 深度上下文（烘焙/低端）→ 阈值放宽 2^8 倍
    const coast16 = makeWaterCoast({ field, n: 8, span: 600, near: 0.5, far: 4000, depthBits: 16 })
    expect(coast16.depthUlp).toBeCloseTo(2 / 2 ** 16, 20)
  })
})
