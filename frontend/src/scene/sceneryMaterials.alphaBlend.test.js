import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { foliageClip, makeBillboardMaterial, makeSpeedtreeStaticMaterial, makeLightmappedMaterial, makeDecalMaterial } from './sceneryMaterials.ts'

const marked = (name = 'marked') => {
  const m = new THREE.MeshStandardMaterial({ name, transparent: true, opacity: 0.5 })
  m.userData.alphaBlend = true
  m.map = new THREE.Texture()
  return m
}
const plainPseudo = (name = 'plain') => {
  const m = new THREE.MeshStandardMaterial({ name, transparent: true, opacity: 1 })
  m.map = new THREE.Texture()
  return m
}

describe('extras.alphaBlend 专用材质路由', () => {
  it('SpeedTree：标记材质保持混合，不进 alpha 裁切', () => {
    const m = marked('ST|leaf')
    const mat = makeSpeedtreeStaticMaterial(m, true)
    expect(mat.transparent).toBe(true)
    expect(mat.depthWrite).toBe(false)
    expect(mat.uniforms.uAlphaCut.value).toBeCloseTo(0.05)
    expect(mat.uniforms.uOpacity.value).toBeCloseTo(0.5)
    expect(mat.fragmentShader).toMatch(/uniform float uOpacity;/)
    expect(mat.fragmentShader).toMatch(/c\.a \* uOpacity/)
    const old = makeSpeedtreeStaticMaterial(plainPseudo('ST|leaf'), true)
    expect(old.transparent).toBe(false)
    expect(old.depthWrite).toBe(true)
    expect(old.uniforms.uAlphaCut.value).toBeCloseTo(0.33)
  })

  it('光照图：标记材质关闭裁切、输出 albedo alpha、透明不写深度', () => {
    const mat = makeLightmappedMaterial(marked('lm'), new THREE.Texture(), null, null)
    expect(mat.transparent).toBe(true)
    expect(mat.depthWrite).toBe(false)
    expect(mat.defines.ALPHA_BLEND).toBe(1)
    expect(mat.uniforms.uAlphaCut.value).toBe(0)
    expect(mat.uniforms.uOpacity.value).toBeCloseTo(0.5)
    expect(mat.fragmentShader).toMatch(/uniform float uOpacity;/)
    expect(mat.fragmentShader).toMatch(/gl_FragColor = vec4\(color, c\.a \* uOpacity\);/)
    const old = makeLightmappedMaterial(plainPseudo('lm'), new THREE.Texture(), null, null)
    expect(old.transparent).toBe(false)
    expect(old.defines.ALPHA_BLEND).toBeUndefined()
    expect(old.uniforms.uAlphaCut.value).toBeGreaterThan(0)
  })

  it('贴花：标记材质关闭裁切、输出 albedo alpha、透明不写深度', () => {
    const mat = makeDecalMaterial(marked('decal'), new THREE.Texture(), null, {})
    expect(mat.transparent).toBe(true)
    expect(mat.depthWrite).toBe(false)
    expect(mat.defines.ALPHA_BLEND).toBe(1)
    expect(mat.uniforms.uAlphaCut.value).toBe(0)
    expect(mat.uniforms.uOpacity.value).toBeCloseTo(0.5)
    expect(mat.fragmentShader).toMatch(/uniform float uOpacity;/)
    expect(mat.fragmentShader).toMatch(/gl_FragColor = vec4\(base\.rgb \* uTint \* shadowColor \* 2\.0, base\.a \* uOpacity\);/)
    const old = makeDecalMaterial(plainPseudo('decal'), new THREE.Texture(), null, {})
    expect(old.transparent).toBe(false)
    expect(old.defines.ALPHA_BLEND).toBeUndefined()
    expect(old.uniforms.uAlphaCut.value).toBeGreaterThan(0)
  })
})

describe('foliage clip', () => {
  it('shares one uniform so the recorder view can toggle every foliage material', () => {
    const material = { map: null, color: null, opacity: 1, userData: {} }
    for (const made of [makeBillboardMaterial(material), makeSpeedtreeStaticMaterial(material, true)]) {
      expect(made.uniforms.uFoliageClip).toBe(foliageClip)
      expect(made.fragmentShader).toContain('if (vViewDist < uFoliageClip) discard;')
    }
  })
})
