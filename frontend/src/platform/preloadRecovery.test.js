// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { installPreloadErrorRecovery } from './preloadRecovery.js'

function fakeWindow(options = {}) {
  const {
    storageThrows = false,
    bufferSizeSupport = true,
    bufferSizeThrows = false,
    observerSupport = true,
    mainBufferEntry = true,
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
  performance.getEntriesByName = vi.fn(() => (mainBufferEntry ? [{ responseStatus: status }] : []))
  performance.clearResourceTimings = vi.fn()
  if (bufferSizeSupport) {
    performance.setResourceTimingBufferSize = vi.fn(() => {
      if (bufferSizeThrows) throw new Error('buffer size denied')
    })
  }
  if (observerSupport) {
    target.__performanceObservers = []
    target.PerformanceObserver = class {
      constructor(callback) {
        this.callback = callback
        this.records = []
        target.__performanceObservers.push(this)
      }
      observe() {}
      takeRecords() { return this.records.splice(0) }
      disconnect() {}
    }
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
    const addPerformanceListener = vi.fn(target.performance.addEventListener.bind(target.performance))
    target.performance.addEventListener = addPerformanceListener
    installPreloadErrorRecovery(target)
    installPreloadErrorRecovery(target)

    expect(addEventListener.mock.calls.filter(([type]) => type === 'vite:preloadError')).toHaveLength(1)
    expect(addPerformanceListener.mock.calls.filter(([type]) => type === 'resourcetimingbufferfull')).toHaveLength(1)
    expect(target.performance.setResourceTimingBufferSize).toHaveBeenCalledTimes(1)
    expect(target.__performanceObservers).toHaveLength(1)

    const event = preloadError()
    target.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(target.location.reload).toHaveBeenCalledTimes(1)
  })
})

describe('Resource Timing observer fallback', () => {
  const staleUrl = 'https://wotbtools.com/assets/ProfilePage-CeTt6kMP.js'

  it('recovers when the 404 entry is still pending in the secondary buffer', () => {
    const target = fakeWindow({ mainBufferEntry: false })
    installPreloadErrorRecovery(target)
    const observer = target.__performanceObservers[0]
    observer.records.push({ name: staleUrl, responseStatus: 404 })

    const event = preloadError(staleUrl)
    target.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(target.location.reload).toHaveBeenCalledTimes(1)
    expect(observer.records).toHaveLength(0)
  })

  it('recovers when the observer already delivered the 404 entry', () => {
    const target = fakeWindow({ mainBufferEntry: false })
    installPreloadErrorRecovery(target)
    const observer = target.__performanceObservers[0]
    observer.callback({ getEntries: () => [{ name: staleUrl, responseStatus: 404 }] })

    const event = preloadError(staleUrl)
    target.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(target.location.reload).toHaveBeenCalledTimes(1)
  })

  it('does not auto-reload when the pending observer entry is not 404', () => {
    const target = fakeWindow({ mainBufferEntry: false })
    installPreloadErrorRecovery(target)
    target.__performanceObservers[0].records.push({ name: staleUrl, responseStatus: 503 })

    const event = preloadError(staleUrl)
    target.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(target.location.reload).not.toHaveBeenCalled()
  })

  it('ignores observer entries outside same-origin /assets', () => {
    const target = fakeWindow({ mainBufferEntry: false })
    installPreloadErrorRecovery(target)
    target.__performanceObservers[0].records.push({
      name: 'https://cdn.example.com/assets/ProfilePage.js',
      responseStatus: 404,
    })

    const event = preloadError(staleUrl)
    target.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(target.location.reload).not.toHaveBeenCalled()
  })

  it('falls back to getEntriesByName when PerformanceObserver is unavailable', () => {
    const target = fakeWindow({ observerSupport: false })
    expect(target.PerformanceObserver).toBeUndefined()
    installPreloadErrorRecovery(target)

    const event = preloadError(staleUrl)
    target.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(target.location.reload).toHaveBeenCalledTimes(1)
  })
})

describe('Resource Timing buffer bound', () => {
  it('caps browser-side growth instead of doubling forever', () => {
    const target = fakeWindow()
    installPreloadErrorRecovery(target)
    const setBufferSize = target.performance.setResourceTimingBufferSize

    for (let i = 0; i < 12; i++) {
      target.performance.dispatchEvent(new Event('resourcetimingbufferfull'))
    }

    const sizes = setBufferSize.mock.calls.map(([size]) => size)
    const max = Math.max(...sizes)
    expect(max).toBeGreaterThanOrEqual(1000)
    expect(max).toBeLessThanOrEqual(4000)
    expect(sizes.at(-1)).toBe(max)
    expect(target.performance.clearResourceTimings).not.toHaveBeenCalled()
  })
})

describe('URL-less Safari dynamic import fails closed', () => {
  const staleUrl = 'https://wotbtools.com/assets/Foo-AbC123.js'

  function safariEvent() {
    return preloadError('', 'Importing a module script failed.')
  }

  function targetWithRecords(records) {
    const target = fakeWindow({ mainBufferEntry: false })
    installPreloadErrorRecovery(target)
    target.__performanceObservers[0].records.push(...records)
    return target
  }

  it('does not recover from a lone recent JS 404 (no timing record for the actual failure)', () => {
    const target = targetWithRecords([{ name: staleUrl, responseStatus: 404 }])

    const event = safariEvent()
    target.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(target.location.reload).not.toHaveBeenCalled()
  })

  it.each([503, 0, undefined])(
    'does not recover when an unrelated 404 is followed by an actual import failure with status %s',
    (status) => {
      const target = targetWithRecords([
        { name: staleUrl, responseStatus: 404 },
        { name: 'https://wotbtools.com/assets/Bar-Def456.js', responseStatus: status },
      ])

      const event = safariEvent()
      target.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(false)
      expect(target.location.reload).not.toHaveBeenCalled()
    },
  )

  it('does not recover without any resource records', () => {
    const target = targetWithRecords([])

    const event = safariEvent()
    target.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(target.location.reload).not.toHaveBeenCalled()
  })
})

describe('URL-ful stale asset messages', () => {
  it('recognizes the CSS preload error message', () => {
    const target = fakeWindow()
    installPreloadErrorRecovery(target)
    const url = 'https://wotbtools.com/assets/Foo-AbC123.css'

    const event = preloadError(url, 'Unable to preload CSS for ' + url)
    target.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(target.location.reload).toHaveBeenCalledTimes(1)
  })
})
