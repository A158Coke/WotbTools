import { describe, expect, it, vi } from 'vitest'
import { WEBGL_STATUS, detectWebGL } from './webglSupport.js'

/** 假 document：按上下文名返回假的 GL 对象（带 WEBGL_lose_context 以验证释放） */
function fakeDocument(available) {
  const loseContext = vi.fn()
  const requested = []
  const doc = {
    createElement: vi.fn(() => ({
      getContext: (name) => {
        requested.push(name)
        if (available[name] === 'throw') throw new Error('blocked')
        return available[name] ? { getExtension: () => ({ loseContext }) } : null
      },
    })),
  }
  return { doc, loseContext, requested }
}

describe('detectWebGL', () => {
  it('WebGL2 可用：支持，且释放预检上下文', () => {
    const { doc, loseContext, requested } = fakeDocument({ webgl2: true })
    expect(detectWebGL(doc)).toEqual({ supported: true, status: WEBGL_STATUS.OK, version: 2 })
    expect(requested).toEqual(['webgl2'])
    expect(loseContext).toHaveBeenCalledTimes(1)
  })

  it('只有 WebGL1：three.js 渲染器无法创建，视为不支持', () => {
    const { doc, loseContext } = fakeDocument({ webgl: true })
    expect(detectWebGL(doc)).toEqual({ supported: false, status: WEBGL_STATUS.WEBGL1_ONLY, version: 1 })
    expect(loseContext).toHaveBeenCalledTimes(1)
  })

  it('experimental-webgl 也算 WebGL1', () => {
    const { doc } = fakeDocument({ 'experimental-webgl': true })
    expect(detectWebGL(doc).status).toBe(WEBGL_STATUS.WEBGL1_ONLY)
  })

  it('完全没有上下文或 getContext 抛错：不可用', () => {
    expect(detectWebGL(fakeDocument({}).doc).status).toBe(WEBGL_STATUS.UNAVAILABLE)
    expect(detectWebGL(fakeDocument({ webgl2: 'throw', webgl: 'throw' }).doc)).toEqual({
      supported: false, status: WEBGL_STATUS.UNAVAILABLE, version: 0,
    })
  })

  it('没有 document（SSR / worker）或 canvas 创建失败：不可用', () => {
    expect(detectWebGL(null).supported).toBe(false)
    expect(detectWebGL({ createElement: () => { throw new Error('no') } }).supported).toBe(false)
    expect(detectWebGL({ createElement: () => ({}) }).supported).toBe(false)
  })
})
