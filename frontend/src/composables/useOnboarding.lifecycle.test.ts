// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { ONBOARDING_PENDING_LOGIN_KEY } from './useOnboarding.js'
import { createOnboardingTestHelpers, resetOnboardingTestBoundary } from './useOnboarding.testSupport.js'
import type { OnboardingTestBoundary } from './useOnboarding.testSupport.js'

const boundary = vi.hoisted(() => ({ auth: null as unknown as OnboardingTestBoundary['auth'], connectivity: null as unknown as OnboardingTestBoundary['connectivity'], bootstrap: null as unknown as OnboardingTestBoundary['bootstrap'],
  epoch: 1, read: vi.fn(), save: vi.fn(), settled: vi.fn() }))
vi.mock('./useAuth.js', () => ({ useAuth: () => boundary.auth }))
vi.mock('./useConnectivity.js', () => ({ useConnectivity: () => ({ connectivity: boundary.connectivity }) }))
vi.mock('./useBusinessUserBootstrap.js', () => ({
  useBusinessUserBootstrap: () => boundary.bootstrap,
  whenBusinessUserSettled: (...args: unknown[]) => boundary.settled(...args),
}))
vi.mock('../api/onboarding.js', () => ({ readOnboardingReceipt: (...args: unknown[]) => boundary.read(...args), saveOnboardingReceipt: (...args: unknown[]) => boundary.save(...args) }))

const { harness, cache, account, deferred } = createOnboardingTestHelpers(boundary)
beforeEach(() => resetOnboardingTestBoundary(boundary))

