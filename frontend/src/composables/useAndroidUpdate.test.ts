// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { createMemoryHistory, createRouter, useRoute } from 'vue-router'
import type { Router } from 'vue-router'
import { flushPromises, mount } from '@vue/test-utils'
import { isAndroidUpdateSnapshot, useAndroidUpdate } from './useAndroidUpdate.js'
import type { AndroidUpdateController, AndroidUpdateSnapshot } from '../shared/androidUpdate.js'

const bridge = vi.hoisted(() => ({
  isAndroidApp: vi.fn(), getCapabilities: vi.fn(), getUpdateStatus: vi.fn(),
  refreshUpdateStatus: vi.fn(), beginUpdateDownload: vi.fn(), installUpdate: vi.fn(), dismissOptionalUpdate: vi.fn(),
}))
vi.mock('./usePlatformBridge.js', () => bridge)

function snapshot(revision = 1): AndroidUpdateSnapshot {
  return {
    revision, state: 'optional', checkState: 'succeeded', checkFailureReason: null,
    currentVersionName: '3.27.2', currentVersionCode: 3027002,
    latestVersionName: '3.28.0', latestVersionCode: 3028000, minSupportedVersionCode: 3017007,
    publishedAt: null, releaseNotes: null, optionalPromptSuppressed: false,
    download: { taskToken: null, versionName: null, versionCode: null, state: 'idle',
      downloadedBytes: null, totalBytes: null, progressPercent: null, failureReason: null },
  }
}

const mounted: ReturnType<typeof mount>[] = []
function start(router?: Router) {
  let update!: AndroidUpdateController
  mounted.push(mount(defineComponent({
    setup() { update = useAndroidUpdate(router ? { route: useRoute(), router } : undefined); return () => null },
  }), { global: { plugins: router ? [router] : [] } }))
  return update
}

beforeEach(() => {
  vi.clearAllMocks()
  bridge.isAndroidApp.mockReturnValue(true)
  bridge.getCapabilities.mockResolvedValue(['app-update', 'app-update-status'])
  bridge.getUpdateStatus.mockResolvedValue(snapshot())
  bridge.refreshUpdateStatus.mockResolvedValue(snapshot(2))
  bridge.beginUpdateDownload.mockResolvedValue(true)
  bridge.installUpdate.mockResolvedValue(true)
  bridge.dismissOptionalUpdate.mockResolvedValue(true)
})
afterEach(() => { mounted.splice(0).forEach(wrapper => wrapper.unmount()) })

