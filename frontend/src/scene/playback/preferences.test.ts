// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { consumeUrlBool } from './preferences.ts'

afterEach(() => { history.replaceState(null, '', '/') })

describe('consumeUrlBool', () => {
  it('读取 URL 覆盖后立即从地址栏移除，后续场景不再继承', () => {
    history.replaceState(null, '', '/replay?shadows=1&q=high')
    expect(consumeUrlBool('shadows')).toBe(true)
    expect(location.search).toBe('?q=high')
    expect(consumeUrlBool('shadows')).toBeNull()
  })

  it('显式 0 返回 false，同样只消费一次', () => {
    history.replaceState(null, '', '/replay?shadows=0')
    expect(consumeUrlBool('shadows')).toBe(false)
    expect(location.search).toBe('')
  })

  it('参数不存在时返回 null 且不改地址', () => {
    history.replaceState(null, '', '/replay?q=low')
    expect(consumeUrlBool('shadows')).toBeNull()
    expect(location.search).toBe('?q=low')
  })
})