describe('real lesson lifecycle', () => {
  it('ignores a late Back action after an external interruption', async () => {
    const h = harness()
    h.controller.start()
    await h.controller.begin()
    h.controller.next()
    await flushPromises()
    h.controller.interrupt()
    h.route.value = 'hof'
    h.controller.back()
    await flushPromises()
    expect(h.controller.index.value).toBe(1)
    expect(h.route.value).toBe('hof')
    expect(h.controller.mode.value).toBe('idle')
    h.wrapper.unmount()
  })
  it('opens the original workspace picker after completion without downgrading its receipt', async () => {
    const h = harness()
    h.controller.start()
    await h.controller.begin()
    for (let i = 0; i < 7; i++) { h.controller.next(); await flushPromises() }
    h.route.value = 'agent-armor'
    await h.controller.useOwnReplay()
    expect(h.route.value).toBe('replay')
    expect(h.chooseOwnReplay).toHaveBeenCalledTimes(1)
    expect(h.cleanup).toHaveBeenCalled()
    expect(h.controller.mode.value).toBe('idle')
    expect(cache().anonymous.disposition).toBe('COMPLETED')
    h.wrapper.unmount()
  })

  it('cancels a pending picker handoff when another guide takes over', async () => {
    const h = harness()
    h.controller.registerWorkspace(null)
    const handoff = h.controller.useOwnReplay()
    await flushPromises()
    h.controller.start('settings')
    await handoff
    expect(h.chooseOwnReplay).not.toHaveBeenCalled()
    expect(h.controller.mode.value).toBe('welcome')
    h.wrapper.unmount()
  })
  it('navigates a cached workspace owner back to its actual page before beginning on Home', async () => {
    const h = harness({ view: 'home', files: true })
    h.controller.start()
    await h.controller.begin(false)
    expect(h.route.value).toBe('replay')
    expect(h.controller.mode.value).toBe('tour')
    h.wrapper.unmount()
  })
  it('records completion only when the core guide reaches its last explicit Next', async () => {
    const h = harness()
    h.controller.start()
    await h.controller.begin()
    for (let i = 0; i < 6; i++) { h.controller.next(); await flushPromises() }
    expect(cache().anonymous.disposition).toBe('OFFERED')
    h.controller.next()
    expect(h.controller.mode.value).toBe('finish')
    expect(cache().anonymous).toEqual({ coreEpoch: 1, disposition: 'COMPLETED' })
    expect(boundary.save).not.toHaveBeenCalled()
    h.wrapper.unmount()
  })
  it('keeps the interrupted core node locally and resumes it from the manual welcome', async () => {
    const h = harness()
    h.controller.start()
    await h.controller.begin()
    for (let i = 0; i < 4; i++) { h.controller.next(); await flushPromises() }
    h.controller.interrupt()
    expect(cache().anonymous.coreStep).toBe(4)
    h.controller.start()
    expect(h.controller.canResume.value).toBe(true)
    await h.controller.resume()
    expect(h.controller.index.value).toBe(4)
    expect(h.controller.currentStage.value.anchor).toBe('playback-declutter')
    h.controller.skip()
    h.controller.start()
    expect(h.controller.canResume.value).toBe(false)
    h.wrapper.unmount()
  })
  it('keeps the official sample loading across Next so the advanced step can use it', async () => {
    const h = harness()
    const pending = deferred<void>()
    h.loadDemo.mockImplementation(async () => {
      await pending.promise
      h.selected.value = true
      h.revision.value++
    })
    h.controller.start()
    const beginning = h.controller.begin()
    await flushPromises()
    const signal = h.loadDemo.mock.calls[0][0]
    expect(signal).toBeInstanceOf(AbortSignal)
    h.controller.next()
    expect(signal?.aborted).toBe(false)
    expect(h.controller.issue.value).toBe('loading')
    pending.resolve()
    await beginning
    await flushPromises()
    expect(h.controller.index.value).toBe(1)
    expect(h.controller.currentStage.value.anchor).toBe('data-toolbar')
    expect(h.controller.issue.value).toBe('')
    h.wrapper.unmount()
  })

  it('reloads the official sample when Retry recovers an unavailable step', async () => {
    const h = harness()
    h.loadDemo.mockRejectedValueOnce(new Error('SAMPLE_UNAVAILABLE'))
    h.controller.start()
    await h.controller.begin()
    expect(h.controller.mode.value).toBe('tour')
    expect(h.controller.issue.value).toBe('unavailable')
    expect(h.controller.index.value).toBe(0)
    expect(h.loadDemo).toHaveBeenCalledTimes(1)

    h.loadDemo.mockImplementation(async () => { h.selected.value = true; h.revision.value++ })
    h.controller.retry()
    await flushPromises()
    expect(h.loadDemo).toHaveBeenCalledTimes(2)
    expect(h.controller.mode.value).toBe('tour')
    expect(h.controller.issue.value).toBe('')
    h.wrapper.unmount()
  })

  it('reloads the sample on Retry without resetting an optional guide to its first step', async () => {
    const h = harness()
    const pending = deferred<void>()
    h.loadDemo.mockImplementation(() => pending.promise)
    h.controller.start('3d')
    const beginning = h.controller.begin(false)
    await flushPromises()
    h.controller.next()
    await flushPromises()
    expect(h.controller.index.value).toBe(1)
    pending.reject(new Error('SAMPLE_UNAVAILABLE'))
    await beginning
    await flushPromises()
    expect(h.controller.issue.value).toBe('unavailable')
    expect(h.controller.topic.value).toBe('3d')
    expect(h.controller.index.value).toBe(1)

    h.controller.registerSurface('3d', { ready: () => true })
    h.loadDemo.mockImplementation(async () => { h.selected.value = true; h.revision.value++ })
    h.controller.retry()
    await flushPromises()
    expect(h.loadDemo).toHaveBeenCalledTimes(2)
    expect(h.controller.index.value).toBe(1)
    expect(h.controller.issue.value).toBe('')
    h.wrapper.unmount()
  })

  it('keeps the current stage when Retry reloads the sample', async () => {
    const h = harness()
    const pending = deferred<void>()
    h.loadDemo.mockImplementation(() => pending.promise)
    h.controller.start('annotations')
    const beginning = h.controller.begin(false)
    await flushPromises()
    h.controller.stageIndex.value = 1
    pending.reject(new Error('SAMPLE_UNAVAILABLE'))
    await beginning
    await flushPromises()
    expect(h.controller.issue.value).toBe('unavailable')

    h.loadDemo.mockImplementation(async () => { h.selected.value = true; h.revision.value++ })
    h.controller.retry()
    await flushPromises()
    expect(h.controller.index.value).toBe(0)
    expect(h.controller.stageIndex.value).toBe(1)
    expect(h.controller.issue.value).toBe('')
    h.wrapper.unmount()
  })

  it('never lets a stale Retry write into a guide started while it was loading', async () => {
    const h = harness()
    h.loadDemo.mockRejectedValueOnce(new Error('SAMPLE_UNAVAILABLE'))
    h.controller.start()
    await h.controller.begin()
    expect(h.controller.issue.value).toBe('unavailable')

    const pending = deferred<void>()
    h.loadDemo.mockImplementation(() => pending.promise)
    void h.controller.retry()
    await flushPromises()
    h.controller.start('hof')
    await h.controller.begin()
    await flushPromises()
    expect(h.controller.topic.value).toBe('hof')
    expect(h.controller.issue.value).toBe('')

    pending.reject(new DOMException('Replay workspace is busy', 'AbortError'))
    await flushPromises()
    expect(h.controller.topic.value).toBe('hof')
    expect(h.controller.mode.value).toBe('tour')
    expect(h.controller.issue.value).toBe('')
    h.wrapper.unmount()
  })

  it('drops the sample-load continuation after the guide is closed during navigation', async () => {
    const h = harness()
    h.controller.start()
    const beginning = h.controller.begin()
    h.controller.skip()
    await beginning
    await flushPromises()
    expect(h.controller.mode.value).toBe('idle')
    expect(h.loadDemo).not.toHaveBeenCalled()
    expect(h.setCapability).not.toHaveBeenCalled()
    h.wrapper.unmount()
  })

  it('never loads the sample when the guide closes while waiting for the workspace', async () => {
    const h = harness()
    h.controller.registerWorkspace(null)
    h.controller.start()
    const beginning = h.controller.begin()
    await flushPromises()
    h.controller.skip()
    h.controller.registerWorkspace({ hasFiles: () => false, busy: () => false, selectionIdentity: () => 2,
      loadDemo: h.loadDemo, chooseOwnReplay: vi.fn(), setCapability: h.setCapability })
    await beginning
    await flushPromises()
    expect(h.loadDemo).not.toHaveBeenCalled()
    expect(h.setCapability).not.toHaveBeenCalled()
    h.wrapper.unmount()
  })

  it('accepts its own demo selection change but interrupts an outside replacement without marking completion', async () => {
    const h = harness()
    h.controller.start()
    await h.controller.begin()
    expect(h.controller.mode.value).toBe('tour')
    expect(h.loadDemo).toHaveBeenCalledTimes(1)
    h.revision.value++
    await nextTick()
    expect(h.controller.mode.value).toBe('idle')
    expect(cache().anonymous.disposition).toBe('OFFERED')
    h.wrapper.unmount()
  })

  it('advances 3D only on real readiness and lets Next bypass unsupported scenes', async () => {
    const h = harness({ files: true })
    const ready = ref(false), failed = ref(false)
    const startScene = vi.fn()
    h.controller.registerSurface('3d', { ready: () => ready.value, failed: () => failed.value, prepare: startScene })
    h.controller.start('3d')
    await h.controller.begin(false)
    expect(h.controller.currentStage.value.anchor).toBe('replay3d-start')
    expect(startScene).not.toHaveBeenCalled()
    ready.value = true
    await nextTick()
    expect(h.controller.currentStage.value.anchor).toBe('replay3d-camera')
    expect(startScene).toHaveBeenCalledTimes(1)
    failed.value = true
    await nextTick()
    expect(h.controller.issue.value).toBe('unavailable')
    h.controller.next()
    await flushPromises()
    expect(h.controller.index.value).toBe(1)
    h.wrapper.unmount()
  })

  it('waits for the Display surface before preparing the declutter step', async () => {
    const h = harness()
    const ready = ref(false), openDisplay = vi.fn()
    h.controller.registerSurface('display', { ready: () => ready.value, prepare: openDisplay })
    h.controller.start()
    await h.controller.begin()
    for (let i = 0; i < 4; i++) { h.controller.next(); await flushPromises() }
    expect(h.controller.currentStage.value.anchor).toBe('playback-declutter')
    expect(openDisplay).not.toHaveBeenCalled()
    ready.value = true
    await flushPromises()
    expect(openDisplay).toHaveBeenCalledTimes(1)
    h.wrapper.unmount()
  })

  it('cleans a canceled surface wait so a late ready signal never runs its command', async () => {
    const h = harness({ files: true })
    const ready = ref(false), prepare = vi.fn()
    h.controller.registerSurface('playback', { ready: () => ready.value, prepare })
    h.controller.start('playback')
    const beginning = h.controller.begin(false)
    await flushPromises()
    h.controller.next()
    ready.value = true
    await beginning
    await flushPromises()
    expect(prepare).not.toHaveBeenCalled()
    expect(h.controller.currentStage.value.anchor).toBe('playback-timeline')
    h.wrapper.unmount()
  })

  it('restores the core shooting list, advances into details and returns after closing the inspector', async () => {
    const h = harness({ files: true })
    const selected = ref(true), staleFilter = ref(true)
    const prepare = vi.fn(() => { selected.value = false; staleFilter.value = false })
    h.controller.registerSurface('shots', { ready: () => selected.value, failed: () => staleFilter.value, prepare })
    h.controller.start()
    await h.controller.begin()
    for (let i = 0; i < 6; i++) { h.controller.next(); await flushPromises() }
    expect(prepare).toHaveBeenCalledTimes(1)
    expect(selected.value).toBe(false)
    expect(h.controller.issue.value).toBe('')
    selected.value = true
    await nextTick()
    expect(h.controller.currentStage.value.anchor).toBe('shot-open-viewer')
    expect(h.controller.stageIndex.value).toBe(1)
    expect(h.controller.currentStep.value.stages).toHaveLength(3)
    selected.value = false
    await nextTick()
    expect(h.controller.currentStage.value.anchor).toBe('shots-first-shot')
    h.controller.next()
    expect(h.controller.mode.value).toBe('finish')
    expect(cache().anonymous.disposition).toBe('COMPLETED')
    h.wrapper.unmount()
  })

  it('keeps an anonymous AI guide request parked across the native login RPC, then resumes it (#670)', async () => {
    boundary.auth.login.mockImplementation(() => { boundary.auth.loginInFlight.value = true })
    const h = harness()
    h.controller.start('ai')
    await h.controller.begin()
    expect(h.controller.mode.value).toBe('welcome')
    expect(h.loadDemo).not.toHaveBeenCalled()
    expect(h.route.value).toBe('home')
    h.controller.loginAiGuide()
    expect(boundary.auth.login).toHaveBeenCalledWith('ai-review')
    expect(h.controller.mode.value).toBe('idle')
    expect(JSON.parse(sessionStorage.getItem(ONBOARDING_PENDING_LOGIN_KEY) || 'null')?.guide)
      .toEqual(expect.objectContaining({ topic: 'ai', index: 0, stageIndex: 0 }))
    boundary.auth.loginInFlight.value = false
    await nextTick()
    expect(JSON.parse(sessionStorage.getItem(ONBOARDING_PENDING_LOGIN_KEY) || 'null')?.guide)
      .toEqual(expect.objectContaining({ topic: 'ai', index: 0, stageIndex: 0 }))
    account('signed-in')
    await flushPromises()
    await flushPromises()
    expect(h.controller.mode.value).toBe('tour')
    expect(h.controller.topic.value).toBe('ai')
    expect(h.loadDemo).toHaveBeenCalledTimes(1)
    expect(sessionStorage.getItem(ONBOARDING_PENDING_LOGIN_KEY)).toBeNull()
    h.wrapper.unmount()
  })
  it('advances the optional shot guide from real row selection to the real armor handoff', async () => {
    const h = harness({ files: true })
    const selected = ref(false), armor = ref(false)
    h.controller.registerSurface('shots', { ready: () => selected.value })
    h.controller.registerSurface('armor', { ready: () => armor.value })
    h.controller.start('shots')
    await h.controller.begin(false)
    selected.value = true
    await flushPromises()
    expect(h.controller.index.value).toBe(1)
    expect(h.controller.currentStage.value.anchor).toBe('shot-open-viewer')
    h.route.value = 'agent-armor'
    armor.value = true
    await flushPromises()
    expect(h.controller.index.value).toBe(2)
    expect(h.controller.currentStage.value.anchor).toBe('armor-workspace')
    expect(h.controller.mode.value).toBe('tour')
    h.wrapper.unmount()
  })
})
