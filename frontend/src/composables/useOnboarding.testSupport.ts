import { mount } from '@vue/test-utils'
import { defineComponent, ref } from 'vue'
import type { Ref } from 'vue'
import { vi } from 'vitest'
import type { Mock } from 'vitest'
import { ONBOARDING_STORAGE_KEY, useOnboarding } from './useOnboarding.js'
import type { OnboardingController } from './useOnboarding.js'

type AsyncTestMock = Mock<(...args: unknown[]) => Promise<unknown>>
type SyncTestMock = Mock<(...args: unknown[]) => unknown>

export interface OnboardingTestBoundary {
  auth: {
    authenticated: Ref<boolean>
    authInitState: Ref<string>
    tokenParsed: Ref<{ sub: string } | null>
    login: SyncTestMock
    loginInFlight: Ref<boolean>
    authEpoch: () => number
  }
  connectivity: Ref<string>
  bootstrap: { state: Ref<string> }
  epoch: number
  read: AsyncTestMock
  save: AsyncTestMock
  settled: AsyncTestMock
}

export function createOnboardingTestHelpers(boundary: OnboardingTestBoundary) {
  function harness({ view = 'home', invite = false, files = false } = {}) {
    const route = ref(view)
    const canInvite = ref(invite)
    const selected = ref(files)
    const revision = ref(0)
    const busy = ref(false)
    const prepare = vi.fn()
    const cleanup = vi.fn()
    let controller!: OnboardingController
    const wrapper = mount(defineComponent({ setup() {
      controller = useOnboarding({ view: route, canInvite, navigate: async view => { route.value = view } })
      return () => null
    } }))
    const loadDemo = vi.fn(async (signal?: AbortSignal) => { if (!signal?.aborted) { selected.value = true; revision.value++ } })
    const chooseOwnReplay = vi.fn()
    const setCapability = vi.fn()
    controller.registerWorkspace({ hasFiles: () => selected.value, busy: () => busy.value,
      selectionIdentity: () => revision.value, loadDemo, chooseOwnReplay, setCapability })
    controller.registerSurface('playback', { ready: () => true, prepare, cleanup })
    controller.registerSurface('display', { ready: () => true, prepare, cleanup })
    return { controller, wrapper, route, canInvite, selected, revision, busy, loadDemo, chooseOwnReplay, setCapability, prepare, cleanup }
  }

  function cache() { return JSON.parse(localStorage.getItem(ONBOARDING_STORAGE_KEY) || '{"receipts":{}}').receipts }

  function account(sub: string | null) {
    boundary.epoch++
    boundary.auth.authenticated.value = !!sub
    boundary.auth.tokenParsed.value = sub ? { sub } : null
    boundary.auth.authInitState.value = sub ? 'authenticated' : 'unauthenticated'
  }

  function deferred<T>() {
    let resolve!: (value: T) => void
    let reject!: (reason?: unknown) => void
    const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
    return { promise, resolve, reject }
  }

  return { harness, cache, account, deferred }
}

export function resetOnboardingTestBoundary(boundary: OnboardingTestBoundary) {
  localStorage.clear()
  sessionStorage.clear()
  boundary.epoch = 1
  boundary.auth = { authenticated: ref(false), authInitState: ref('unauthenticated'), tokenParsed: ref<{ sub: string } | null>(null), login: vi.fn(), loginInFlight: ref(false), authEpoch: () => boundary.epoch }
  boundary.connectivity = ref('online')
  boundary.bootstrap = { state: ref('ready') }
  boundary.read.mockReset().mockResolvedValue({ coreEpoch: 0, disposition: 'NONE' })
  boundary.save.mockReset().mockImplementation(async (receipt: unknown) => receipt)
  boundary.settled.mockReset().mockResolvedValue(true)
}
