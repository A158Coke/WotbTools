// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { URL as NodeURL } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { useAndroidUpdate } from '../composables/useAndroidUpdate.js'

const bridge = vi.hoisted(() => ({
  isAndroidApp: vi.fn(() => true), getCapabilities: vi.fn(async () => ['app-update-status']),
  getUpdateStatus: vi.fn(), refreshUpdateStatus: vi.fn(), beginUpdateDownload: vi.fn(),
  installUpdate: vi.fn(), dismissOptionalUpdate: vi.fn(),
}))
vi.mock('../composables/usePlatformBridge.js', () => bridge)

const source = readFileSync(new NodeURL('../../../android/app/src/main/assets/gecko-bridge/bridge.js', import.meta.url), 'utf8')
const snapshot = (revision: number, state: string) => ({
  revision, state: 'optional', checkState: 'succeeded', checkFailureReason: null,
  currentVersionName: '3.27.2', currentVersionCode: 3027002, latestVersionName: '3.28.0',
  latestVersionCode: 3028000, minSupportedVersionCode: 3017007, publishedAt: null,
  releaseNotes: null, optionalPromptSuppressed: false,
  download: { taskToken: 'task-one', versionName: '3.28.0', versionCode: 3028000,
    state, downloadedBytes: 3, totalBytes: 3, progressPercent: 100, failureReason: null },
})

function connect(page: object) {
  let receive!: (message: unknown) => void
  const scriptWindow = { wrappedJSObject: page, top: null as unknown }
  scriptWindow.top = scriptWindow
  const browser = { runtime: { connectNative: () => ({ postMessage() {},
    onMessage: { addListener: (callback: typeof receive) => { receive = callback } },
    onDisconnect: { addListener() {} },
  }) } }
  new Function('window', 'location', 'browser', 'cloneInto', source)(scriptWindow,
    { protocol: 'http:', hostname: '127.0.0.1', port: '21653' }, browser, (value: unknown) => value)
  return (global: string) => receive({ type: 'event', global })
}

describe('Gecko update status event', () => {
  it('forwards the real Native event to the frontend, which reads and displays the updated snapshot', async () => {
    bridge.getUpdateStatus.mockResolvedValue(snapshot(1, 'downloading'))
    let update!: ReturnType<typeof useAndroidUpdate>
    const wrapper = mount(defineComponent({ setup() { update = useAndroidUpdate(); return () => update.snapshot.value?.download.state } }))
    try {
      await flushPromises()
      expect(wrapper.text()).toBe('downloading')
      const emit = connect(window)
      bridge.getUpdateStatus.mockResolvedValue(snapshot(2, 'ready'))
      emit('wotbtoolsOnUpdateStatusChanged')
      await flushPromises()
      expect(bridge.getUpdateStatus).toHaveBeenCalledTimes(2)
      expect(wrapper.text()).toBe('ready')
    } finally { wrapper.unmount(); Reflect.deleteProperty(window, 'WotbNative') }
  })

  it('forwards the other contract events but rejects unknown globals', () => {
    const page: Record<string, unknown> = {}
    const callbacks = ['wotbtoolsOnAuthChanged', 'wotbtoolsOnConnectivityChanged', 'wotbtoolsOnReplay', 'arbitraryGlobal']
    for (const name of callbacks) page[name] = vi.fn()
    const emit = connect(page)
    for (const name of callbacks) emit(name)
    for (const name of callbacks.slice(0, 3)) expect(page[name]).toHaveBeenCalledTimes(1)
    expect(page.arbitraryGlobal).not.toHaveBeenCalled()
  })
})
