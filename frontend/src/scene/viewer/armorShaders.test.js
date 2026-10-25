import { describe, expect, it, vi } from 'vitest'
import { createArmorShaderContext } from './armorShaders.js'

// 评审 P1：穿透材质族的运行态（分辨率/跳弹 uniforms/占位纹理）必须**每个 viewer 一份**。
// 拆分前它们位于 initTankViewer 闭包；出仓时不得提升为模块单例——两个 viewer 生命周期
// 重叠时，A 的更新/重建/清理会直接改到 B 正在使用的 uniforms。
describe('armorShaders per-viewer context（评审 P1）', () => {
  it('两个 context 的 uniforms / 占位纹理互不共享', () => {
    const a = createArmorShaderContext()
    const b = createArmorShaderContext()
    expect(a.rcUniforms).not.toBe(b.rcUniforms)
    expect(a.resUniform).not.toBe(b.resUniform)
    expect(a.emptySpacedTexture()).not.toBe(b.emptySpacedTexture())
    a.resUniform.value.set(640, 480)
    a.rcUniforms.rcEnabled.value = true
    a.rcUniforms.rcMode.value = 2
    expect(b.resUniform.value.x).toBe(1)
    expect(b.rcUniforms.rcEnabled.value).toBe(false)
    expect(b.rcUniforms.rcMode.value).toBe(0)
  })

  it('材质绑定各自 context 的共享 uniforms：mutate A 不影响 B 的材质', () => {
    const a = createArmorShaderContext()
    const b = createArmorShaderContext()
    const ma = a.penetrationMaterial(100)
    const mb = b.penetrationMaterial(100)
    expect(ma.uniforms.rcEnabled).toBe(a.rcUniforms.rcEnabled)
    expect(mb.uniforms.rcEnabled).toBe(b.rcUniforms.rcEnabled)
    expect(ma.uniforms.rcEnabled).not.toBe(mb.uniforms.rcEnabled)
    a.rcUniforms.rcEnabled.value = true
    expect(mb.uniforms.rcEnabled.value).toBe(false)
    ma.dispose()
    mb.dispose()
  })

  it('dispose 只释放自己的占位纹理，B 的仍然可用', () => {
    const a = createArmorShaderContext()
    const b = createArmorShaderContext()
    const ta = a.emptySpacedTexture()
    const tb = b.emptySpacedTexture()
    const spy = vi.spyOn(ta, 'dispose')
    a.dispose()
    expect(spy).toHaveBeenCalledTimes(1)
    expect(tb.image).toBeTruthy()
    expect(a.emptySpacedTexture()).not.toBe(ta)   // 再取会新建，不复用已释放对象
  })
})
