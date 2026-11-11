// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'

const platform = vi.hoisted(() => ({ device: null as null | 'android-phone-app' | 'iphone-safari', locks: [] as string[] }))
vi.mock('../platform/screenForm.js', () => ({
  forcedLandscapeDevice: async () => platform.device,
  setNativeOrientationLock: async (mode: string) => { platform.locks.push(mode); return true },
}))

import { useForcedLandscape } from './useForcedLandscape.js'

function stubOrientation(portrait: boolean) {
  vi.stubGlobal('matchMedia', () => ({ matches: portrait, addEventListener() {}, removeEventListener() {} }))
}

function host(active = ref(true), options: Parameters<typeof useForcedLandscape>[1] = {}) {
  let state!: ReturnType<typeof useForcedLandscape>
  const wrapper = mount(defineComponent({ setup() { state = useForcedLandscape(active, options); return () => h('div') } }))
  return { wrapper, state: () => state, active }
}

afterEach(() => { vi.unstubAllGlobals(); platform.locks = [] })

describe('useForcedLandscape', () => {
  it('desktop / tablet / Android browser: never required, never blocked', async () => {
    platform.device = null
    stubOrientation(true)
    const { state } = host()
    await flushPromises()
    expect(state().required.value).toBe(false)
    expect(state().blocked.value).toBe(false)
  })

  it('iPhone Safari in portrait is blocked (rotate prompt), landscape is not; no native lock', async () => {
    platform.device = 'iphone-safari'
    stubOrientation(true)
    const portrait = host()
    await flushPromises()
    expect(portrait.state().blocked.value).toBe(true)
    portrait.wrapper.unmount()
    stubOrientation(false)
    const landscape = host()
    await flushPromises()
    expect(landscape.state().blocked.value).toBe(false)
    expect(platform.locks).toEqual([])
  })

  it('Android phone app locks while active and releases when inactive and on unmount', async () => {
    platform.device = 'android-phone-app'
    stubOrientation(false)
    const { wrapper, active } = host()
    await flushPromises()
    expect(platform.locks).toEqual(['landscape'])
    active.value = false
    await nextTick()
    expect(platform.locks).toEqual(['landscape', 'unspecified'])
    active.value = true
    await nextTick()
    wrapper.unmount()
    expect(platform.locks).toEqual(['landscape', 'unspecified', 'landscape', 'unspecified'])
  })

  it('Android 手机 App：设备判定返回前就离开页面，不会在卸载后加锁', async () => {
    platform.device = 'android-phone-app'
    stubOrientation(false)
    const { wrapper } = host()
    wrapper.unmount()
    await flushPromises()
    expect(platform.locks).not.toContain('landscape')
  })

  it('portrait mode: Android phone app locks portrait without a rotate prompt; iPhone Safari still blocked', async () => {
    platform.device = 'android-phone-app'
    stubOrientation(true)
    const android = host(ref(true), { androidOrientation: 'portrait' })
    await flushPromises()
    expect(platform.locks).toEqual(['portrait'])
    expect(android.state().blocked.value).toBe(false)
    android.wrapper.unmount()
    expect(platform.locks).toEqual(['portrait', 'unspecified'])
    platform.device = 'iphone-safari'
    const iphone = host(ref(true), { androidOrientation: 'portrait' })
    await flushPromises()
    expect(iphone.state().blocked.value).toBe(true)
  })

  it('androidActive drives only the Android lock; iPhone prompt still follows active', async () => {
    platform.device = 'android-phone-app'
    stubOrientation(true)
    const android = host(ref(false), { androidOrientation: 'portrait', androidActive: ref(true) })
    await flushPromises()
    expect(platform.locks).toEqual(['portrait'])
    android.wrapper.unmount()
    platform.locks = []
    platform.device = 'iphone-safari'
    const iphone = host(ref(false), { androidOrientation: 'portrait', androidActive: ref(true) })
    await flushPromises()
    expect(iphone.state().blocked.value).toBe(false)
  })
})
