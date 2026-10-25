// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { motionTransition, readMotionTokens } from './motionPolicy'

afterEach(() => { document.documentElement.removeAttribute('style') })

function setTokens(fast: string, base: string, slow: string) {
  const style = document.documentElement.style
  style.setProperty('--duration-fast', fast)
  style.setProperty('--duration-base', base)
  style.setProperty('--duration-slow', slow)
  style.setProperty('--ease-standard', 'cubic-bezier(.2, 0, 0, 1)')
}

describe('motionPolicy', () => {
  it('把 design-language token 解析为秒与缓动数组', () => {
    setTokens('120ms', '200ms', '300ms')
    expect(readMotionTokens()).toEqual({ fast: 0.12, base: 0.2, slow: 0.3, ease: [0.2, 0, 0, 1] })
  })

  it('reduced-motion 下 token 归零，transition 时长随之为 0', () => {
    setTokens('0ms', '0ms', '0ms')
    expect(motionTransition('slow').duration).toBe(0)
  })

  it('token 缺失或无法解析时不产生动画，缓动回落标准曲线', () => {
    expect(readMotionTokens()).toMatchObject({ fast: 0, base: 0, slow: 0, ease: [0.2, 0, 0, 1] })
  })
})
