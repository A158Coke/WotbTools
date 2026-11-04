// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { URL as NodeURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, watch } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { useAndroidUpdate } from '../composables/useAndroidUpdate.js'
import AndroidUpdatePanel from '../components/AndroidUpdatePanel.vue'
import type { AndroidUpdateSnapshot } from '../shared/androidUpdate.js'
import en from '../locales/en.json'

const source = readFileSync(new NodeURL('../../../android/app/src/main/assets/gecko-bridge/bridge.js', import.meta.url), 'utf8')
const snapshot = (revision = 1, state: AndroidUpdateSnapshot['download']['state'] = 'ready'): AndroidUpdateSnapshot => ({
  revision, state: 'optional', checkState: 'succeeded', checkFailureReason: null,
  currentVersionName: '3.27.2', currentVersionCode: 3027002, latestVersionName: '3.28.0',
  latestVersionCode: 3028000, minSupportedVersionCode: 3017007, publishedAt: null,
  releaseNotes: null, optionalPromptSuppressed: false,
  download: { taskToken: 'task-one', versionName: '3.28.0', versionCode: 3028000,
    state, downloadedBytes: 3, totalBytes: 3, progressPercent: 100, failureReason: null },
})

type Request = { id: number, method: string, params: Record<string, unknown> }

// Only the Native port and Gecko compartment cloning are simulated. The content script,
// page RPC transport, updater controller and rendered update panel are production code.
function connect(page: object, onRequest: (request: Request) => void = () => {}) {
  let receive!: (message: unknown) => void
  const scriptWindow = { wrappedJSObject: page, top: null as unknown }
  scriptWindow.top = scriptWindow
  const browser = { runtime: { connectNative: () => ({
    postMessage(message: { type: string, data: string }) { onRequest(JSON.parse(message.data) as Request) },
    onMessage: { addListener: (callback: typeof receive) => { receive = callback } },
    onDisconnect: { addListener() {} },
  }) } }
  new Function('window', 'location', 'browser', 'cloneInto', source)(scriptWindow,
    { protocol: 'http:', hostname: '127.0.0.1', port: '21653' }, browser, (value: unknown) => value)
  receive({ type: 'ready' })
  return {
    emit(global: string) { receive({ type: 'event', global }) },
    reply(id: number, result: unknown) { receive({ type: 'reply', data: JSON.stringify({ id, result }) }) },
  }
}

const mounted: ReturnType<typeof mount>[] = []
afterEach(() => {
  mounted.splice(0).forEach(wrapper => wrapper.unmount())
  vi.useRealTimers()
  Reflect.deleteProperty(window, 'WotbNative')
})

function start(initial = snapshot()) {
  const native = { current: initial, statusReply: undefined as unknown, requests: [] as Request[] }
  const port = connect(window, request => {
    native.requests.push(request)
    if (request.method === 'installUpdate') return
    queueMicrotask(() => port.reply(request.id, request.method === 'getCapabilities'
      ? ['app-update-status'] : native.statusReply === undefined ? native.current : native.statusReply))
  })
  let update!: ReturnType<typeof useAndroidUpdate>
  const wrapper = mount(defineComponent({
    setup() { update = useAndroidUpdate(); return () => h(AndroidUpdatePanel, { update }) },
  }), { global: {
    plugins: [createI18n({ legacy: false, locale: 'en', messages: { en } })],
    stubs: { AppSheet: { template: '<div><slot /></div>' } },
  } })
  mounted.push(wrapper)
  return { native, port, update, wrapper, installs: () => native.requests.filter(request => request.method === 'installUpdate') }
}

