import { describe, expect, it, vi } from 'vitest'
import { createShaderPrewarm, type ShaderPrewarmDeps } from './shaderPrewarm.js'

function makeHarness(opts: { armorPref?: boolean; compileFn?: boolean; throwOnCompile?: boolean } = {}) {
  const compile = vi.fn(() => { if (opts.throwOnCompile) throw new Error('render failed') })
  const renderer = { compile: opts.compileFn === false ? undefined : compile }
  const camera = { updateMatrixWorld: vi.fn() }
  const prewarmBattle = vi.fn((fn: () => void) => fn())
  const prewarmArmor = vi.fn()
  const ensureArmorHighlight = vi.fn(() => ({ prewarm: prewarmArmor }))
  const deps: ShaderPrewarmDeps = {
    getRenderer: () => renderer as unknown as import('three').WebGLRenderer,
    getScene: () => ({}) as import('three').Scene,
    getCamera: () => camera as unknown as import('three').PerspectiveCamera,
    ensureBattleFx: () => ({ prewarm: prewarmBattle }),
    ensureArmorHighlight,
    armorHighlightPref: () => opts.armorPref === true,
  }
  return { deps, compile, camera, prewarmBattle, prewarmArmor, ensureArmorHighlight }
}

describe('shaderPrewarm（着色器预热工厂）', () => {
  it('compile 经 ensureBattleFx().prewarm 恰一次；相机矩阵先更新', () => {
    const h = makeHarness()
    createShaderPrewarm(h.deps)()
    expect(h.camera.updateMatrixWorld).toHaveBeenCalledTimes(1)
    expect(h.prewarmBattle).toHaveBeenCalledTimes(1)
    expect(h.compile).toHaveBeenCalledTimes(1)
  })

  it('装甲预热按偏好触发：pref 开启 + renderer.compile 可用 → ensureArmorHighlight().prewarm(camera)', () => {
    const h = makeHarness({ armorPref: true })
    createShaderPrewarm(h.deps)()
    expect(h.ensureArmorHighlight).toHaveBeenCalledTimes(1)
    expect(h.prewarmArmor).toHaveBeenCalledWith(h.camera)
  })

  it('pref 关闭 / renderer.compile 缺失 → 不触装甲预热（不抛错）', () => {
    const h1 = makeHarness({ armorPref: false })
    createShaderPrewarm(h1.deps)()
    expect(h1.ensureArmorHighlight).not.toHaveBeenCalled()
    const h2 = makeHarness({ armorPref: true, compileFn: false })
    createShaderPrewarm(h2.deps)()
    expect(h2.prewarmArmor).not.toHaveBeenCalled()
  })

  it('compile 抛错被吞（best-effort，不影响加载）', () => {
    const h = makeHarness({ throwOnCompile: true })
    expect(() => createShaderPrewarm(h.deps)()).not.toThrow()
  })
})
