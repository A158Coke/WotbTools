// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'

const platform = vi.hoisted(() => ({ device: 'android-phone-app' as null | string }))
vi.mock('../platform/screenForm.js', () => ({ forcedLandscapeDevice: async () => platform.device }))

import { useReplayAutoFullscreen } from './useReplayAutoFullscreen.js'

function setup(device: string | null = 'android-phone-app') {
  platform.device = device
  const token = ref(1)
  const key = ref<object | null>({ id: 'A' })
  const ready = ref(false)
  const active = ref(true)
  const enter = vi.fn(async () => true)
  let state!: ReturnType<typeof useReplayAutoFullscreen>
  const wrapper = mount(defineComponent({
    setup() {
      state = useReplayAutoFullscreen({ token: () => token.value, key: () => key.value, ready: () => ready.value, active: () => active.value, enter })
      return () => h('div')
    },
  }))
  return { wrapper, token, key, ready, active, enter, result: () => state.result.value }
}

describe('useReplayAutoFullscreen', () => {
  it('enters once when ready; loading / error (not ready) never enters', async () => {
    const s = setup()
    await flushPromises()
    expect(s.enter).not.toHaveBeenCalled()
    s.ready.value = true
    await nextTick(); await flushPromises()
    expect(s.enter).toHaveBeenCalledTimes(1)
  })

  it('I2: after consumption, staying Ready / re-rendering never re-enters the same identity', async () => {
    const s = setup()
    s.ready.value = true
    await flushPromises()
    s.ready.value = false
    await nextTick()
    s.ready.value = true
    await nextTick(); await flushPromises()
    expect(s.enter).toHaveBeenCalledTimes(1)
  })

  it('a new token (re-entering the viewer) or a new replay is a new entry event', async () => {
    const s = setup()
    s.ready.value = true
    await flushPromises()
    s.token.value = 2
    await nextTick(); await flushPromises()
    expect(s.enter).toHaveBeenCalledTimes(2)
    s.key.value = { id: 'B' }
    await nextTick(); await flushPromises()
    expect(s.enter).toHaveBeenCalledTimes(3)
  })

  it('inactive viewers never consume; the request is not replayed when they become active without a new token', async () => {
    const s = setup()
    s.active.value = false
    s.ready.value = true
    await flushPromises()
    expect(s.enter).not.toHaveBeenCalled()
    s.active.value = true
    await nextTick(); await flushPromises()
    expect(s.enter).toHaveBeenCalledTimes(1)
  })

  it('token 0 (no entry event yet) never enters', async () => {
    const s = setup()
    s.token.value = 0
    s.ready.value = true
    await flushPromises()
    expect(s.enter).not.toHaveBeenCalled()
  })

  it.each([null, 'iphone-safari'])('non Android-phone-app device (%s) never enters', async (device) => {
    const s = setup(device)
    s.ready.value = true
    await flushPromises()
    expect(s.enter).not.toHaveBeenCalled()
  })

  it('result 观察真实结果：entered / failed（不重试）', async () => {
    const ok = setup()
    ok.ready.value = true
    await flushPromises()
    expect(ok.result()).toBe('entered')
    const denied = setup()
    denied.enter.mockResolvedValue(false)
    denied.ready.value = true
    await flushPromises()
    expect(denied.result()).toBe('failed')
    await nextTick(); await flushPromises()
    expect(denied.enter).toHaveBeenCalledTimes(1)
    const thrown = setup()
    thrown.enter.mockRejectedValue(new Error('x'))
    thrown.ready.value = true
    await flushPromises()
    expect(thrown.result()).toBe('failed')
  })
})