describe('Android update Native projection', () => {
  it('opens a notification request only after capability discovery and consumes just its marker once', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/tool', component: { template: '<p />' } }] })
    await router.push('/tool?view=more&androidUpdate=1&keep=value#details')
    let ready!: (capabilities: string[]) => void
    bridge.getCapabilities.mockReturnValue(new Promise(resolve => { ready = resolve }))
    const update = start(router)
    await flushPromises()
    expect(update.panelOpen.value).toBe(false)
    expect(router.currentRoute.value.query.androidUpdate).toBe('1')
    ready(['app-update-status'])
    await flushPromises()
    expect(update.panelOpen.value).toBe(true)
    expect(router.currentRoute.value.path).toBe('/tool')
    expect(router.currentRoute.value.query).toEqual({ view: 'more', keep: 'value' })
    expect(router.currentRoute.value.hash).toBe('#details')
    update.close()
    window.dispatchEvent(new Event('focus'))
    await flushPromises()
    expect(update.panelOpen.value).toBe(false)
    router.options.history.destroy()
  })

  it.each(['web', 'legacy'])('does not consume a notification marker or open a modal on %s', async runtime => {
    bridge.isAndroidApp.mockReturnValue(runtime !== 'web')
    bridge.getCapabilities.mockResolvedValue(['app-update'])
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<p />' } }] })
    await router.push('/?view=more&androidUpdate=1#details')
    const update = start(router)
    await flushPromises()
    expect(update.panelOpen.value).toBe(false)
    expect(router.currentRoute.value.query.androidUpdate).toBe('1')
    expect(router.currentRoute.value.hash).toBe('#details')
    router.options.history.destroy()
  })

  it('does not check the network or open a panel on optional startup', async () => {
    const update = start()
    await flushPromises()
    expect(update.supported.value).toBe(true)
    expect(update.showPrompt.value).toBe(true)
    expect(update.panelOpen.value).toBe(false)
    expect(bridge.refreshUpdateStatus).not.toHaveBeenCalled()
    await update.open()
    expect(update.panelOpen.value).toBe(true)
    expect(bridge.refreshUpdateStatus).not.toHaveBeenCalled()
  })

  it.each([false, true])('hides new UI for Web or an old Native capability (%s)', async android => {
    bridge.isAndroidApp.mockReturnValue(android)
    bridge.getCapabilities.mockResolvedValue(['app-update'])
    const update = start()
    await flushPromises()
    expect(update.supported.value).toBe(false)
    expect(update.showPrompt.value).toBe(false)
    expect(bridge.getUpdateStatus).not.toHaveBeenCalled()
  })

  it('suppression and mandatory classification remain Native-owned', async () => {
    const status = snapshot()
    status.optionalPromptSuppressed = true
    bridge.getUpdateStatus.mockResolvedValue(status)
    const update = start()
    await flushPromises()
    expect(update.showPrompt.value).toBe(false)
    await update.open()
    expect(update.snapshot.value?.state).toBe('optional')
    const mandatory = { ...snapshot(2), state: 'mandatory', optionalPromptSuppressed: true }
    bridge.getUpdateStatus.mockResolvedValue(mandatory)
    await update.open()
    expect(update.snapshot.value?.state).toBe('mandatory')
    expect(update.showPrompt.value).toBe(false)
  })

  it('exposes checking and explicit failure even while a known mandatory state remains', async () => {
    bridge.getUpdateStatus.mockResolvedValue({ ...snapshot(), state: 'mandatory' })
    const update = start()
    await flushPromises()
    let resolveCheck!: (value: unknown) => void
    bridge.refreshUpdateStatus.mockReturnValue(new Promise(resolve => { resolveCheck = resolve }))
    const pending = update.refresh()
    expect(update.checking.value).toBe(true)
    resolveCheck({ ...snapshot(2), state: 'mandatory', checkState: 'failed', checkFailureReason: 'network' })
    await pending
    expect(update.checking.value).toBe(false)
    expect(update.snapshot.value?.checkState).toBe('failed')
    expect(update.snapshot.value?.state).toBe('mandatory')
    bridge.refreshUpdateStatus.mockResolvedValue(null)
    await update.refresh()
    expect(update.error.value).toBe('unavailable')
    expect(update.snapshot.value?.state).toBe('mandatory')
  })

  it('reads after notification and ignores late snapshots, then restores the previous handler', async () => {
    const previous = vi.fn()
    Reflect.set(window, 'wotbtoolsOnUpdateStatusChanged', previous)
    const update = start()
    await flushPromises()
    const notify = Reflect.get(window, 'wotbtoolsOnUpdateStatusChanged') as () => void
    bridge.getUpdateStatus.mockResolvedValue(snapshot(3))
    notify()
    await flushPromises()
    expect(update.snapshot.value?.revision).toBe(3)
    bridge.getUpdateStatus.mockResolvedValue(snapshot(2))
    notify()
    await flushPromises()
    expect(update.snapshot.value?.revision).toBe(3)
    mounted.pop()?.unmount()
    expect(Reflect.get(window, 'wotbtoolsOnUpdateStatusChanged')).toBe(previous)
    Reflect.deleteProperty(window, 'wotbtoolsOnUpdateStatusChanged')
  })

  it('sends pinned identities for download, install and dismiss without auto-installing', async () => {
    const update = start()
    await flushPromises()
    await update.download()
    expect(bridge.beginUpdateDownload).toHaveBeenCalledWith(3028000)
    expect(bridge.installUpdate).not.toHaveBeenCalled()
    const ready = snapshot(2)
    ready.download = { ...ready.download, state: 'ready', taskToken: 'task-one', versionName: '3.28.0', versionCode: 3028000 }
    bridge.getUpdateStatus.mockResolvedValue(ready)
    await update.open()
    await update.install()
    expect(bridge.installUpdate).toHaveBeenCalledWith('task-one')
    await update.dismiss()
    expect(bridge.dismissOptionalUpdate).toHaveBeenCalledWith(3028000)
    bridge.beginUpdateDownload.mockResolvedValue(false)
    await update.download()
    expect(update.error.value).toBe('rejected')
  })

  it('rejects missing fields, invalid enums and invalid/unknown progress without classifying versions', () => {
    expect(isAndroidUpdateSnapshot(snapshot())).toBe(true)
    expect(isAndroidUpdateSnapshot({ ...snapshot(), state: 'invented' })).toBe(false)
    expect(isAndroidUpdateSnapshot({ ...snapshot(), currentVersionName: undefined })).toBe(false)
    expect(isAndroidUpdateSnapshot({ ...snapshot(), revision: -1 })).toBe(false)
    expect(isAndroidUpdateSnapshot({ ...snapshot(), download: { ...snapshot().download, progressPercent: 101 } })).toBe(false)
    expect(isAndroidUpdateSnapshot({ ...snapshot(), download: { ...snapshot().download, totalBytes: 0 } })).toBe(false)
    expect(isAndroidUpdateSnapshot({ ...snapshot(), download: { ...snapshot().download, packageType: 'delta', state: 'applyingDelta' } })).toBe(true)
    expect(isAndroidUpdateSnapshot({ ...snapshot(), download: { ...snapshot().download, packageType: 'other' } })).toBe(false)
    // An apparently inverted version relation is not reclassified by Vue: Native owns the decision.
    expect(isAndroidUpdateSnapshot({ ...snapshot(), state: 'mandatory', currentVersionCode: 9999999 })).toBe(true)
  })
})
