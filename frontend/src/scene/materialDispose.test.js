import { describe, it, expect, vi } from 'vitest'
import { collectMaterialTextures } from './materialDispose.js'

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
