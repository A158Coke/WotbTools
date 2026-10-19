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
    now = 10_000,
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
  performance.now = vi.fn(() => now)
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

describe('Safari URL-less dynamic import correlation', () => {
  const staleUrl = 'https://wotbtools.com/assets/Foo-AbC123.js'
  const now = 10_000

  function safariEvent(message = 'Importing a module script failed.') {
    return preloadError('', message)
  }

  function recoverTarget(options = {}) {
    const target = fakeWindow({ mainBufferEntry: false, ...options })
    installPreloadErrorRecovery(target)
    return target
  }

  function pushRecord(target, overrides = {}) {
    target.__performanceObservers[0].records.push({
      name: staleUrl,
      responseStatus: 404,
      initiatorType: 'script',
      startTime: now - 200,
      responseEnd: now - 100,
      ...overrides,
    })
  }

  it('recovers from a unique recent same-origin JS 404', () => {
    const target = recoverTarget()
    pushRecord(target)

    const event = safariEvent()
    target.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(target.location.reload).toHaveBeenCalledTimes(1)
  })

  it.each([503, 0, undefined])('does not recover with status %s', (status) => {
    const target = recoverTarget()
    pushRecord(target, { responseStatus: status })

    const event = safariEvent()
    target.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(target.location.reload).not.toHaveBeenCalled()
  })

  it('does not recover without a matching timing entry', () => {
    const target = recoverTarget()

    const event = safariEvent()
    target.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(target.location.reload).not.toHaveBeenCalled()
  })

  it('does not choose between multiple recent JS 404 candidates', () => {
    const target = recoverTarget()
    pushRecord(target)
    pushRecord(target, { name: 'https://wotbtools.com/assets/Bar-Def456.js' })

    const event = safariEvent()
    target.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(target.location.reload).not.toHaveBeenCalled()
  })

  it('ignores cross-origin and non-JS 404 records', () => {
    const target = recoverTarget()
    pushRecord(target, { name: 'https://other.example/assets/Foo-AbC123.js' })
    pushRecord(target, { name: 'https://wotbtools.com/assets/Foo-AbC123.css' })

    const event = safariEvent()
    target.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(target.location.reload).not.toHaveBeenCalled()
  })

  it('ignores a candidate older than the correlation window', () => {
    const target = recoverTarget()
    pushRecord(target, { responseEnd: 1 })

    const event = safariEvent()
    target.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(target.location.reload).not.toHaveBeenCalled()
  })

  it('does not correlate a URL-less failure from the main buffer alone', () => {
    const target = fakeWindow({ observerSupport: false })
    installPreloadErrorRecovery(target)

    const event = safariEvent()
    target.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(target.location.reload).not.toHaveBeenCalled()
  })

  it('does not expand beyond the known Safari wording', () => {
    const target = recoverTarget()
    pushRecord(target)

    const event = safariEvent('Importing a module script failed with extra detail')
    target.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(target.location.reload).not.toHaveBeenCalled()
  })

  it('keeps the shared cooldown for a second Safari recovery attempt', () => {
    const target = recoverTarget()
    pushRecord(target)

    const first = safariEvent()
    target.dispatchEvent(first)
    expect(first.defaultPrevented).toBe(true)
    expect(target.location.reload).toHaveBeenCalledTimes(1)

    const second = safariEvent()
    target.dispatchEvent(second)
    expect(second.defaultPrevented).toBe(false)
    expect(target.location.reload).toHaveBeenCalledTimes(1)
  })

  it('does not suppress or reload when the persistent guard is denied', () => {
    const target = recoverTarget({ storageThrows: true })
    pushRecord(target)

    const event = safariEvent()
    target.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(target.location.reload).not.toHaveBeenCalled()
  })
})
