// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h, provide, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { SHELL_CHROME_KEY } from '../shared/shellChrome.js'

const env = vi.hoisted(() => ({ isPhone: null, isPortrait: null, coarse: null, forced: [] }))
vi.mock('./usePlaybackPhoneForm.ts', async () => {
  const { ref: r } = await import('vue')
  env.isPhone = r(true)
  return { usePlaybackPhoneForm: () => ({ isPhone: env.isPhone }) }
})
vi.mock('./usePlaybackPortraitViewport.ts', async () => {
  const { ref: r } = await import('vue')
  env.isPortrait = r(false)
  return { usePlaybackPortraitViewport: () => ({ isPortrait: env.isPortrait }) }
})
vi.mock('./useBreakpoint.js', async () => {
  const { ref: r } = await import('vue')
  env.coarse = r(true)
  return { usePointer: () => ({ coarse: env.coarse }) }
})
vi.mock('./useForcedLandscape.js', () => ({
  useForcedLandscape: (active, opts) => {
    env.forced.push({ active, opts })
    return {}
  },
}))

const { useReplayImmersive } = await import('./useReplayImmersive.js')

function mountHost(capability = 'events') {
  const request = vi.fn()
  const activeCapability = ref(capability)
  const playbackMounted = ref(true)
  const threeMounted = ref(false)
  const workspaceReady = ref(true)
  const content = ref(null)
  let api = null
  const Child = defineComponent({
    setup() {
      api = useReplayImmersive(content, { replay: { cancelRemove: () => {} } }, {
        activeCapability, playbackMounted, threeMounted, workspaceReady,
      })
      return () => h('div')
    },
  })
  const Parent = defineComponent({
    setup() {
      provide(SHELL_CHROME_KEY, { request })
      return () => h(Child)
    },
  })
  const wrapper = mount(Parent)
  return { wrapper, request, activeCapability, playbackMounted, threeMounted, workspaceReady, api: () => api }
}

describe('useReplayImmersive — events 深链与 2D 回放同一设备语义', () => {
  it('events 深链按 2D 回放进入沉浸态、申请强制横屏与自动全屏序号', async () => {
    env.forced.length = 0
    const h = mountHost('events')
    await h.wrapper.vm.$nextTick()

    expect(h.api().wantsImmersive.value).toBe(true)
    expect(h.request).toHaveBeenCalledTimes(1)
    expect(h.request.mock.calls[0][1]).toBe(true)
    expect(h.api().autoFullscreenToken.value).toBe(1)
    const forced = env.forced.at(-1)
    expect(forced.active.value).toBe(true)
    expect(forced.opts.androidActive.value).toBe(true)
    h.wrapper.unmount()
  })

  it('playback ↔ events 共用同一 2D 进入键：双向导航不重复递增自动全屏序号', async () => {
    const h = mountHost('playback')
    await h.wrapper.vm.$nextTick()
    expect(h.api().autoFullscreenToken.value).toBe(1)
    h.activeCapability.value = 'events'
    await h.wrapper.vm.$nextTick()
    expect(h.api().autoFullscreenToken.value).toBe(1)
    h.activeCapability.value = 'playback'
    await h.wrapper.vm.$nextTick()
    expect(h.api().autoFullscreenToken.value).toBe(1)
    h.activeCapability.value = 'data'
    await h.wrapper.vm.$nextTick()
    h.activeCapability.value = 'events'
    await h.wrapper.vm.$nextTick()
    expect(h.api().autoFullscreenToken.value).toBe(2)
    h.threeMounted.value = true
    h.activeCapability.value = '3d'
    await h.wrapper.vm.$nextTick()
    expect(h.api().autoFullscreenToken.value).toBe(3)
    h.wrapper.unmount()
  })

  it('离开 events 到非查看器能力后不再沉浸，也不递增序号', async () => {
    env.forced.length = 0
    const h = mountHost('events')
    await h.wrapper.vm.$nextTick()
    const tokenBefore = h.api().autoFullscreenToken.value
    h.activeCapability.value = 'data'
    await h.wrapper.vm.$nextTick()

    expect(h.api().wantsImmersive.value).toBe(false)
    expect(h.api().autoFullscreenToken.value).toBe(tokenBefore)
    const forced = env.forced.at(-1)
    expect(forced.active.value).toBe(false)
    expect(forced.opts.androidActive.value).toBe(false)
    expect(h.request.mock.calls.map((call) => call[1])).toEqual([true, false])
    expect(h.request.mock.calls[0][0]).toBe(h.request.mock.calls[1][0])
    h.wrapper.unmount()
  })

  it('3D 同样递增自动全屏序号（对照：普通回放入口行为不变）', async () => {
    const h = mountHost('playback')
    await h.wrapper.vm.$nextTick()
    expect(h.api().autoFullscreenToken.value).toBe(1)
    h.threeMounted.value = true
    h.activeCapability.value = '3d'
    await h.wrapper.vm.$nextTick()
    expect(h.api().wantsImmersive.value).toBe(true)
    expect(h.api().autoFullscreenToken.value).toBe(2)
    h.wrapper.unmount()
  })
})
