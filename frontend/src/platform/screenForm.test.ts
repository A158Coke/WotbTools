// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const bridge = vi.hoisted(() => ({ android: false, capabilities: [] as string[], phone: true, calls: [] as Array<[string, unknown]> }))
vi.mock('../composables/usePlatformBridge.js', () => ({
  isAndroidApp: () => bridge.android,
  getCapabilities: async () => bridge.capabilities,
  callBridge: async (method: string, params?: unknown) => {
    bridge.calls.push([method, params])
    if (method === 'getScreenForm') return { phone: bridge.phone }
    if (method === 'setOrientationLock') return true
    return null
  },
}))

import { __resetForcedLandscapeDeviceForTest, forcedLandscapeDevice, isIphoneSafari, setNativeOrientationLock } from './screenForm.js'

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const IPAD = 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const IPAD_DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'
const ANDROID_CHROME = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36'
const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

beforeEach(() => {
  __resetForcedLandscapeDeviceForTest()
  Object.assign(bridge, { android: false, capabilities: [], phone: true, calls: [] })
})
afterEach(() => vi.unstubAllGlobals())

describe('forced landscape device', () => {
  it('only iPhone Safari counts on the web: iPad (both UAs), Android browsers and desktops never force', () => {
    expect(isIphoneSafari(IPHONE)).toBe(true)
    for (const ua of [IPAD, IPAD_DESKTOP, ANDROID_CHROME, DESKTOP]) expect(isIphoneSafari(ua)).toBe(false)
  })

  it('iPhone Safari is detected from the UA, independent of the viewport', async () => {
    vi.stubGlobal('navigator', { userAgent: IPHONE })
    expect(await forcedLandscapeDevice()).toBe('iphone-safari')
    expect(await setNativeOrientationLock('landscape')).toBe(false)
    expect(bridge.calls.some(([method]) => method === 'setOrientationLock')).toBe(false)
  })

  it('Android app: only a phone with the screen-form capability forces landscape and locks natively', async () => {
    bridge.android = true
    bridge.capabilities = ['screen-form']
    expect(await forcedLandscapeDevice()).toBe('android-phone-app')
    expect(await setNativeOrientationLock('landscape')).toBe(true)
    expect(await setNativeOrientationLock('portrait')).toBe(true)
    expect(bridge.calls).toContainEqual(['setOrientationLock', { orientation: 'landscape' }])
    expect(bridge.calls).toContainEqual(['setOrientationLock', { orientation: 'portrait' }])
  })

  it('Android app on a tablet, or an older app without the capability, never forces', async () => {
    bridge.android = true
    bridge.capabilities = ['screen-form']
    bridge.phone = false
    expect(await forcedLandscapeDevice()).toBeNull()
    __resetForcedLandscapeDeviceForTest()
    bridge.capabilities = []
    bridge.phone = true
    expect(await forcedLandscapeDevice()).toBeNull()
    expect(bridge.calls.some(([method]) => method === 'getScreenForm')).toBe(true)
  })
})
