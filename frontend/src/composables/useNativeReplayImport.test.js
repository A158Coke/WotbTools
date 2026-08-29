// @vitest-environment happy-dom

import { describe, expect, it, vi, afterEach } from 'vitest'
import { useNativeReplayImport } from './useNativeReplayImport.js'

function stubNative(pending) {
  window.WotbNative = {
    getCapabilities: () => JSON.stringify(['replay-share']),
    getPendingReplay: () => (pending ? JSON.stringify(pending) : 'null'),
  }
}

describe('useNativeReplayImport', () => {
  afterEach(() => {
    delete window.WotbNative
    delete window.wotbtoolsOnReplay
  })

  it('registers the global handler and is a no-op on a plain browser', () => {
    const { triggerFileInput } = useNativeReplayImport()
    expect(typeof window.wotbtoolsOnReplay).toBe('function')
    expect(() => triggerFileInput()).not.toThrow()
  })

  it('clicks the first .wotbreplay file input when a native pending replay exists', () => {
    stubNative({ name: 'a.wotbreplay', uri: 'content://x', size: 1 })
    const input = document.createElement('input')
    input.setAttribute('type', 'file')
    input.setAttribute('accept', '.wotbreplay')
    document.body.appendChild(input)
    const clickSpy = vi.spyOn(input, 'click')
    const { triggerFileInput } = useNativeReplayImport()
    triggerFileInput()
    expect(clickSpy).toHaveBeenCalled()
    input.remove()
  })
})
