// @vitest-environment happy-dom

import { describe, expect, it, afterEach } from 'vitest'
import {
  getCapabilities,
  getPendingReplay,
  isAndroidApp,
  supports,
  consumePendingReplay,
  usePlatformBridge,
} from './usePlatformBridge.js'

function stubNative(capabilities) {
  window.WotbNative = {
    getCapabilities: () => JSON.stringify(capabilities),
    getPendingReplay: () => JSON.stringify({ name: 'a.wotbreplay', uri: 'content://x' }),
    consumePendingReplay: () => true,
  }
}

describe('usePlatformBridge', () => {
  afterEach(() => {
    delete window.WotbNative
  })

  it('Web fallback when no native bridge (browser)', () => {
    expect(isAndroidApp()).toBe(false)
    expect(getCapabilities()).toEqual([])
    expect(supports('replay-share')).toBe(false)
    expect(getPendingReplay()).toBeNull()
    expect(consumePendingReplay()).toBe(false)
  })

  it('capability detection via injected bridge', () => {
    stubNative(['replay-share', 'replay-open', 'app-update'])
    expect(isAndroidApp()).toBe(true)
    expect(getCapabilities()).toEqual(['replay-share', 'replay-open', 'app-update'])
    expect(supports('replay-share')).toBe(true)
    expect(supports('does-not-exist')).toBe(false)
    expect(getPendingReplay()).toEqual({ name: 'a.wotbreplay', uri: 'content://x' })
    expect(consumePendingReplay()).toBe(true)
  })

  it('usePlatformBridge exposes the same surface', () => {
    const p = usePlatformBridge()
    expect(p.isAndroidApp()).toBe(false)
    expect(p.supports('app-update')).toBe(false)
  })
})
