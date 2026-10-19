// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { installPreloadErrorRecovery } from './preloadRecovery.js'

function fakeWindow() {
  const target = new EventTarget()
  const values = new Map()
  target.sessionStorage = {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, value),
  }
  target.location = { reload: vi.fn() }
  return target
}

describe('preload error recovery', () => {
  it('reloads once and suppresses the first stale chunk error', () => {
    const target = fakeWindow()
    installPreloadErrorRecovery(target)

    const first = new Event('vite:preloadError', { cancelable: true })
    target.dispatchEvent(first)
    expect(first.defaultPrevented).toBe(true)
    expect(target.location.reload).toHaveBeenCalledTimes(1)

    const second = new Event('vite:preloadError', { cancelable: true })
    target.dispatchEvent(second)
    expect(second.defaultPrevented).toBe(false)
    expect(target.location.reload).toHaveBeenCalledTimes(1)
  })
})
