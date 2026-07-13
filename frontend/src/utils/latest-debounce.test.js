import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLatestDebounce } from './latest-debounce.js'

afterEach(() => {
  vi.useRealTimers()
})

describe('createLatestDebounce', () => {
  it('drops an in-flight result after cancellation', async () => {
    vi.useFakeTimers()
    let resolveRequest
    const request = new Promise(resolve => { resolveRequest = resolve })
    const onResult = vi.fn()
    const search = createLatestDebounce(10)

    search.schedule(() => request, onResult, vi.fn())
    await vi.advanceTimersByTimeAsync(10)
    search.cancel()
    resolveRequest(['stale'])
    await Promise.resolve()

    expect(onResult).not.toHaveBeenCalled()
  })

  it('keeps only the latest scheduled result', async () => {
    vi.useFakeTimers()
    const onResult = vi.fn()
    const search = createLatestDebounce(10)

    search.schedule(async () => ['first'], onResult, vi.fn())
    search.schedule(async () => ['second'], onResult, vi.fn())
    await vi.advanceTimersByTimeAsync(10)

    expect(onResult).toHaveBeenCalledOnce()
    expect(onResult).toHaveBeenCalledWith(['second'])
  })
})
