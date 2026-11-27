import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { collectInstanceEntries, groupInstanceBatches, canonicalizeEntryMaterials } from './sceneryInstancing.js'
import { geo, mat } from '../test/sceneryInstancingTestHelpers.js'



describe('canonicalizeEntryMaterials · 材质签名规整（2026-11-14 帧率优化）', () => {
  const entryOf = (material) => ({ node: null, name: 'n', geometry: null, material, matrix: null, x: 0, y: 0, z: 0, lm: null })

  it('同配置不同对象的材质收敛到同一代表对象', () => {
    const a = mat(), b = mat()
    const entries = [entryOf(a), entryOf(b)]
    canonicalizeEntryMaterials(entries)
    expect(entries[0].material).toBe(entries[1].material)
    expect(entries[0].material).toBe(a)
  })

  it('渲染相关属性任一不同都不合并（纹理/颜色/透明/双面/透明度）', () => {
    const base = mat()
    const tex1 = new THREE.Texture()
    const tex2 = new THREE.Texture()
    const variants = [
      () => Object.assign(mat(), { map: tex1 }),
      () => Object.assign(mat(), { map: tex2 }),
      () => Object.assign(mat(), { color: new THREE.Color(0xff0000) }),
      () => Object.assign(mat(), { transparent: true }),
      () => Object.assign(mat(), { opacity: 0.5 }),
      () => Object.assign(mat(), { side: THREE.DoubleSide }),
      () => Object.assign(mat(), { alphaTest: 0.1 }),
    ]
    const entries = [entryOf(base), ...variants.map(v => entryOf(v()))]
    canonicalizeEntryMaterials(entries)
    const mats = entries.map(e => e.material)
    expect(new Set(mats).size).toBe(mats.length)
  })

  it('多材质叶子（契约外）原样跳过，不抛错', () => {
    const m = [mat(), mat()]
    const entries = [entryOf(m), entryOf(m)]
    expect(canonicalizeEntryMaterials(entries)[0].material).toBe(m)
  })

  it('几何不做内容级签名：同签名不同 uuid 的几何仍分属不同组（形状差异不可凭签名断言）', () => {
    const root = new THREE.Object3D()
    root.add(new THREE.Mesh(geo(2), mat()))
    root.add(new THREE.Mesh(geo(2), mat()))
    root.updateMatrixWorld(true)
    const batches = groupInstanceBatches(collectInstanceEntries(root))
    expect(batches).toHaveLength(2)
  })

  it('ShaderMaterial 按 uniforms+着色器签名：uniform 不同不合并（2026-11-14 建筑物贴图串图回归）', () => {
    const shaderOf = (tex, tint) => {
      const m = new THREE.ShaderMaterial({
        uniforms: { map: { value: tex }, uTint: { value: tint }, uOpacity: { value: 1 } },
        vertexShader: 'void main(){}', fragmentShader: 'void main(){}',
      })
      return m
    }
    const texA = new THREE.Texture(), texB = new THREE.Texture()
    const sA = shaderOf(texA, new THREE.Color(0xffffff))
    const sB = shaderOf(texB, new THREE.Color(0xffffff))
    const sC = shaderOf(texA, new THREE.Color(0x808080))
    const sD = shaderOf(texA, new THREE.Color(0xffffff))
    const entries = [entryOf(sA), entryOf(sB), entryOf(sC), entryOf(sD)]
    canonicalizeEntryMaterials(entries)
    expect(entries[0].material).toBe(sA)
    expect(entries[1].material).toBe(sB)
    expect(entries[2].material).toBe(sC)
    expect(entries[3].material).toBe(sA)
  })

  it('带 onBeforeCompile 注入的材质一律不合并（无法静态签名）', () => {
    const mk = () => Object.assign(new THREE.MeshLambertMaterial(), { onBeforeCompile: () => {} })
    const a = mk(), b = mk()
    const entries = [entryOf(a), entryOf(b)]
    canonicalizeEntryMaterials(entries)
    expect(entries[0].material).toBe(a)
    expect(entries[1].material).toBe(b)
  })

  it('仅 defines 不同的 ShaderMaterial 不合并（评审 P2：makeDecalMaterial 的 DECAL_SEPARATE_LM）', () => {
    const sharedLmTex = new THREE.Texture()
    const sharedTint = new THREE.Color(0xffffff)
    const mk = (separateLm) => new THREE.ShaderMaterial({
      uniforms: { colormapLm: { value: sharedLmTex }, uTint: { value: sharedTint } },
      defines: separateLm ? { DECAL_SEPARATE_LM: 1 } : {},
      vertexShader: 'void main(){}', fragmentShader: 'void main(){}',
    })
    const withLm = mk(true), withoutLm = mk(false)
    const entries = [entryOf(withLm), entryOf(withoutLm)]
    canonicalizeEntryMaterials(entries)
    expect(entries[0].material).toBe(withLm)
    expect(entries[1].material).toBe(withoutLm)
  })

  it('HDR tint 不合并：颜色签名用原始 RGB，不经 8-bit hex（评审 P2）', () => {
    const sharedTex = new THREE.Texture()
    const mk = (tint) => new THREE.ShaderMaterial({
      uniforms: { colormapLm: { value: sharedTex }, uTint: { value: tint } },
      vertexShader: 'void main(){}', fragmentShader: 'void main(){}',
    })
    const unit = mk(new THREE.Color(1, 1, 1))
    const hdr = mk(new THREE.Color(1.77, 1.77, 1.77))
    expect(unit.uniforms.uTint.value.getHexString()).toBe(hdr.uniforms.uTint.value.getHexString())
    const entries = [entryOf(unit), entryOf(hdr)]
    canonicalizeEntryMaterials(entries)
    expect(entries[0].material).toBe(unit)
    expect(entries[1].material).toBe(hdr)
    const same = mk(new THREE.Color(1.77, 1.77, 1.77))
    const pair = [entryOf(mk(new THREE.Color(1.77, 1.77, 1.77))), entryOf(same)]
    canonicalizeEntryMaterials(pair)
    expect(pair[1].material).toBe(pair[0].material)
  })

  it('仅 annotationSurface 策略不同的材质不合并（评审 P2：薄片贴花 vs 实体可绘制面）', () => {
    const sharedTex = new THREE.Texture()
    const sharedTint = new THREE.Color(0xffffff)
    const mk = (annotationSurface) => {
      const m = new THREE.ShaderMaterial({
        uniforms: { colormapLm: { value: sharedTex }, uTint: { value: sharedTint } },
        vertexShader: 'void main(){}', fragmentShader: 'void main(){}',
      })
      if (annotationSurface !== undefined) m.userData.annotationSurface = annotationSurface
      return m
    }
    const solid = mk(undefined)
    const overlay = mk(false)
    const entries = [entryOf(solid), entryOf(overlay)]
    canonicalizeEntryMaterials(entries)
    expect(entries[0].material).toBe(solid)
    expect(entries[1].material).toBe(overlay)
    const explicitTrue = mk(true)
    const merged = [entryOf(mk(undefined)), entryOf(explicitTrue)]
    canonicalizeEntryMaterials(merged)
    expect(merged[1].material).toBe(merged[0].material)
  })

  it('仅渲染状态（side / depthWrite / transparent）不同的 ShaderMaterial 不合并', () => {
    const sharedTex = new THREE.Texture()
    const mk = (patch) => Object.assign(new THREE.ShaderMaterial({
      uniforms: { uMap: { value: sharedTex } },
      vertexShader: 'void main(){}', fragmentShader: 'void main(){}',
    }), patch)
    const base = mk({})
    const variants = [
      mk({ side: THREE.DoubleSide }),
      mk({ depthWrite: false }),
      mk({ transparent: true }),
    ]
    const entries = [entryOf(base), ...variants.map(entryOf)]
    canonicalizeEntryMaterials(entries)
    expect(new Set(entries.map(e => e.material)).size).toBe(4)
  })
})