describe('Gecko update status event', () => {
  it.each(['wotbtoolsOnUpdateStatusChanged', 'wotbtoolsOnAuthChanged', 'wotbtoolsOnConnectivityChanged', 'wotbtoolsOnReplay'])(
    'forwards %s exactly once', global => {
      const callback = vi.fn()
      const port = connect({ [global]: callback })
      port.emit(global)
      expect(callback).toHaveBeenCalledExactlyOnceWith()
    },
  )

  it('rejects an arbitrary global', () => {
    const arbitraryGlobal = vi.fn()
    connect({ arbitraryGlobal }).emit('arbitraryGlobal')
    expect(arbitraryGlobal).not.toHaveBeenCalled()
  })

  it('reads READY through the real Gecko RPC after an event and renders the install action', async () => {
    const { native, port, update, wrapper } = start(snapshot(1, 'downloading'))
    await flushPromises()
    expect(wrapper.text()).toContain(en.androidUpdate.downloadState.downloading)
    expect(wrapper.find('[data-testid="update-install"]').exists()).toBe(false)
    native.current = snapshot(2)
    port.emit('wotbtoolsOnUpdateStatusChanged')
    await flushPromises()
    expect(native.requests.filter(request => request.method === 'getUpdateStatus')).toHaveLength(2)
    expect(update.snapshot.value?.download.state).toBe('ready')
    expect(wrapper.text()).toContain(en.androidUpdate.downloadState.ready)
    expect(wrapper.get('[data-testid="update-install"]').attributes('disabled')).toBeUndefined()
  })

  it('renders rejection only for an explicit Native false through the real bridge', async () => {
    const { port, update, wrapper, installs } = start()
    await flushPromises()
    const action = update.install()
    expect(installs()[0]?.params).toEqual({ expectedTaskToken: 'task-one' })
    port.reply(installs()[0]!.id, false)
    await action
    expect(update.acting.value).toBe(false)
    expect(update.error.value).toBe('rejected')
    expect(wrapper.text()).toContain(en.androidUpdate.actionRejected)
  })

  it('keeps a queued install pending beyond five seconds with no duplicate and accepts its eventual reply', async () => {
    vi.useFakeTimers()
    const { port, native, update, wrapper, installs } = start()
    await vi.advanceTimersByTimeAsync(0)
    const action = update.install()
    await vi.advanceTimersByTimeAsync(6000)
    expect(update.acting.value).toBe(true)
    expect(update.error.value).toBeNull()
    expect(wrapper.text()).toContain(en.androidUpdate.actionProcessing)
    expect(wrapper.get('[data-testid="update-install"]').attributes('disabled')).toBeDefined()
    await update.install()
    expect(installs()).toHaveLength(1)
    native.current = snapshot(2, 'installRequested')
    port.reply(installs()[0]!.id, true)
    await vi.advanceTimersByTimeAsync(0)
    await action
    expect(update.acting.value).toBe(false)
    expect(update.error.value).toBeNull()
    expect(update.snapshot.value?.download.state).toBe('installRequested')
    expect(installs()).toHaveLength(1)
  })

  it('treats the install deadline as unknown, retains the lock across failed reads, and reconciles from a real event', async () => {
    vi.useFakeTimers()
    const { native, port, update, wrapper, installs } = start()
    await vi.advanceTimersByTimeAsync(0)
    let settled = false
    const action = update.install().then(() => { settled = true })
    await vi.advanceTimersByTimeAsync(119_999)
    expect(update.error.value).toBeNull()
    expect(update.acting.value).toBe(true)
    await vi.advanceTimersByTimeAsync(1)
    expect(settled).toBe(false)
    expect(update.error.value).toBe('confirming')
    expect(update.acting.value).toBe(true)
    expect(wrapper.text()).toContain(en.androidUpdate.actionConfirming)
    expect(wrapper.text()).not.toContain(en.androidUpdate.actionRejected)
    await update.install()
    expect(installs()).toHaveLength(1)
    native.statusReply = null
    window.dispatchEvent(new Event('focus'))
    await vi.advanceTimersByTimeAsync(0)
    expect(update.error.value).toBe('unavailable')
    expect(update.acting.value).toBe(true)
    await update.install()
    expect(installs()).toHaveLength(1)
    native.statusReply = undefined
    native.current = snapshot(2)
    window.dispatchEvent(new Event('focus'))
    await vi.advanceTimersByTimeAsync(0)
    expect(update.error.value).toBe('confirming')
    expect(update.acting.value).toBe(true)
    native.current = snapshot(3, 'installRequested')
    port.emit('wotbtoolsOnUpdateStatusChanged')
    await vi.advanceTimersByTimeAsync(0)
    expect(update.acting.value).toBe(true) // Native snapshot displays progress; the live RPC still owns this attempt.
    expect(update.error.value).toBe('confirming')
    expect(wrapper.text()).toContain(en.androidUpdate.downloadState.installRequested)
    expect(installs()).toHaveLength(1)
    port.reply(installs()[0]!.id, true)
    await vi.advanceTimersByTimeAsync(0)
    await action
    expect(settled).toBe(true)
    expect(update.acting.value).toBe(false)
    expect(update.error.value).toBeNull()
  })

  it.each([
    ['installRequestFailed', false], ['installRequestFailed', true],
    ['installPermissionRequired', false], ['installPermissionRequired', true],
  ] as const)('accepts a late correlated %s reply (%s) even with an unchanged terminal snapshot', async (state, result) => {
    vi.useFakeTimers()
    const initial = snapshot(1, state)
    initial.download.failureReason = state === 'installRequestFailed' ? 'installerUnavailable' : 'permissionDenied'
    const { port, update, wrapper, installs } = start(initial)
    await vi.advanceTimersByTimeAsync(0)
    let settled = false
    const action = update.install().then(() => { settled = true })
    await vi.advanceTimersByTimeAsync(120_000)
    expect(settled).toBe(false)
    expect(update.acting.value).toBe(true)
    expect(update.error.value).toBe('confirming')
    await update.install()
    expect(installs()).toHaveLength(1)
    // An unrelated RPC reply cannot settle the install attempt.
    port.reply(installs()[0]!.id + 10_000, result)
    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toBe(false)
    port.reply(installs()[0]!.id, result)
    await vi.advanceTimersByTimeAsync(0)
    await action
    expect(update.acting.value).toBe(false)
    expect(update.error.value).toBe(result ? null : 'rejected')
    expect(wrapper.get('[data-testid="update-install"]').attributes('disabled')).toBeUndefined()
    expect(installs()).toHaveLength(1)
  })

  it('does not let an older correlated completion clear a newer install action', async () => {
    vi.useFakeTimers()
    const { native, port, update, installs } = start()
    await vi.advanceTimersByTimeAsync(0)
    const older = update.install()
    await vi.advanceTimersByTimeAsync(120_000)
    let newer: Promise<void> | undefined
    const stop = watch(update.acting, acting => {
      if (!acting && !newer) newer = update.install()
    }, { flush: 'sync' })
    native.current = snapshot(2, 'installRequestFailed')
    native.current.download.failureReason = 'installerUnavailable'
    // A malformed reply ends transport certainty; its terminal read unlocks and starts a new
    // action synchronously before the older action reaches its finally block.
    port.reply(installs()[0]!.id, null)
    await vi.advanceTimersByTimeAsync(0)
    await older
    stop()
    expect(installs()).toHaveLength(2)
    port.reply(installs()[0]!.id, false)
    await vi.advanceTimersByTimeAsync(0)
    expect(update.acting.value).toBe(true)
    expect(update.error.value).toBeNull()
    await update.install()
    expect(installs()).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(update.error.value).toBe('confirming')
    port.reply(installs()[1]!.id, true)
    await vi.advanceTimersByTimeAsync(0)
    await newer
    expect(update.acting.value).toBe(false)
    expect(update.error.value).toBeNull()
  })

  it.each([0, 120_000])('ignores deadline and completion callbacks after unmount at %sms', async elapsed => {
    vi.useFakeTimers()
    const { native, port, update, wrapper, installs } = start()
    await vi.advanceTimersByTimeAsync(0)
    const action = update.install()
    await vi.advanceTimersByTimeAsync(elapsed)
    const before = { acting: update.acting.value, error: update.error.value, requests: native.requests.length }
    mounted.splice(mounted.indexOf(wrapper), 1)
    wrapper.unmount()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(update.acting.value).toBe(before.acting)
    expect(update.error.value).toBe(before.error)
    port.reply(installs()[0]!.id, false)
    await vi.advanceTimersByTimeAsync(0)
    await action
    expect(update.acting.value).toBe(before.acting)
    expect(update.error.value).toBe(before.error)
    expect(native.requests).toHaveLength(before.requests)
  })
})
