import { describe, it, expect, vi } from 'vitest'
import { collectMaterialTextures, sharedOwnedTextures } from './materialDispose.js'

const tex = (id) => ({ isTexture: true, id, dispose: vi.fn() })

describe('collectMaterialTextures', () => {
  it('收集直接属性与 uniforms 中的纹理，Set 去重共享纹理', () => {
    const t1 = tex(1), t2 = tex(2), t3 = tex(3)
    const m = {
      map: t1,
      alphaMap: t2,
      uniforms: { map: { value: t1 }, occl: { value: t3 }, nothing: { value: 42 } },
    }
    const out = collectMaterialTextures(m)
    expect(out.size).toBe(3)
    expect(out.has(t1) && out.has(t2) && out.has(t3)).toBe(true)
  })
  it('普通材质无 uniforms 不抛错；空材质返回空集合', () => {
    expect(collectMaterialTextures({}).size).toBe(0)
    expect(collectMaterialTextures({ uniforms: {} }).size).toBe(0)
  })
})

describe('sharedOwnedTextures', () => {
  it('收齐 groundLayers.texs 全部共享纹理与 heightTex；空入参不抛错', () => {
    const cm = tex(1), lm = tex(2)
    const h = tex(3)
    const out = sharedOwnedTextures({ texs: { cm, lm, mask0: null } }, h)
    expect(out.size).toBe(3)
    expect(out.has(cm) && out.has(lm) && out.has(h)).toBe(true)
  })
  it('无 groundLayers / 无 heightTex 时返回空集合（调用方不必判空）', () => {
    expect(sharedOwnedTextures(null, null).size).toBe(0)
    expect(sharedOwnedTextures({ texs: {} }, null).size).toBe(0)
  })
})
