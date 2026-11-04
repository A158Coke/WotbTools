// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import { useAndroidUpdate } from './useAndroidUpdate.js'

afterEach(() => { vi.useRealTimers(); Reflect.deleteProperty(window, 'WotbNative') })

it('keeps one real bridge RPC pending beyond five seconds and resolves from Native', async () => {
  vi.useFakeTimers()
  const listeners = new Set<(event: { data: unknown }) => void>()
  let installRequest: { id: number } | undefined
  let installs = 0
  const ready = {
    revision: 1, state: 'optional', checkState: 'succeeded', checkFailureReason: null,
    currentVersionName: '4.0.0', currentVersionCode: 4000000,
    latestVersionName: '4.0.1', latestVersionCode: 4000001, minSupportedVersionCode: 4000000,
    publishedAt: null, releaseNotes: null, optionalPromptSuppressed: false,
    download: { taskToken: 'task-one', versionName: '4.0.1', versionCode: 4000001, state: 'ready',
      downloadedBytes: 3, totalBytes: 3, progressPercent: 100, failureReason: null },
  }
  let current = ready
  function respond(id: number, result: unknown) { listeners.forEach(listener => listener({ data: { id, result } })) }
  Reflect.set(window, 'WotbNative', {
    addEventListener(_type: string, listener: (event: { data: unknown }) => void) { listeners.add(listener) },
    removeEventListener(_type: string, listener: (event: { data: unknown }) => void) { listeners.delete(listener) },
    postMessage(raw: string) {
      const request = JSON.parse(raw) as { id: number, method: string }
      if (request.method === 'installUpdate') { installs++; installRequest = request; return }
      queueMicrotask(() => respond(request.id, request.method === 'getCapabilities' ? ['app-update-status'] : current))
    },
  })
  let update!: ReturnType<typeof useAndroidUpdate>
  const wrapper = mount(defineComponent({ setup() { update = useAndroidUpdate(); return () => null } }))
  try {
    await vi.advanceTimersByTimeAsync(0)
    expect(update.snapshot.value?.download.state).toBe('ready')
    const action = update.install()
    await vi.advanceTimersByTimeAsync(6000)
    expect(update.acting.value).toBe(true)
    expect(update.error.value).not.toBe('rejected')
    await update.install()
    expect(installs).toBe(1)
    respond(installRequest!.id, true)
    await vi.advanceTimersByTimeAsync(0)
    await action
    expect(update.acting.value).toBe(false)
    expect(update.error.value).toBeNull()
    expect(installs).toBe(1)
    let settled = false
    const uncertain = update.install().then(() => { settled = true })
    await vi.advanceTimersByTimeAsync(120_000)
    expect(settled).toBe(false)
    expect(listeners.size).toBe(1)
    expect(update.error.value).toBe('confirming')
    expect(update.acting.value).toBe(true)
    await update.install()
    expect(installs).toBe(2)
    window.dispatchEvent(new Event('focus'))
    await vi.advanceTimersByTimeAsync(0)
    expect(update.acting.value).toBe(true) // READY 仍可能是在排队。
    current = { ...ready, revision: 2, download: { ...ready.download, state: 'installRequested' } }
    window.dispatchEvent(new Event('focus'))
    await vi.advanceTimersByTimeAsync(0)
    expect(update.acting.value).toBe(true) // snapshot 不能代替仍在等待的关联回复。
    respond(installRequest!.id, true)
    await vi.advanceTimersByTimeAsync(0)
    await uncertain
    expect(update.acting.value).toBe(false)
    expect(update.error.value).toBeNull()
    expect(listeners.size).toBe(0)
  } finally { wrapper.unmount() }
})
