// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { confirm, useConfirmHost } from './useConfirm.js'

afterEach(() => useConfirmHost().settle(false))
describe('confirmation lifecycle', () => {
  it('cancels the caller confirmation when its context aborts', async () => {
    const controller = new AbortController()
    const result = confirm({ title: 'Delete stage', signal: controller.signal })
    expect(useConfirmHost().request.value?.title).toBe('Delete stage')
    controller.abort()
    expect(await result).toBe(false)
    expect(useConfirmHost().request.value).toBeNull()
  })
  it('does not cancel a replacement confirmation when an old context aborts', async () => {
    const old = new AbortController()
    const previous = confirm({ title: 'Old', signal: old.signal })
    const next = confirm({ title: 'New' })
    expect(await previous).toBe(false)
    old.abort()
    expect(useConfirmHost().request.value?.title).toBe('New')
    useConfirmHost().settle(true)
    expect(await next).toBe(true)
  })
})
