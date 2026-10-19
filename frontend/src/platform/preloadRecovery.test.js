// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { installPreloadErrorRecovery } from './preloadRecovery.js'

function fakeWindow(options = {}) {
  const {
    storageThrows = false,
    bufferSizeSupport = true,
    bufferSizeThrows = false,
  } = options
  const status = Object.prototype.hasOwnProperty.call(options, 'status')
    ? options.status
    : 404
  const target = new EventTarget()
  const values = new Map()
  target.location = {
    href: 'https://wotbtools.com/?view=profile',
    origin: 'https://wotbtools.com',
    reload: vi.fn(),
  }
  target.sessionStorage = {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => {
      if (storageThrows) throw new Error('storage denied')
      values.set(key, value)
    },
  }
  const performance = new EventTarget()
  performance.getEntriesByName = vi.fn(() => [{ responseStatus: status }])
  performance.clearResourceTimings = vi.fn()
  if (bufferSizeSupport) {
    performance.setResourceTimingBufferSize = vi.fn(() => {
      if (bufferSizeThrows) throw new Error('buffer size denied')
    })
  }
  target.performance = performance
  return target
}

function preloadError(
  url = 'https://wotbtools.com/assets/ProfilePage-CeTt6kMP.js',
  message = `Failed to fetch dynamically imported module: ${url}`,
) {
  const event = new Event('vite:preloadError', { cancelable: true })
  event.payload = new TypeError(message)
  return event
}

describe('preload error recovery', () => {
  it('reloads once only when the failed same-origin asset is confirmed 404', () => {
    const target = fakeWindow()
    installPreloadErrorRecovery(target)

    const first = preloadError()
    target.dispatchEvent(first)
    expect(first.defaultPrevented).toBe(true)
    expect(target.location.reload).toHaveBeenCalledTimes(1)

    const second = preloadError()
    target.dispatchEvent(second)
    expect(second.defaultPrevented).toBe(false)
    expect(target.location.reload).toHaveBeenCalledTimes(1)
  })

  it('recognizes the Firefox dynamic-import error message', () => {
    const target = fakeWindow()
    installPreloadErrorRecovery(target)

    const url = 'https://wotbtools.com/assets/ProfilePage-CeTt6kMP.js'
    const event = preloadError(url, `error loading dynamically imported module: ${url}`)
    target.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(target.location.reload).toHaveBeenCalledTimes(1)
  })

  it.each([0, 503, undefined])('preserves the existing error path for non-404 status %s', (status) => {
    const target = fakeWindow({ status })
    installPreloadErrorRecovery(target)

    const event = preloadError()
    target.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(target.location.reload).not.toHaveBeenCalled()
  })

  it('does not auto-reload cross-origin preload failures', () => {
    const target = fakeWindow()
    installPreloadErrorRecovery(target)

    const event = preloadError('https://cdn.example.com/assets/ProfilePage.js')
    target.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(target.location.reload).not.toHaveBeenCalled()
  })

  it('preserves the normal error path when the reload guard cannot be persisted', () => {
    const target = fakeWindow({ storageThrows: true })
    installPreloadErrorRecovery(target)

    const event = preloadError()
    target.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(target.location.reload).not.toHaveBeenCalled()
  })
})

describe('Resource Timing capacity', () => {
  it('reserves headroom for the stale asset entry at install time', () => {
    const target = fakeWindow()
    installPreloadErrorRecovery(target)

    const setBufferSize = target.performance.setResourceTimingBufferSize
    expect(setBufferSize).toHaveBeenCalledTimes(1)
    expect(setBufferSize.mock.calls[0][0]).toBeGreaterThanOrEqual(1000)
    expect(target.performance.clearResourceTimings).not.toHaveBeenCalled()
  })

  it('doubles capacity on resourcetimingbufferfull without clearing existing entries', () => {
    const target = fakeWindow()
    installPreloadErrorRecovery(target)

    const setBufferSize = target.performance.setResourceTimingBufferSize
    const initial = setBufferSize.mock.calls.at(-1)[0]
    target.performance.dispatchEvent(new Event('resourcetimingbufferfull'))
    const firstGrowth = setBufferSize.mock.calls.at(-1)[0]
    expect(firstGrowth).toBeGreaterThan(initial)

    target.performance.dispatchEvent(new Event('resourcetimingbufferfull'))
    expect(setBufferSize.mock.calls.at(-1)[0]).toBeGreaterThan(firstGrowth)
    expect(target.performance.clearResourceTimings).not.toHaveBeenCalled()
  })

  it('installs without throwing when setResourceTimingBufferSize is unavailable', () => {
    const target = fakeWindow({ bufferSizeSupport: false })
    expect(target.performance.setResourceTimingBufferSize).toBeUndefined()
    expect(() => installPreloadErrorRecovery(target)).not.toThrow()

    const event = preloadError()
    target.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(target.location.reload).toHaveBeenCalledTimes(1)
  })

  it('keeps stale recovery working when Resource Timing sizing throws', () => {
    const target = fakeWindow({ bufferSizeThrows: true })
    expect(() => installPreloadErrorRecovery(target)).not.toThrow()
    expect(() => target.performance.dispatchEvent(new Event('resourcetimingbufferfull'))).not.toThrow()

    const event = preloadError()
    target.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(target.location.reload).toHaveBeenCalledTimes(1)
  })

  it('does not duplicate listeners on repeated installs', () => {
    const target = fakeWindow()
    const addEventListener = vi.fn(target.addEventListener.bind(target))
    target.addEventListener = addEventListener
    installPreloadErrorRecovery(target)
    installPreloadErrorRecovery(target)

    expect(addEventListener.mock.calls.filter(([type]) => type === 'vite:preloadError')).toHaveLength(1)
    expect(target.performance.setResourceTimingBufferSize).toHaveBeenCalledTimes(1)

    const event = preloadError()
    target.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(target.location.reload).toHaveBeenCalledTimes(1)
  })
})
